//! 面板隐藏后的 WebView2 内存管理。
//!
//! 隐藏后先把控制器设为不可见，再降内存目标到 Low；呼出时恢复可见并回到
//! Normal，避免空白首帧。
//!
//! 不再调用 TrySuspend：挂起省的是常驻工作集，唤醒却要把换出的页读回，
//! 久闲首次呼出会卡顿。

use std::sync::atomic::{AtomicU8, Ordering};

use tauri::Manager;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2_19, ICoreWebView2_3, ICoreWebView2Controller,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
use windows::core::Interface;

/// WebView2 当前省电档位：0=正常，1=低内存。
///
/// 生命周期：进程启动为 0；隐藏 20s 成功降到 Low 置 1；每次 resume 归 0。
/// 只由本模块写，show_panel 通过 [`level`] 读取以决定出窗前的预热缓冲。
/// 原子量，可在任意线程读写。
static POWER_LEVEL: AtomicU8 = AtomicU8::new(0);

pub fn level() -> u8 {
    POWER_LEVEL.load(Ordering::Relaxed)
}

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

/// 隐藏后调用：让渲染层释放合成表面
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
            POWER_LEVEL.store(1, Ordering::Relaxed);
            crate::logging::info("webview", "webview: low memory");
        }
    });
}

pub fn resume(handle: &tauri::AppHandle) {
    with_webview(handle, |controller, core| {
        // 必须在窗口 show 之前恢复可见，否则会先闪一帧空白
        let _ = unsafe { controller.SetIsVisible(true) };
        // 本程序不再主动挂起；这里保留 Resume 作为系统级挂起的兜底
        if let Ok(core3) = core.cast::<ICoreWebView2_3>() {
            let _ = unsafe { core3.Resume() };
        }
        if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
            let _ = unsafe {
                core19.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL)
            };
        }
        POWER_LEVEL.store(0, Ordering::Relaxed);
        crate::logging::info("webview", "webview: resume");
    });
}
