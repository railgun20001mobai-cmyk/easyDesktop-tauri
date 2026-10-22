//! 窗口可见性、毛玻璃与调整尺寸。

use serde_json::{json, Value};
use std::sync::atomic::Ordering;

use tauri::Manager;

const METHODS: &[&str] = &[
    "lock_window_visibility",
    "unlock_window_visibility",
    "close_fullscreen_window",
    "mouse_state",
    "drag_posMoveAction",
    "set_blur_effect",
    "load_blur_effect",
    "fit_window_start",
    "fit_window_end",
    "fit_resize",
];

pub(super) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

pub(super) fn dispatch(method: &str, args: &[Value], app: &tauri::AppHandle) -> Value {
    match method {
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
            if crate::config::get().full_screen {
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

        "set_blur_effect" => {
            let on = args.get(0).and_then(|v| v.as_bool()).unwrap_or(true);
            // 第二个参数是当前主题（'light'/'dark'）：亚克力底色用白还是黑，
            // 对应旧版 setLightBlurEffect / setDarkBlurEffect 的差别
            let dark = args.get(1).and_then(|v| v.as_str()).map(|s| s != "light").unwrap_or(false);
            apply_blur(app, on, dark);
            Value::Null
        }

        "load_blur_effect" => {
            let on = crate::config::get().blur_bg;
            // 前端传的 b_type：'Acrylic'=浅色主题、'Aero'=深色主题（沿用旧版叫法）
            let dark = args.get(0).and_then(|v| v.as_str()).map(|s| s != "Acrylic").unwrap_or(false);
            apply_blur(app, on, dark);
            Value::Null
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
        _ => Value::Null,
    }
}

/// 按当前窗口尺寸重裁圆角（调整尺寸时窗口大小在变）
fn apply_corners(w: &tauri::WebviewWindow) {
    if let (Ok(h), Ok(sz)) = (w.hwnd(), w.outer_size()) {
        crate::win32::apply_round_corners(h.0 as isize, sz.width as i32, sz.height as i32);
    }
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
                let be = crate::config::get().blur_effect;
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
