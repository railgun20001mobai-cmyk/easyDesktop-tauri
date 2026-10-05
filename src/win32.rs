//! Windows 原生 API 封装（COM 解析快捷方式、Shell 打开/定位、光标与屏幕信息）

use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows::core::{Interface, PCWSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    IPersistFile, STGM_READ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, ShellExecuteW};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN, SW_SHOWNORMAL,
};
use windows::Win32::Foundation::POINT;

fn to_wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(once(0)).collect()
}

fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// 确保 COM 已初始化（重复调用安全，返回 Err 时忽略即可）
fn ensure_com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
}

/// 解析 .lnk 指向的真实路径；失败返回 None
pub fn resolve_lnk(path: &str) -> Option<String> {
    if !path.to_lowercase().ends_with(".lnk") {
        return None;
    }
    ensure_com();
    unsafe {
        let link: IShellLinkW = match CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) {
            Ok(v) => v,
            Err(_) => return None,
        };
        let persist: IPersistFile = match link.cast::<IPersistFile>() {
            Ok(v) => v,
            Err(_) => return None,
        };
        let wide = to_wide(path);
        if persist.Load(PCWSTR(wide.as_ptr()), STGM_READ).is_err() {
            return None;
        }
        let mut buf = [0u16; 1024];
        match link.GetPath(&mut buf, std::ptr::null_mut(), 0) {
            Ok(_) => {
                let s = from_wide(&buf);
                if s.is_empty() {
                    None
                } else {
                    Some(s)
                }
            }
            Err(_) => None,
        }
    }
}

