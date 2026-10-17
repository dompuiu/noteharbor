//! Throwaway measurement: encodes a deterministic sample of real full-size
//! note images to WebP-lossy (q80/q85) and JPEG (q85) and compares against
//! the source bytes. Read-only; prints a table to stdout.
//!
//! ```text
//! sample-webp [--dir data] [--n 20]
//! ```

use std::path::{Path, PathBuf};

fn sample_files(images_dir: &Path, n: usize) -> Vec<PathBuf> {
    let mut fulls: Vec<PathBuf> = Vec::new();
    let mut stack = vec![images_dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else { continue };
        let mut entries: Vec<PathBuf> =
            entries.filter_map(Result::ok).map(|entry| entry.path()).collect();
        entries.sort();
        for entry in entries {
            if entry.is_dir() {
                stack.push(entry);
            } else if entry.is_file()
                && entry
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.ends_with("-full.jpg") || name.ends_with("-full.png")
                    })
            {
                fulls.push(entry);
            }
        }
    }
    fulls.sort();
    if fulls.len() <= n {
        return fulls;
    }
    let step = fulls.len() / n;
    fulls.into_iter().step_by(step).take(n).collect()
}

fn encode_webp(rgb: &image::RgbImage, quality: f32) -> Vec<u8> {
    webp::Encoder::from_rgb(&rgb.as_raw()[..], rgb.width(), rgb.height())
        .encode(quality)
        .to_vec()
}

fn encode_jpeg(rgb: &image::RgbImage, quality: u8) -> Vec<u8> {
    let mut out = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality);
    encoder
        .encode_image(&image::DynamicImage::ImageRgb8(rgb.clone()))
        .expect("jpeg encodes");
    out
}

fn main() {
    let mut dir = PathBuf::from("data");
    let mut n = 20usize;
    let mut rest = std::env::args().skip(1);
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--dir" => dir = PathBuf::from(rest.next().expect("--dir needs a value")),
            "--n" => n = rest.next().expect("--n needs a value").parse().expect("number"),
            _ => panic!("unknown argument {arg}"),
        }
    }
    let files = sample_files(&dir.join("images"), n);
    println!("sample: {} files", files.len());
    println!("{:>12} {:>12} {:>12} {:>12}  path", "src", "webp80", "webp85", "jpg85");
    let (mut src_total, mut w80_total, mut w85_total, mut j85_total) = (0u64, 0u64, 0u64, 0u64);
    for path in &files {
        let bytes = std::fs::read(path).expect("reads");
        let decoded = image::load_from_memory(&bytes).expect("decodes").to_rgb8();
        let (w80, w85, j85) = (
            encode_webp(&decoded, 80.0),
            encode_webp(&decoded, 85.0),
            encode_jpeg(&decoded, 85),
        );
        // Round-trip sanity: WebP output decodes at identical dimensions.
        let roundtrip = webp::Decoder::new(&w85).decode().expect("webp decodes");
        assert_eq!((roundtrip.width(), roundtrip.height()), (decoded.width(), decoded.height()));
        src_total += bytes.len() as u64;
        w80_total += w80.len() as u64;
        w85_total += w85.len() as u64;
        j85_total += j85.len() as u64;
        println!(
            "{:>12} {:>12} {:>12} {:>12}  {}",
            bytes.len(),
            w80.len(),
            w85.len(),
            j85.len(),
            path.display()
        );
    }
    let pct = |after: u64| 100.0 * (src_total.saturating_sub(after)) as f64 / src_total as f64;
    println!("total src:   {src_total}");
    println!("total webp80: {w80_total} ({:.1}%)", pct(w80_total));
    println!("total webp85: {w85_total} ({:.1}%)", pct(w85_total));
    println!("total jpg85:  {j85_total} ({:.1}%)", pct(j85_total));
}
