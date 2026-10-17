//! One-time image migration: copies a data directory to a new location with
//! all note images re-encoded (GIFs copied verbatim), and rewrites the
//! copied database's image `localPath`s to match.
//!
//! The source directory is never modified. Usage:
//!
//! ```text
//! migrate-images --src data --dst data-migrated [--format jpeg|webp]
//!                [--quality 85] [--thumbnail-quality 82] [--never-grow]
//!                [--dry-run] [--report report.csv]
//! ```

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use editor_server_rust::images::{
    IMAGE_API_PREFIX, MIGRATE_FULL_JPEG_QUALITY, MIGRATE_THUMB_JPEG_QUALITY, transcode_to_jpeg,
    transcode_to_webp,
};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Format {
    Jpeg,
    Webp,
}

impl Format {
    fn extension(self) -> &'static str {
        match self {
            Format::Jpeg => ".jpg",
            Format::Webp => ".webp",
        }
    }
}

struct Args {
    src: PathBuf,
    dst: PathBuf,
    format: Format,
    quality: f32,
    thumbnail_quality: f32,
    never_grow: bool,
    dry_run: bool,
    report: Option<PathBuf>,
}

fn usage() -> String {
    "usage: migrate-images --src <data-dir> --dst <out-dir> [--format jpeg|webp] \
     [--quality 1-100] [--thumbnail-quality 1-100] [--never-grow] [--dry-run] \
     [--report <csv>]"
        .to_owned()
}

fn parse_args() -> Result<Args, String> {
    let mut src = None;
    let mut dst = None;
    let mut format = Format::Jpeg;
    let mut quality = f32::from(MIGRATE_FULL_JPEG_QUALITY);
    let mut thumbnail_quality = f32::from(MIGRATE_THUMB_JPEG_QUALITY);
    let mut never_grow = false;
    let mut dry_run = false;
    let mut report = None;
    let mut rest = std::env::args().skip(1);
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--src" => src = Some(PathBuf::from(rest.next().ok_or("--src needs a value")?)),
            "--dst" => dst = Some(PathBuf::from(rest.next().ok_or("--dst needs a value")?)),
            "--format" => {
                format = match rest.next().ok_or("--format needs a value")?.as_str() {
                    "jpeg" => Format::Jpeg,
                    "webp" => Format::Webp,
                    other => return Err(format!("unknown --format \"{other}\" (jpeg|webp)")),
                };
            }
            "--quality" => {
                quality = parse_quality(rest.next().ok_or("--quality needs a value")?)?;
            }
            "--thumbnail-quality" => {
                thumbnail_quality =
                    parse_quality(rest.next().ok_or("--thumbnail-quality needs a value")?)?;
            }
            "--never-grow" => never_grow = true,
            "--dry-run" => dry_run = true,
            "--report" => {
                report = Some(PathBuf::from(rest.next().ok_or("--report needs a value")?))
            }
            _ => return Err(format!("unknown argument \"{arg}\"\n{}", usage())),
        }
    }
    let (Some(src), Some(dst)) = (src, dst) else {
        return Err(format!("--src and --dst are required\n{}", usage()));
    };
    if src == dst {
        return Err("--dst must differ from --src".to_owned());
    }
    Ok(Args {
        src,
        dst,
        format,
        quality,
        thumbnail_quality,
        never_grow,
        dry_run,
        report,
    })
}

fn parse_quality(raw: String) -> Result<f32, String> {
    match raw.parse::<f32>() {
        Ok(value) if (1.0..=100.0).contains(&value) => Ok(value),
        _ => Err("--quality must be 1-100".to_owned()),
    }
}

fn quality_for(relative_posix: &str, args: &Args) -> f32 {
    if relative_posix.to_lowercase().contains("thumbnail") {
        args.thumbnail_quality
    } else {
        args.quality
    }
}

fn transcode(bytes: &[u8], format: Format, quality: f32) -> Option<Vec<u8>> {
    match format {
        Format::Jpeg => transcode_to_jpeg(bytes, quality as u8),
        Format::Webp => transcode_to_webp(bytes, quality),
    }
}

/// Every file under `dir` as (absolute path, `/`-joined relative path), sorted.
fn collect_files(dir: &Path) -> std::io::Result<Vec<(PathBuf, String)>> {
    let mut files = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&current)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        entries.sort();
        for entry in entries {
            if entry.is_dir() {
                stack.push(entry);
            } else if entry.is_file() {
                let relative = entry
                    .strip_prefix(dir)
                    .map(to_posix)
                    .unwrap_or_else(|_| entry.to_string_lossy().into_owned());
                files.push((entry, relative));
            }
        }
    }
    files.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(files)
}