/// 用系统默认方式打开文件
pub fn shell_open(path: &str) {
    let wide = to_wide(path);
    unsafe {
        ShellExecuteW(
            None,
            PCWSTR::null(),
            PCWSTR(wide.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

/// 在资源管理器中定位文件
pub fn shell_show_in_explorer(path: &str) {
    let params = format!("/select,\"{}\"", path);
    let exe = to_wide("explorer");
    let args = to_wide(&params);
    unsafe {
        ShellExecuteW(
            None,
            PCWSTR::null(),
            PCWSTR(exe.as_ptr()),
            PCWSTR(args.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

/// 用资源管理器打开系统文件夹（此电脑 / 控制面板 / 回收站）
///
/// 传 shell 命名空间 CLSID，如 `::{20D04FE0-3AEA-1069-A2D8-08002B30309D}`。
pub fn open_sys_folder(clsid: &str) {
    let exe = to_wide("explorer.exe");
    let arg = to_wide(clsid);
    unsafe {
        ShellExecuteW(
            None,
            PCWSTR::null(),
            PCWSTR(exe.as_ptr()),
            PCWSTR(arg.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

/// 主显示器缩放百分比（如 175），用于 screens_winInfo 的 "2560x1600 175%" 键
pub fn screen_scale_percent() -> i32 {
    use windows::Win32::UI::HiDpi::GetDpiForSystem;
    unsafe {
        let dpi = GetDpiForSystem();
        ((dpi as f64) * 100.0 / 96.0).round() as i32
    }
}

/// 单实例检测：用命名互斥体，已存在同名实例时返回 true
///
/// 互斥体句柄故意不释放，随进程生命周期存在。
pub fn already_running() -> bool {
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;

    let name = to_wide("EasyDesktop_SingleInstance_Mutex");
    unsafe {
        let _handle = CreateMutexW(None, true, PCWSTR(name.as_ptr()));
        if _handle.is_err() {
            return false;
        }
        // 句柄泄漏是有意为之：保证互斥体在进程存活期间一直有效
        std::mem::forget(_handle);
        GetLastError() == ERROR_ALREADY_EXISTS
    }
}

/// 删除到回收站（对应旧版的 send2trash）
pub fn move_to_recycle_bin(path: &str) -> bool {
    use windows::Win32::UI::Shell::{
        SHFileOperationW, SHFILEOPSTRUCTW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI,
        FOF_SILENT, FO_DELETE,
    };

    // pFrom 需要「双 null 结尾」的路径列表
    let mut from: Vec<u16> = std::ffi::OsStr::new(path).encode_wide().collect();
    from.push(0);
    from.push(0);

    unsafe {
        let mut op = SHFILEOPSTRUCTW {
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            fFlags: (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_SILENT.0 | FOF_NOERRORUI.0) as u16,
            ..Default::default()
        };
        SHFileOperationW(&mut op) == 0
    }
}

/// 抢前台焦点
///
/// Windows 不允许后台进程直接抢焦点。优先用 AttachThreadInput 挂到
/// 前台线程上再抢（可靠且不残留按键状态）；失败时退回旧版的「Alt 技巧」。
///
/// 本地时间戳：MM-DD HH:MM:SS.mmm
///
/// 日志用它打头，出问题时才能和系统事件日志（蓝屏/重启/崩溃）对上时间线。
pub fn local_time_str() -> String {
    use windows::Win32::System::SystemInformation::GetLocalTime;
    let st = unsafe { GetLocalTime() };
    format!(
        "{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
        st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds
    )
}

/// 前台窗口是不是全屏应用（游戏 / 全屏视频）
pub fn is_fullscreen_foreground() -> bool {
    foreground_is_fullscreen()
}

/// 面板必须真正成为前台窗口：WebView2(Chromium) 在窗口非激活时
/// 会吞掉第一次点击——用户表现为「点一下才有反应」。
///
/// `gentle = true` 时只做温和尝试（BringWindowToTop + SetForegroundWindow）：
/// 不做 AttachThreadInput、也不注入 Alt。后者会把两个线程的输入队列接在一起，
/// 前台是全屏游戏时是危险动作（可能让游戏卡死、也容易被反作弊盯上）。
pub fn force_foreground(hwnd_raw: isize, gentle: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, SetActiveWindow, SetFocus, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };

    if hwnd_raw == 0 {
        return;
    }
    let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
    unsafe {
        if GetForegroundWindow() == hwnd {
            return;
        }
        if gentle {
            let _ = BringWindowToTop(hwnd);
            let _ = SetForegroundWindow(hwnd);
            return;
        }
        let cur = GetCurrentThreadId();
        let fg = GetForegroundWindow();
        let fg_tid = GetWindowThreadProcessId(fg, None);
        let target_tid = GetWindowThreadProcessId(hwnd, None);

        let a1 = fg_tid != 0 && fg_tid != cur && AttachThreadInput(cur, fg_tid, true).as_bool();
        let a2 =
            target_tid != 0 && target_tid != cur && AttachThreadInput(cur, target_tid, true).as_bool();

        let _ = BringWindowToTop(hwnd);
        let _ = SetForegroundWindow(hwnd);
        let _ = SetFocus(Some(hwnd));
        let _ = SetActiveWindow(hwnd);

        if a2 {
            let _ = AttachThreadInput(cur, target_tid, false);
        }
        if a1 {
            let _ = AttachThreadInput(cur, fg_tid, false);
        }

        // 还没抢到就退回 Alt 技巧
        if GetForegroundWindow() != hwnd {
            const VK_MENU: u8 = 0x12; // Alt
            keybd_event(VK_MENU, 0, KEYBD_EVENT_FLAGS(0), 0);
            let _ = SetForegroundWindow(hwnd);
            keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
        }
    }
}

/// 按标题抢前台（面板显示后兜底：鼠标进入面板时再抢一次）
pub fn activate_by_title(title: &str, gentle: bool) {
    use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
    if is_self_foreground(title) {
        return;
    }
    let wide = to_wide(title);
    unsafe {
        if let Ok(h) = FindWindowW(PCWSTR::null(), PCWSTR(wide.as_ptr())) {
            if !h.is_invalid() {
                force_foreground(h.0 as isize, gentle);
            }
        }
    }
}

/// 鼠标左键是否处于按下状态（拖拽自动滚动用）
pub fn left_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    const DOWN_MASK: i16 = 0x8000u16 as i16;
    unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) & DOWN_MASK != 0 }
}

/// 面板圆角（旧版面板四角是圆角）
///
/// 用 Win11 的 DWM 圆角属性：系统会把窗口和它的 Mica/亚克力背景一起裁成圆角；
/// 早先用 SetWindowRgn 试过，系统背景仍会把方角画满，没效果。
pub fn apply_round_corners(hwnd_raw: isize, _w: i32, _h: i32) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};
    /// DWMWA_WINDOW_CORNER_PREFERENCE
    const ATTR_CORNER: i32 = 33;
    /// DWMWCP_ROUND = 2（系统圆角，约 8px）
    const CORNER_ROUND: i32 = 2;
    if hwnd_raw == 0 {
        return;
    }
    let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
    unsafe {
        let pref = CORNER_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWINDOWATTRIBUTE(ATTR_CORNER),
            &pref as *const i32 as *const std::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
    }
}



/// 前台窗口是否是「全屏程序」（对应设置里的"防打扰"）
///
/// 判定：窗口矩形完全覆盖所在显示器的完整区域（rcMonitor）。
/// 最大化窗口只覆盖工作区（rcWork，扣掉任务栏），不会误判。
/// 桌面/任务栏/自己这些 shell 窗口要排除，否则面板永远触发不了。
pub fn foreground_is_fullscreen() -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowTextW, IsIconic, IsWindowVisible,
    };
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            return false;
        }
        // 自己 / 不可见 / 最小化 一律不算
        let mut buf = [0u16; 256];
        let n = GetWindowTextW(fg, &mut buf);
        if n > 0 && String::from_utf16_lossy(&buf[..n as usize]) == "EasyDesktop_Main" {
            return false;
        }
        if !IsWindowVisible(fg).as_bool() || IsIconic(fg).as_bool() {
            return false;
        }
        // 排除桌面 / 任务栏等 shell 窗口（它们本来就铺满屏幕）
        let mut cbuf = [0u16; 128];
        let cn = GetClassNameW(fg, &mut cbuf);
        if cn > 0 {
            let cls = String::from_utf16_lossy(&cbuf[..cn as usize]);
            if matches!(
                cls.as_str(),
                "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "Windows.UI.Core.CoreWindow"
            ) {
                return false;
            }
        }

        let mut wr = RECT::default();
        if GetWindowRect(fg, &mut wr).is_err() {
            return false;
        }
        let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(mon, &mut mi).as_bool() {
            return false;
        }
        let m = mi.rcMonitor;
        const TOL: i32 = 2;
        wr.left <= m.left + TOL
            && wr.top <= m.top + TOL
            && wr.right >= m.right - TOL
            && wr.bottom >= m.bottom - TOL
    }
}

/// 当前前台窗口的标题
pub fn foreground_title() -> String {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return String::new();
        }
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf);
        if n <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..n as usize])
    }
}

/// easyDesktop 面板当前是否为前台窗口（对应旧版 tool.is_ed_focused）
pub fn is_self_foreground(title: &str) -> bool {
    foreground_title() == title
}

pub fn cursor_pos() -> (i32, i32) {
    let mut p = POINT::default();
    unsafe {
        if GetCursorPos(&mut p).is_ok() {
            (p.x, p.y)
        } else {
            (-1, -1)
        }
    }
}

pub fn screen_size() -> (i32, i32) {
    unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) }
}

/// 路径是否带隐藏属性
pub fn is_hidden(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    path.metadata()
        .map(|m| m.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0)
        .unwrap_or(false)
}
