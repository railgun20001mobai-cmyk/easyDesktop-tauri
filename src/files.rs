//! 桌面文件扫描与排序（对应 Python 版 res_load.load_items / order_items）

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::config;
use crate::win32;

pub fn desktop_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(u) = std::env::var("USERPROFILE") {
        v.push(PathBuf::from(u).join("Desktop"));
    }
    if let Ok(p) = std::env::var("PUBLIC") {
        v.push(PathBuf::from(p).join("Desktop"));
    }
    v
}

fn icon_for(ext: &str, is_dir: bool) -> String {
    let name = if is_dir {
        "dir.png"
    } else {
        match ext.to_lowercase().as_str() {
            ".lnk" => "lnk.png",
            ".txt" => "txt.png",
            ".pdf" => "pdf.png",
            ".doc" | ".docx" => "docx.png",
            ".xls" | ".xlsx" => "xlsx.png",
            ".ppt" | ".pptx" => "pptx.png",
            ".zip" | ".rar" | ".7z" => "zip.png",
            ".json" => "JSON.png",
            ".exe" => "exe.png",
            // .url 没有专用图标，与旧版 blank 模式保持一致
            ".url" => "unkonw.png",
            _ => "unkonw.png",
        }
    };
    format!("./resources/file_icos/{}", name)
}

/// 构造单个条目，返回 (类别, 条目)
fn build_item(path: &Path, is_dir: bool) -> (&'static str, Value) {
    let file_name_full = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name_full.clone());

    let mut real_path: Option<String> = None;
    let mut ext = if is_dir {
        "dir".to_string()
    } else {
        path.extension()
            .map(|s| format!(".{}", s.to_string_lossy()))
            .unwrap_or_default()
    };

    if ext == ".lnk" {
        if let Some(target) = win32::resolve_lnk(&path.to_string_lossy()) {
            let tp = PathBuf::from(&target);
            ext = if tp.is_dir() {
                "dir".to_string()
            } else {
                tp.extension()
                    .map(|s| format!(".{}", s.to_string_lossy()))
                    .unwrap_or_default()
            };
            real_path = Some(target);
        }
    }

    let kind = if is_dir || ext == "dir" {
        "dir"
    } else if ext == ".exe" || ext == ".url" {
        "exe"
    } else {
        "file"
    };

    // 图标优先级：自定义图标 > 进程内提取的真实图标 > 静态占位图标
    let path_str = path.to_string_lossy().to_string();
    let custom = {
        let cfg = config::get();
        cfg.get("ico")
            .and_then(|m| m.get(&path_str))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    let has_custom = custom.is_some();
    let ico = match custom {
        Some(c) => c,
        None => {
            let want_real = kind == "exe"
                && (ext.eq_ignore_ascii_case(".exe")
                    || ext.eq_ignore_ascii_case(".url")
                    || file_name_full.to_lowercase().ends_with(".lnk"));
            if want_real {
                // 175% 缩放下 64px 会被放大导致模糊，取 256px（系统能提供的最大清晰度）
                crate::icons::icon_file(&path_str, 256)
                    .map(|p| crate::icons::asset_url(&p))
                    .unwrap_or_else(|| icon_for(&ext, false))
            } else {
                icon_for(&ext, is_dir || ext == "dir")
            }
        }
    };

    // .url 指向 steam:// 的标记为 Steam 游戏（旧版行为，前端显示"Steam游戏"）
    let file_type = if is_dir || ext == "dir" {
        "文件夹".to_string()
    } else if ext.eq_ignore_ascii_case(".url") {
        // .url 常为 ANSI/GBK 编码，read_to_string 会失败 → 按字节读再 lossy 转（steam:// 是 ASCII 不受影响）
        match fs::read(path) {
            Ok(b) if String::from_utf8_lossy(&b).to_lowercase().contains("steam://") => {
                "SteamGame".to_string()
            }
            _ => ext.clone(),
        }
    } else {
        ext.clone()
    };

    let mut info = json!({
        "file": real_path
            .as_ref()
            .map(|p| Path::new(p).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default())
            .unwrap_or_else(|| file_name_full.clone()),
        "filePath": path_str,
        "fileName": stem,
        "ico": ico,
        "fileType": file_type,
    });
    if let Some(o) = info.as_object_mut() {
        if let Some(rp) = real_path {
            o.insert("realPath".into(), json!(rp));
        }
        // 有自定义图标时给前端一个标记，右键菜单显示"恢复默认图标"
        if has_custom {
            o.insert("edit_ico".into(), json!(true));
        }
    }
    (kind, info)
}

