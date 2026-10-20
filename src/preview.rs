//! 图片缩略图预览
//!
//! 对应旧版 res_load.imagePreview_main.get_imageBase64：
//! 先缩到面板实际需要的尺寸，再压成 JPEG、限制体积，最后转 base64 data URL。
//! 结果在内存里按字节数做 LRU 缓存，避免重复解码又不让缓存无限长。

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

use base64::Engine;

/// 预览图最长边。网格显示 64px，200% DPI 下 128 物理像素足够，192 留一点余量。
const MAX_DIM: u32 = 192;
/// 单张预览的字节上限，避免极端图片把一条缓存撑爆。
const MAX_KB: usize = 80;
/// 整个 Rust 侧缓存的上限；前后端各一份，避免两边的常驻内存叠加。
const CACHE_MAX_BYTES: usize = 16 * 1024 * 1024;
const CACHE_MAX_ENTRIES: usize = 400;

struct PreviewCache {
    map: HashMap<String, Option<String>>,
    order: VecDeque<String>,
    bytes: usize,
}

impl PreviewCache {
    fn new() -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
        }
    }

    fn get(&mut self, key: &str) -> Option<Option<String>> {
        let value = self.map.get(key)?.clone();
        self.order.retain(|k| k != key);
        self.order.push_back(key.to_string());
        Some(value)
    }

    fn insert(&mut self, key: String, value: Option<String>) {
        if let Some(old) = self.map.remove(&key) {
            self.bytes = self
                .bytes
                .saturating_sub(old.as_ref().map(|s| s.len()).unwrap_or(0));
            self.order.retain(|k| k != &key);
        }
        self.bytes += value.as_ref().map(|s| s.len()).unwrap_or(0);
        self.map.insert(key.clone(), value);
        self.order.push_back(key);

        while (self.bytes > CACHE_MAX_BYTES || self.map.len() > CACHE_MAX_ENTRIES)
            && self.order.len() > 1
        {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(old) = self.map.remove(&oldest) {
                self.bytes = self
                    .bytes
                    .saturating_sub(old.as_ref().map(|s| s.len()).unwrap_or(0));
            }
        }
    }

    fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
        self.bytes = 0;
    }
}

static CACHE: OnceLock<Mutex<PreviewCache>> = OnceLock::new();

fn cache() -> &'static Mutex<PreviewCache> {
    CACHE.get_or_init(|| Mutex::new(PreviewCache::new()))
}

pub fn get_image_base64(path: &str) -> Option<String> {
    if let Ok(mut g) = cache().lock() {
        if let Some(v) = g.get(path) {
            return v;
        }
    }
    let result = encode(path);
    if let Ok(mut g) = cache().lock() {
        g.insert(path.to_string(), result.clone());
    }
    result
}

fn encode(path: &str) -> Option<String> {
    let img = image::open(path).ok()?;

    // 先缩尺寸：预览只显示到 64px，原图分辨率再高也不会更清楚，
    // 却会让 JPEG 解码后的常驻像素成倍增加。
    let img = if img.width() > MAX_DIM || img.height() > MAX_DIM {
        img.thumbnail(MAX_DIM, MAX_DIM)
    } else {
        img
    };

    // 尺寸已受控，先用较高质量编码；仍超标再逐级降质。
    let mut quality: u8 = 82;
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        {
            let mut cursor = std::io::Cursor::new(&mut buf);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
            img.write_with_encoder(encoder).ok()?;
        }
        if buf.len() / 1024 <= MAX_KB || quality <= 40 {
            break;
        }
        quality = quality.saturating_sub(8);
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
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, 72);
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
