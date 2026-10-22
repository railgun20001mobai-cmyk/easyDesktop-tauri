//! 配置读写（沿用旧版的 config.json / user_class.json / cl_data.json，放在 exe 同目录）

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static CONFIG: OnceLock<Mutex<Config>> = OnceLock::new();
static EXE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 唯一版本来源：`Cargo.toml` 的 `version`。运行时/配置里的版本都从这里取，避免多处手改漂移。
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 面板按「分辨率 + 缩放」记住的尺寸与位置
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ScreenInfo {
    pub w: i64,
    pub h: i64,
    pub x: i64,
    pub y: i64,
    #[serde(rename = "outPos")]
    pub out_pos: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ScreensWinInfo {
    pub w_pc: f64,
    pub h_pc: f64,
    pub infos: BTreeMap<String, ScreenInfo>,
}

impl Default for ScreensWinInfo {
    fn default() -> Self {
        Self {
            w_pc: 0.65,
            h_pc: 0.4,
            infos: BTreeMap::new(),
        }
    }
}

/// 主配置。
///
/// 已知字段类型化，未知字段落在 `extra`：前端新增设置项时不需要同步改这里，
/// 也不会因为反序列化丢掉用户已写入的键。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub version: String,
    pub theme: String,
    pub language: String,
    #[serde(rename = "themeChangeType")]
    pub theme_change_type: String,
    pub view: String,
    pub auto_start: bool,
    pub use_bg: bool,
    pub bg: String,
    pub ms_ef: i64,
    pub ign_update: String,
    pub width: i64,
    pub height: i64,
    pub full_screen: bool,
    pub fdr: bool,
    pub cf_type: String,
    pub cf_hotkey: String,
    pub corner_size: String,
    pub out_cf_type: String,
    #[serde(rename = "show_sysApp")]
    pub show_sys_app: bool,
    #[serde(deserialize_with = "de_f64_flexible")]
    pub scale: f64,
    pub df_dir: String,
    pub df_dir_name: String,
    pub of_s: bool,
    #[serde(rename = "outPos")]
    pub out_pos: String,
    pub imgpre: bool,
    #[serde(rename = "bgType")]
    pub bg_type: String,
    pub blur_bg: bool,
    pub blur_effect: i64,
    pub dir_order: BTreeMap<String, Vec<Value>>,
    pub class_order: Vec<String>,
    pub ico: BTreeMap<String, String>,
    pub dbc_action: String,
    pub show_hidden_file: bool,
    pub custom: Value,
    #[serde(rename = "screens_winInfo")]
    pub screens_win_info: ScreensWinInfo,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Config {
    fn default() -> Self {
        let (w, h) = crate::win32::screen_size();
        Self {
            version: APP_VERSION.to_string(),
            theme: "light".to_string(),
            language: "zh-CN".to_string(),
            theme_change_type: "1".to_string(),
            view: "block".to_string(),
            auto_start: false,
            use_bg: false,
            bg: String::new(),
            ms_ef: 0,
            ign_update: String::new(),
            width: (w as f64 * 0.65) as i64,
            height: (h as f64 * 0.4) as i64,
            full_screen: true,
            fdr: true,
            cf_type: "1".to_string(),
            cf_hotkey: String::new(),
            corner_size: "2".to_string(),
            out_cf_type: "2".to_string(),
            show_sys_app: false,
            scale: 80.0,
            df_dir: "desktop".to_string(),
            df_dir_name: "桌面".to_string(),
            of_s: true,
            out_pos: "1".to_string(),
            imgpre: true,
            bg_type: "3".to_string(),
            blur_bg: true,
            blur_effect: 30,
            dir_order: BTreeMap::new(),
            class_order: Vec::new(),
            ico: BTreeMap::new(),
            dbc_action: "1".to_string(),
            show_hidden_file: false,
            custom: json!({}),
            screens_win_info: ScreensWinInfo::default(),
            extra: Map::new(),
        }
    }
}

fn de_f64_flexible<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v = Value::deserialize(deserializer)?;
    match v {
        Value::Number(n) => n
            .as_f64()
            .ok_or_else(|| serde::de::Error::custom("数字无法转换为 f64")),
        Value::String(s) => s
            .parse::<f64>()
            .map_err(|e| serde::de::Error::custom(format!("不是有效数字: {e}"))),
        _ => Err(serde::de::Error::custom("期望数字或数字字符串")),
    }
}

