//! 图片缩略图预览
//!
//! 对应旧版 res_load.imagePreview_main.get_imageBase64：
//! 把图片压成 JPEG、限制体积，再转 base64 data URL 交给前端。
//! 结果在内存里缓存，避免重复解码（前端也有自己的缓存）。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use base64::Engine;

static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn get_image_base64(path: &str) -> Option<String> {
    if let Ok(g) = cache().lock() {
        if let Some(v) = g.get(path) {
            return v.clone();
        }
    }
    let result = encode(path);
    if let Ok(mut g) = cache().lock() {
        if g.len() > 500 {
            g.clear();
        }
        g.insert(path.to_string(), result.clone());
    }
    result
}

fn encode(path: &str) -> Option<String> {
    const MAX_KB: usize = 200;

    let img = image::open(path).ok()?;

    // 逐步降质，直到体积达标；仍超标则整体缩小
    let mut quality: u8 = 85;
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        {
            let mut cursor = std::io::Cursor::new(&mut buf);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
            img.write_with_encoder(encoder).ok()?;
        }
        if buf.len() / 1024 <= MAX_KB || quality <= 10 {
            break;
        }
        quality = quality.saturating_sub(5);
    }

    if buf.len() / 1024 > MAX_KB {
        let (w, h) = (img.width(), img.height());
        let scale = ((MAX_KB * 1024) as f64 / buf.len() as f64).sqrt().min(1.0);
        let nw = ((w as f64 * scale) as u32).max(1);
        let nh = ((h as f64 * scale) as u32).max(1);
        let small = img.resize(nw, nh, image::imageops::FilterType::Lanczos3);
        buf.clear();
        {
            let mut cursor = std::io::Cursor::new(&mut buf);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 80);
            small.write_with_encoder(encoder).ok()?;
        }
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Some(format!("data:image/jpeg;base64,{}", b64))
}

pub fn clear_cache() {
    if let Ok(mut g) = cache().lock() {
        g.clear();
    }
}
