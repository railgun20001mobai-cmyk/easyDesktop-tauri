#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod config;
mod files;
mod icons;
mod preview;
mod win32;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

static WINDOW_VISIBLE: AtomicBool = AtomicBool::new(false);
static LOCKED: AtomicBool = AtomicBool::new(false);
/// 可见性锁的引用计数：设置面板锁着时，子对话框（重命名/删除等）关闭会无条件解锁，
/// 用计数就不会把设置面板的锁一起清掉（问：设置到一半鼠标滑出去面板自己关了）
static LOCK_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// 加锁：面板保持显示，不被"鼠标移出/失焦即收起"收走
pub fn lock_visibility() {
    let n = LOCK_COUNT.fetch_add(1, Ordering::SeqCst) + 1;
    LOCKED.store(true, Ordering::SeqCst);
    log(&format!("lock visibility (n={})", n));
}

/// 解锁：计数归零才真正允许自动收起
pub fn unlock_visibility() {
    let prev = LOCK_COUNT
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| Some(n.saturating_sub(1)))
        .unwrap_or(0);
    if prev <= 1 {
        LOCK_COUNT.store(0, Ordering::SeqCst);
        LOCKED.store(false, Ordering::SeqCst);
        log("unlock visibility (n=0 -> 可自动收起)");
    } else {
        log(&format!("unlock visibility (n={} -> 仍锁着)", prev - 1));
    }
}
/// 面板展开后是否还没抢到前台焦点（WebView2 非激活时会吞掉第一次点击）
static NEEDS_ACTIVATION: AtomicBool = AtomicBool::new(false);
/// 是否处于「调整尺寸」模式（此时窗口可拖拽缩放，尺寸变化要实时保存）
pub static FIT_MODE: AtomicBool = AtomicBool::new(false);

/// 设置里的"防打扰"：有全屏程序时不触发面板
fn trigger_blocked() -> bool {
    let fdr = config::get()
        .get("fdr")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    fdr && win32::foreground_is_fullscreen()
}

/// 旧版 config/app_config.py 里的 WINDOW_POSITION_RATIO
const WINDOW_POSITION_RATIO: f64 = 0.1;


/// 热区是否"已武装"：收起之后，鼠标必须先离开热区，再进入才允许呼出
///
/// 否则鼠标停在左下角不动时：收起一结束（WINDOW_VISIBLE 已是 false），热区轮询
/// 立刻判定"该呼出"→ 面板又滑进来 → 但后台进程通常抢不到前台焦点 →
/// 500ms 后又被判定"失焦收起"，观感就是"收起末尾闪一下页面"。
static CORNER_ARMED: AtomicBool = AtomicBool::new(true);
/// 鼠标进入热区的时间（0 = 不在热区），用于旧版那种「停留 N 毫秒才触发」
static CORNER_ENTER: AtomicU64 = AtomicU64::new(0);
/// 上次「补抢焦点」的时间：轮询在 NEEDS_ACTIVATION 期间是 16ms 一拍，
/// 不限流会变成每秒几十次 SetForegroundWindow，日志里全是重试且从没成功过
static LAST_ACTIVATE_AT: AtomicU64 = AtomicU64::new(0);
/// 本次呼出是否已经记过一条「因鼠标仍在面板/热区而没收起」的日志
static SUPPRESS_LOGGED: AtomicBool = AtomicBool::new(false);

/// 写一行日志到 exe 同目录的 ed_calls.log（正式版也写：出问题时有据可查）
fn log(msg: &str) {
    use std::io::Write;
    log_rotate_if_needed();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(config::exe_dir().join("ed_calls.log"))
    {
        // 带本地时间戳：排查问题时要能和系统事件日志（重启/蓝屏/崩溃）对时间线
        let _ = writeln!(f, "[{}] [rust] {}", win32::local_time_str(), msg);
    }
}

/// 日志上限 512KB，超了就从零开始（日志只用于排查问题，不该无限增长）
///
/// 每 128 次写入才 stat 一次，避免频繁系统调用。
pub fn log_rotate_if_needed() {
    const LOG_MAX: u64 = 512 * 1024;
    static TICK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    if TICK.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % 128 != 0 {
        return;
    }
    let path = config::exe_dir().join("ed_calls.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX {
            let _ = std::fs::write(&path, "[rust] 日志超过 512KB，已重置\n");
        }
    }
}

static START_INSTANT: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
/// 最近一次展开的毫秒时间戳
static SHOWN_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn now_ms() -> u64 {
    START_INSTANT
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis() as u64
}

fn out_cf_type() -> String {
    config::get()
        .get("out_cf_type")
        .and_then(|v| v.as_str())
        .unwrap_or("2")
        .to_string()
}

fn out_pos() -> String {
    config::get()
        .get("outPos")
        .and_then(|v| v.as_str())
        .unwrap_or("1")
        .to_string()
}