pub fn exe_dir() -> &'static PathBuf {
    EXE_DIR.get_or_init(|| {
        let dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        if dir_writable(&dir) {
            return dir;
        }
        // 装进 Program Files 这类只读目录时配置写不进去（看起来像每次启动都恢复默认），
        // 退回 %APPDATA%\EasyDesktop
        let fallback = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("EasyDesktop");
        let _ = fs::create_dir_all(&fallback);
        if dir_writable(&fallback) {
            fallback
        } else {
            dir
        }
    })
}

/// 试写一个临时文件判断目录是否可写
fn dir_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(".ed_write_test");
    match fs::write(&probe, b"1") {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 损坏文件留底名：`config.corrupt-bak-20261021-181500.json`
///
/// 同一秒内多次损坏时追加序号，不能覆盖上一次现场。
fn corrupt_backup_path(path: &Path, stamp: &str) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let ext = path
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    let mut candidate = path.with_file_name(format!("{}.corrupt-bak-{}{}", stem, stamp, ext));
    let mut i = 1;
    while candidate.exists() {
        candidate = path.with_file_name(format!("{}.corrupt-bak-{}-{}{}", stem, stamp, i, ext));
        i += 1;
    }
    candidate
}

fn read_json<T>(path: PathBuf, fallback: T) -> T
where
    T: DeserializeOwned,
{
    match fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<T>(&s) {
            Ok(v) => v,
            Err(e) => {
                // 文件损坏时先改名留底，再回退默认值；否则下次写盘会把现场直接覆盖掉
                let backup = corrupt_backup_path(&path, &crate::win32::file_timestamp_str());
                match fs::rename(&path, &backup) {
                    Ok(()) => crate::logging::warn(
                        "config",
                        format!(
                            "{} 解析失败: {}；已备份到 {}",
                            path.display(),
                            e,
                            backup.display()
                        ),
                    ),
                    Err(re) => crate::logging::error(
                        "config",
                        format!(
                            "{} 解析失败: {}；备份到 {} 也失败: {}",
                            path.display(),
                            e,
                            backup.display(),
                            re
                        ),
                    ),
                }
                fallback
            }
        },
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            crate::logging::warn("config", format!("读取 {} 失败: {}", path.display(), e));
            fallback
        }
        Err(_) => fallback,
    }
}

/// 原子写：先写 .tmp 再 rename，避免写坏导致软件起不来
pub fn write_json<T: Serialize + ?Sized>(path: &PathBuf, data: &T) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    if let Err(e) = fs::write(&tmp, text) {
        crate::logging::error("config", format!("写入 {} 失败: {}", tmp.display(), e));
        return Err(e);
    }
    if let Err(e) = fs::rename(&tmp, path) {
        crate::logging::error("config", format!("替换 {} 失败: {}", path.display(), e));
        return Err(e);
    }
    Ok(())
}

pub fn init() {
    let dir = exe_dir().clone();
    let path = dir.join("config.json");
    let mut cfg = if path.exists() {
        read_json(path.clone(), Config::default())
    } else {
        let d = Config::default();
        let _ = write_json(&path, &d);
        d
    };
    // 版本号以 Cargo.toml 为准，旧配置里的 version 不参与逻辑
    cfg.version = APP_VERSION.to_string();
    let _ = CONFIG.set(Mutex::new(cfg));
}

pub fn get() -> Config {
    CONFIG
        .get()
        .and_then(|m| m.lock().ok())
        .map(|g| g.clone())
        .unwrap_or_else(Config::default)
}

/// 返回给前端的配置（旧版会剔除 dir_order）
pub fn get_public() -> Value {
    let cfg = get();
    match serde_json::to_value(cfg) {
        Ok(mut v) => {
            if let Some(o) = v.as_object_mut() {
                o.remove("dir_order");
            }
            v
        }
        Err(e) => {
            crate::logging::error("config", format!("序列化公开配置失败: {e}"));
            json!({})
        }
    }
}

fn write_config(cfg: &Config) {
    let _ = write_json(&exe_dir().join("config.json"), cfg);
}

/// 在锁内完成一次读改写；闭包返回 `true` 才落盘
///
/// 避免「先 get() 克隆整份配置、改完再 set_all()」：两步之间别的调用插进来，
/// 后写的会把先写的覆盖掉。
pub fn mutate<F>(f: F)
where
    F: FnOnce(&mut Config) -> bool,
{
    let Some(m) = CONFIG.get() else {
        return;
    };
    let Ok(mut g) = m.lock() else {
        return;
    };
    if f(&mut g) {
        write_config(&g);
    }
}

