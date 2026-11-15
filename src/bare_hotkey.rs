//! 「只有修饰键」的全局组合键（Win+Shift）。
//!
//! Windows 的 `RegisterHotKey` 要求必须有一个非修饰主键，tauri 的全局快捷键插件
//! 在解析阶段就会拒绝 `Super+Shift`（日志：only one main key）。这里用 Raw Input
//! 在后台监听键盘：同时按下 Win 与 Shift、期间没有按过其它键、松开任意一个时
//! 触发一次。带主键的组合（Win+Shift+S 截图、Win+Shift+方向键移动窗口）不会误触。
//!
//! 不用 `WH_KEYBOARD_LL` 键盘钩子：Raw Input 只读监听，不插入其它进程的输入链，
//! 对游戏反作弊更友好。监听窗口是隐藏的普通窗口（`RIDEV_INPUTSINK` 要求真实
//! HWND），线程常驻进程生命周期，切换触发方式只切 `ENABLED`。

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use tauri::AppHandle;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    VK_LSHIFT, VK_LWIN, VK_RSHIFT, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
    RAWINPUTHEADER, RIDEV_INPUTSINK, RID_INPUT, RIM_TYPEKEYBOARD,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostThreadMessageW,
    RegisterClassW, TranslateMessage, MSG, WM_INPUT, WNDCLASSW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_POPUP,
};

/// 投递给监听线程的触发消息（WM_APP + 1）
const WM_APP_TRIGGER: u32 = 0x8000 + 1;

static ENABLED: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);
static LISTENER_TID: AtomicU32 = AtomicU32::new(0);
static WIN_DOWN: AtomicBool = AtomicBool::new(false);
static SHIFT_DOWN: AtomicBool = AtomicBool::new(false);
/// 本次按下过程中没有夹带其它主键；只有为 true 时松手才算裸组合键
static CHORD_CLEAN: AtomicBool = AtomicBool::new(true);

fn is_win(vk: u16) -> bool {
    vk == VK_LWIN.0 || vk == VK_RWIN.0
}

fn is_shift(vk: u16) -> bool {
    vk == VK_SHIFT.0 || vk == VK_LSHIFT.0 || vk == VK_RSHIFT.0
}