/// 面板最终位置与尺寸（与旧版 tool.get_targetPos 公式一致）
fn target_rect() -> (i32, i32, u32, u32) {
    let cfg = config::get();
    let (sw, sh) = win32::screen_size();
    let full = cfg
        .get("full_screen")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let (wid, hei) = if full {
        (sw, sh)
    } else {
        // 旧版按「分辨率 缩放%」记忆面板尺寸（由"调整尺寸"保存），优先用记忆值
        let key = format!("{}x{} {}%", sw, sh, win32::screen_scale_percent());
        let saved = cfg
            .get("screens_winInfo")
            .and_then(|v| v.get("infos"))
            .and_then(|v| v.get(&key));
        match saved {
            Some(v) => (
                v.get("w").and_then(|x| x.as_i64()).unwrap_or(1664) as i32,
                v.get("h").and_then(|x| x.as_i64()).unwrap_or(640) as i32,
            ),
            None => (
                cfg.get("width").and_then(|v| v.as_i64()).unwrap_or(1664) as i32,
                cfg.get("height").and_then(|v| v.as_i64()).unwrap_or(640) as i32,
            ),
        }
    };

    let (x, y) = if full {
        (0, 0)
    } else {
        // 调整尺寸时拖左/上边缘会移动窗口，这里优先用记忆的位置
        // （只有记忆时的"呼出位置"和当前一致才用，用户改了呼出位置就重新锚定）
        let key = format!("{}x{} {}%", sw, sh, win32::screen_scale_percent());
        let saved = cfg
            .get("screens_winInfo")
            .and_then(|v| v.get("infos"))
            .and_then(|v| v.get(&key));
        let saved_pos = saved.and_then(|v| {
            let sx = v.get("x").and_then(|x| x.as_i64())?;
            let sy = v.get("y").and_then(|x| x.as_i64())?;
            let sp = v.get("outPos").and_then(|x| x.as_str()).unwrap_or("");
            if sp == out_pos() {
                Some((sx as i32, sy as i32))
            } else {
                None
            }
        });
        match saved_pos {
            Some((sx, sy)) => (
                sx.clamp(0, (sw - wid).max(0)),
                sy.clamp(0, (sh - hei).max(0)),
            ),
            None => {
                let swf = sw as f64;
                let shf = sh as f64;
                let x_left = (swf * WINDOW_POSITION_RATIO) as i32;
                let x_mid = ((sw - wid) / 2) as i32;
                let y_bottom = (shf - (shf * WINDOW_POSITION_RATIO + hei as f64)) as i32;
                let y_top = (shf * WINDOW_POSITION_RATIO) as i32;
                match out_pos().as_str() {
                    "2" => (x_left, y_top),
                    "3" => (x_mid, y_bottom),
                    "4" => (x_mid, y_top),
                    _ => (x_left, y_bottom),
                }
            }
        }
    };
    // 注意：本函数被热区轮询每 80ms 调用一次，不要在这里打日志（会刷爆 ed_calls.log）
    (x, y, wid.max(1) as u32, hei.max(1) as u32)
}

fn apply_rect(w: &WebviewWindow, x: i32, y: i32, wid: u32, hei: u32) {
    let _ = w.set_size(PhysicalSize::new(wid, hei));
    let _ = w.set_position(PhysicalPosition::new(x, y));
    // 面板四角是圆角（旧版效果），尺寸变了要重裁
    if let Ok(h) = w.hwnd() {
        win32::apply_round_corners(h.0 as isize, wid as i32, hei as i32);
    }
}

/// 保存面板尺寸+位置到 config（旧版 screens_winInfo 按「分辨率 缩放%」分别记忆）
///
/// 位置也一并保存：用户拖左/上边缘调整时窗口会移动，
/// 只存尺寸的话下次呼出会被重新锚回角落（看起来"只有右边变长"）。
pub fn save_panel_size(w: u32, h: u32, x: i32, y: i32) {
    let (sw, sh) = win32::screen_size();
    if sw <= 0 || sh <= 0 {
        return;
    }
    let key = format!("{}x{} {}%", sw, sh, win32::screen_scale_percent());
    let mut cfg = config::get();
    if let Some(o) = cfg.as_object_mut() {
        o.insert("width".into(), serde_json::json!(w));
        o.insert("height".into(), serde_json::json!(h));
        let info = o
            .entry("screens_winInfo")
            .or_insert_with(|| serde_json::json!({}));
        if let Some(io) = info.as_object_mut() {
            io.insert("w_pc".into(), serde_json::json!(w as f64 / sw as f64));
            io.insert("h_pc".into(), serde_json::json!(h as f64 / sh as f64));
            let infos = io.entry("infos").or_insert_with(|| serde_json::json!({}));
            if let Some(map) = infos.as_object_mut() {
                // outPos 记录下来：用户改了"呼出位置"就忽略这次记忆的坐标
                map.insert(
                    key,
                    serde_json::json!({
                        "w": w,
                        "h": h,
                        "x": x,
                        "y": y,
                        "outPos": out_pos(),
                    }),
                );
            }
        }
    }
    config::set_all(cfg);
}

/// 让面板立刻按当前配置重排（全屏模式/呼出位置等改了要即时生效）
pub fn reapply_rect(handle: &tauri::AppHandle) {
    let h = handle.clone();
    let h2 = handle.clone();
    let _ = h.run_on_main_thread(move || {
        if let Some(w) = h2.get_webview_window("main") {
            let (tx, ty, tw, th) = target_rect();
            let _ = w.set_size(PhysicalSize::new(tw, th));
            let _ = w.set_position(PhysicalPosition::new(tx, ty));
        }
    });
}

