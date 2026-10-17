//! Image storage helpers.
//!
//! Storage layout parity (recorded for ticket 04):
//! - Files live under `<data_dir>/images/notes/<note_id>/`
//!   (`IMAGES_DIR = DATA_DIR/images`, note subdir per note).
//! - One file per slot, named `<type>-<variant>.<ext>`
//!   (e.g. `front-full.jpg`); the extension follows the upload MIME type
//!   (png/webp/gif/jpeg, else the original filename's extension, else `.jpg`).
//! - Served at `/api/images/notes/<note_id>/<type>-<variant>.<ext>`.
//! - Slots: `front`/`back` × `full`/`thumbnail` (4 total).
//! - Thumbnails: max width 500 px, never enlarged (`withoutEnlargement`),
//!   aspect preserved. Origins: `scraped`/`uploaded`/`generated` with the
//!   same `/api/images/scraped/` + `/api/images/notes/` inference fallback.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const THUMBNAIL_MAX_WIDTH: u32 = 500;

pub const IMAGE_TYPES: &[&str] = &["front", "back"];
pub const IMAGE_VARIANTS: &[&str] = &["full", "thumbnail"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageSlot {
    pub field: &'static str,
    pub image_type: &'static str,
    pub variant: &'static str,
}

pub const IMAGE_SLOTS: &[ImageSlot] = &[
    ImageSlot { field: "image_front_full", image_type: "front", variant: "full" },
    ImageSlot { field: "image_front_thumbnail", image_type: "front", variant: "thumbnail" },
    ImageSlot { field: "image_back_full", image_type: "back", variant: "full" },
    ImageSlot { field: "image_back_thumbnail", image_type: "back", variant: "thumbnail" },
];

pub const IMAGE_API_PREFIX: &str = "/api/images/";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImageRecord {
    #[serde(rename = "type")]
    pub image_type: String,
    pub variant: String,
    #[serde(rename = "localPath")]
    pub local_path: String,
    #[serde(rename = "sourceUrl")]
    pub source_url: Option<String>,
    pub origin: String,
}

pub fn image_slot_key(image_type: &str, variant: &str) -> String {
    format!("{image_type}:{variant}")
}

pub fn field_name_for_slot(image_type: &str, variant: &str) -> String {
    format!("image_{image_type}_{variant}")
}

pub fn delete_flag_field_name(image_type: &str, variant: &str) -> String {
    format!("delete_image_{image_type}_{variant}")
}

pub fn generate_flag_field_name(image_type: &str) -> String {
    format!("generate_image_{image_type}_thumbnail_from_full")
}

/// Parses boolean flags (same truthy set as the server env parser).
pub fn parse_boolean_flag(value: Option<&str>) -> bool {
    matches!(
        value.unwrap_or("").trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub fn get_extension_for_mime_type(mime_type: &str, original_name: &str) -> String {
    match mime_type {
        "image/png" => ".png".to_owned(),
        "image/webp" => ".webp".to_owned(),
        "image/gif" => ".gif".to_owned(),
        "image/jpeg" => ".jpg".to_owned(),
        _ => {
            let ext = Path::new(original_name)
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| format!(".{ext}"))
                .unwrap_or_default();
            if ext.is_empty() { ".jpg".to_owned() } else { ext.to_lowercase() }
        }
    }
}

pub fn get_note_images_dir(images_dir: &Path, note_id: i64) -> PathBuf {
    images_dir.join("notes").join(note_id.to_string())
}

pub fn get_slot_basename(image_type: &str, variant: &str) -> String {
    format!("{image_type}-{variant}")
}

pub fn build_local_path(note_id: i64, image_type: &str, variant: &str, extension: &str) -> String {
    format!(
        "/api/images/notes/{note_id}/{}{extension}",
        get_slot_basename(image_type, variant)
    )
}

/// Maps a `/api/images/...` URL back to a file under `images_dir`.
/// Returns `None` for non-managed paths (external URLs, other prefixes).
pub fn resolve_local_path(images_dir: &Path, local_path: &str) -> Option<PathBuf> {
    if !local_path.starts_with(IMAGE_API_PREFIX) {
        return None;
    }
    let relative = &local_path[IMAGE_API_PREFIX.len()..];
    if relative.is_empty() {
        return None;
    }
    let mut candidate = images_dir.to_path_buf();
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return None;
        }
        candidate.push(segment);
    }
    Some(candidate)
}

