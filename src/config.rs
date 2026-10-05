//! 配置读写（沿用旧版的 config.json / user_class.json / cl_data.json，放在 exe 同目录）

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static CONFIG: OnceLock<Mutex<Value>> = OnceLock::new();
static EXE_DIR: OnceLock<PathBuf> = OnceLock::new();

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

fn default_config() -> Value {
    let (w, h) = crate::win32::screen_size();
    json!({
        "version": "2.9.0",
        "theme": "light",
        "language": "zh-CN",
        "themeChangeType": "1",
        "view": "block",
        "auto_start": false,
        "use_bg": false,
        "bg": "",
        "ms_ef": 0,
        "ign_update": "",
        "width": (w as f64 * 0.65) as i64,
        "height": (h as f64 * 0.4) as i64,
        "full_screen": true,
        "fdr": true,
        "cf_type": "1",
        "cf_hotkey": "",
        "corner_size": "2",
        "out_cf_type": "2",
        "show_sysApp": false,
        "scale": 80,
        "df_dir": "desktop",
        "df_dir_name": "桌面",
        "of_s": true,
        "outPos": "1",
        "imgpre": true,
        "bgType": "3",
        "blur_bg": true,
        "blur_effect": 30,
        "dir_order": {},
        "class_order": [],
        "ico": {},
        "dbc_action": "1",
        "show_hidden_file": false,
        "custom": {},
        "screens_winInfo": { "w_pc": 0.65, "h_pc": 0.4, "infos": {} }
    })
}

fn read_json(path: PathBuf, fallback: Value) -> Value {
    match fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<Value>(&s) {
            Ok(v) => v,
            Err(_) => {
                // 文件损坏时先改名留底，再回退默认值；否则下次写盘会把现场直接覆盖掉
                let _ = fs::rename(&path, path.with_extension("corrupt-bak"));
                fallback
            }
        },
        Err(_) => fallback,
    }
}

/// 原子写：先写 .tmp 再 rename，避免写坏导致软件起不来
pub fn write_json(path: &PathBuf, data: &Value) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(data).unwrap_or_default())?;
    fs::rename(&tmp, path)?;
    Ok(())
}

pub fn init() {
    let dir = exe_dir().clone();
    let path = dir.join("config.json");
    let mut cfg = if path.exists() {
        read_json(path.clone(), default_config())
    } else {
        let d = default_config();
        let _ = write_json(&path, &d);
        d
    };
    // 补齐缺失字段（版本升级时的兼容处理）
    let def = default_config();
    if let (Some(obj), Some(def_obj)) = (cfg.as_object_mut(), def.as_object()) {
        for (k, v) in def_obj {
            if !obj.contains_key(k) {
                obj.insert(k.clone(), v.clone());
            }
        }
        obj.insert("version".into(), json!("2.9.0"));
    }
    let _ = CONFIG.set(Mutex::new(cfg));
}

pub fn get() -> Value {
    CONFIG
        .get()
        .and_then(|m| m.lock().ok())
        .map(|g| g.clone())
        .unwrap_or_else(default_config)
}

/// 返回给前端的配置（旧版会剔除 dir_order）
pub fn get_public() -> Value {
    let mut c = get();
    if let Some(o) = c.as_object_mut() {
        o.remove("dir_order");
    }
    c
}

/// 整体替换配置（用于嵌套修改，如 dir_order）
pub fn set_all(data: Value) {
    if let Some(m) = CONFIG.get() {
        if let Ok(mut g) = m.lock() {
            *g = data;
            let _ = write_json(&exe_dir().join("config.json"), &g);
        }
    }
}

pub fn update(part: &str, data: Value) {
    if let Some(m) = CONFIG.get() {
        if let Ok(mut g) = m.lock() {
            if let Some(o) = g.as_object_mut() {
                o.insert(part.to_string(), data);
            }
            let _ = write_json(&exe_dir().join("config.json"), &g);
        }
    }
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
    let dir = get()
        .get("df_dir")
        .and_then(|v| v.as_str())
        .unwrap_or("desktop")
        .to_string();
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

    let saved: Vec<String> = g
        .get("dir_order")
        .and_then(|d| d.get(dir_key))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    x.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| x.get("filePath").and_then(|v| v.as_str()).map(|s| s.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();

    // 扫描结果里每个条目的下标（新增项按它插回，和渲染时 order_items 的规则一致）
    let mut paths: Vec<String> = Vec::new();
    for item in &all {
        if let Some(p) = item.get("filePath").and_then(|v| v.as_str()) {
            paths.push(p.to_string());
        }
    }
    let exist: std::collections::HashSet<&str> = paths.iter().map(|s| s.as_str()).collect();
    let saved_set: std::collections::HashSet<&str> = saved.iter().map(|s| s.as_str()).collect();

    // 1) 仍存在的条目按用户保存的顺序排好
    let mut result: Vec<String> = Vec::new();
    for sp in &saved {
        if exist.contains(sp.as_str()) {
            result.push(sp.clone());
        }
    }
    // 2) 新增条目按它在扫描结果里的下标插回
    for (i, p) in paths.iter().enumerate() {
        if saved_set.contains(p.as_str()) {
            continue;
        }
        let pos = i.min(result.len());
        result.insert(pos, p.clone());
    }

    // 顺序没变化就不写盘，避免每次启动都改配置
    let changed =
        result.len() != saved.len() || result.iter().zip(saved.iter()).any(|(a, b)| a != b);
    if !changed {
        return 0;
    }
    if let Some(o) = g.as_object_mut() {
        if !o.get("dir_order").map(|v| v.is_object()).unwrap_or(false) {
            o.insert("dir_order".to_string(), json!({}));
        }
        if let Some(dm) = o.get_mut("dir_order").and_then(|v| v.as_object_mut()) {
            dm.insert(dir_key.to_string(), json!(result));
        }
    }
    let _ = write_json(&exe_dir().join("config.json"), &g);
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