/// 为任意已存在路径构造一个列表条目（应用组添加成员时用）
///
/// 字段补齐到与列表条目一致：cl / index / f_type，
/// 否则组视图里会因 cl 缺失把星标画成「已标星」。
pub fn item_for_path(path_str: &str) -> Value {
    let p = Path::new(path_str);
    let (_, mut item) = build_item(p, p.is_dir());
    if let Some(o) = item.as_object_mut() {
        let star = config::read_cl()
            .get(path_str)
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        o.insert("cl".into(), json!(star));
        o.insert("index".into(), json!(0));
        o.insert("f_type".into(), json!("exe"));
    }
    item
}

/// 桌面根目录下的「应用组」伪条目
///
/// filePath 固定为 `__group__:<gid>`，前端 generateFileId 会转成 DOM id，
/// 组内文件列表则需要真实的 ico 字段做 2x2 宫格预览。
pub fn group_items() -> Vec<Value> {
    let groups = config::read_groups();
    let Some(map) = groups.as_object() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (gid, g) in map {
        let name = g
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("应用组")
            .to_string();
        let files = g
            .get("files")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let icons: Vec<String> = files
            .iter()
            .filter_map(|f| f.get("ico").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .take(4)
            .collect();
        out.push(json!({
            "isGroup": true,
            "groupId": gid,
            "file": name,
            "fileName": name,
            "filePath": format!("__group__:{}", gid),
            "fileType": "应用组",
            "ico": icons.first().cloned().unwrap_or_else(|| "./resources/file_icos/dir.png".to_string()),
            "groupIcons": icons,
            "itemCount": files.len(),
        }));
    }
    out
}

/// 已被任一应用组收录的文件路径集合
///
/// 旧版行为：加进组里的文件会从主视图隐藏（res_load.py order_items 里的「过滤已编组文件」），
/// 否则同一个图标会同时出现在桌面和组里，看起来像重复项。
pub fn grouped_paths() -> std::collections::HashSet<String> {
    let mut out = std::collections::HashSet::new();
    let groups = config::read_groups();
    if let Some(map) = groups.as_object() {
        for g in map.values() {
            if let Some(files) = g.get("files").and_then(|v| v.as_array()) {
                for f in files {
                    if let Some(p) = f.get("filePath").and_then(|v| v.as_str()) {
                        out.insert(p.to_string());
                    }
                }
            }
        }
    }
    out
}

/// 「此电脑 / 控制面板 / 回收站」系统项（show_sysApp 打开时显示在桌面根目录）
///
/// file 前缀 explorer.exe 是为了让前端 getFileType 显示"应用程序"（与旧版一致）；
/// filePath 用中文名，正好能和旧版 dir_order 里保存的同名项对上位置。
pub fn sys_items() -> Vec<Value> {
    let cfgs = [
        ("此电脑", "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}"),
        ("控制面板", "::{26EE0668-A00A-44D7-9371-BEB064C98683}"),
        ("回收站", "::{645FF040-5081-101B-9F08-00AA002F954E}"),
    ];
    cfgs.iter()
        .map(|(name, clsid)| {
            let ico = crate::icons::icon_file(clsid, 256)
                .map(|p| crate::icons::asset_url(&p))
                .unwrap_or_else(|| "./resources/file_icos/dir.png".to_string());
            json!({
                "sysApp": true,
                "file": "explorer.exe",
                "filePath": name,
                "fileName": name,
                "ico": ico,
                "fileType": ".exe",
            })
        })
        .collect()
}

/// 扫描目录，返回 (exe, dir, file) 三组
pub fn scan(dir_keys: &[PathBuf], show_hidden: bool) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let mut exes = Vec::new();
    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for dir in dir_keys {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if name == "desktop.ini" {
                continue;
            }
            if !show_hidden && win32::is_hidden(&p) {
                continue;
            }
            let is_dir = p.is_dir();
            let (kind, item) = build_item(&p, is_dir);
            match kind {
                "exe" => exes.push(item),
                "dir" => dirs.push(item),
                _ => files.push(item),
            }
        }
    }
    (exes, dirs, files)
}

