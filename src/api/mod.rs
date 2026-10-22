//! pywebview API 兼容层
//!
//! 前端 ed.js 完全不用改：它通过 `window.pywebview.api[方法名](...参数)` 调用后端。
//! 这里用一个统一的 `pywebview_call(method, args)` 命令接收并分发，
//! 具体方法按领域拆到 config / files / classes / groups / window / system 子模块。

use serde_json::Value;
use std::sync::Mutex;

use tauri::Manager;

mod classes;
mod config;
mod files;
mod groups;
mod system;
mod window;

/// 复制到剪贴板的文件路径（对应旧版的复制/粘贴）
pub(super) static CLIPBOARD: Mutex<Option<Vec<String>>> = Mutex::new(None);

pub(super) fn s(args: &[Value], i: usize) -> String {
    args.get(i)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// 默认目录的键：桌面时是 "desktop"，自定义时是该目录的绝对路径
/// （与旧版一致：dir_order / user_class.json 都按这个键分组）
pub(super) fn root_key() -> String {
    let key = crate::config::get().df_dir;
    if key.is_empty() {
        "desktop".to_string()
    } else {
        key
    }
}

pub(super) fn is_root(p: &str) -> bool {
    if matches!(p, "desktop" | "" | "\\" | "/" | "\\\\") {
        return true;
    }
    // 自定义默认目录：前端回根时会传 config.df_dir（绝对路径）
    let key = root_key();
    !key.is_empty() && key != "desktop" && p == key
}

/// 根目录要扫描的文件夹：桌面模式 = 用户桌面 + 公共桌面；自定义模式 = 那一个目录
pub(super) fn root_dirs() -> Vec<std::path::PathBuf> {
    let key = root_key();
    if key.is_empty() || key == "desktop" {
        crate::files::desktop_paths()
    } else {
        vec![std::path::PathBuf::from(key)]
    }
}

pub(super) fn desktop_dirs() -> Vec<std::path::PathBuf> {
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

fn dispatch(method: &str, args: &[Value], app: &tauri::AppHandle) -> Value {
    if config::handles(method) {
        return config::dispatch(method, args, app);
    }
    if files::handles(method) {
        return files::dispatch(method, args, app);
    }
    if classes::handles(method) {
        return classes::dispatch(method, args, app);
    }
    if groups::handles(method) {
        return groups::dispatch(method, args, app);
    }
    if window::handles(method) {
        return window::dispatch(method, args, app);
    }
    if system::handles(method) {
        return system::dispatch(method, args, app);
    }
    Value::Null
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
