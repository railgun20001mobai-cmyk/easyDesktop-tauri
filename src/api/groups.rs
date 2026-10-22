//! 应用组管理。

use serde_json::{json, Value};

use super::s;

const METHODS: &[&str] = &[
    "get_groups",
    "get_group_contents",
    "create_group",
    "rename_group",
    "delete_group",
    "add_to_group",
    "remove_from_group",
    "edit_group_order",
    "save_group_order",
];

pub(super) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

pub(super) fn dispatch(method: &str, args: &[Value], _app: &tauri::AppHandle) -> Value {
    match method {
        "get_groups" => {
            let groups = crate::config::read_groups();
            let mut out = serde_json::Map::new();
            if let Some(map) = groups.as_object() {
                for (gid, g) in map {
                    let count = g
                        .get("files")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    out.insert(
                        gid.clone(),
                        json!({
                            "name": g.get("name").and_then(|v| v.as_str()).unwrap_or("应用组"),
                            "count": count,
                        }),
                    );
                }
            }
            json!({ "success": true, "data": Value::Object(out) })
        }

        "get_group_contents" => {
            let gid = s(args, 0);
            let groups = crate::config::read_groups();
            let files = groups
                .get(&gid)
                .and_then(|g| g.get("files"))
                .cloned()
                .unwrap_or_else(|| json!([]));
            json!({ "success": true, "data": files })
        }

        "create_group" => {
            let mut name = s(args, 0);
            if name.trim().is_empty() {
                name = "新建组".to_string();
            }
            let mut groups = crate::config::read_groups();
            // 重名时自动加尾缀：agent工具 → agent工具-1 → agent工具-2 …
            let existing: Vec<String> = groups
                .as_object()
                .map(|m| {
                    m.values()
                        .filter_map(|g| g.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if existing.iter().any(|n| n == &name) {
                let mut i = 1;
                while i <= 999 {
                    let cand = format!("{}-{}", name, i);
                    if !existing.iter().any(|n| n == &cand) {
                        name = cand;
                        break;
                    }
                    i += 1;
                }
            }
            let gid = new_group_id(&groups);
            if let Some(o) = groups.as_object_mut() {
                o.insert(gid.clone(), json!({ "name": name, "files": [] }));
            }
            crate::config::write_groups(&groups);
            // 前端会带上"当前所在分类"：在分类页里建的组要归到该分类下
            let class_name = s(args, 1);
            crate::config::add_file_to_class(&class_name, &format!("__group__:{}", gid), &name);
            json!({ "success": true, "groupId": gid })
        }

        "rename_group" => {
            let gid = s(args, 0);
            let name = s(args, 1);
            let mut groups = crate::config::read_groups();
            if let Some(g) = groups.get_mut(&gid).and_then(|g| g.as_object_mut()) {
                g.insert("name".into(), json!(name));
            }
            crate::config::write_groups(&groups);
            // 分类里存的是组的伪路径 + 当时的名字，改名后要同步，否则分类设置里还是旧名
            crate::config::rename_in_classes(&format!("__group__:{}", gid), &name);
            json!({ "success": true })
        }

        "delete_group" => {
            let gid = s(args, 0);
            let mut groups = crate::config::read_groups();
            if let Some(o) = groups.as_object_mut() {
                o.remove(&gid);
            }
            crate::config::write_groups(&groups);
            // 顺手把排序表里的引用清掉，避免残留 `__group__:xx`
            let group_path = format!("__group__:{}", gid);
            // 分类里指向这个组的条目也要摘掉（否则分类里留一个幽灵条目、分类设置里还勾着它）
            crate::config::remove_file_from_classes(&group_path);
            crate::config::remove_path_from_orders(&group_path);
            json!({ "success": true })
        }

        "add_to_group" => {
            let gid = s(args, 0);
            let paths: Vec<String> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let mut groups = crate::config::read_groups();
            let mut ok = false;
            if let Some(g) = groups.get_mut(&gid).and_then(|g| g.as_object_mut()) {
                let files = g.entry("files").or_insert_with(|| json!([]));
                if let Some(arr) = files.as_array_mut() {
                    for p in paths {
                        if arr
                            .iter()
                            .any(|f| f.get("filePath").and_then(|v| v.as_str()) == Some(p.as_str()))
                        {
                            continue;
                        }
                        arr.push(crate::files::item_for_path(&p));
                    }
                    ok = true;
                }
            }
            if ok {
                crate::config::write_groups(&groups);
            }
            json!({ "success": ok })
        }

        "remove_from_group" => {
            let gid = s(args, 0);
            let path = s(args, 1);
            let mut groups = crate::config::read_groups();
            if let Some(arr) = groups
                .get_mut(&gid)
                .and_then(|g| g.get_mut("files"))
                .and_then(|v| v.as_array_mut())
            {
                arr.retain(|f| f.get("filePath").and_then(|v| v.as_str()) != Some(path.as_str()));
            }
            crate::config::write_groups(&groups);
            json!({ "success": true })
        }

        "edit_group_order" => {
            let gid = s(args, 0);
            let paths: Vec<String> = args
                .get(1)
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let mut groups = crate::config::read_groups();
            if let Some(arr) = groups
                .get_mut(&gid)
                .and_then(|g| g.get_mut("files"))
                .and_then(|v| v.as_array_mut())
            {
                let mut old = std::mem::take(arr);
                let mut new: Vec<Value> = Vec::new();
                for p in &paths {
                    if let Some(pos) = old
                        .iter()
                        .position(|f| f.get("filePath").and_then(|v| v.as_str()) == Some(p.as_str()))
                    {
                        new.push(old.remove(pos));
                    }
                }
                // 未出现在顺序表里的（异常情况）保留在末尾
                new.extend(old);
                *arr = new;
            }
            crate::config::write_groups(&groups);
            json!({ "success": true })
        }

        "save_group_order" => {
            let order: Vec<String> = args
                .get(0)
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            if !order.is_empty() {
                let groups = crate::config::read_groups();
                if let Some(map) = groups.as_object() {
                    let mut new = serde_json::Map::new();
                    for gid in &order {
                        if let Some(v) = map.get(gid) {
                            new.insert(gid.clone(), v.clone());
                        }
                    }
                    for (k, v) in map {
                        if !new.contains_key(k) {
                            new.insert(k.clone(), v.clone());
                        }
                    }
                    crate::config::write_groups(&Value::Object(new));
                }
            }
            json!({ "success": true })
        }
        _ => Value::Null,
    }
}

/// 生成不冲突的组 id（毫秒时间戳 + 冲突后缀）
fn new_group_id(groups: &Value) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut gid = format!("g{}", now);
    let mut i = 0;
    while groups.get(&gid).is_some() {
        i += 1;
        gid = format!("g{}_{}", now, i);
    }
    gid
}