/// 滑出动画的起始位置：从「呼出位置」所在方向、屏幕外滑入
///
/// 公式照抄旧版 src/windowMgr.py（show 分支的 start_x / start_y）：
/// 左侧位置整体藏在屏幕左边、纵向错开半屏；上下位置左右居中、整体藏在屏幕外。
/// 全程只改位置、不改尺寸，所以画面不会被重新布局（图标不会自己排列）。
fn slide_from() -> (i32, i32) {
    let (_tx, _ty, tw, th) = target_rect();
    let (sw, sh) = win32::screen_size();
    let w = tw as i32;
    let h = th as i32;
    match out_pos().as_str() {
        "2" => (-w, -h / 2),                         // 左上角
        "3" => ((sw - w) / 2, sh + h),               // 正下方
        "4" => ((sw - w) / 2, -h),                   // 正上方
        _ => (-w, sh - h / 2),                       // 左下角（默认）
    }
}

/// 热区边长与停留时间：旧版 config/app_config.py 的 cornerSize_m
///
/// 严格/中等/宽松 = (区域边长像素, 需要停留的毫秒数)。区域非常小（10 像素级），
/// 之前按屏幕 6% 算是错的，会让鼠标路过左下角就误触。
fn corner_size_cfg() -> (i32, u64) {
    match config::get()
        .get("corner_size")
        .and_then(|v| v.as_str())
        .unwrap_or("2")
    {
        "1" => (1, 300),
        "3" => (25, 0),
        _ => (10, 100),
    }
}

/// 热区矩形：旧版 src/tool.py 的 is_desktop_and_mouse_in_corner
fn corner_rect(cs: i32) -> (i32, i32, i32, i32) {
    let (sw, sh) = win32::screen_size();
    match out_pos().as_str() {
        "2" => (0, 0, cs, cs),                          // 左上角
        "3" => (sw / 3, sh - cs, sw - sw / 3, sh),      // 底部中间 1/3
        "4" => (sw / 3, 0, sw - sw / 3, cs),            // 顶部中间 1/3
        _ => (0, sh - cs, cs, sh),                      // 左下角（默认）
    }
}

/// 唤起热区的「宽松版」矩形：位置跟 corner_rect 一致，但按屏幕比例放大。
///
/// 收起判定要用它而不是 corner_rect：触发判定要求精确（1~25px），
/// 但"鼠标是否还在唤起位置附近"这个判断需要容差，否则手一抖面板就收了。
fn generous_hot_zone() -> (i32, i32, i32, i32) {
    let (sw, sh) = win32::screen_size();
    let zw = (sw as f32 * 0.06).max(60.0) as i32;
    let zh = (sh as f32 * 0.06).max(60.0) as i32;
    match out_pos().as_str() {
        "2" => (0, 0, zw, zh),
        "3" => (sw / 3, sh - zh, sw - sw / 3, sh),
        "4" => (sw / 3, 0, sw - sw / 3, zh),
        _ => (0, sh - zh, zw, sh),
    }
}

/// 三次贝塞尔缓动求解，与 CSS 的 cubic-bezier(x1,y1,x2,y2) 数学等价
///
/// 窗口位置由 Rust 逐帧 set_position 驱动，而内容那层是 CSS 动画；
/// 两边必须用同一条曲线，否则会一个"软"一个"硬"。
/// 做法：牛顿迭代反解 x 对应的参数 t，再代入求 y（x 单调，收敛很快）。
fn cubic_bezier_ease(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let cx = 3.0 * x1;
    let bx = 3.0 * (x2 - x1) - cx;
    let ax = 1.0 - cx - bx;
    let cy = 3.0 * y1;
    let by = 3.0 * (y2 - y1) - cy;
    let ay = 1.0 - cy - by;
    let mut t = x;
    for _ in 0..8 {
        let f = ((ax * t + bx) * t + cx) * t - x;
        let df = (3.0 * ax * t + 2.0 * bx) * t + cx;
        if df.abs() < 1e-6 {
            break;
        }
        let nt = (t - f / df).clamp(0.0, 1.0);
        if (nt - t).abs() < 1e-7 {
            t = nt;
            break;
        }
        t = nt;
    }
    ((ay * t + by) * t + cy) * t
}

/// 面板进场/退场的时长（与 frame.css 的 --md-motion-dur-* 令牌一致）
///
/// 非对称：进场长一点（内容有时间"落下来"），退场短一点（干脆利落）。
const PANEL_IN_MS: u64 = 340;
const PANEL_OUT_MS: u64 = 240;
/// 强调型减速 cubic-bezier(0.2, 0, 0, 1) —— 进场
const EASE_ENTER: (f64, f64, f64, f64) = (0.2, 0.0, 0.0, 1.0);
/// 强调型加速 cubic-bezier(0.3, 0, 0.8, 0.15) —— 退场
const EASE_EXIT: (f64, f64, f64, f64) = (0.3, 0.0, 0.8, 0.15);