/// 复制文件/文件夹到目标目录，重名时加 " - 副本" 后缀，返回新路径
pub fn copy_into(src: &str, target_dir: &Path) -> Option<String> {
    let sp = Path::new(src);
    let name = sp.file_name()?.to_string_lossy().to_string();
    let (stem, ext) = match sp.extension() {
        Some(e) => (
            name.trim_end_matches(&format!(".{}", e.to_string_lossy())).to_string(),
            format!(".{}", e.to_string_lossy()),
        ),
        None => (name.clone(), String::new()),
    };
    let mut target = target_dir.join(&name);
    let mut i = 1;
    while target.exists() {
        let suffix = if i == 1 {
            " - 副本".to_string()
        } else {
            format!(" - 副本{}", i)
        };
        target = target_dir.join(format!("{}{}{}", stem, suffix, ext));
        i += 1;
        if i > 999 {
            break;
        }
    }
    let ok = if sp.is_dir() {
        copy_dir_recursive(sp, &target).is_ok()
    } else {
        fs::copy(sp, &target).is_ok()
    };
    if ok {
        Some(target.to_string_lossy().to_string())
    } else {
        None
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)?.flatten() {
        let p = e.path();
        let t = dst.join(e.file_name());
        if p.is_dir() {
            copy_dir_recursive(&p, &t)?;
        } else {
            fs::copy(&p, &t)?;
        }
    }
    Ok(())
}

/// 应用自定义排序 + 标星置顶 + 编号，返回最终列表
///
/// extra 为注入的伪条目（应用组）；前端保存顺序时会把整个条目对象传回来，
/// 因此解析 dir_order 时兼容「字符串」与「{filePath}」两种写法。
pub fn order_items(
    dir_key: &str,
    exes: Vec<Value>,
    dirs: Vec<Value>,
    files: Vec<Value>,
    extra: Vec<Value>,
) -> Vec<Value> {
    // 旧版 res_load.py 的 order_items 是「o_data = group_data + exe_data + dir_data + file_data」，
    // 即组伪条目排在最前；随后 merge_lists 把新增项按它在 o_data 里的下标插回，
    // 所以新建的组会落在列表最前面（一眼能看到）。之前我把 extra 放在最后，
    // 新组就被插到列表中段（第一屏之外），表现为"建了组但看不到"。
    let mut all: Vec<Value> = Vec::new();
    all.extend(extra);
    all.extend(exes);
    all.extend(dirs);
    all.extend(files);

    // 自定义排序（dir_order）
    let cfg = config::get();
    let saved: Vec<String> = cfg
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

    let mut result: Vec<Value> = Vec::new();
    if !saved.is_empty() {
        let natural_len = all.len().max(1);
        // 先按保存顺序取已存在的
        for sp in &saved {
            if let Some(pos) = all.iter().position(|x| x.get("filePath").and_then(|v| v.as_str()) == Some(sp)) {
                result.push(all.remove(pos));
            }
        }
        // 新增项插回：旧版 merge_lists 的 new_items 用的是「项在全新列表 a 里的下标 i」，
        // 插入位置 = int((i/len(a)) * len(a)) = i，即按它在 all 里的下标插回。
        // 组伪条目在 all 最前 → 新组落在列表最前；新增的桌面文件也不会跑到首位。
        let remain = all;
        for (i, item) in remain.into_iter().enumerate() {
            let pos = i.min(result.len());
            result.insert(pos, item);
        }
        let _ = natural_len;
    } else {
        result = all;
    }

    // 标星置顶
    let cl = config::read_cl();
    let is_star = |v: &Value| -> bool {
        v.get("filePath")
            .and_then(|x| x.as_str())
            .and_then(|p| cl.get(p))
            .and_then(|b| b.as_bool())
            .unwrap_or(false)
    };
    let mut starred: Vec<Value> = Vec::new();
    let mut normal: Vec<Value> = Vec::new();
    for item in result {
        if is_star(&item) {
            starred.push(item);
        } else {
            normal.push(item);
        }
    }
    starred.extend(normal);

    // 编号 + cl 字段
    for (i, item) in starred.iter_mut().enumerate() {
        if let Some(o) = item.as_object_mut() {
            o.insert("index".into(), json!(i));
            let star = is_star(&Value::Object(o.clone()));
            o.insert("cl".into(), json!(star));
            o.insert("f_type".into(), json!("exe"));
        }
    }
    starred
}