fn normalize_image_origin(origin: Option<&str>, local_path: &str) -> String {
    let normalized = origin.unwrap_or("").trim().to_lowercase();
    if matches!(normalized.as_str(), "scraped" | "uploaded" | "generated") {
        return normalized;
    }
    if local_path.starts_with("/api/images/scraped/") {
        return "scraped".to_owned();
    }
    if local_path.starts_with("/api/images/notes/") {
        return "uploaded".to_owned();
    }
    "uploaded".to_owned()
}

pub fn normalize_image_record(image: &Value) -> Option<ImageRecord> {
    let obj = image.as_object()?;
    let image_type = obj.get("type")?.as_str()?;
    let variant = obj.get("variant")?.as_str()?;
    let local_path = obj.get("localPath")?.as_str()?;
    if image_type.is_empty() || variant.is_empty() || local_path.is_empty() {
        return None;
    }
    if !IMAGE_TYPES.contains(&image_type) || !IMAGE_VARIANTS.contains(&variant) {
        return None;
    }
    let source_url = obj
        .get("sourceUrl")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let origin = normalize_image_origin(
        obj.get("origin").and_then(Value::as_str),
        local_path,
    );
    Some(ImageRecord {
        image_type: image_type.to_owned(),
        variant: variant.to_owned(),
        local_path: local_path.to_owned(),
        source_url,
        origin,
    })
}

/// Normalizes a stored `images` array: drops malformed records, dedups by
/// slot (later entries win), and returns the survivors in canonical slot
/// order (`front:full`, `front:thumbnail`, `back:full`, `back:thumbnail`).
pub fn normalize_images(images: &Value) -> Vec<ImageRecord> {
    let list = images.as_array().cloned().unwrap_or_default();
    let mut by_slot: HashMap<String, ImageRecord> = HashMap::new();
    for image in &list {
        if let Some(normalized) = normalize_image_record(image) {
            by_slot.insert(
                image_slot_key(&normalized.image_type, &normalized.variant),
                normalized,
            );
        }
    }
    IMAGE_SLOTS
        .iter()
        .filter_map(|slot| by_slot.remove(&image_slot_key(slot.image_type, slot.variant)))
        .collect()
}

pub fn image_map_from_list(images: &Value) -> HashMap<String, ImageRecord> {
    normalize_images(images)
        .into_iter()
        .map(|image| (image_slot_key(&image.image_type, &image.variant), image))
        .collect()
}

pub fn slot_record(
    note_id: i64,
    image_type: &str,
    variant: &str,
    extension: &str,
    origin: &str,
    source_url: Option<String>,
) -> ImageRecord {
    ImageRecord {
        image_type: image_type.to_owned(),
        variant: variant.to_owned(),
        local_path: build_local_path(note_id, image_type, variant, extension),
        source_url,
        origin: origin.to_owned(),
    }
}

pub fn list_slot_files(note_images_dir: &Path, image_type: &str, variant: &str) -> Vec<PathBuf> {
    let prefix = format!("{}.", get_slot_basename(image_type, variant));
    let Ok(entries) = std::fs::read_dir(note_images_dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&prefix))
        })
        .collect()
}

pub fn delete_slot_files(images_dir: &Path, note_id: i64, image_type: &str, variant: &str) {
    for path in list_slot_files(&get_note_images_dir(images_dir, note_id), image_type, variant) {
        let _ = std::fs::remove_file(&path);
    }
}

