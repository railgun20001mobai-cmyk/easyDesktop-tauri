//! 文件列表、浏览与文件系统操作。

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use super::{desktop_dirs, is_root, root_dirs, root_key, s, CLIPBOARD};

const METHODS: &[&str] = &[
    "get_fileinfo",
    "get_parent",
    "search_desktop_path",
    "change_default_dir",
    "open_file",
    "show_file",
    "remove_file",
    "rename_file",
    "new_file",
    "copy_file",
    "put_file",
];

pub(super) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

pub(super) fn dispatch(method: &str, args: &[Value], app: &tauri::AppHandle) -> Value {
    match method {
        "get_fileinfo" => {
            let path = s(args, 0);
            let at_root = is_root(&path);
            let root = root_key();
            let dir_key = if at_root { root.as_str() } else { path.as_str() };
            let dirs = if at_root {
                root_dirs()
            } else {
                vec![PathBuf::from(&path)]
            };
            let cfg = crate::config::get();
            let view = crate::files::scan_view(&cfg, &dirs, at_root);
            let data = crate::files::order_items(
                dir_key,
                view.exes,
                view.dirs,
                view.files,
                view.extra,
            );
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

        "open_file" => {
            crate::win32::shell_open(&s(args, 0));
            // 设置里的"打开文件后收起窗口"
            if crate::config::get().of_s {
                crate::hide_panel_now(app);
            }
            json!({ "success": true })
        }

        "show_file" => {
            crate::win32::shell_show_in_explorer(&s(args, 0));
            if crate::config::get().of_s {
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
        _ => Value::Null,
    }
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