/// 逐帧滑动窗口，约 6ms 一帧（约 160fps）
///
/// `exit = true` 用退场曲线（加速），否则用进场曲线（减速）。
/// 返回 false 表示动画被新的呼出/收起打断（此时调用方不能再做
/// "隐藏窗口"这类收尾动作，否则会把刚呼出的面板藏掉）。
fn slide_window(
    w: &tauri::WebviewWindow,
    from: (i32, i32),
    to: (i32, i32),
    dur_ms: u64,
    gen: u64,
    exit: bool,
) -> bool {
    let t0 = std::time::Instant::now();
    let mut frames = 0u32;
    let mut done = true;
    loop {
        if SLIDE_GEN.load(Ordering::SeqCst) != gen {
            done = false;
            break;
        }
        let el = t0.elapsed().as_millis() as f64;
        let p = (el / dur_ms as f64).min(1.0);
        let e = if exit {
            cubic_bezier_ease(EASE_EXIT.0, EASE_EXIT.1, EASE_EXIT.2, EASE_EXIT.3, p)
        } else {
            cubic_bezier_ease(EASE_ENTER.0, EASE_ENTER.1, EASE_ENTER.2, EASE_ENTER.3, p)
        };
        let x = from.0 as f64 + (to.0 - from.0) as f64 * e;
        let y = from.1 as f64 + (to.1 - from.1) as f64 * e;
        let _ = w.set_position(tauri::PhysicalPosition::new(
            x.round() as i32,
            y.round() as i32,
        ));
        frames += 1;
        if p >= 1.0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(6));
    }
    log(&format!(
        "slide({}): {} frames / {}ms{}",
        if exit { "out" } else { "in" },
        frames,
        t0.elapsed().as_millis(),
        if done { "" } else { " (被打断)" }
    ));
    done
}

/// 动画代号：新的呼出/收起会让旧动画立即停下，避免两边同时改窗口位置
static SLIDE_GEN: AtomicU64 = AtomicU64::new(0);

/// 任务计划里的「快速自启」任务名
const LOGON_TASK: &str = "EasyDesktop";

/// 调 schtasks（隐藏控制台窗口）
fn schtasks(args: &[&str]) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("schtasks")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// 「快速自启」任务是否存在
pub fn logon_task_exists() -> bool {
    schtasks(&["/query", "/tn", LOGON_TASK])
}

/// 删除「快速自启」任务（关掉开机自启时调用）
pub fn remove_logon_task() {
    let _ = schtasks(&["/delete", "/f", "/tn", LOGON_TASK]);
}

/// 开/关「快速自启」
///
/// 用 schtasks 建当前用户的登录任务：登录时更早启动，且不需要 UAC 提权
/// （旧版说明里也写了"不抬进程 CPU 优先级"）。开启时关掉注册表自启，避免双开；
/// 关闭时若用户本来开着注册表自启，就恢复它。
pub fn set_logon_task(app: &tauri::AppHandle, on: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let exe = std::env::current_exe().unwrap_or_default();
    if on {
        let ok = schtasks(&[
            "/create",
            "/f",
            "/tn",
            LOGON_TASK,
            "/tr",
            &format!("\"{}\"", exe.display()),
            "/sc",
            "onlogon",
        ]);
        if ok {
            let _ = app.autolaunch().disable();
        }
        log(&format!("logon task create = {}", ok));
    } else {
        let ok = schtasks(&["/delete", "/f", "/tn", LOGON_TASK]);
        if config::get()
            .get("auto_start")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            let _ = app.autolaunch().enable();
        }
        log(&format!("logon task delete = {}", ok));
    }
}

/// 面板内容层的进出场动效（窗口滑动由 Rust 负责，这一层负责淡入淡出 + 轻微缩放）
///
/// 缩放原点取"呼出位置"那个角，和滑入方向一致；纯 CSS transform/opacity，
/// 不触发重新布局（图标不会重新排列）。时长由调用方传入，和窗口滑动一致。
fn panel_motion_js(show: bool, dur_ms: u64) -> String {
    let origin = match out_pos().as_str() {
        "2" => "left top",
        "3" => "center bottom",
        "4" => "center top",
        _ => "left bottom",
    };
    let cls = if show { "ed-panel-in" } else { "ed-panel-out" };
    // 进场：先摘掉"远离态"再挂动画类，保证第一帧就是动画起点；
    // 收起：动画结束后重新挂回"远离态"（而不是回到最终状态），
    // 这样下次呼出前内容一直是不可见的，不会先闪一帧最终态再跳回起点
    // —— 角落呼出时偶发的"跳变"就是这么来的。
    let tail = if show {
        "b.classList.remove('ed-panel-in');".to_string()
    } else {
        "b.classList.remove('ed-panel-out'); b.classList.add('ed-panel-away');".to_string()
    };
    format!(
        r#"(function(){{
  try{{
    var b=document.body; if(!b) return;
    // 序号：快速连续呼出/收起时，旧动画的收尾动作作废，
    // 否则"收起"的收尾会在面板刚展开后把它变成远离态（内容看不见）
    var my=(window.__edPanelSeq=(window.__edPanelSeq||0)+1);
    b.classList.remove('ed-panel-in','ed-panel-out','ed-panel-away');
    b.style.setProperty('--ed-panel-anim','{dur}ms');
    b.style.transformOrigin='{origin}';
    void b.offsetWidth;
    b.classList.add('{cls}');
    setTimeout(function(){{
      if(window.__edPanelSeq!==my) return;
      {tail}
    }},{dur}+80);
  }}catch(e){{}}
}})();"#,
        dur = dur_ms,
        origin = origin,
        cls = cls,
        tail = tail
    )
}

/// 呼出时执行的 JS：收起设置面板、刷新列表（与旧版行为一致）
fn open_js() -> String {
    // 刷新推迟到进场动画结束后：呼出当帧做全量扫描+重渲染会和滑入动画抢主线程，
    // 表现为"框先出现、内容后出现"。show 时看到的是隐藏期间保留的旧 DOM，不会空白。
    "try{\
      window_state=true;\
      var p=document.getElementById('themeSettingsPanel');if(p)p.style.display='none';\
      if(typeof enableScroll==='function')enableScroll();\
      if(typeof fit_btnBar==='function')fit_btnBar();\
      setTimeout(function(){try{\
        if(typeof NavigationManager!=='undefined')NavigationManager.refreshCurrentPath(true,false,false);\
      }catch(e){console.error('[ed] open refresh failed',e)}},420);\
     }catch(e){console.error('[ed] open refresh failed',e)}"
        .to_string()
}