pub fn ensure_note_images_dir(images_dir: &Path, note_id: i64) -> std::io::Result<PathBuf> {
    let dir = get_note_images_dir(images_dir, note_id);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Writes one slot buffer, replacing any previous file for the slot
/// (including extension changes, e.g. `.jpg` → `.png`).
#[allow(clippy::too_many_arguments)]
pub fn write_slot_buffer(
    images_dir: &Path,
    note_id: i64,
    image_type: &str,
    variant: &str,
    buffer: &[u8],
    extension: &str,
    origin: &str,
    source_url: Option<String>,
) -> std::io::Result<ImageRecord> {
    let dir = ensure_note_images_dir(images_dir, note_id)?;
    let normalized = {
        let ext = extension.to_lowercase();
        if ext.starts_with('.') { ext } else { format!(".{ext}") }
    };
    delete_slot_files(images_dir, note_id, image_type, variant);
    let target = dir.join(format!("{}{normalized}", get_slot_basename(image_type, variant)));
    std::fs::write(&target, buffer)?;
    Ok(slot_record(note_id, image_type, variant, &normalized, origin, source_url))
}

/// Downscales `input` to a max width of 500 px, preserving aspect ratio and
/// never enlarging small images (sharp `withoutEnlargement` parity). The
/// output keeps the input encoding when it is JPEG/PNG/WebP, else JPEG.
pub fn generate_thumbnail_buffer(input: &[u8]) -> Result<Vec<u8>, String> {
    let format = image::guess_format(input).map_err(|error| error.to_string())?;
    let decoded = image::load_from_memory(input).map_err(|error| error.to_string())?;
    if decoded.width() <= THUMBNAIL_MAX_WIDTH {
        return Ok(input.to_vec());
    }
    let resized = decoded.thumbnail(THUMBNAIL_MAX_WIDTH, u32::MAX);
    let mut out = Vec::new();
    // The output keeps the input encoding (sharp `toBuffer()` parity);
    // anything else is encoded as JPEG quality 82.
    match format {
        image::ImageFormat::Png => {
            resized.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        }
        image::ImageFormat::Gif => {
            resized.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Gif)
        }
        image::ImageFormat::WebP => {
            resized.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::WebP)
        }
        _ => {
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                &mut out,
                82,
            );
            encoder.encode_image(&resized).map_err(|error| error.to_string())?;
            Ok(())
        }
    }
    .map_err(|error| error.to_string())?;
    Ok(out)
}

/// Quality used when re-encoding full-size note images to optimized JPEG
/// (visually lossless for banknote photos, metadata stripped).
pub const MIGRATE_FULL_JPEG_QUALITY: u8 = 85;
/// Quality used when re-encoding thumbnail note images.
pub const MIGRATE_THUMB_JPEG_QUALITY: u8 = 82;

/// Re-encodes `input` to an optimized JPEG at `quality`, stripping metadata
/// (no resolution change). GIF input returns `None` so callers can copy it
/// verbatim (re-encoding would flatten animation); undecodable input also
/// returns `None` so callers can fall back to a verbatim copy and never lose
/// data.
pub fn transcode_to_jpeg(input: &[u8], quality: u8) -> Option<Vec<u8>> {
    if image::guess_format(input).ok() == Some(image::ImageFormat::Gif) {
        return None;
    }
    let decoded = image::load_from_memory(input).ok()?;
    let rgb = flatten_to_rgb8(&decoded);
    let mut out = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
    encoder
        .encode_image(&image::DynamicImage::ImageRgb8(rgb))
        .ok()?;
    Some(out)
}

/// Flattens any input (including alpha) onto a white RGB8 canvas: banknote
/// photos are opaque, and JPEG has no alpha channel.
fn flatten_to_rgb8(image: &image::DynamicImage) -> image::RgbImage {
    let rgba = image.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    let mut out = image::RgbImage::from_pixel(width, height, image::Rgb([255, 255, 255]));
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = f32::from(pixel[3]) / 255.0;
        let blend = |foreground: u8| (f32::from(foreground) * alpha + 255.0 * (1.0 - alpha)) as u8;
        out.put_pixel(x, y, image::Rgb([blend(pixel[0]), blend(pixel[1]), blend(pixel[2])]));
    }
    out
}

