//! 排序合并规则（纯函数）
//!
//! 与上游 `res_load.py::merge_lists` 保持一致：已保存的顺序优先，新增项按它在
//! 最新扫描结果里的原始下标插回，已消失的条目剔除。

use serde_json::Value;
use std::collections::HashSet;

/// 从配置里取某个目录已保存的顺序，兼容字符串与 `{filePath}` 两种写法
pub fn saved_paths(cfg: &Value, dir_key: &str) -> Vec<String> {
    cfg.get("dir_order")
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
        .unwrap_or_default()
}

/// 把保存顺序与最新扫描结果合并
///
/// - 仍存在的条目按保存顺序保留，重复项只留第一次；
/// - 新增条目按它在 `paths` 里的原始下标插入（与上游 `merge_lists` 的 `i` 一致）；
/// - 已消失的条目直接丢弃。
pub fn merge_order(saved: &[String], paths: &[String]) -> Vec<String> {
    let exist: HashSet<&str> = paths.iter().map(|s| s.as_str()).collect();
    let saved_set: HashSet<&str> = saved.iter().map(|s| s.as_str()).collect();

    let mut result: Vec<String> = Vec::with_capacity(paths.len());
    let mut seen: HashSet<&str> = HashSet::new();
    for p in saved {
        if exist.contains(p.as_str()) && seen.insert(p.as_str()) {
            result.push(p.clone());
        }
    }
    for (i, p) in paths.iter().enumerate() {
        if saved_set.contains(p.as_str()) {
            continue;
        }
        let pos = i.min(result.len());
        result.insert(pos, p.clone());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn list(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn empty_saved_keeps_natural_order() {
        let paths = list(&["a", "b", "c"]);
        assert_eq!(merge_order(&[], &paths), paths);
    }

    #[test]
    fn keeps_saved_order_and_drops_missing() {
        let saved = list(&["b", "gone", "a"]);
        let paths = list(&["a", "b", "c"]);
        assert_eq!(merge_order(&saved, &paths), list(&["b", "a", "c"]));
    }

    #[test]
    fn new_item_uses_original_index_not_remaining_index() {
        // 上游把新增项按它在完整新列表里的下标插回：
        // A 下标 0、C 下标 2，所以结果应是 A,B,C，而不是 A,C,B。
        let saved = list(&["b"]);
        let paths = list(&["a", "b", "c"]);
        assert_eq!(merge_order(&saved, &paths), list(&["a", "b", "c"]));
    }

    #[test]
    fn new_item_can_land_before_saved_head() {
        let saved = list(&["b"]);
        let paths = list(&["new", "b"]);
        assert_eq!(merge_order(&saved, &paths), list(&["new", "b"]));
    }

    #[test]
    fn duplicate_saved_entries_are_collapsed() {
        let saved = list(&["b", "b", "a"]);
        let paths = list(&["a", "b"]);
        assert_eq!(merge_order(&saved, &paths), list(&["b", "a"]));
    }

    #[test]
    fn all_saved_missing_falls_back_to_natural_order() {
        let saved = list(&["x"]);
        let paths = list(&["a", "b"]);
        assert_eq!(merge_order(&saved, &paths), list(&["a", "b"]));
    }

    #[test]
    fn saved_paths_accepts_strings_and_objects() {
        let cfg = json!({
            "dir_order": {
                "desktop": ["a", { "filePath": "b" }, 1, null]
            }
        });
        assert_eq!(saved_paths(&cfg, "desktop"), list(&["a", "b"]));
        assert!(saved_paths(&cfg, "missing").is_empty());
    }
}
