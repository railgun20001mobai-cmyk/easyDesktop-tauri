//! 面板隐藏后的 WebView2 内存管理。
//!
//! 隐藏后先把控制器设为不可见（TrySuspend 的硬性前提），再降内存目标到 Low，
//! 最后尝试挂起整个 WebView2；呼出时先恢复可见/Resume 再显示，避免空白首帧。

use tauri::Manager;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2_19, ICoreWebView2_3, ICoreWebView2Controller,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use webview2_com::TrySuspendCompletedHandler;
use windows::core::Interface;

fn with_webview<F>(handle: &tauri::AppHandle, f: F)
where
    F: FnOnce(&ICoreWebView2Controller, &ICoreWebView2) + Send + 'static,
{
    let Some(w) = handle.get_webview_window("main") else {
        return;
    };
    // with_webview 只负责把闭包投递到主线程；COM 调用必须在那个线程上执行
    let _ = w.with_webview(move |webview| {
        let controller = webview.controller();
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
            return;
        };
        f(&controller, &core);
    });
}

/// 隐藏后调用：控制器不可见，TrySuspend 才允许执行
pub fn set_invisible(handle: &tauri::AppHandle) {
    with_webview(handle, |controller, _| {
        let _ = unsafe { controller.SetIsVisible(false) };
        crate::logging::info("webview", "webview: invisible");
    });
}

pub fn set_low(handle: &tauri::AppHandle) {
    with_webview(handle, |_, core| {
        let Ok(core19) = core.cast::<ICoreWebView2_19>() else {
            return;
        };
        if unsafe {
            core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW)
        }
        .is_ok()
        {
            crate::logging::info("webview", "webview: low memory");
        }
    });
}

pub fn resume(handle: &tauri::AppHandle) {
    with_webview(handle, |controller, core| {
        // 必须在窗口 show 之前恢复可见，否则会先闪一帧空白
        let _ = unsafe { controller.SetIsVisible(true) };
        if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
            let _ = unsafe { core3.Resume() };
        }
        if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
            let _ = unsafe {
                core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL)
            };
        }
        crate::logging::info("webview", "webview: resume");
    });
}

pub fn try_suspend(handle: &tauri::AppHandle) {
    with_webview(handle, |_, core| {
        let Ok(core3) = core.cast::<ICoreWebView2_3>() else {
            return;
        };
        let handler = TrySuspendCompletedHandler::create(Box::new(|hr, suspended| {
            if hr.is_ok() && suspended {
                crate::logging::info("webview", "webview: suspended");
            } else {
                crate::logging::warn(
                    "webview",
                    format!("webview: suspend failed hr={hr:?} suspended={suspended}"),
                );
            }
            Ok(())
        }));
        if let Err(e) = unsafe { core3.TrySuspend(&handler) } {
            crate::logging::error("webview", format!("TrySuspend failed: {e:?}"));
        }
    });
}