/// Re-encodes `input` to lossy WebP at `quality` (0–100, clamped), stripping
/// metadata (no resolution change). GIF input returns `None` so callers can
/// copy it verbatim; undecodable input also returns `None` so callers can
/// fall back to a verbatim copy and never lose data.
pub fn transcode_to_webp(input: &[u8], quality: f32) -> Option<Vec<u8>> {
    if image::guess_format(input).ok() == Some(image::ImageFormat::Gif) {
        return None;
    }
    let decoded = image::load_from_memory(input).ok()?;
    let rgb = flatten_to_rgb8(&decoded);
    Some(
        webp::Encoder::from_rgb(&rgb.as_raw()[..], rgb.width(), rgb.height())
            .encode(quality.clamp(1.0, 100.0))
            .to_vec(),
    )
}

/// Maps a managed note-image `localPath` to its migrated file name: `.gif`
/// stays `.gif` (copied verbatim), every other extension becomes `.jpg`.
/// Non-managed paths (external URLs) pass through unchanged.
pub fn migrated_local_path(local_path: &str) -> String {
    migrated_local_path_with_extension(local_path, ".jpg")
}

/// Same as [`migrated_local_path`] with an explicit target extension
/// (`".jpg"` or `".webp"`).
pub fn migrated_local_path_with_extension(local_path: &str, extension: &str) -> String {
    if !local_path.starts_with(IMAGE_API_PREFIX) {
        return local_path.to_owned();
    }
    if local_path.to_lowercase().ends_with(".gif") {
        return local_path.to_owned();
    }
    match local_path.rfind('.') {
        Some(dot) => format!("{}{extension}", &local_path[..dot]),
        None => format!("{local_path}{extension}"),
    }
}

pub fn remove_file_if_managed(images_dir: &Path, local_path: Option<&str>) {
    let Some(path) = local_path.and_then(|local| resolve_local_path(images_dir, local)) else {
        return;
    };
    if path.is_file() {
        let _ = std::fs::remove_file(&path);
    }
}

