//! Desktop prefs.
//!
//! The showcase photo size is the only file-backed desktop preference so
//! far. Writes are atomic (`<path>.tmp` + rename) and preserve unrelated
//! keys.

use std::{collections::HashMap, fs, path::Path};

pub const DESKTOP_PREFERENCES_FILENAME: &str = "preferences.json";
pub const DEFAULT_SHOWCASE_PHOTO_SIZE: &str = "small";

pub fn normalize_showcase_photo_size(value: Option<&str>) -> String {
    match value {
        Some("small" | "medium" | "large") => value.unwrap().to_owned(),
        _ => DEFAULT_SHOWCASE_PHOTO_SIZE.to_owned(),
    }
}

fn load_preferences(path: &Path) -> HashMap<String, serde_json::Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|parsed| {
            if parsed.is_object() {
                serde_json::from_value(parsed).ok()
            } else {
                None
            }
        })
        .unwrap_or_default()
}

pub fn read_showcase_photo_size(path: &Path) -> String {
    let prefs = load_preferences(path);
    let raw = prefs
        .get("showcasePhotoSize")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    normalize_showcase_photo_size(raw.as_deref())
}

pub fn write_showcase_photo_size(path: &Path, value: &str) -> std::io::Result<String> {
    let normalized = normalize_showcase_photo_size(Some(value));
    let mut prefs = load_preferences(path);
    prefs.insert(
        "showcasePhotoSize".to_owned(),
        serde_json::Value::String(normalized.clone()),
    );
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string(&prefs).unwrap())?;
    fs::rename(&tmp, path)?;
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(dir: &tempfile::TempDir) -> std::path::PathBuf {
        dir.path().join("preferences.json")
    }

    #[test]
    fn defaults_to_small_when_no_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_showcase_photo_size(&temp_path(&dir)), "small");
    }

    #[test]
    fn round_trips_the_chosen_size_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        assert_eq!(
            write_showcase_photo_size(&path, "large").unwrap(),
            "large"
        );
        assert_eq!(read_showcase_photo_size(&path), "large");
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn normalizes_unknown_values_instead_of_persisting_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        assert_eq!(
            write_showcase_photo_size(&path, "gigantic").unwrap(),
            "small"
        );
        assert_eq!(read_showcase_photo_size(&path), "small");
        assert_eq!(normalize_showcase_photo_size(None), "small");
    }

    #[test]
    fn preserves_unrelated_preferences_when_updating() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        fs::write(&path, r#"{"windowWidth":1480}"#).unwrap();
        write_showcase_photo_size(&path, "medium").unwrap();
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed["showcasePhotoSize"], "medium");
        assert_eq!(parsed["windowWidth"], 1480);
    }
}