fn show_panel(handle: &tauri::AppHandle) {
    SHOWN_AT.store(now_ms(), Ordering::SeqCst);
    NEEDS_ACTIVATION.store(true, Ordering::SeqCst);
    // 呼出时会强制关掉设置面板（open_js），所以锁计数一并清零，
    // 避免之前某次加锁没配对解锁导致面板再也自动收不起来
    LOCK_COUNT.store(0, Ordering::SeqCst);
    LOCKED.store(false, Ordering::SeqCst);
    SUPPRESS_LOGGED.store(false, Ordering::SeqCst);
    LAST_ACTIVATE_AT.store(0, Ordering::SeqCst);
    let gen = SLIDE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let h = handle.clone();
    let h2 = handle.clone();
    // 阶段一（仍隐藏）：摆位 + 抖 1px 强制 WebView2 重绘 + 移到屏幕外滑出起点
    let _ = h.run_on_main_thread(move || {
        if let Some(w) = h2.get_webview_window("main") {
            let (tx, ty, tw, th) = target_rect();
            apply_rect(&w, tx, ty, tw, th);
            let _ = w.set_size(PhysicalSize::new(tw, th.saturating_add(1)));
            let _ = w.set_size(PhysicalSize::new(tw, th));
            let (sx, sy) = slide_from();
            apply_rect(&w, sx, sy, tw, th);
            let _ = w.set_always_on_top(true);
        }
    });
    // 阶段二：重绘后留一拍让 WebView2 在屏幕外完成合成，再 show。
    // 否则首帧没合成完，用户看到"窗口框先出现、内容慢一拍弹出"。
    let h3 = handle.clone();
    let h4 = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(60));
        // 这期间发生过新的收起/呼出就作废本次 show
        if SLIDE_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        let _ = h3.run_on_main_thread(move || {
            if let Some(w) = h4.get_webview_window("main") {
                let (tx, ty, _, _) = target_rect();
                let (sx, sy) = slide_from();
                let _ = w.show();
                // 内容层同步淡入 + 轻微缩放（与窗口滑动同时开始、同时结束）
                let _ = w.eval(panel_motion_js(true, PANEL_IN_MS));
                let _ = w.eval(open_js());
                // 抢焦点（AttachThreadInput + Alt 兜底，否则面板会立刻被"失焦收起"规则收掉）
                let _ = w.set_focus();
                let raw = w.hwnd().map(|h| h.0 as isize).unwrap_or(0);
                log(&format!("hwnd raw = {}", raw));
                // 前台是全屏应用时只做温和抢焦点（不 AttachThreadInput、不注入 Alt），
                // 避免和全屏游戏/全屏视频抢线程输入队列
                let gentle = win32::is_fullscreen_foreground();
                if gentle {
                    log("show: 前台是全屏应用，温和抢焦点");
                }
                win32::force_foreground(raw, gentle);
                // 逐帧滑到目标位置（后台线程驱动，不阻塞主线程）
                std::thread::spawn(move || {
                    slide_window(&w, (sx, sy), (tx, ty), PANEL_IN_MS, gen, false);
                });
            }
        });
    });
}

fn hide_panel(handle: &tauri::AppHandle) {
    let gen = SLIDE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    // 收起时解除热区武装：鼠标不离开热区就不会被立刻重新呼出
    CORNER_ARMED.store(false, Ordering::SeqCst);
    // 焦点补偿状态一并清掉，否则收起后仍按 16ms 高频空转
    NEEDS_ACTIVATION.store(false, Ordering::SeqCst);
    let h = handle.clone();
    std::thread::spawn(move || {
        let Some(w) = h.get_webview_window("main") else {
            return;
        };
        let (tx, ty, _, _) = target_rect();
        let (sx, sy) = slide_from();
        // 内容层同步淡出（比进场更快，退场干脆）
        let _ = w.eval(panel_motion_js(false, PANEL_OUT_MS));
        // 原路滑回屏幕外，滑完再隐藏；中途被新的呼出打断就不隐藏
        if !slide_window(&w, (tx, ty), (sx, sy), PANEL_OUT_MS, gen, true) {
            return;
        }
        // 在主线程隐藏并等待完成：@note 隐藏后不要再移动/改尺寸窗口
        // （移动隐藏窗口会闪一帧旧内容），位置由下次 show_panel 自己摆。
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || {
            if let Some(w2) = h2.get_webview_window("main") {
                let _ = w2.hide();
            }
            let _ = done_tx.send(());
        });
        let _ = done_rx.recv_timeout(Duration::from_millis(500));
    });
}

/// 呼出/收起面板（热键与托盘图标共用）
fn toggle_panel(app: &tauri::AppHandle) {
    if WINDOW_VISIBLE.load(Ordering::SeqCst) {
        WINDOW_VISIBLE.store(false, Ordering::SeqCst);
        hide_panel(app);
    } else if !trigger_blocked() {
        // 防打扰：有全屏程序时不触发
        WINDOW_VISIBLE.store(true, Ordering::SeqCst);
        show_panel(app);
    }
}