/// 前端按 key 更新单个配置项。
///
/// 这里是 JSON 边界：先把类型化配置序列化、插入新值，再反序列化回来。
/// 这样 `userTheme`、`auto_start_priority` 这类尚未建模的键仍会落进 `extra`。
pub fn update(part: &str, data: Value) {
    mutate(|cfg| {
        let mut value = match serde_json::to_value(&*cfg) {
            Ok(v) => v,
            Err(e) => {
                crate::logging::error("config", format!("更新 {} 前序列化失败: {e}", part));
                return false;
            }
        };
        let Some(o) = value.as_object_mut() else {
            crate::logging::error("config", "配置根节点不是对象，拒绝更新");
            return false;
        };
        o.insert(part.to_string(), data);
        match serde_json::from_value::<Config>(value) {
            Ok(next) => {
                *cfg = next;
                true
            }
            Err(e) => {
                crate::logging::error("config", format!("更新 {} 的类型不匹配: {e}", part));
                false
            }
        }
    });
}

/// 原子写入某个目录的排序表
pub fn set_dir_order(dir_key: &str, order: Vec<String>) {
    mutate(|cfg| {
        let values = order.into_iter().map(Value::String).collect();
        cfg.dir_order.insert(dir_key.to_string(), values);
        true
    });
}

/// 从所有目录的排序表里摘掉某个路径（删除应用组等场景）
pub fn remove_path_from_orders(file_path: &str) {
    mutate(|cfg| {
        let mut dirty = false;
        for arr in cfg.dir_order.values_mut() {
            let before = arr.len();
            arr.retain(|x| crate::order::item_path(x) != Some(file_path));
            dirty |= arr.len() != before;
        }
        dirty
    });
}

/// 原子增删自定义图标映射；`url = None` 表示恢复默认图标
pub fn set_icon(path: &str, url: Option<&str>) {
    mutate(|cfg| match url {
        Some(u) => {
            cfg.ico.insert(path.to_string(), u.to_string());
            true
        }
        None => cfg.ico.remove(path).is_some(),
    });
}

// ===== 分类 =====
fn class_path() -> PathBuf {
    exe_dir().join("user_class.json")
}

pub fn read_classes() -> Value {
    read_json(class_path(), json!({"desktop": {}}))
}

pub fn write_classes(data: &Value) {
    let _ = write_json(&class_path(), data);
}

// ===== 标星 =====
fn cl_path() -> PathBuf {
    exe_dir().join("cl_data.json")
}

pub fn read_cl() -> Value {
    read_json(cl_path(), json!({}))
}

pub fn write_cl(data: &Value) {
    let _ = write_json(&cl_path(), data);
}

/// 把一个条目（应用组的伪路径）加进指定分类
///
/// user_class.json 结构：{ "<dir_key>": { "<分类名>": [ {filePath, ...}, ... ] } }
/// 在"开发编程"这类分类页里新建的组，要归到这个分类下，否则只会出现在「全部」里。
pub fn add_file_to_class(class_name: &str, file_path: &str, display_name: &str) {
    if class_name.is_empty() || class_name == "全部" {
        return;
    }
    let dir = get().df_dir;
    let mut classes = read_classes();
    if let Some(obj) = classes.as_object_mut() {
        let d = obj.entry(dir).or_insert_with(|| json!({}));
        if let Some(dm) = d.as_object_mut() {
            let entry = dm.entry(class_name).or_insert_with(|| json!([]));
            if let Some(arr) = entry.as_array_mut() {
                let exists = arr
                    .iter()
                    .any(|x| x.get("filePath").and_then(|v| v.as_str()) == Some(file_path));
                if !exists {
                    arr.push(json!({
                        "filePath": file_path,
                        "fileName": display_name,
                        "fileType": "应用组",
                        "isGroup": true,
                    }));
                }
            }
        }
    }
    write_classes(&classes);
}

/// 从所有分类里摘掉某个条目（应用组被解散时用）
///
/// 组是根目录的伪条目，分类里存的是它的伪路径；组没了却留着这条引用，
/// 分类过滤里就会出现一个指向不存在条目的幽灵项（分类设置里也还勾着）。
pub fn remove_file_from_classes(file_path: &str) {
    let mut classes = read_classes();
    let mut dirty = false;
    if let Some(obj) = classes.as_object_mut() {
        for (_, map) in obj.iter_mut() {
            if let Some(dm) = map.as_object_mut() {
                for (_, list) in dm.iter_mut() {
                    if let Some(arr) = list.as_array_mut() {
                        let before = arr.len();
                        arr.retain(|x| {
                            x.get("filePath").and_then(|v| v.as_str()) != Some(file_path)
                        });
                        if arr.len() != before {
                            dirty = true;
                        }
                    }
                }
            }
        }
    }
    if dirty {
        write_classes(&classes);
    }
}