/// 隐藏窗口的消息过程：只处理 WM_INPUT，其余交给系统默认处理
unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_INPUT {
        handle_input(lparam);
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

unsafe fn handle_input(lparam: LPARAM) {
    if !ENABLED.load(Ordering::Relaxed) {
        return;
    }
    // 键盘事件很小，栈上 128 字节足够；按 GetRawInputData 的约定先读进缓冲
    let mut buf = [0u8; 128];
    let mut size = buf.len() as u32;
    let got = GetRawInputData(
        HRAWINPUT(lparam.0 as *mut _),
        RID_INPUT,
        Some(buf.as_mut_ptr() as *mut _),
        &mut size,
        std::mem::size_of::<RAWINPUTHEADER>() as u32,
    );
    if got == u32::MAX || got == 0 {
        return;
    }
    let raw = &*(buf.as_ptr() as *const RAWINPUT);
    if raw.header.dwType != RIM_TYPEKEYBOARD.0 {
        return;
    }
    let kb = &raw.data.keyboard;
    let vk = kb.VKey;
    if vk == 0xFFu16 {
        // 部分设备会发 0xFF 的伪键，忽略
        return;
    }
    let down = (kb.Flags & 0x01) == 0; // RI_KEY_BREAK = 0x01
    let win = is_win(vk);
    let shift = is_shift(vk);

    if win || shift {
        if down {
            if win {
                WIN_DOWN.store(true, Ordering::Relaxed);
            }
            if shift {
                SHIFT_DOWN.store(true, Ordering::Relaxed);
            }
        } else {
            let both = WIN_DOWN.load(Ordering::Relaxed) && SHIFT_DOWN.load(Ordering::Relaxed);
            if both && CHORD_CLEAN.load(Ordering::Relaxed) {
                // 先取消 clean，避免松开第二个修饰键时再触发一次
                CHORD_CLEAN.store(false, Ordering::Relaxed);
                let tid = LISTENER_TID.load(Ordering::Relaxed);
                if tid != 0 {
                    let _ = PostThreadMessageW(tid, WM_APP_TRIGGER, WPARAM(0), LPARAM(0));
                }
            }
            if win {
                WIN_DOWN.store(false, Ordering::Relaxed);
            }
            if shift {
                SHIFT_DOWN.store(false, Ordering::Relaxed);
            }
            if !WIN_DOWN.load(Ordering::Relaxed) && !SHIFT_DOWN.load(Ordering::Relaxed) {
                CHORD_CLEAN.store(true, Ordering::Relaxed);
            }
        }
    } else if down && (WIN_DOWN.load(Ordering::Relaxed) || SHIFT_DOWN.load(Ordering::Relaxed)) {
        // Win 已按下时按了 E（先开了资源管理器），或 Win+Shift 后按了 S（截图）：
        // 这一轮不再算裸组合键，直到两个修饰键都松开
        CHORD_CLEAN.store(false, Ordering::Relaxed);
    }
}

fn start_listener(app: AppHandle) {
    let spawned = std::thread::Builder::new()
        .name("ed-bare-chord".into())
        .spawn(move || unsafe {
            let hinst = match GetModuleHandleW(None) {
                Ok(h) => HINSTANCE(h.0),
                Err(e) => {
                    STARTED.store(false, Ordering::SeqCst);
                    ENABLED.store(false, Ordering::SeqCst);
                    crate::logging::error("hotkey", format!("Win+Shift 监听失败: 取模块句柄 {e}"));
                    return;
                }
            };
            let class = w!("EasyDesktopBareChord");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: hinst,
                lpszClassName: class,
                ..Default::default()
            };
            // 类已存在时 RegisterClassW 返回 0，但窗口仍可创建，所以不因它提前退出
            RegisterClassW(&wc);
            let hwnd = match CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                class,
                PCWSTR::null(),
                WS_POPUP,
                0,
                0,
                0,
                0,
                None,
                None,
                Some(hinst),
                None,
            ) {
                Ok(h) => h,
                Err(e) => {
                    STARTED.store(false, Ordering::SeqCst);
                    ENABLED.store(false, Ordering::SeqCst);
                    crate::logging::error("hotkey", format!("Win+Shift 监听失败: 建隐藏窗口 {e}"));
                    return;
                }
            };
            let dev = RAWINPUTDEVICE {
                usUsagePage: 0x01, // Generic Desktop Controls
                usUsage: 0x06,     // Keyboard
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            };
            if let Err(e) = RegisterRawInputDevices(
                &[dev],
                std::mem::size_of::<RAWINPUTDEVICE>() as u32,
            ) {
                STARTED.store(false, Ordering::SeqCst);
                ENABLED.store(false, Ordering::SeqCst);
                crate::logging::error("hotkey", format!("Win+Shift 监听失败: Raw Input {e}"));
                return;
            }
            LISTENER_TID.store(GetCurrentThreadId(), Ordering::SeqCst);
            crate::logging::info("hotkey", "hotkey: Win+Shift 裸组合键监听已启动 (Raw Input)");

            let mut msg = MSG::default();
            loop {
                let ret = GetMessageW(&mut msg, None, 0, 0);
                if ret.0 <= 0 {
                    break;
                }
                if msg.message == WM_APP_TRIGGER {
                    crate::toggle_panel(&app);
                    continue;
                }
                let _ = TranslateMessage(&msg);
                let _ = DispatchMessageW(&msg);
            }
            LISTENER_TID.store(0, Ordering::SeqCst);
            STARTED.store(false, Ordering::SeqCst);
        });
    if let Err(e) = spawned {
        STARTED.store(false, Ordering::SeqCst);
        ENABLED.store(false, Ordering::SeqCst);
        crate::logging::error("hotkey", format!("Win+Shift 监听线程启动失败: {e}"));
    }
}

/// 切换触发方式时调用：mode 2 启用，其它模式停用。
///
/// 监听线程只启动一次，之后仅切换 `ENABLED`；线程常驻到进程结束。
pub fn set_enabled(on: bool, app: AppHandle) {
    if on {
        let was = ENABLED.swap(true, Ordering::SeqCst);
        WIN_DOWN.store(false, Ordering::SeqCst);
        SHIFT_DOWN.store(false, Ordering::SeqCst);
        CHORD_CLEAN.store(true, Ordering::SeqCst);
        if !STARTED.swap(true, Ordering::SeqCst) {
            start_listener(app);
        }
        if !was {
            crate::logging::info("hotkey", "hotkey: Win+Shift 裸组合键已启用");
        }
    } else {
        if !ENABLED.swap(false, Ordering::SeqCst) {
            return;
        }
        WIN_DOWN.store(false, Ordering::SeqCst);
        SHIFT_DOWN.store(false, Ordering::SeqCst);
        CHORD_CLEAN.store(true, Ordering::SeqCst);
        crate::logging::info("hotkey", "hotkey: Win+Shift 裸组合键已停用");
    }
}