/// 托盘图标：给用户一个"程序在跑"的可见标志，右键菜单可呼出/退出
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "呼出/收起面板", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 EasyDesktop", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("ed-tray")
        .tooltip("EasyDesktop —— 已启动（Ctrl+Alt+Q 呼出面板）")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => toggle_panel(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击托盘图标 → 呼出/收起面板
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_panel(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    } else {
        log("tray: 未取到默认窗口图标");
    }
    builder.build(app)?;
    log("tray: 托盘图标已创建");
    Ok(())
}

/// 启动时扫一遍默认目录：把新增的快捷方式并进 dir_order
///
/// 用户要求："每次启动软件时读一次桌面图标，更新页面顺序"，
/// 但**不要在呼出面板时重排**（会影响流畅度）。所以这里在启动后延时跑一次：
/// 扫描 → 与已保存顺序合并 → 有变化才写回 dir_order。
/// 顺带把新条目的图标提出来（build_item 里会做），呼出时就不用现算图标了。
pub fn refresh_desktop_order_on_start() {
    let key = config::get()
        .get("df_dir")
        .and_then(|v| v.as_str())
        .unwrap_or("desktop")
        .to_string();
    let dirs = if key.is_empty() || key == "desktop" {
        crate::files::desktop_paths()
    } else {
        vec![std::path::PathBuf::from(&key)]
    };
    let show_hidden = config::get()
        .get("show_hidden_file")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let (exes, dirs_items, files) = crate::files::scan(&dirs, show_hidden);

    // 伪条目（系统项 + 应用组）也算进顺序，否则会被当成"已失效"剔除
    let mut extra: Vec<serde_json::Value> = Vec::new();
    if config::get()
        .get("show_sysApp")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        extra.extend(crate::files::sys_items());
    }
    extra.extend(crate::files::group_items());

    // 已被收进应用组的文件不在主视图里，顺序里也不该有
    let grouped = crate::files::grouped_paths();
    let keep = move |v: &serde_json::Value| {
        !v.get("filePath")
            .and_then(|x| x.as_str())
            .map(|p| grouped.contains(p))
            .unwrap_or(false)
    };
    let (exes, dirs_items, files) = (
        exes.into_iter().filter(|v| keep(v)).collect::<Vec<_>>(),
        dirs_items.into_iter().filter(|v| keep(v)).collect::<Vec<_>>(),
        files.into_iter().filter(|v| keep(v)).collect::<Vec<_>>(),
    );

    let mut all: Vec<serde_json::Value> = Vec::new();
    all.extend(extra);
    all.extend(exes);
    all.extend(dirs_items);
    all.extend(files);
    let n = config::merge_desktop_order(&key, all);
    if n > 0 {
        log(&format!("startup scan: dir_order 已更新，共 {} 项", n));
    } else {
        log("startup scan: 顺序无变化");
    }
}

/// 供 api 层调用（打开文件后收起窗口等）：收起面板并复位状态
pub fn hide_panel_now(handle: &tauri::AppHandle) {
    WINDOW_VISIBLE.store(false, Ordering::SeqCst);
    NEEDS_ACTIVATION.store(false, Ordering::SeqCst);
    hide_panel(handle);
}