/// Deletes note-image files no longer referenced by `images` and prunes the
/// note directory when it becomes empty.
pub fn remove_stale_managed_files(images_dir: &Path, note_id: i64, images: &Value) {
    let note_images_dir = get_note_images_dir(images_dir, note_id);
    if !note_images_dir.is_dir() {
        return;
    }
    let keep: std::collections::HashSet<PathBuf> = normalize_images(images)
        .iter()
        .filter_map(|image| resolve_local_path(images_dir, &image.local_path))
        .collect();
    let Ok(entries) = std::fs::read_dir(&note_images_dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() && !keep.contains(&path) {
            let _ = std::fs::remove_file(&path);
        }
    }
    if std::fs::read_dir(&note_images_dir).is_ok_and(|mut entries| entries.next().is_none()) {
        let _ = std::fs::remove_dir_all(&note_images_dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn full_and_thumbnail_slots_are_defined() {
        assert_eq!(IMAGE_VARIANTS, &["full", "thumbnail"]);
        let mut fields: Vec<_> = IMAGE_SLOTS.iter().map(|slot| slot.field).collect();
        fields.sort_unstable();
        assert_eq!(
            fields,
            vec![
                "image_back_full",
                "image_back_thumbnail",
                "image_front_full",
                "image_front_thumbnail"
            ]
        );
    }

    #[test]
    fn normalize_images_keeps_thumbnail_records_in_slot_order() {
        let normalized = normalize_images(&json!([
            { "type": "back", "variant": "thumbnail", "localPath": "/api/images/notes/1/back-thumbnail.jpg", "origin": "generated" },
            { "type": "front", "variant": "full", "localPath": "/api/images/notes/1/front-full.jpg", "origin": "scraped" },
            { "type": "front", "variant": "thumbnail", "localPath": "/api/images/notes/1/front-thumbnail.jpg", "origin": "scraped" },
            { "type": "back", "variant": "full", "localPath": "/api/images/notes/1/back-full.jpg", "origin": "uploaded" },
        ]));
        let keys: Vec<_> = normalized
            .iter()
            .map(|image| image_slot_key(&image.image_type, &image.variant))
            .collect();
        assert_eq!(keys, vec!["front:full", "front:thumbnail", "back:full", "back:thumbnail"]);
    }

    #[test]
    fn normalize_images_drops_malformed_records() {
        let normalized = normalize_images(&json!([
            { "type": "front", "variant": "full", "localPath": null },
            { "variant": "full", "localPath": "/api/images/notes/1/front-full.jpg" },
            { "type": "front", "variant": "preview", "localPath": "/api/images/notes/1/front-preview.jpg" },
        ]));
        assert!(normalized.is_empty());
    }

    #[test]
    fn normalize_images_later_slot_entries_win() {
        let normalized = normalize_images(&json!([
            { "type": "front", "variant": "full", "localPath": "/api/images/notes/1/front-full.jpg", "origin": "scraped" },
            { "type": "front", "variant": "full", "localPath": "/api/images/notes/1/front-full.jpg", "origin": "uploaded" },
        ]));
        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].origin, "uploaded");
    }

    #[test]
    fn extension_mapping_matches_node() {
        assert_eq!(get_extension_for_mime_type("image/png", "a.jpg"), ".png");
        assert_eq!(get_extension_for_mime_type("image/webp", "a.jpg"), ".webp");
        assert_eq!(get_extension_for_mime_type("image/gif", "a.jpg"), ".gif");
        assert_eq!(get_extension_for_mime_type("image/jpeg", "a.png"), ".jpg");
        assert_eq!(get_extension_for_mime_type("image/bmp", "photo.PNG"), ".png");
        assert_eq!(get_extension_for_mime_type("image/bmp", "photo"), ".jpg");
    }

    #[test]
    fn local_path_round_trips_through_resolver() {
        let images_dir = Path::new("/data/images");
        let local = build_local_path(7, "front", "full", ".jpg");
        assert_eq!(local, "/api/images/notes/7/front-full.jpg");
        assert_eq!(
            resolve_local_path(images_dir, &local),
            Some(PathBuf::from("/data/images/notes/7/front-full.jpg"))
        );
        assert_eq!(resolve_local_path(images_dir, "https://x/y.jpg"), None);
        assert_eq!(resolve_local_path(images_dir, "/api/images/notes/../evil"), None);
    }

    #[test]
    fn boolean_flags_share_the_server_truthy_set() {
        for truthy in ["1", "true", "yes", "on", " True "] {
            assert!(parse_boolean_flag(Some(truthy)), "{truthy}");
        }
        assert!(!parse_boolean_flag(None));
        assert!(!parse_boolean_flag(Some("0")));
    }

    #[test]
    fn thumbnail_generation_downscales_wide_images() {
        let wide = image::RgbImage::from_pixel(1200, 800, image::Rgb([200, 100, 50]));
        let mut input = Vec::new();
        image::DynamicImage::ImageRgb8(wide)
            .write_to(&mut std::io::Cursor::new(&mut input), image::ImageFormat::Jpeg)
            .expect("encode");
        let thumb = generate_thumbnail_buffer(&input).expect("thumbnail");
        let decoded = image::load_from_memory(&thumb).expect("decode thumbnail");
        assert!(decoded.width() <= THUMBNAIL_MAX_WIDTH);
        assert!(thumb.len() < input.len());
    }

    #[test]
    fn thumbnail_generation_leaves_small_images_alone() {
        let small = image::RgbImage::from_pixel(100, 80, image::Rgb([10, 20, 30]));
        let mut input = Vec::new();
        image::DynamicImage::ImageRgb8(small)
            .write_to(&mut std::io::Cursor::new(&mut input), image::ImageFormat::Jpeg)
            .expect("encode");
        let thumb = generate_thumbnail_buffer(&input).expect("thumbnail");
        assert_eq!(thumb, input);
    }

    #[test]
    fn transcode_to_jpeg_shrinks_a_high_quality_photo() {
        // Noisy pixels defeat DCT compression at high quality, so the q85
        // re-encode must come out smaller than the q100 source.
        let mut pixels = image::RgbImage::new(320, 240);
        let mut state: u64 = 0x9E3779B97F4A7C15;
        for pixel in pixels.pixels_mut() {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *pixel = image::Rgb([(state >> 56) as u8, (state >> 48) as u8, (state >> 40) as u8]);
        }
        let mut source = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut source, 100)
            .encode_image(&image::DynamicImage::ImageRgb8(pixels))
            .expect("source encodes");
        let transcoded = transcode_to_jpeg(&source, 85).expect("transcodes");
        assert!(
            transcoded.len() < source.len(),
            "{} vs {}",
            transcoded.len(),
            source.len()
        );
        let decoded = image::load_from_memory(&transcoded).expect("decodes");
        assert_eq!((decoded.width(), decoded.height()), (320, 240));
    }

    #[test]
    fn transcode_to_jpeg_passes_gif_through() {
        let frame = image::RgbaImage::from_pixel(16, 16, image::Rgba([1, 2, 3, 255]));
        let mut gif = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut gif);
            encoder
                .encode(&frame, 16, 16, image::ExtendedColorType::Rgba8)
                .expect("gif encodes");
        }
        assert_eq!(transcode_to_jpeg(&gif, 85), None);
        assert_eq!(transcode_to_jpeg(b"not an image", 85), None);
    }

    #[test]
    fn transcode_to_jpeg_flattens_alpha_onto_white() {
        let mut rgba = image::RgbaImage::from_pixel(64, 64, image::Rgba([200, 0, 0, 255]));
        for x in 0..16 {
            for y in 0..16 {
                rgba.put_pixel(x, y, image::Rgba([0, 0, 0, 0]));
            }
        }
        let mut source = Vec::new();
        image::DynamicImage::ImageRgba8(rgba)
            .write_to(&mut std::io::Cursor::new(&mut source), image::ImageFormat::Png)
            .expect("png encodes");
        let transcoded = transcode_to_jpeg(&source, 90).expect("transcodes");
        let decoded = image::load_from_memory(&transcoded).expect("decodes").to_rgb8();
        // Fully transparent pixel lands on white (JPEG lossy: allow rounding).
        for channel in decoded.get_pixel(0, 0).0 {
            assert!(channel > 240, "{channel}");
        }
        // Opaque red pixel survives approximately.
        let red = decoded.get_pixel(32, 32).0;
        assert!(red[0] > 150 && red[1] < 100 && red[2] < 100, "{red:?}");
    }

    #[test]
    fn migrated_local_path_only_rewrites_managed_non_gif_paths() {
        assert_eq!(
            migrated_local_path("/api/images/notes/7/front-full.png"),
            "/api/images/notes/7/front-full.jpg"
        );
        assert_eq!(
            migrated_local_path("/api/images/notes/7/front-full.JPG"),
            "/api/images/notes/7/front-full.jpg"
        );
        assert_eq!(
            migrated_local_path("/api/images/notes/7/front-full.gif"),
            "/api/images/notes/7/front-full.gif"
        );
        assert_eq!(
            migrated_local_path("https://example.com/a.png"),
            "https://example.com/a.png"
        );
        assert_eq!(
            migrated_local_path_with_extension("/api/images/notes/7/front-full.jpg", ".webp"),
            "/api/images/notes/7/front-full.webp"
        );
        assert_eq!(
            migrated_local_path_with_extension("/api/images/notes/7/x.gif", ".webp"),
            "/api/images/notes/7/x.gif"
        );
    }

    #[test]
    fn transcode_to_webp_round_trips_dimensions_and_skips_gif() {
        let mut pixels = image::RgbImage::new(160, 120);
        let mut state: u64 = 0x9E3779B97F4A7C15;
        for pixel in pixels.pixels_mut() {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            *pixel = image::Rgb([(state >> 56) as u8, (state >> 48) as u8, (state >> 40) as u8]);
        }
        let mut source = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut source, 95)
            .encode_image(&image::DynamicImage::ImageRgb8(pixels))
            .expect("source encodes");
        let transcoded = transcode_to_webp(&source, 80.0).expect("transcodes");
        assert!(!transcoded.is_empty());
        let roundtrip = webp::Decoder::new(&transcoded).decode().expect("webp decodes");
        assert_eq!((roundtrip.width(), roundtrip.height()), (160, 120));

        let frame = image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 2, 3, 255]));
        let mut gif = Vec::new();
        image::codecs::gif::GifEncoder::new(&mut gif)
            .encode(&frame, 8, 8, image::ExtendedColorType::Rgba8)
            .expect("gif encodes");
        assert_eq!(transcode_to_webp(&gif, 80.0), None);
    }
}
