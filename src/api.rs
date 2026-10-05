//! pywebview API 兼容层
//!
//! 前端 ed.js 完全不用改：它通过 `window.pywebview.api[方法名](...参数)` 调用后端。
//! 这里用一个统一的 `pywebview_call(method, args)` 命令接收并分发，
//! 把 Python 版 AppAPI 的方法逐个用 Rust 实现。

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::Manager;

const VERSION: &str = "1.0.0";

/// 复制到剪贴板的文件路径（对应旧版的复制/粘贴）
static CLIPBOARD: Mutex<Option<Vec<String>>> = Mutex::new(None);

fn s(args: &[Value], i: usize) -> String {
    args.get(i)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// 默认目录的键：桌面时是 "desktop"，自定义时是该目录的绝对路径
/// （与旧版一致：dir_order / user_class.json 都按这个键分组）
fn root_key() -> String {
    crate::config::get()
        .get("df_dir")
        .and_then(|v| v.as_str())
        .unwrap_or("desktop")
        .to_string()
}

fn is_root(p: &str) -> bool {
    if matches!(p, "desktop" | "" | "\\" | "/" | "\\\\") {
        return true;
    }
    // 自定义默认目录：前端回根时会传 config.df_dir（绝对路径）
    let key = root_key();
    !key.is_empty() && key != "desktop" && p == key
}

/// 根目录要扫描的文件夹：桌面模式 = 用户桌面 + 公共桌面；自定义模式 = 那一个目录
fn root_dirs() -> Vec<PathBuf> {
    let key = root_key();
    if key.is_empty() || key == "desktop" {
        crate::files::desktop_paths()
    } else {
        vec![PathBuf::from(key)]
    }
}

fn desktop_dirs() -> Vec<PathBuf> {
    crate::files::desktop_paths()
}

/// 主分发入口
#[tauri::command]
pub fn pywebview_call(
    method: String,
    args: Vec<Value>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    // 记录前端调用便于排查：
    // - `__` 开头的是自检/探针方法，调用极少，正式版也记（否则线上出问题没法定位）；
    // - 其余调用量大的只在 debug 构建记。
    {
        use std::io::Write;
        let is_probe = method.starts_with("__");
        #[cfg(not(debug_assertions))]
        let should_log = is_probe;
        #[cfg(debug_assertions)]
        let should_log = is_probe
            || !matches!(
                method.as_str(),
                // 高频调用，打日志会把排查信息淹掉
                "mouse_state" | "drag_posMoveAction"
            );
        if should_log {
            crate::log_rotate_if_needed();
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(crate::config::exe_dir().join("ed_calls.log"))
            {
                let ts = crate::win32::local_time_str();
                if is_probe {
                    let _ = writeln!(f, "[{}] {} {:?}", ts, method, args);
                } else {
                    let _ = writeln!(f, "[{}] {}", ts, method);
                }
            }
        }
    }
    Ok(dispatch(&method, &args, &app))
}

#[tauri::command]
pub fn set_visibility_lock(locked: bool) {
    // 与 lock/unlock_window_visibility 共用引用计数，避免直接写 LOCKED 把设置面板的锁提前清掉
    if locked {
        crate::lock_visibility();
    } else {
        crate::unlock_visibility();
    }
}

#[tauri::command]
pub fn toggle_window(app: tauri::AppHandle, show: bool) {
    let h = app.clone();
    let h2 = app.clone();
    let _ = h.run_on_main_thread(move || {
        if let Some(w) = h2.get_webview_window("main") {
            if show {
                let _ = w.show();
                let _ = w.set_focus();
            } else {
                // 托盘隐藏这条路径不经过滑动动画：至少把内容切到"远离态"，
                // 否则下次呼出会先闪一帧最终状态（和角落呼出的跳变同源）
                let _ = w.eval("try{document.body.classList.add('ed-panel-away')}catch(e){}");
                std::thread::sleep(std::time::Duration::from_millis(30));
                let _ = w.hide();
            }
        }
    });
}

fn dispatch(method: &str, args: &[Value], app: &tauri::AppHandle) -> Value {
    match method {
        // ===== 启动 / 配置 =====
        "bootstrap" => json!({ "config": config_get_public(), "version": VERSION }),
        "get_config" => config_get_public(),
        "get_version" => json!({ "success": true, "version": VERSION }),
        "update_config" => {
            let part = s(args, 0);
            let data = args.get(1).cloned().unwrap_or(Value::Null);
            crate::config::update(&part, data.clone());
            // 开机自启需要真正写系统自启项，而不是只存配置
            if part == "auto_start" {
                use tauri_plugin_autostart::ManagerExt;
                let al = app.autolaunch();
                let enable = data.as_bool().unwrap_or(false);
                let r = if enable { al.enable() } else { al.disable() };
                match r {
                    Ok(()) => crate::log(&format!(
                        "autostart set {} ok, is_enabled={:?}",
                        enable,
                        al.is_enabled()
                    )),
                    Err(e) => crate::log(&format!("autostart set {} failed: {}", enable, e)),
                }
                // 关掉开机自启时把「快速自启」任务一起删掉，
                // 否则任务还会在登录时把程序拉起来，和界面对不上
                if !enable {
                    crate::remove_logon_task();
                }
            }
            // 「快速自启」：用任务计划在登录时更早启动，并关掉注册表自启避免双开
            if part == "auto_start_priority" {
                crate::set_logon_task(app, data.as_bool().unwrap_or(false));
            }
            // 触发方式或快捷键改了要重新注册
            if part == "cf_type" || part == "cf_hotkey" {
                crate::register_hotkey(app);
            }
            // 全屏模式 / 呼出位置改了，面板要立刻重排（否则要等下次呼出才生效）
            if part == "full_screen" || part == "outPos" {
                crate::reapply_rect(app);
            }
            Value::Null
        }
        "update_config_order" => {
            let path_key = s(args, 0);
            // 前端传回的是完整条目对象数组，这里归一化成 filePath 字符串数组
            // （与旧版 config.json 的 dir_order 格式一致）
            let order: Vec<Value> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| {
                            x.as_str()
                                .map(|s| json!(s))
                                .or_else(|| x.get("filePath").and_then(|v| v.as_str()).map(|s| json!(s)))
                        })
                        .collect()
                })
                .unwrap_or_default();
            let mut cfg = crate::config::get();
            if let Some(o) = cfg.as_object_mut() {
                let dir_order = o
                    .entry("dir_order")
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .unwrap();
                dir_order.insert(path_key, json!(order));
            }
            crate::config::set_all(cfg);
            Value::Null
        }

        // ===== 文件列表 =====
        "get_fileinfo" => {
            let path = s(args, 0);
            let root = root_key();
            let dir_key = if is_root(&path) { root.as_str() } else { path.as_str() };
            let cfg = crate::config::get();
            let show_hidden = cfg
                .get("show_hidden_file")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let dirs = if is_root(&path) {
                root_dirs()
            } else {
                vec![PathBuf::from(&path)]
            };
            let (mut exes, mut dirs_items, mut files) = crate::files::scan(&dirs, show_hidden);
            // 根目录下把「应用组 / 系统项」伪条目一并交给排序（可被拖拽排序、可置顶）
            let extra = if is_root(&path) {
                let mut v = Vec::new();
                let cfg = crate::config::get();
                if cfg
                    .get("show_sysApp")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false)
                {
                    v.extend(crate::files::sys_items());
                }
                v.extend(crate::files::group_items());
                // 旧版行为：已加入应用组的文件从主视图隐藏（否则和组内图标重复）
                let grouped = crate::files::grouped_paths();
                if !grouped.is_empty() {
                    let keep = |v: &serde_json::Value| {
                        !v.get("filePath")
                            .and_then(|x| x.as_str())
                            .map(|p| grouped.contains(p))
                            .unwrap_or(false)
                    };
                    exes.retain(keep);
                    dirs_items.retain(keep);
                    files.retain(keep);
                }
                v
            } else {
                Vec::new()
            };
            let extra_n = extra.len();
            let data = crate::files::order_items(dir_key, exes, dirs_items, files, extra);
            // 【临时排查】看组伪条目有没有进列表
            crate::log(&format!(
                "get_fileinfo path='{}' root={} groups={} extra={} data={} 前3项={:?}",
                path,
                is_root(&path),
                crate::config::read_groups().as_object().map(|m| m.len()).unwrap_or(0),
                extra_n,
                data.len(),
                data.iter()
                    .take(3)
                    .map(|v| v.get("filePath").and_then(|x| x.as_str()).unwrap_or(""))
                    .collect::<Vec<_>>()
            ));
            json!({ "success": true, "data": data, "same": false })
        }
        "get_parent" => {
            let path = s(args, 0);
            let parent = Path::new(&path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if parent.is_empty() {
                // 已在盘符根/UNC 根：再上跳保持原地，不能返回空串被前端当桌面根
                json!(path)
            } else if root_dirs().iter().any(|d| d.to_string_lossy() == parent) {
                // 回到根：返回根目录键（自定义目录时返回绝对路径，前端才认得出是根）
                json!(root_key())
            } else {
                json!(parent)
            }
        }
        "search_desktop_path" => json!(desktop_dirs()
            .first()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()),

        // 切换"默认文件夹"：传 "desktop" 回桌面，传空则弹文件夹选择框
        "change_default_dir" => {
            let arg = args.get(0).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let (new_dir, name) = if arg.is_empty() {
                match pick_folder(app) {
                    Some(p) => {
                        let name = Path::new(&p)
                            .file_name()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| p.clone());
                        (p, name)
                    }
                    None => return json!({ "success": false, "message": "未选择文件夹" }),
                }
            } else if arg == "desktop" {
                ("desktop".to_string(), "桌面".to_string())
            } else {
                let name = Path::new(&arg)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| arg.clone());
                (arg, name)
            };
            crate::config::update("df_dir", json!(new_dir));
            crate::config::update("df_dir_name", json!(name));
            json!({ "success": true, "data": new_dir, "name": name })
        }

        // ===== 文件操作 =====
        "open_file" => {
            crate::win32::shell_open(&s(args, 0));
            // 设置里的"打开文件后收起窗口"
            if crate::config::get()
                .get("of_s")
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
            {
                crate::hide_panel_now(app);
            }
            json!({ "success": true })
        }
        "show_file" => {
            crate::win32::shell_show_in_explorer(&s(args, 0));
            if crate::config::get()
                .get("of_s")
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
            {
                crate::hide_panel_now(app);
            }
            json!({ "success": true })
        }
        "remove_file" => {
            let path = s(args, 0);
            let del_type = s(args, 1);
            if del_type == "rubbish" {
                // 删除到回收站，可恢复
                json!({ "success": crate::win32::move_to_recycle_bin(&path) })
            } else {
                let p = PathBuf::from(&path);
                let ok = if p.is_dir() {
                    fs::remove_dir_all(&p).is_ok()
                } else {
                    fs::remove_file(&p).is_ok()
                };
                json!({ "success": ok })
            }
        }
        "rename_file" => {
            let p = PathBuf::from(s(args, 0));
            let new_name = s(args, 1);
            let is_dir = p.is_dir();
            let ext = p
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            // 目录不补扩展名（"v1.2" 会被误解析出扩展名）；文件输入已带同扩展名时不重复补
            let final_name = if is_dir
                || ext.is_empty()
                || new_name.to_lowercase().ends_with(&ext.to_lowercase())
            {
                new_name
            } else {
                format!("{}{}", new_name, ext)
            };
            let target = p.parent().unwrap_or(Path::new(".")).join(final_name);
            json!({ "success": fs::rename(&p, &target).is_ok(), "file": target.to_string_lossy() })
        }
        "new_file" => {
            let suffix = s(args, 0);
            let cur = s(args, 1);
            let dir = if is_root(&cur) {
                root_dirs().first().cloned().unwrap_or_default()
            } else {
                PathBuf::from(&cur)
            };
            let (stem, ext) = if suffix == "folder" {
                ("新建文件夹".to_string(), String::new())
            } else {
                ("新建文档".to_string(), format!(".{}", suffix))
            };
            let mut target = dir.join(format!("{}{}", stem, ext));
            let mut i = 1;
            while target.exists() {
                target = dir.join(format!("{} {}{}", stem, i, ext));
                i += 1;
                if i > 999 {
                    break;
                }
            }
            let ok = if suffix == "folder" {
                fs::create_dir(&target).is_ok()
            } else {
                fs::write(&target, "").is_ok()
            };
            json!({ "success": ok, "file": target.to_string_lossy() })
        }
        "copy_file" => {
            let path = s(args, 0);
            if let Ok(mut g) = CLIPBOARD.lock() {
                *g = if path.is_empty() { None } else { Some(vec![path]) };
            }
            json!({ "success": true })
        }
        "put_file" => {
            let target = s(args, 0);
            let dir = if is_root(&target) {
                root_dirs().first().cloned().unwrap_or_default()
            } else {
                PathBuf::from(&target)
            };
            let items = CLIPBOARD
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .unwrap_or_default();
            let mut files = Vec::new();
            for src in items {
                if let Some(p) = crate::files::copy_into(&src, &dir) {
                    files.push(p);
                }
            }
            if files.is_empty() {
                json!({ "success": false, "message": "没有可粘贴的内容" })
            } else {
                json!({ "success": true, "files": files })
            }
        }

        // ===== 分类 =====
        "read_class" => {
            let key = s(args, 0);
            let classes = crate::config::read_classes();
            let dir = crate::config::get()
                .get("df_dir")
                .and_then(|v| v.as_str())
                .unwrap_or("desktop")
                .to_string();

            if key.is_empty() || key == "all" || key == "全部" {
                let mut order: Vec<String> = crate::config::get()
                    .get("class_order")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                let map = classes.get(&dir).cloned().unwrap_or_else(|| json!({}));
                if order.is_empty() {
                    if let Some(o) = map.as_object() {
                        order = o.keys().cloned().collect();
                    }
                } else {
                    order.retain(|k| map.get(k).is_some());
                    // class_order 里没列到的分类（新建、或改名后出现的新名字）追加到末尾。
                    // 否则它们虽然存在于 user_class.json，却不会返回给前端 ——
                    // 表现就是"分类栏里那个分类直接消失了"（改名时踩过这个坑）。
                    if let Some(o) = map.as_object() {
                        for k in o.keys() {
                            if !order.iter().any(|x| x == k) {
                                order.push(k.clone());
                            }
                        }
                    }
                }
                let mut out = serde_json::Map::new();
                for k in order {
                    if let Some(v) = map.get(&k) {
                        out.insert(k, v.clone());
                    }
                }
                json!({ "success": true, "data": Value::Object(out) })
            } else {
                match classes.get(&dir).and_then(|d| d.get(&key)) {
                    Some(v) => json!({ "success": true, "files": v }),
                    None => json!({ "success": false, "files": [], "message": "没有找到该分类的文件" }),
                }
            }
        }
        "add_class" => {
            let files_v = args.get(0).cloned().unwrap_or(json!([]));
            let key = s(args, 1);
            let dir = crate::config::get()
                .get("df_dir")
                .and_then(|v| v.as_str())
                .unwrap_or("desktop")
                .to_string();
            let mut classes = crate::config::read_classes();
            if let Some(obj) = classes.as_object_mut() {
                let d = obj.entry(dir).or_insert_with(|| json!({}));
                if let Some(dm) = d.as_object_mut() {
                    dm.insert(key.clone(), files_v);
                }
            }
            crate::config::write_classes(&classes);
            // 新分类（含改名后产生的新名字）要进 class_order，否则会被 read_class 过滤掉
            let mut order: Vec<String> = crate::config::get()
                .get("class_order")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if !order.is_empty() && !order.iter().any(|x| x == &key) {
                order.push(key.clone());
                crate::config::update("class_order", json!(order));
            }
            json!({ "success": true })
        }
        "remove_class" => {
            let key = s(args, 0);
            let dir = crate::config::get()
                .get("df_dir")
                .and_then(|v| v.as_str())
                .unwrap_or("desktop")
                .to_string();
            let mut classes = crate::config::read_classes();
            if let Some(obj) = classes.as_object_mut() {
                if let Some(d) = obj.get_mut(&dir).and_then(|v| v.as_object_mut()) {
                    d.remove(&key);
                }
            }
            crate::config::write_classes(&classes);
            // 同步摘掉 class_order 里的旧名字（改名 = remove_class + add_class，
            // 不清理的话这里会积累一堆指向已不存在分类的幽灵项）
            let mut order: Vec<String> = crate::config::get()
                .get("class_order")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let before = order.len();
            order.retain(|x| x != &key);
            if order.len() != before {
                crate::config::update("class_order", json!(order));
            }
            json!({ "success": true })
        }
        "save_classOrder" => {
            crate::config::update("class_order", args.get(0).cloned().unwrap_or(json!([])));
            Value::Null
        }

        // ===== 标星 =====
        "change_cl_state" => {
            let path = s(args, 0);
            let state = args.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
            let mut cl = crate::config::read_cl();
            if let Some(o) = cl.as_object_mut() {
                o.insert(path, json!(!state));
            }
            crate::config::write_cl(&cl);
            Value::Null
        }

        // ===== 搜索索引（全拼 + 首字母）=====
        "load_search_index" => {
            let mut out = serde_json::Map::new();
            if let Some(arr) = args.get(0).and_then(|v| v.as_array()) {
                for f in arr {
                    if let Some(name) = f.get("fileName").and_then(|v| v.as_str()) {
                        let (py, sxpy) = build_pinyin(name);
                        out.insert(name.to_string(), json!({ "sxpy": sxpy, "py": py }));
                    }
                }
            }
            Value::Object(out)
        }

        // ===== 窗口 =====
        "lock_window_visibility" => {
            crate::lock_visibility();
            Value::Null
        }
        "unlock_window_visibility" => {
            crate::unlock_visibility();
            Value::Null
        }
        "close_fullscreen_window" => {
            // 只在全屏模式下才允许"点空白处收起"，普通模式点空白不关面板
            let full = crate::config::get()
                .get("full_screen")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if full {
                crate::hide_panel_now(app);
            }
            Value::Null
        }
        // 拖拽时前端每 100ms 询问一次：左键还按着吗、是否拖到面板上下边缘
        // 滑出动画由 main.rs 的 Rust 线程驱动，这里不需要每帧回调
        "mouse_state" => json!(crate::win32::left_button_down()),
        "drag_posMoveAction" => {
            let (_, y) = crate::win32::cursor_pos();
            let (_, py, _, ph) = crate::target_rect();
            let top = py + 80;
            let bottom = py + ph as i32 - 80;
            if y < top {
                json!("top")
            } else if y > bottom {
                json!("bottom")
            } else {
                json!("none")
            }
        }

        // ===== 应用组 =====
        "get_groups" => {
            let groups = crate::config::read_groups();
            let mut out = serde_json::Map::new();
            if let Some(map) = groups.as_object() {
                for (gid, g) in map {
                    let count = g
                        .get("files")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    out.insert(
                        gid.clone(),
                        json!({
                            "name": g.get("name").and_then(|v| v.as_str()).unwrap_or("应用组"),
                            "count": count,
                        }),
                    );
                }
            }
            json!({ "success": true, "data": Value::Object(out) })
        }
        "get_group_contents" => {
            let gid = s(args, 0);
            let groups = crate::config::read_groups();
            let files = groups
                .get(&gid)
                .and_then(|g| g.get("files"))
                .cloned()
                .unwrap_or_else(|| json!([]));
            json!({ "success": true, "data": files })
        }
        "create_group" => {
            let mut name = s(args, 0);
            if name.trim().is_empty() {
                name = "新建组".to_string();
            }
            let mut groups = crate::config::read_groups();
            // 重名时自动加尾缀：agent工具 → agent工具-1 → agent工具-2 …
            let existing: Vec<String> = groups
                .as_object()
                .map(|m| {
                    m.values()
                        .filter_map(|g| g.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if existing.iter().any(|n| n == &name) {
                let mut i = 1;
                while i <= 999 {
                    let cand = format!("{}-{}", name, i);
                    if !existing.iter().any(|n| n == &cand) {
                        name = cand;
                        break;
                    }
                    i += 1;
                }
            }
            let gid = new_group_id(&groups);
            if let Some(o) = groups.as_object_mut() {
                o.insert(gid.clone(), json!({ "name": name, "files": [] }));
            }
            crate::config::write_groups(&groups);
            // 前端会带上"当前所在分类"：在分类页里建的组要归到该分类下
            let class_name = s(args, 1);
            crate::config::add_file_to_class(&class_name, &format!("__group__:{}", gid), &name);
            json!({ "success": true, "groupId": gid })
        }
        "rename_group" => {
            let gid = s(args, 0);
            let name = s(args, 1);
            let mut groups = crate::config::read_groups();
            if let Some(g) = groups.get_mut(&gid).and_then(|g| g.as_object_mut()) {
                g.insert("name".into(), json!(name));
            }
            crate::config::write_groups(&groups);
            // 分类里存的是组的伪路径 + 当时的名字，改名后要同步，否则分类设置里还是旧名
            crate::config::rename_in_classes(&format!("__group__:{}", gid), &name);
            json!({ "success": true })
        }
        "delete_group" => {
            let gid = s(args, 0);
            let mut groups = crate::config::read_groups();
            if let Some(o) = groups.as_object_mut() {
                o.remove(&gid);
            }
            crate::config::write_groups(&groups);
            // 顺手把排序表里的引用清掉，避免残留 `__group__:xx`
            let group_path = format!("__group__:{}", gid);
            // 分类里指向这个组的条目也要摘掉（否则分类里留一个幽灵条目、分类设置里还勾着它）
            crate::config::remove_file_from_classes(&group_path);
            let mut cfg = crate::config::get();
            let mut dirty = false;
            if let Some(orders) = cfg.get_mut("dir_order").and_then(|v| v.as_object_mut()) {
                for (_, arr) in orders.iter_mut() {
                    if let Some(a) = arr.as_array_mut() {
                        let before = a.len();
                        a.retain(|x| {
                            let p = x
                                .as_str()
                                .map(|s| s.to_string())
                                .or_else(|| x.get("filePath").and_then(|v| v.as_str()).map(|s| s.to_string()));
                            p.as_deref() != Some(group_path.as_str())
                        });
                        if a.len() != before {
                            dirty = true;
                        }
                    }
                }
            }
            if dirty {
                crate::config::set_all(cfg);
            }
            json!({ "success": true })
        }
        "add_to_group" => {
            let gid = s(args, 0);
            let paths: Vec<String> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let mut groups = crate::config::read_groups();
            let mut ok = false;
            if let Some(g) = groups.get_mut(&gid).and_then(|g| g.as_object_mut()) {
                let files = g.entry("files").or_insert_with(|| json!([]));
                if let Some(arr) = files.as_array_mut() {
                    for p in paths {
                        if arr
                            .iter()
                            .any(|f| f.get("filePath").and_then(|v| v.as_str()) == Some(p.as_str()))
                        {
                            continue;
                        }
                        arr.push(crate::files::item_for_path(&p));
                    }
                    ok = true;
                }
            }
            if ok {
                crate::config::write_groups(&groups);
            }
            json!({ "success": ok })
        }
        "remove_from_group" => {
            let gid = s(args, 0);
            let path = s(args, 1);
            let mut groups = crate::config::read_groups();
            if let Some(arr) = groups
                .get_mut(&gid)
                .and_then(|g| g.get_mut("files"))
                .and_then(|v| v.as_array_mut())
            {
                arr.retain(|f| f.get("filePath").and_then(|v| v.as_str()) != Some(path.as_str()));
            }
            crate::config::write_groups(&groups);
            json!({ "success": true })
        }
        "edit_group_order" => {
            let gid = s(args, 0);
            let paths: Vec<String> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let mut groups = crate::config::read_groups();
            if let Some(arr) = groups
                .get_mut(&gid)
                .and_then(|g| g.get_mut("files"))
                .and_then(|v| v.as_array_mut())
            {
                let mut old = std::mem::take(arr);
                let mut new: Vec<Value> = Vec::new();
                for p in &paths {
                    if let Some(pos) = old
                        .iter()
                        .position(|f| f.get("filePath").and_then(|v| v.as_str()) == Some(p.as_str()))
                    {
                        new.push(old.remove(pos));
                    }
                }
                // 未出现在顺序表里的（异常情况）保留在末尾
                new.extend(old);
                *arr = new;
            }
            crate::config::write_groups(&groups);
            json!({ "success": true })
        }
        "save_group_order" => {
            let order: Vec<String> = args
                .get(0)
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            if !order.is_empty() {
                let groups = crate::config::read_groups();
                if let Some(map) = groups.as_object() {
                    let mut new = serde_json::Map::new();
                    for gid in &order {
                        if let Some(v) = map.get(gid) {
                            new.insert(gid.clone(), v.clone());
                        }
                    }
                    for (k, v) in map {
                        if !new.contains_key(k) {
                            new.insert(k.clone(), v.clone());
                        }
                    }
                    crate::config::write_groups(&Value::Object(new));
                }
            }
            json!({ "success": true })
        }

        // ===== 暂未实现 / 无副作用 =====
        "clean_temp" => {
            crate::icons::clear_cache();
            crate::preview::clear_cache();
            Value::Null
        }
        "get_imageBase64" => match crate::preview::get_image_base64(&s(args, 0)) {
            Some(v) => json!(v),
            None => Value::Null,
        },

        // ===== 系统项 / 毛玻璃 / 背景 / 调整尺寸 / 图标 =====
        "open_sysApp" => {
            let name = s(args, 0);
            let clsid = match name.as_str() {
                "此电脑" => "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}",
                "控制面板" => "::{26EE0668-A00A-44D7-9371-BEB064C98683}",
                "回收站" => "::{645FF040-5081-101B-9F08-00AA002F954E}",
                _ => "",
            };
            if !clsid.is_empty() {
                crate::win32::open_sys_folder(clsid);
            }
            Value::Null
        }
        "set_blur_effect" => {
            let on = args.get(0).and_then(|v| v.as_bool()).unwrap_or(true);
            // 第二个参数是当前主题（'light'/'dark'）：亚克力底色用白还是黑，
            // 对应旧版 setLightBlurEffect / setDarkBlurEffect 的差别
            let dark = args.get(1).and_then(|v| v.as_str()).map(|s| s != "light").unwrap_or(false);
            apply_blur(app, on, dark);
            Value::Null
        }
        "load_blur_effect" => {
            let on = crate::config::get()
                .get("blur_bg")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            // 前端传的 b_type：'Acrylic'=浅色主题、'Aero'=深色主题（沿用旧版叫法）
            let dark = args.get(0).and_then(|v| v.as_str()).map(|s| s != "Acrylic").unwrap_or(false);
            apply_blur(app, on, dark);
            Value::Null
        }
        "set_background" => {
            let Some(src) = pick_image_file(app) else {
                return Value::Null;
            };
            let dir = crate::config::exe_dir().join("background");
            let _ = fs::create_dir_all(&dir);
            let ext = Path::new(&src)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_else(|| "png".to_string());
            let dst = dir.join(format!("bg.{}", ext));
            if fs::copy(&src, &dst).is_ok() {
                json!(crate::icons::asset_url(&dst))
            } else {
                Value::Null
            }
        }
        "fit_window_start" => {
            crate::lock_visibility();
            crate::FIT_MODE.store(true, Ordering::SeqCst);
            let h = app.clone();
            let h2 = app.clone();
            let _ = h.run_on_main_thread(move || {
                if let Some(w) = h2.get_webview_window("main") {
                    let _ = w.set_resizable(true);
                    // 前端不会自己进入调整态，必须由后端调它的 disable_settings()。
                    // 注意：HTML 里「清理」和「调整尺寸」两个按钮 id 都是 fit_btn，
                    // disable_settings 里的 getElementById 改的是「清理」按钮，这里按选择器再改回真正的那个。
                    let _ = w.eval(
                        "try{if(typeof disable_settings==='function')disable_settings()}catch(e){}\
                         try{var b=document.querySelector(\"button[onclick='fit_window()']\");if(b)b.innerText='点击完成调整'}catch(e){}",
                    );
                }
            });
            Value::Null
        }
        "fit_window_end" => {
            crate::unlock_visibility();
            crate::FIT_MODE.store(false, Ordering::SeqCst);
            let h = app.clone();
            let h2 = app.clone();
            let _ = h.run_on_main_thread(move || {
                if let Some(w) = h2.get_webview_window("main") {
                    let _ = w.set_resizable(false);
                    if let Ok(sz) = w.outer_size() {
                        if sz.width > 100 && sz.height > 100 {
                            let pos = w.outer_position().map(|p| (p.x, p.y)).unwrap_or((0, 0));
                            crate::save_panel_size(sz.width, sz.height, pos.0, pos.1);
                        }
                    }
                    apply_corners(&w);
                    // 恢复设置面板（与 disable_settings 相反，没有现成函数，这里逐项还原）。
                    // 两个 fit_btn 都要还原：调整尺寸按钮 + 被误改文字的「清理」按钮。
                    let _ = w.eval(
                        "try{\
                          setting_mode=false;\
                          var b=document.querySelector(\"button[onclick='fit_window()']\");if(b)b.innerText='调整尺寸';\
                          var c=document.querySelector(\"button[onclick='ApiHelper.cleanTemp()']\");if(c)c.innerText='清理';\
                          document.getElementById('closeThemePanel').style.display='';\
                          document.querySelectorAll('.settings-section').forEach(function(e){e.style.display=''});\
                          document.querySelectorAll('.setting_note').forEach(function(e){e.style.display=''});\
                         }catch(e){}",
                    );
                }
            });
            Value::Null
        }
        "fit_resize" => {
            // 只在调整尺寸过程中保存，避免面板呼出时的尺寸抖动覆盖记忆值
            if crate::FIT_MODE.load(Ordering::SeqCst) {
                if let Some(w) = app.get_webview_window("main") {
                    if let Ok(sz) = w.outer_size() {
                        if sz.width > 100 && sz.height > 100 {
                            let pos = w.outer_position().map(|p| (p.x, p.y)).unwrap_or((0, 0));
                            crate::save_panel_size(sz.width, sz.height, pos.0, pos.1);
                        }
                    }
                    apply_corners(&w);
                }
            }
            Value::Null
        }
        "bug_report" => {
            use std::io::Write;
            let log = crate::config::exe_dir().join("error.log");
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let _ = writeln!(f, "[{}] {} {}", ts, s(args, 0), s(args, 1));
            }
            Value::Null
        }
        "setIcon" => {
            let path = s(args, 0);
            let pick_new = args.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
            if !pick_new {
                // 恢复默认图标：删掉自定义图标映射
                let mut cfg = crate::config::get();
                let mut changed = false;
                if let Some(map) = cfg.get_mut("ico").and_then(|v| v.as_object_mut()) {
                    changed = map.remove(&path).is_some();
                }
                if changed {
                    crate::config::set_all(cfg);
                }
                json!({ "success": true })
            } else {
                let Some(src) = pick_image_file(app) else {
                    return json!({ "success": false, "message": "未选择图标" });
                };
                match crate::icons::import_custom_icon(&src) {
                    Some(url) => {
                        let mut cfg = crate::config::get();
                        if let Some(map) = cfg.get_mut("ico").and_then(|v| v.as_object_mut()) {
                            map.insert(path.clone(), json!(url));
                        }
                        crate::config::set_all(cfg);
                        json!({ "success": true })
                    }
                    None => json!({ "success": false, "message": "图标处理失败" }),
                }
            }
        }

        // ===== 系统任务计划 / 暂未实现 =====
        "get_taskScheduler_state" => json!({
            "success": true,
            "state": crate::logon_task_exists(),
            "priority": crate::logon_task_exists(),
        }),
        "select_image" => Value::Null,

        _ => Value::Null,
    }
}