/// 左下角热区检测
fn start_corner_watcher(handle: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        // 焦点补偿期间加快轮询，缩小"鼠标刚进面板就点击"的窗口期
        let fast = NEEDS_ACTIVATION.load(Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(if fast { 16 } else { 80 }));

        if LOCKED.load(Ordering::SeqCst) {
            continue;
        }

        if !WINDOW_VISIBLE.load(Ordering::SeqCst) {
            // 只有「鼠标移到指定位置」模式才检测热区；
            // 2/3/4 = win+shift / win+esc / 自定义热键，靠全局热键呼出，
            // 否则鼠标划到左下角（比如去点开始菜单）会莫名其妙弹出面板。
            let corner_mode = config::get()
                .get("cf_type")
                .and_then(|v| v.as_str())
                .unwrap_or("1")
                == "1";
            if !corner_mode {
                CORNER_ENTER.store(0, Ordering::SeqCst);
                continue;
            }
            let (cs, dwell_ms) = corner_size_cfg();
            let (zx1, zy1, zx2, zy2) = corner_rect(cs);
            let (x, y) = win32::cursor_pos();
            let in_zone = x >= zx1 && x <= zx2 && y >= zy1 && y <= zy2;
            if !in_zone {
                // 鼠标离开热区 → 重新武装，下次进入才允许呼出
                CORNER_ARMED.store(true, Ordering::SeqCst);
                CORNER_ENTER.store(0, Ordering::SeqCst);
            } else if CORNER_ARMED.load(Ordering::SeqCst) {
                let enter = CORNER_ENTER.load(Ordering::SeqCst);
                if enter == 0 {
                    CORNER_ENTER.store(now_ms(), Ordering::SeqCst);
                }
                let waited = if enter == 0 {
                    0
                } else {
                    now_ms().saturating_sub(enter)
                };
                // 严格/中等要停够时间才触发，宽松（0ms）进入即触发
                if waited >= dwell_ms {
                    if trigger_blocked() {
                        // 前台是全屏应用（多半在打游戏 / 看全屏视频）：忽略这次热区触发。
                        // 呼出会把面板置顶 + 抢焦点，对全屏应用是被动且危险的操作。
                        log("corner: 前台是全屏应用，已忽略触发");
                        CORNER_ENTER.store(0, Ordering::SeqCst);
                        // 鼠标不离开热区就不再重复判断，离开后才重新武装
                        CORNER_ARMED.store(false, Ordering::SeqCst);
                    } else {
                        WINDOW_VISIBLE.store(true, Ordering::SeqCst);
                        CORNER_ENTER.store(0, Ordering::SeqCst);
                        show_panel(&handle);
                    }
                }
            }
        } else {
            // 面板开着时前台出现了全屏应用（进了游戏 / 全屏视频）→ 立刻收起，
            // 免得一个置顶窗口压在人家上面
            if trigger_blocked() {
                log("hide: 前台出现全屏应用，自动收起面板");
                WINDOW_VISIBLE.store(false, Ordering::SeqCst);
                hide_panel(&handle);
                continue;
            }
            let (px, py, pw, ph) = target_rect();
            let (x, y) = win32::cursor_pos();
            let m = 8; // 边缘容差
            let in_panel = x >= px - m
                && x <= px + pw as i32 + m
                && y >= py - m
                && y <= py + ph as i32 + m;
            let (hx1, hy1, hx2, hy2) = generous_hot_zone();
            let in_hot = x >= hx1 && x <= hx2 && y >= hy1 && y <= hy2;

            // 展开后若没抢到前台焦点，鼠标进入面板时再抢一次：
            // WebView2 在窗口非激活时会吞掉第一次点击（表现为"点一下才有反应"）
            if NEEDS_ACTIVATION.load(Ordering::SeqCst) {
                let since = now_ms().saturating_sub(SHOWN_AT.load(Ordering::SeqCst));
                if win32::is_self_foreground("EasyDesktop_Main") {
                    NEEDS_ACTIVATION.store(false, Ordering::SeqCst);
                } else if since > 2500 {
                    // 兜底窗口结束就不再反复抢，避免和用户其它窗口抢焦点
                    NEEDS_ACTIVATION.store(false, Ordering::SeqCst);
                } else if in_panel
                    && now_ms().saturating_sub(LAST_ACTIVATE_AT.load(Ordering::SeqCst)) >= 250
                {
                    LAST_ACTIVATE_AT.store(now_ms(), Ordering::SeqCst);
                    // 只做温和激活：这里鼠标已经在面板上，用不着 AttachThreadInput + 注入 Alt。
                    // 那套激进手段会在呼出动画刚开始时闪一下窗口状态，表现为"跳变"。
                    log("show: 鼠标进入面板，温和补抢焦点");
                    win32::activate_by_title("EasyDesktop_Main", true);
                }
            }

            // 刚展开的短暂时间内不判断收起，避免动画/焦点尚未就绪就误收起
            if now_ms().saturating_sub(SHOWN_AT.load(Ordering::SeqCst)) < 500 {
                continue;
            }

            let should_hide = if out_cf_type() == "1" {
                // 模式 1：鼠标离开「面板 + 唤起热区」即收起
                // 注意必须按面板真实矩形判断：不同分辨率下面板尺寸不同，
                // 用屏幕比例当边界会把面板上半区误判成"外面"。
                !(in_panel || in_hot)
            } else {
                // 模式 2/3：面板失去前台焦点即收起（与旧版 out_cf_type=2 一致）。
                // 但鼠标还压在面板或唤起热区上时不能收：抢不到前台焦点的场景
                // （全屏游戏用 Alt 松开鼠标后游戏仍是前台，SetForegroundWindow
                // 会被系统前台锁挡掉）会让面板陷入「弹出 → 500ms 失焦收起 →
                // 热区再触发」的闪烁循环，一轮只活 500ms，WebView2 根本来不及
                // 响应 hover，用户必须先点一下把窗口点成前台才能用。
                let lost_focus = !win32::is_self_foreground("EasyDesktop_Main");
                if lost_focus && (in_panel || in_hot) {
                    if !SUPPRESS_LOGGED.swap(true, Ordering::SeqCst) {
                        log(&format!(
                            "hide: 失焦但鼠标仍在面板/热区，暂不收起 cursor=({}, {})",
                            x, y
                        ));
                    }
                    false
                } else {
                    lost_focus
                }
            };

            if should_hide {
                log(&format!(
                    "hide: out_cf_type={} cursor=({}, {}) panel=({}, {}, {}, {})",
                    out_cf_type(),
                    x,
                    y,
                    px,
                    py,
                    pw,
                    ph
                ));
                WINDOW_VISIBLE.store(false, Ordering::SeqCst);
                NEEDS_ACTIVATION.store(false, Ordering::SeqCst);
                hide_panel(&handle);
            }
        }
    });
}

/// 把前端记录的快捷键写法统一成插件认识的格式
fn normalize_hotkey(raw: &str) -> Option<String> {
    if raw.trim().is_empty() {
        return None;
    }
    let mut parts: Vec<String> = Vec::new();
    for p in raw.split('+') {
        let p = p.trim().to_lowercase();
        if p.is_empty() {
            continue;
        }
        let mapped = match p.as_str() {
            "ctrl" | "control" => "Control",
            "alt" => "Alt",
            "shift" => "Shift",
            "win" | "windows" | "super" | "meta" | "left windows" | "right windows" => "Super",
            other => {
                // 单字符主键统一大写
                if other.chars().count() == 1 {
                    parts.push(other.to_uppercase());
                    continue;
                }
                match other {
                    "escape" | "esc" => "Escape",
                    "space" => "Space",
                    "tab" => "Tab",
                    "enter" | "return" => "Enter",
                    "backspace" => "Backspace",
                    "delete" => "Delete",
                    "home" => "Home",
                    "end" => "End",
                    "pageup" | "page up" => "PageUp",
                    "pagedown" | "page down" => "PageDown",
                    "up" => "Up",
                    "down" => "Down",
                    "left" => "Left",
                    "right" => "Right",
                    _ => {
                        parts.push(other.to_uppercase());
                        continue;
                    }
                }
            }
        };
        parts.push(mapped.to_string());
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("+"))
    }
}

