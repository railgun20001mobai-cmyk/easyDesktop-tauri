//! 分级日志：Rust 侧所有日志统一写 exe 同目录的 ed_calls.log。
//!
//! 阈值由 `ED_LOG_LEVEL` 环境变量控制（debug/info/warn/error）；
//! 未设置时 debug 构建记 debug、release 构建记 info。

use std::fmt::Display;
use std::io::Write;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn label(self) -> &'static str {
        match self {
            Level::Debug => "DEBUG",
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

fn parse_level(raw: &str) -> Option<Level> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "debug" => Some(Level::Debug),
        "info" => Some(Level::Info),
        "warn" | "warning" => Some(Level::Warn),
        "error" => Some(Level::Error),
        _ => None,
    }
}

fn default_level(debug_build: bool) -> Level {
    if debug_build {
        Level::Debug
    } else {
        Level::Info
    }
}

/// 环境变量非法时回退到默认级别，不因为一个笔误把日志全关掉
fn threshold_from(raw: Option<&str>, debug_build: bool) -> Level {
    raw.and_then(parse_level)
        .unwrap_or_else(|| default_level(debug_build))
}

fn threshold() -> Level {
    static LEVEL: OnceLock<Level> = OnceLock::new();
    *LEVEL.get_or_init(|| threshold_from(std::env::var("ED_LOG_LEVEL").ok().as_deref(), cfg!(debug_assertions)))
}

fn passes(level: Level, threshold: Level) -> bool {
    level >= threshold
}

fn format_line(ts: &str, level: Level, scope: &str, msg: &str) -> String {
    format!("[{}] [rust] {} [{}] {}", ts, level.label(), scope, msg)
}

pub(crate) fn log(level: Level, scope: &str, msg: impl Display) {
    if !passes(level, threshold()) {
        return;
    }
    rotate_if_needed();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(crate::config::exe_dir().join("ed_calls.log"))
    {
        // 带本地时间戳：排查问题时要能和系统事件日志（重启/蓝屏/崩溃）对时间线
        let ts = crate::win32::local_time_str();
        let _ = writeln!(f, "{}", format_line(&ts, level, scope, &msg.to_string()));
    }
}

pub(crate) fn debug(scope: &str, msg: impl Display) {
    log(Level::Debug, scope, msg);
}

pub(crate) fn info(scope: &str, msg: impl Display) {
    log(Level::Info, scope, msg);
}

pub(crate) fn warn(scope: &str, msg: impl Display) {
    log(Level::Warn, scope, msg);
}

pub(crate) fn error(scope: &str, msg: impl Display) {
    log(Level::Error, scope, msg);
}

/// 日志上限 512KB，超了就从零开始（日志只用于排查问题，不该无限增长）
///
/// 每 128 次写入才 stat 一次，避免频繁系统调用。
fn rotate_if_needed() {
    const LOG_MAX: u64 = 512 * 1024;
    static TICK: AtomicU32 = AtomicU32::new(0);
    if TICK.fetch_add(1, Ordering::Relaxed) % 128 != 0 {
        return;
    }
    let path = crate::config::exe_dir().join("ed_calls.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_MAX {
            let _ = std::fs::write(&path, "[rust] 日志超过 512KB，已重置\n");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_levels_case_insensitively() {
        assert_eq!(parse_level("DEBUG"), Some(Level::Debug));
        assert_eq!(parse_level(" info "), Some(Level::Info));
        assert_eq!(parse_level("Warn"), Some(Level::Warn));
        assert_eq!(parse_level("warning"), Some(Level::Warn));
        assert_eq!(parse_level("error"), Some(Level::Error));
    }

    #[test]
    fn ignores_unknown_level() {
        assert_eq!(parse_level(""), None);
        assert_eq!(parse_level("verbose"), None);
    }

    #[test]
    fn default_level_depends_on_build() {
        assert_eq!(default_level(true), Level::Debug);
        assert_eq!(default_level(false), Level::Info);
    }

    #[test]
    fn env_overrides_default_and_invalid_falls_back() {
        assert_eq!(threshold_from(Some("warn"), false), Level::Warn);
        assert_eq!(threshold_from(Some("debug"), false), Level::Debug);
        assert_eq!(threshold_from(Some("nope"), false), Level::Info);
        assert_eq!(threshold_from(None, true), Level::Debug);
    }

    #[test]
    fn filters_lower_levels() {
        assert!(passes(Level::Info, Level::Info));
        assert!(passes(Level::Warn, Level::Info));
        assert!(passes(Level::Error, Level::Warn));
        assert!(!passes(Level::Debug, Level::Info));
        assert!(!passes(Level::Info, Level::Warn));
    }

    #[test]
    fn formats_line_with_level_and_scope() {
        assert_eq!(
            format_line("2026-10-22 10:00:00", Level::Warn, "config", "读取失败"),
            "[2026-10-22 10:00:00] [rust] WARN [config] 读取失败"
        );
    }
}