fn config_get_public() -> Value {
    crate::config::get_public()
}

/// 按当前窗口尺寸重裁圆角（调整尺寸时窗口大小在变）
fn apply_corners(w: &tauri::WebviewWindow) {
    if let (Ok(h), Ok(sz)) = (w.hwnd(), w.outer_size()) {
        crate::win32::apply_round_corners(h.0 as isize, sz.width as i32, sz.height as i32);
    }
}

/// 弹出图片选择对话框（返回绝对路径）
fn pick_image_file(app: &tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("图片", &["png", "jpg", "jpeg", "bmp", "gif", "webp", "ico"])
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

/// 弹出文件夹选择对话框（返回绝对路径）
fn pick_folder(app: &tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

/// 开/关毛玻璃（Acrylic）效果
///
/// 【磨砂强度】沿用旧版（Python 2.9.0 `window_effect.py::setLightBlurEffect`）的规则：
///   滑块 = 强度百分比（10~100），存到配置里的是 blur_effect = 100 - 强度；
///   亚克力底色的 alpha = 155 + blur_effect（clamp 到 0~255）。
///   换算过来：强度 100% → alpha 155（最透、最磨）；强度 0% → alpha 255（纯白、不磨）。
/// 旧版是把这个 alpha 拼成 GradientColor 交给系统的 SetWindowCompositionAttribute，
/// 这里换成 tauri 的 WindowEffectsConfig.color，规则一致。
/// 注意：只改 blur_effect 不会自动生效，写完配置要重新调用一次 set_blur_effect。
pub fn apply_blur(app: &tauri::AppHandle, on: bool, dark: bool) {
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::utils::{WindowEffect, WindowEffectState};
    let h = app.clone();
    let h2 = app.clone();
    let _ = h.run_on_main_thread(move || {
        if let Some(w) = h2.get_webview_window("main") {
            let cfg = if on {
                // 【磨砂强度】沿用旧版（Python 2.9.0 window_effect.py::setLightBlurEffect）的
                // 规则：滑块 = 强度百分比(10~100)，配置里存 blur_effect = 100 - 强度；
                // 亚克力底色的 alpha = 155 + blur_effect，clamp 到 0~255。
                // 也就是：强度 100% → alpha 155（最透、最磨）；强度 0% → alpha 255（纯白、不磨）。
                // 旧版把这个 alpha 拼成 GradientColor 交给系统的 SetWindowCompositionAttribute，
                // 这里换成 tauri 的 WindowEffectsConfig.color，视觉规则一致。
                let be = crate::config::get()
                    .get("blur_effect")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(30);
                let alpha = (155i64 + be.clamp(0, 100)) as u8;
                Some(WindowEffectsConfig {
                    effects: vec![WindowEffect::Acrylic],
                    state: Some(WindowEffectState::Active),
                    radius: None,
                    color: Some(if dark {
                        tauri::utils::config::Color(0, 0, 0, alpha)
                    } else {
                        tauri::utils::config::Color(255, 255, 255, alpha)
                    }),
                })
            } else {
                None
            };
            let _ = w.set_effects(cfg);
        }
    });
}

/// 生成不冲突的组 id（毫秒时间戳 + 冲突后缀）
fn new_group_id(groups: &Value) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut gid = format!("g{}", now);
    let mut i = 0;
    while groups.get(&gid).is_some() {
        i += 1;
        gid = format!("g{}_{}", now, i);
    }
    gid
}

/// 生成「全拼」与「首字母」两种检索串（替代旧版的 pypinyin）
fn build_pinyin(name: &str) -> (String, String) {
    use pinyin::ToPinyin;
    let mut py = String::with_capacity(name.len() * 3);
    let mut sx = String::with_capacity(name.len());
    for ch in name.chars() {
        match ch.to_pinyin() {
            Some(p) => {
                py.push_str(p.plain());
                sx.push_str(p.first_letter());
            }
            None => {
                // 非汉字：字母数字保留，其余丢弃（与 JS 端忽略标点一致）
                for lc in ch.to_lowercase() {
                    if lc.is_alphanumeric() {
                        py.push(lc);
                        sx.push(lc);
                    }
                }
            }
        }
    }
    (py, sx)
}