/// 按 config 的 cf_type / cf_hotkey 注册全局热键
fn register_hotkey(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    use std::str::FromStr;

    let cfg = config::get();
    let cf_type = cfg.get("cf_type").and_then(|v| v.as_str()).unwrap_or("1").to_string();
    let custom = cfg.get("cf_hotkey").and_then(|v| v.as_str()).unwrap_or("").to_string();

    let spec = match cf_type.as_str() {
        "2" => Some("Super+Shift".to_string()),
        "3" => Some("Super+Escape".to_string()),
        "4" => normalize_hotkey(&custom),
        _ => None, // 1 = 仅角落触发
    };

    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let Some(spec) = spec else {
        log("hotkey: 仅角落触发，未注册全局热键");
        return;
    };
    match Shortcut::from_str(&spec) {
        Ok(sc) => match gs.register(sc) {
            Ok(_) => log(&format!("hotkey registered: {}", spec)),
            Err(e) => log(&format!("hotkey register failed: {} ({})", spec, e)),
        },
        Err(e) => log(&format!("hotkey parse failed: {} ({})", spec, e)),
    }
}

fn main() {
    // 任何 panic 都记进日志（正式版没有控制台，否则崩溃时现场一片空白）
    std::panic::set_hook(Box::new(|info| {
        let bt = std::backtrace::Backtrace::force_capture().to_string();
        let head: Vec<&str> = bt.lines().take(12).collect();
        log(&format!("!!! panic: {} || 调用栈: {}", info, head.join(" <- ")));
    }));

    // 单实例：已有实例在跑就直接退出，避免两个进程抢热区和配置
    if win32::already_running() {
        log("已有实例在运行，本次启动退出");
        return;
    }
    log(&format!(
        "=== 启动 v{} pid={} ===",
        env!("CARGO_PKG_VERSION"),
        std::process::id()
    ));

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    log(&format!("hotkey event: {:?}", event.state()));
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    toggle_panel(app);
                })
                .build(),
        )
        .setup(|app| {
            config::init();

            let handle = app.handle().clone();
            if let Some(w) = handle.get_webview_window("main") {
                let (x, y, wid, hei) = target_rect();
                apply_rect(&w, x, y, wid, hei);
                let _ = w.set_skip_taskbar(true);
                let _ = w.hide();
            }

            // 【调试探针】启动几秒后注入诊断脚本（仅 debug 构建）
            #[cfg(debug_assertions)]
            {
                let h = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(4));
                    let h2 = h.clone();
                    let _ = h.run_on_main_thread(move || {
                        if let Some(w) = h2.get_webview_window("main") {
                            let js = r#"(function(){
                            /* 【临时排查】挂 JS 错误钩子，运行期任何前端报错都会写进日志 */
                            try{
                            window.addEventListener('error', function(ev){ try{ window.__TAURI_INTERNALS__.invoke('pywebview_call',{method:'__ui',args:['JS错误: '+(ev.message||'')+' @'+(ev.filename||'')+':'+(ev.lineno||0)]}); }catch(e){} });
                            window.addEventListener('unhandledrejection', function(ev){ try{ window.__TAURI_INTERNALS__.invoke('pywebview_call',{method:'__ui',args:['Promise未处理: '+String(ev.reason).slice(0,150)]}); }catch(e){} });
                            }catch(e){}
                            var info = {
    hasInternals: !!window.__TAURI_INTERNALS__,
    hasPywebview: !!window.pywebview,
    hasEdJs: typeof Utils !== 'undefined',
    readyState: document.readyState,
    bodyLen: document.body ? document.body.innerHTML.length : -1,
    err: window.__edErr || null,
    url: location.href
  };
  try { window.__TAURI_INTERNALS__.invoke('pywebview_call', { method: '__diag', args: [info] }); } catch (e) {}
})()"#;
                            let _ = w.eval(js);
                        }
                    });
                });
            }

            register_hotkey(app.handle());
            // 托盘图标失败不影响主流程（例如被安全软件拦截）
            if let Err(e) = setup_tray(app.handle()) {
                log(&format!("tray 创建失败: {}", e));
            }
            // 启动后延时扫一次桌面，把新增快捷方式并进顺序（呼出时就不用重排了）
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(4));
                refresh_desktop_order_on_start();
            });
            start_corner_watcher(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::pywebview_call,
            api::set_visibility_lock,
            api::toggle_window
        ])
        .build(tauri::generate_context!())
        .expect("EasyDesktop 启动失败")
        .run(|_app, event| {
            // 正常退出会走到这里（托盘「退出」）。反过来说：日志里只有启动行、
            // 没有这行结束行，就说明进程是被外部杀掉或随系统一起挂掉的。
            if let tauri::RunEvent::Exit = event {
                log("app exit (正常退出)");
            }
        });
}
