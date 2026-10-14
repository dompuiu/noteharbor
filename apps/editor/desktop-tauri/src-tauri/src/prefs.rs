//! Desktop prefs.
//!
//! The showcase photo size is the only file-backed desktop preference so
//! far. Writes are atomic (`<path>.tmp` + rename) and preserve unrelated
//! keys.

use std::{collections::HashMap, fs, path::Path};

pub const DESKTOP_PREFERENCES_FILENAME: &str = "preferences.json";
pub const DEFAULT_SHOWCASE_PHOTO_SIZE: &str = "small";
pub const LAST_VISITED_ROUTE_KEY: &str = "lastVisitedRoute";
/// Upper bound for a persisted route (pathname + search + hash).
pub const MAX_LAST_VISITED_ROUTE_LEN: usize = 2000;

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

/// Validates a last-visited route the same way on read and write: an
/// app-local pathname under `/catalog/` or `/portfolio/` (the collections
/// home included), with its query/hash kept. Anything else — the `/` root,
/// unknown paths, `new`-draft addresses, overlong or suspicious values —
/// normalizes to `None` so the shell falls back to the default destination
/// instead of restoring a dead or transient screen.
pub fn normalize_last_visited_route(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() || raw.len() > MAX_LAST_VISITED_ROUTE_LEN {
        return None;
    }
    if !raw.starts_with('/') || raw.starts_with("//") {
        return None;
    }
    if raw.chars().any(|c| {
        c.is_control() || c == ' ' || c == '\\' || c == '"' || c == '<' || c == '>' || c == '`'
    }) {
        return None;
    }
    let path_end = raw.find(['?', '#']).unwrap_or(raw.len());
    let pathname = &raw[..path_end];
    let known = pathname == "/catalog/collections"
        || pathname.starts_with("/catalog/")
        || pathname.starts_with("/portfolio/");
    if !known {
        return None;
    }
    if pathname.split('/').any(|segment| segment == "new") {
        return None;
    }
    Some(raw.to_owned())
}

pub fn read_last_visited_route(path: &Path) -> Option<String> {
    let prefs = load_preferences(path);
    let raw = prefs.get(LAST_VISITED_ROUTE_KEY)?.as_str()?;
    normalize_last_visited_route(Some(raw))
}

pub fn write_last_visited_route(path: &Path, value: &str) -> std::io::Result<Option<String>> {
    let normalized = normalize_last_visited_route(Some(value));
    let mut prefs = load_preferences(path);
    match normalized.clone() {
        Some(route) => {
            prefs.insert(
                LAST_VISITED_ROUTE_KEY.to_owned(),
                serde_json::Value::String(route),
            );
        }
        None => {
            prefs.remove(LAST_VISITED_ROUTE_KEY);
        }
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string(&prefs).unwrap())?;
    fs::rename(&tmp, path)?;
    Ok(normalized)
}

/// Joins the embedded-server base URL with a saved route, mirroring how the
/// saved window position restores onto the built window: a valid saved route
/// becomes the WebView's initial URL, anything else keeps the base URL.
pub fn initial_app_url(app_url: &str, route: Option<&str>) -> String {
    match normalize_last_visited_route(route) {
        Some(route) => format!("{}{}", app_url.trim_end_matches('/'), route),
        None => app_url.to_owned(),
    }
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

    #[test]
    fn last_visited_route_accepts_catalog_and_portfolio_paths_with_query() {
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections")),
            Some("/catalog/collections".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/1/view")),
            Some("/catalog/collections/1/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/portfolio/showcases/2/view?node=3")),
            Some("/portfolio/showcases/2/view?node=3".to_owned())
        );
    }

    #[test]
    fn last_visited_route_rejects_root_unknown_and_draft_addresses() {
        assert_eq!(normalize_last_visited_route(None), None);
        assert_eq!(normalize_last_visited_route(Some("")), None);
        assert_eq!(normalize_last_visited_route(Some("/")), None);
        // Retired app-local paths still land on the default destination
        // through the catch-all redirect, so restoring them is harmless.
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/banknotes")),
            Some("/catalog/banknotes".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/settings/advanced")),
            None
        );
        assert_eq!(normalize_last_visited_route(Some("/api/health")), None);
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/new/edit")),
            None
        );
        assert_eq!(
            normalize_last_visited_route(Some("/portfolio/showcases/new/edit")),
            None
        );
    }

    #[test]
    fn last_visited_route_rejects_absolute_urls_and_suspicious_values() {
        assert_eq!(
            normalize_last_visited_route(Some("https://example.com/")),
            None
        );
        assert_eq!(normalize_last_visited_route(Some("//catalog/x")), None);
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/x with space")),
            None
        );
        assert_eq!(normalize_last_visited_route(Some("/catalog/\\x")), None);
        assert_eq!(normalize_last_visited_route(Some(&"a".repeat(3000))), None);
    }

    #[test]
    fn last_visited_route_round_trips_and_preserves_unrelated_keys() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        assert_eq!(read_last_visited_route(&path), None);
        assert_eq!(
            write_last_visited_route(&path, "/catalog/collections/1/view").unwrap(),
            Some("/catalog/collections/1/view".to_owned())
        );
        assert_eq!(
            read_last_visited_route(&path),
            Some("/catalog/collections/1/view".to_owned())
        );
        write_showcase_photo_size(&path, "medium").unwrap();
        assert_eq!(
            read_last_visited_route(&path),
            Some("/catalog/collections/1/view".to_owned())
        );
        // An invalid write clears the saved route instead of persisting it.
        assert_eq!(write_last_visited_route(&path, "/").unwrap(), None);
        assert_eq!(read_last_visited_route(&path), None);
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed["showcasePhotoSize"], "medium");
    }

    #[test]
    fn initial_app_url_appends_only_valid_routes() {
        let base = "http://127.0.0.1:1234";
        assert_eq!(
            initial_app_url(base, Some("/catalog/import-export")),
            "http://127.0.0.1:1234/catalog/import-export"
        );
        assert_eq!(
            initial_app_url("http://127.0.0.1:1234/", Some("/catalog/import-export")),
            "http://127.0.0.1:1234/catalog/import-export"
        );
        assert_eq!(initial_app_url(base, None), base);
        assert_eq!(initial_app_url(base, Some("/")), base);
        assert_eq!(initial_app_url(base, Some("https://example.com/")), base);
    }
}