/// 改掉分类里某个条目的显示名（应用组改名后用，保持分类设置里的名字一致）
pub fn rename_in_classes(file_path: &str, new_name: &str) {
    let mut classes = read_classes();
    let mut dirty = false;
    if let Some(obj) = classes.as_object_mut() {
        for (_, map) in obj.iter_mut() {
            if let Some(dm) = map.as_object_mut() {
                for (_, list) in dm.iter_mut() {
                    if let Some(arr) = list.as_array_mut() {
                        for item in arr.iter_mut() {
                            let same = item
                                .get("filePath")
                                .and_then(|v| v.as_str())
                                .map(|p| p == file_path)
                                .unwrap_or(false);
                            if same {
                                if let Some(o) = item.as_object_mut() {
                                    o.insert("fileName".into(), json!(new_name));
                                    dirty = true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if dirty {
        write_classes(&classes);
    }
}

/// 把默认目录的最新扫描结果并入 dir_order（启动时调用）
///
/// 用户要求：启动软件时读一次桌面，让顺序保持最新；呼出面板时不再重排，保证流畅。
/// 已存在的条目保持用户排好的相对顺序，新增条目按它在扫描结果里的下标插进去，
/// 已消失的条目从顺序里剔除。
pub fn merge_desktop_order(dir_key: &str, all: Vec<Value>) -> usize {
    // 全程在同一把锁里读改写：避免和前端同时写配置时互相覆盖
    let Some(m) = CONFIG.get() else {
        return 0;
    };
    let Ok(mut g) = m.lock() else {
        return 0;
    };

    let saved = crate::order::saved_paths(&g.dir_order, dir_key);
    let paths: Vec<String> = all
        .iter()
        .filter_map(|item| {
            item.get("filePath")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .collect();
    let result = crate::order::merge_order(&saved, &paths);

    // 顺序没变化就不写盘，避免每次启动都改配置
    let changed =
        result.len() != saved.len() || result.iter().zip(saved.iter()).any(|(a, b)| a != b);
    if !changed {
        return 0;
    }
    g.dir_order.insert(
        dir_key.to_string(),
        result
            .iter()
            .map(|p| Value::String(p.clone()))
            .collect::<Vec<_>>(),
    );
    write_config(&g);
    result.len()
}

// ===== 应用组 =====
// 结构：{ "<groupId>": { "name": "组名", "files": [ {filePath, fileName, ico, ...}, ... ] } }
fn groups_path() -> PathBuf {
    exe_dir().join("user_groups.json")
}

pub fn read_groups() -> Value {
    read_json(groups_path(), json!({}))
}

pub fn write_groups(data: &Value) {
    let _ = write_json(&groups_path(), data);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn default_config_uses_package_version() {
        let cfg = Config::default();
        assert_eq!(cfg.version, APP_VERSION);
    }

    #[test]
    fn corrupt_backup_keeps_json_extension_and_timestamp() {
        let p = corrupt_backup_path(Path::new("C:/ed/config.json"), "20261021-181500");
        let name = p.file_name().unwrap().to_string_lossy();
        assert_eq!(name, "config.corrupt-bak-20261021-181500.json");
    }

    #[test]
    fn missing_scale_falls_back_to_default() {
        let cfg: super::Config = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(cfg.scale, 80.0);
    }

    #[test]
    fn config_keeps_unknown_keys_and_accepts_string_scale() {
        let cfg: Config = serde_json::from_value(json!({
            "scale": "80",
            "show_sysApp": true,
            "auto_start_priority": true,
            "userTheme": { "primary": "#fff" },
            "dir_order": { "desktop": ["a", { "filePath": "b" }, 1, null] }
        }))
        .unwrap();
        assert_eq!(cfg.scale, 80.0);
        assert!(cfg.show_sys_app);
        assert_eq!(cfg.extra.get("auto_start_priority"), Some(&json!(true)));
        assert!(cfg.extra.get("userTheme").is_some());
        assert_eq!(cfg.dir_order["desktop"].len(), 4);
    }

    #[test]
    fn public_config_hides_dir_order_but_keeps_extra() {
        let cfg: Config = serde_json::from_value(json!({
            "dir_order": { "desktop": ["a"] },
            "auto_start_priority": false
        }))
        .unwrap();
        let mut v = serde_json::to_value(cfg).unwrap();
        v.as_object_mut().unwrap().remove("dir_order");
        assert!(v.get("dir_order").is_none());
        assert_eq!(v.get("auto_start_priority"), Some(&json!(false)));
    }
}
