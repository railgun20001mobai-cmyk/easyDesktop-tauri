//! 启动、配置读写与版本信息。

use serde_json::{json, Value};

use crate::config::APP_VERSION;

use super::s;

const METHODS: &[&str] = &[
    "bootstrap",
    "get_config",
    "get_version",
    "update_config",
    "update_config_order",
];

pub(super) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

pub(super) fn dispatch(method: &str, args: &[Value], app: &tauri::AppHandle) -> Value {
    match method {
        "bootstrap" => json!({ "config": crate::config::get_public(), "version": APP_VERSION }),

        "get_config" => crate::config::get_public(),

        "get_version" => json!({ "success": true, "version": APP_VERSION }),

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
                    Ok(()) => crate::logging::info(
                        "autostart",
                        format!(
                            "autostart set {} ok, is_enabled={:?}",
                            enable,
                            al.is_enabled()
                        ),
                    ),
                    Err(e) => crate::logging::error(
                        "autostart",
                        format!("set {} failed: {}", enable, e),
                    ),
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
            let order: Vec<String> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| {
                            x.as_str().map(|s| s.to_string()).or_else(|| {
                                x.get("filePath")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            crate::config::set_dir_order(&path_key, order);
            Value::Null
        }
        _ => Value::Null,
    }
}
