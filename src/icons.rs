//! 图标提取与缓存
//!
//! 旧版是 spawn 一个 exeIconGet.exe 子进程逐个提取，进程创建开销大且会闪黑窗。
//! 这里改用 IShellItemImageFactory 在进程内直接取图标，转 PNG 落盘缓存。

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use windows::core::PCWSTR;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_ICONONLY,
};

/// 图标缓存目录：exe 同目录下的 desktopICO
pub fn cache_dir() -> PathBuf {
    let d = crate::config::exe_dir().join("desktopICO");
    if !d.exists() {
        let _ = fs::create_dir_all(&d);
    }
    d
}

fn to_wide(s: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

fn path_hash(p: &str) -> String {
    let mut h = DefaultHasher::new();
    p.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// 把 HBITMAP 转成 RGBA 像素
fn hbitmap_to_rgba(hbm: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut bm = BITMAP::default();
        if GetObjectW(
            HGDIOBJ(hbm.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut std::ffi::c_void),
        ) == 0
        {
            return None;
        }
        let w = bm.bmWidth;
        let h = bm.bmHeight;
        if w <= 0 || h <= 0 || w > 1024 || h > 1024 {
            return None;
        }

        let mut bi = BITMAPINFO::default();
        bi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // 负数 = 自上而下
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };

        let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
        let hdc = GetDC(None);
        let ok = GetDIBits(
            hdc,
            hbm,
            0,
            h as u32,
            Some(buf.as_mut_ptr() as *mut std::ffi::c_void),
            &mut bi,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, hdc);
        if ok == 0 {
            return None;
        }
        // BGRA -> RGBA
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        Some((w as u32, h as u32, buf))
    }
}

/// 包围盒是否"已经基本铺满"（>=88%），铺满就不用裁
fn nearly_full(bbox: (u32, u32, u32, u32), w: u32, h: u32) -> bool {
    let bw = bbox.2 - bbox.0 + 1;
    let bh = bbox.3 - bbox.1 + 1;
    bw * 100 >= w * 88 && bh * 100 >= h * 88
}