fn to_posix(relative: &Path) -> String {
    relative
        .iter()
        .map(|segment| segment.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn to_fs_path(root: &Path, relative_posix: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    for segment in relative_posix.split('/') {
        if !segment.is_empty() {
            path.push(segment);
        }
    }
    path
}

fn main() {
    let args = parse_args().unwrap_or_else(|error| {
        eprintln!("error: {error}");
        std::process::exit(2);
    });
    if let Err(error) = run(&args) {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run(args: &Args) -> Result<(), String> {
    let src_db = args.src.join("banknotes.db");
    let src_images = args.src.join("images");
    if !src_db.is_file() {
        return Err(format!("source database not found: {}", src_db.display()));
    }
    if !src_images.is_dir() {
        return Err(format!(
            "source images dir not found: {}",
            src_images.display()
        ));
    }

    let dst_db = args.dst.join("banknotes.db");
    if !args.dry_run {
        std::fs::create_dir_all(&args.dst).map_err(|error| error.to_string())?;
        // Consistent compact copy straight from the live file (same VACUUM
        // INTO technique as the export snapshot).
        let src = rusqlite::Connection::open(&src_db).map_err(|error| error.to_string())?;
        let literal = dst_db.to_string_lossy().replace('\'', "''");
        src.execute_batch(&format!("VACUUM INTO '{literal}'"))
            .map_err(|error| error.to_string())?;
    }

    let files = collect_files(&src_images).map_err(|error| error.to_string())?;
    // Old `images/<rel>` -> new `images/<rel>` (identical unless transcoded
    // across extensions, e.g. `.png` -> `.jpg`, or kept verbatim).
    let mut renames: HashMap<String, String> = HashMap::new();
    let mut rows: Vec<(String, u64, u64, &'static str)> = Vec::with_capacity(files.len());
    let (mut total_before, mut total_after) = (0u64, 0u64);
    let mut transcoded_count = 0usize;
    for (absolute, relative) in &files {
        let bytes = std::fs::read(absolute).map_err(|error| error.to_string())?;
        let before = bytes.len() as u64;
        total_before += before;
        let transcoded = transcode(&bytes, args.format, quality_for(relative, args));
        let (out_relative, out_bytes, action) = match transcoded {
            Some(output)
                if !args.never_grow || (output.len() as u64) < before =>
            {
                let stem = relative
                    .rsplit_once('.')
                    .map(|(stem, _)| stem)
                    .unwrap_or(relative);
                (format!("{stem}{}", args.format.extension()), output, "transcoded")
            }
            // GIFs, undecodable files, and (with --never-grow) outputs that
            // would be larger than the source travel verbatim.
            _ => (relative.clone(), bytes, "copied"),
        };
        let after = out_bytes.len() as u64;
        total_after += after;
        if action == "transcoded" {
            transcoded_count += 1;
        }
        rows.push((relative.clone(), before, after, action));
        renames.insert(relative.clone(), out_relative.clone());
        if !args.dry_run {
            let target = to_fs_path(&args.dst.join("images"), &out_relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::write(&target, &out_bytes).map_err(|error| error.to_string())?;
        }
    }

    if !args.dry_run {
        rewrite_image_paths(&dst_db, &renames)?;
    }

    print_report(args, &rows, total_before, total_after, transcoded_count)?;
    Ok(())
}

/// Rewrites `localPath`s in the copied database to the migrated file names.
/// Records whose file was copied verbatim (or is missing) keep their path.
fn rewrite_image_paths(dst_db: &Path, renames: &HashMap<String, String>) -> Result<(), String> {
    let db = rusqlite::Connection::open(dst_db).map_err(|error| error.to_string())?;
    let rows: Vec<(i64, Option<String>)> = {
        let mut stmt = db
            .prepare("SELECT id, images FROM banknotes")
            .map_err(|error| error.to_string())?;
        let mapped = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|error| error.to_string())?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    for (id, raw) in rows {
        let Some(raw) = raw else { continue };
        let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let mut changed = false;
        let rewritten: Vec<Value> = items
            .into_iter()
            .map(|item| {
                let Some(obj) = item.as_object() else {
                    return item;
                };
                let Some(local) = obj.get("localPath").and_then(Value::as_str) else {
                    return item;
                };
                let Some(relative) = local.strip_prefix(IMAGE_API_PREFIX) else {
                    return item;
                };
                match renames.get(relative) {
                    Some(new_relative) if new_relative != relative => {
                        let mut updated = obj.clone();
                        updated.insert(
                            "localPath".to_owned(),
                            Value::String(format!("{IMAGE_API_PREFIX}{new_relative}")),
                        );
                        changed = true;
                        Value::Object(updated)
                    }
                    _ => item,
                }
            })
            .collect();
        if changed {
            db.execute(
                "UPDATE banknotes SET images = ?1 WHERE id = ?2",
                rusqlite::params![Value::Array(rewritten).to_string(), id],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn print_report(
    args: &Args,
    rows: &[(String, u64, u64, &'static str)],
    total_before: u64,
    total_after: u64,
    transcoded_count: usize,
) -> Result<(), String> {
    let saved = total_before.saturating_sub(total_after);
    let percent = if total_before == 0 {
        0.0
    } else {
        100.0 * saved as f64 / total_before as f64
    };
    println!("source:      {}", args.src.display());
    println!("destination: {}", args.dst.display());
    println!(
        "format:      {:?} (quality {}, thumbnail {}){}",
        args.format,
        args.quality,
        args.thumbnail_quality,
        if args.never_grow { ", never-grow" } else { "" }
    );
    if args.dry_run {
        println!("mode:        dry-run (nothing written)");
    }
    println!(
        "files:       {} (transcoded {transcoded_count}, copied {})",
        rows.len(),
        rows.len() - transcoded_count
    );
    println!("before:      {:.1} MB", total_before as f64 / 1e6);
    println!("after:       {:.1} MB", total_after as f64 / 1e6);
    println!("saved:       {:.1} MB ({percent:.1}%)", saved as f64 / 1e6);
    if let Some(report) = &args.report {
        let mut csv = String::from("path,before_bytes,after_bytes,action\n");
        for (relative, before, after, action) in rows {
            csv.push_str(&format!("{relative},{before},{after},{action}\n"));
        }
        std::fs::write(report, csv).map_err(|error| error.to_string())?;
        println!("report:      {}", report.display());
    }
    Ok(())
}
