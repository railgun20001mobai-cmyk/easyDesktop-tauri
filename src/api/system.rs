//! 系统项、背景、图标与临时缓存。

use serde_json::{json, Value};
use std::fs;
use std::path::Path;

use super::s;

const METHODS: &[&str] = &[
    "clean_temp",
    "clear_preview_cache",
    "get_imageBase64",
    "open_sysApp",
    "set_background",
    "bug_report",
    "setIcon",
    "get_taskScheduler_state",
    "select_image",
];

pub(super) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

pub(super) fn dispatch(method: &str, args: &[Value], app: &tauri::AppHandle) -> Value {
    match method {
        "clean_temp" => {
            crate::icons::clear_cache();
            crate::preview::clear_cache();
            Value::Null
        }

        // 面板隐藏后只清预览缓存，图标磁盘缓存保留
        "clear_preview_cache" => {
            crate::preview::clear_cache();
            Value::Null
        }

        "get_imageBase64" => match crate::preview::get_image_base64(&s(args, 0)) {
            Some(v) => json!(v),
            None => Value::Null,
        },

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
                crate::config::set_icon(&path, None);
                json!({ "success": true })
            } else {
                let Some(src) = pick_image_file(app) else {
                    return json!({ "success": false, "message": "未选择图标" });
                };
                match crate::icons::import_custom_icon(&src) {
                    Some(url) => {
                        crate::config::set_icon(&path, Some(&url));
                        json!({ "success": true })
                    }
                    None => json!({ "success": false, "message": "图标处理失败" }),
                }
            }
        }

        "get_taskScheduler_state" => json!({
            "success": true,
            "state": crate::logon_task_exists(),
            "priority": crate::logon_task_exists(),
        }),

        "select_image" => Value::Null,

        _ => Value::Null,
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