/// 按透明通道找内容包围盒（未铺满时返回）
///
/// 只在内缩一圈的范围里找：图标最外圈常有一根细边框线，
/// 不排掉的话包围盒永远是满幅，裁切就失效了。
fn alpha_bbox(img: &image::RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (w, h) = img.dimensions();
    let pad = (w.min(h) / 40).max(2);
    if w <= pad * 2 || h <= pad * 2 {
        return None;
    }
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    let mut found = false;
    for (x, y, p) in img.enumerate_pixels() {
        if x < pad || y < pad || x + pad >= w || y + pad >= h {
            continue;
        }
        if p[3] > 8 {
            found = true;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    if !found {
        return None;
    }
    let bbox = (x0, y0, x1, y1);
    if nearly_full(bbox, w, h) {
        None
    } else {
        Some(bbox)
    }
}

/// 处理"不透明白/灰底 + 细边框 + 中间小图案"的图标（AULA、AJAZZ 这类驱动软件常见）
///
/// 底色取外框区域出现最多的颜色，然后把与底色明显不同的区域当作图案裁出来。
fn opaque_pad_bbox(img: &image::RgbaImage) -> Option<(u32, u32, u32, u32)> {
    use std::collections::HashMap;
    let (w, h) = img.dimensions();
    if w < 16 || h < 16 {
        return None;
    }
    let inset = (w.min(h) / 8).max(2);
    let mut buckets: HashMap<(u8, u8, u8), (u64, u64, u64, u64, u64)> = HashMap::new();
    let mut add = |p: &image::Rgba<u8>| {
        // 量化到 16 级，避免颜色抖动把票数分散
        let key = (p[0] >> 4, p[1] >> 4, p[2] >> 4);
        let e = buckets.entry(key).or_insert((0, 0, 0, 0, 0));
        e.0 += p[0] as u64;
        e.1 += p[1] as u64;
        e.2 += p[2] as u64;
        e.3 += p[3] as u64;
        e.4 += 1;
    };
    for x in 0..w {
        for y in 0..h {
            if x < inset || x + inset >= w || y < inset || y + inset >= h {
                add(img.get_pixel(x, y));
            }
        }
    }
    let (sr, sg, sb, sa, n) = buckets.into_values().max_by_key(|v| v.4)?;
    if n == 0 {
        return None;
    }
    let bg = [
        (sr / n) as i32,
        (sg / n) as i32,
        (sb / n) as i32,
        (sa / n) as i32,
    ];
    // 底色必须基本不透明且偏亮，否则可能本来就是满幅彩色图案，别乱裁
    if bg[3] < 200 || (bg[0] + bg[1] + bg[2]) < 3 * 170 {
        return None;
    }
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    let mut found = false;
    let pad = (w.min(h) / 40).max(2);
    for (x, y, p) in img.enumerate_pixels() {
        // 同样跳过最外圈的细边框，否则包围盒永远满幅
        if x < pad || y < pad || x + pad >= w || y + pad >= h {
            continue;
        }
        let d = (p[0] as i32 - bg[0])
            .abs()
            .max((p[1] as i32 - bg[1]).abs())
            .max((p[2] as i32 - bg[2]).abs())
            .max((p[3] as i32 - bg[3]).abs());
        if d > 40 {
            found = true;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    if !found {
        return None;
    }
    let bbox = (x0, y0, x1, y1);
    if nearly_full(bbox, w, h) {
        None
    } else {
        Some(bbox)
    }
}

/// 裁到图案包围盒再等比放大回画布（小图标居中留大片空白的问题就出在这）
fn trim_and_fit(img: image::RgbaImage) -> image::RgbaImage {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return img;
    }
    let Some((x0, y0, x1, y1)) = alpha_bbox(&img).or_else(|| opaque_pad_bbox(&img)) else {
        return img;
    };
    let bw = x1 - x0 + 1;
    let bh = y1 - y0 + 1;
    let cropped = image::imageops::crop_imm(&img, x0, y0, bw, bh).to_image();
    // 等比放大到画布的 88%
    let target = (w.min(h) as f32 * 0.88).max(1.0);
    let scale = target / bw.max(bh) as f32;
    let nw = ((bw as f32 * scale).round() as u32).clamp(1, w);
    let nh = ((bh as f32 * scale).round() as u32).clamp(1, h);
    let resized = image::imageops::resize(&cropped, nw, nh, image::imageops::FilterType::Lanczos3);
    let mut canvas = image::RgbaImage::new(w, h);
    let ox = ((w - nw) / 2) as i64;
    let oy = ((h - nh) / 2) as i64;
    image::imageops::overlay(&mut canvas, &resized, ox, oy);
    canvas
}

/// 提取指定文件的图标，返回 PNG 的字节
pub fn extract_png(path: &str, size: i32) -> Option<Vec<u8>> {
    unsafe {
        let wide = to_wide(path);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;
        let hbm = factory
            .GetImage(
                SIZE {
                    cx: size,
                    cy: size,
                },
                SIIGBF_ICONONLY,
            )
            .ok()?;

        let rgba = hbitmap_to_rgba(hbm);
        let _ = DeleteObject(HGDIOBJ(hbm.0));
        let (w, h, data) = rgba?;

        let img = trim_and_fit(image::RgbaImage::from_raw(w, h, data)?);
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .ok()?;
        Some(out.into_inner())
    }
}

/// 判断图标是否被系统合成到了不透明白底上
///
/// 256px 下有些程序没有大尺寸图标资源，Shell 会把小图标放大并垫白底，
/// 在浅色面板上会看到难看的白方块 —— 这种情况要用小尺寸重新取一次。
fn has_opaque_white_bg(img: &image::RgbaImage) -> bool {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return false;
    }
    let pts = [
        (0, 0),
        (w - 1, 0),
        (0, h - 1),
        (w - 1, h - 1),
        (w / 2, 0),
        (w / 2, h - 1),
    ];
    let mut white = 0;
    for (x, y) in pts {
        let p = img.get_pixel(x, y);
        if p[0] >= 245 && p[1] >= 245 && p[2] >= 245 && p[3] >= 245 {
            white += 1;
        }
    }
    white >= 4
}

/// 取最佳图标：优先 256px（清晰），若被垫了白底则退回 64px
pub fn extract_png_best(path: &str) -> Option<Vec<u8>> {
    for size in [256i32, 64] {
        if let Some(png) = extract_png(path, size) {
            let white_bg = image::load_from_memory(&png)
                .map(|d| has_opaque_white_bg(&d.to_rgba8()))
                .unwrap_or(false);
            if !white_bg || size == 64 {
                return Some(png);
            }
        }
    }
    None
}

/// 取得（必要时生成）图标缓存文件，返回绝对路径
pub fn icon_file(src_path: &str, _size: i32) -> Option<PathBuf> {
    let dir = cache_dir();
    // 缓存键带上策略版本号，策略调整后旧缓存自动失效
    let out = dir.join(format!("{}.png", path_hash(&format!("{}@best4", src_path))));

    // 源文件比缓存新则重新提取
    let need = match (fs::metadata(&out), fs::metadata(src_path)) {
        (Ok(o), Ok(s)) => match (o.modified(), s.modified()) {
            (Ok(ot), Ok(st)) => st > ot,
            _ => false,
        },
        (Ok(_), Err(_)) => false, // 源文件取不到元数据（权限等），沿用已有缓存
        (Err(_), _) => true,      // 没有缓存，必须生成
    };
    if !need {
        return Some(out);
    }

    let png = extract_png_best(src_path)?;
    fs::write(&out, png).ok()?;
    Some(out)
}

/// 转成 WebView 可访问的 asset URL（Tauri asset 协议）
pub fn asset_url(path: &Path) -> String {
    let p = path.to_string_lossy().replace('\\', "/");
    let mut enc = String::with_capacity(p.len() + 8);
    for b in p.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b':' | b'-' | b'_' | b'.' | b'~' => {
                enc.push(b as char)
            }
            _ => enc.push_str(&format!("%{:02X}", b)),
        }
    }
    format!("http://asset.localhost/{}", enc)
}

/// 导入自定义图标：缩放成 256px 内的 PNG 存到 custom_ico 目录，返回 asset URL
pub fn import_custom_icon(src: &str) -> Option<String> {
    let img = image::open(src).ok()?;
    let img = img.resize(256, 256, image::imageops::FilterType::Lanczos3);
    let dir = crate::config::exe_dir().join("custom_ico");
    fs::create_dir_all(&dir).ok()?;
    let out = dir.join(format!("{}.png", path_hash(&format!("ico:{}", src))));
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).ok()?;
    fs::write(&out, buf.into_inner()).ok()?;
    Some(asset_url(&out))
}

/// 清空图标缓存
pub fn clear_cache() {
    let dir = cache_dir();
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            let _ = fs::remove_file(e.path());
        }
    }
}
