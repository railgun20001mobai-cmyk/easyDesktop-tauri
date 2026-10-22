//! 分类与搜索索引。

use serde_json::{json, Value};

use super::s;

const METHODS: &[&str] = &[
    "read_class",
    "add_class",
    "remove_class",
    "save_classOrder",
    "change_cl_state",
    "load_search_index",
];

pub(super) fn handles(method: &str) -> bool {
    METHODS.contains(&method)
}

pub(super) fn dispatch(method: &str, args: &[Value], _app: &tauri::AppHandle) -> Value {
    match method {
        "read_class" => {
            let key = s(args, 0);
            let classes = crate::config::read_classes();
            let cfg = crate::config::get();
            let dir = if cfg.df_dir.is_empty() {
                "desktop".to_string()
            } else {
                cfg.df_dir.clone()
            };

            if key.is_empty() || key == "all" || key == "全部" {
                let mut order = cfg.class_order.clone();
                let map = classes.get(&dir).cloned().unwrap_or_else(|| json!({}));
                if order.is_empty() {
                    if let Some(o) = map.as_object() {
                        order = o.keys().cloned().collect();
                    }
                } else {
                    order.retain(|k| map.get(k).is_some());
                    // class_order 里没列到的分类（新建、或改名后出现的新名字）追加到末尾。
                    // 否则它们虽然存在于 user_class.json，却不会返回给前端 ——
                    // 表现就是"分类栏里那个分类直接消失了"（改名时踩过这个坑）。
                    if let Some(o) = map.as_object() {
                        for k in o.keys() {
                            if !order.iter().any(|x| x == k) {
                                order.push(k.clone());
                            }
                        }
                    }
                }
                let mut out = serde_json::Map::new();
                for k in order {
                    if let Some(v) = map.get(&k) {
                        out.insert(k, v.clone());
                    }
                }
                json!({ "success": true, "data": Value::Object(out) })
            } else {
                match classes.get(&dir).and_then(|d| d.get(&key)) {
                    Some(v) => json!({ "success": true, "files": v }),
                    None => json!({ "success": false, "files": [], "message": "没有找到该分类的文件" }),
                }
            }
        }

        "add_class" => {
            let files_v = args.get(0).cloned().unwrap_or(json!([]));
            let key = s(args, 1);
            let dir = {
                let df = crate::config::get().df_dir;
                if df.is_empty() { "desktop".to_string() } else { df }
            };
            let mut classes = crate::config::read_classes();
            if let Some(obj) = classes.as_object_mut() {
                let d = obj.entry(dir).or_insert_with(|| json!({}));
                if let Some(dm) = d.as_object_mut() {
                    dm.insert(key.clone(), files_v);
                }
            }
            crate::config::write_classes(&classes);
            // 新分类（含改名后产生的新名字）要进 class_order，否则会被 read_class 过滤掉
            let mut order = crate::config::get().class_order;
            if !order.is_empty() && !order.iter().any(|x| x == &key) {
                order.push(key.clone());
                crate::config::update("class_order", json!(order));
            }
            json!({ "success": true })
        }

        "remove_class" => {
            let key = s(args, 0);
            let dir = {
                let df = crate::config::get().df_dir;
                if df.is_empty() { "desktop".to_string() } else { df }
            };
            let mut classes = crate::config::read_classes();
            if let Some(obj) = classes.as_object_mut() {
                if let Some(d) = obj.get_mut(&dir).and_then(|v| v.as_object_mut()) {
                    d.remove(&key);
                }
            }
            crate::config::write_classes(&classes);
            // 同步摘掉 class_order 里的旧名字（改名 = remove_class + add_class，
            // 不清理的话这里会积累一堆指向已不存在分类的幽灵项）
            let mut order = crate::config::get().class_order;
            let before = order.len();
            order.retain(|x| x != &key);
            if order.len() != before {
                crate::config::update("class_order", json!(order));
            }
            json!({ "success": true })
        }

        "save_classOrder" => {
            crate::config::update("class_order", args.get(0).cloned().unwrap_or(json!([])));
            Value::Null
        }

        "change_cl_state" => {
            let path = s(args, 0);
            let state = args.get(1).and_then(|v| v.as_bool()).unwrap_or(false);
            let mut cl = crate::config::read_cl();
            if let Some(o) = cl.as_object_mut() {
                o.insert(path, json!(!state));
            }
            crate::config::write_cl(&cl);
            Value::Null
        }

        "load_search_index" => {
            let mut out = serde_json::Map::new();
            if let Some(arr) = args.get(0).and_then(|v| v.as_array()) {
                for f in arr {
                    if let Some(name) = f.get("fileName").and_then(|v| v.as_str()) {
                        let (py, sxpy) = build_pinyin(name);
                        out.insert(name.to_string(), json!({ "sxpy": sxpy, "py": py }));
                    }
                }
            }
            Value::Object(out)
        }
        _ => Value::Null,
    }
}

/// 生成「全拼」与「首字母」两种检索串（替代旧版的 pypinyin）
fn build_pinyin(name: &str) -> (String, String) {
    use pinyin::ToPinyin;
    let mut py = String::with_capacity(name.len() * 3);
    let mut sx = String::with_capacity(name.len());
    for ch in name.chars() {
        match ch.to_pinyin() {
            Some(p) => {
                py.push_str(p.plain());
                sx.push_str(p.first_letter());
            }
            None => {
                // 非汉字：字母数字保留，其余丢弃（与 JS 端忽略标点一致）
                for lc in ch.to_lowercase() {
                    if lc.is_alphanumeric() {
                        py.push(lc);
                        sx.push(lc);
                    }
                }
            }
        }
    }
    (py, sx)
}

#[cfg(test)]
mod tests {
    use super::build_pinyin;

    #[test]
    fn pinyin_full_and_initials() {
        assert_eq!(
            build_pinyin("微信"),
            ("weixin".to_string(), "wx".to_string())
        );
    }

    #[test]
    fn pinyin_mixed_text_and_digits() {
        assert_eq!(
            build_pinyin("PDF阅读"),
            ("pdfyuedu".to_string(), "pdfyd".to_string())
        );
    }

    #[test]
    fn pinyin_drops_punctuation() {
        assert_eq!(
            build_pinyin("A-1_文档"),
            ("a1wendang".to_string(), "a1wd".to_string())
        );
    }
}
