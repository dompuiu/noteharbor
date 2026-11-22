//! Desktop prefs.
//!
//! The showcase photo size and catalog layout are the file-backed desktop
//! display preferences. Writes are atomic (`<path>.tmp` + rename) and preserve
//! unrelated keys.

use std::{collections::HashMap, fs, path::Path};

pub const DESKTOP_PREFERENCES_FILENAME: &str = "preferences.json";
pub const DEFAULT_SHOWCASE_PHOTO_SIZE: &str = "small";
pub const DEFAULT_SHOWCASE_CATALOG_LAYOUT: &str = "labels";
pub const LAST_VISITED_ROUTE_KEY: &str = "lastVisitedRoute";
/// Upper bound for a persisted route (pathname + search + hash).
pub const MAX_LAST_VISITED_ROUTE_LEN: usize = 2000;
pub const TABLE_STATES_KEY: &str = "tableStates";
/// The saved table structures are small (sort + visible columns per
/// collection); this only keeps a malformed payload from turning the
/// preferences file into an arbitrary blob.
pub const MAX_TABLE_STATES_JSON_LEN: usize = 64 * 1024;

pub fn normalize_showcase_photo_size(value: Option<&str>) -> String {
    match value {
        Some("small" | "medium" | "large") => value.unwrap().to_owned(),
        _ => DEFAULT_SHOWCASE_PHOTO_SIZE.to_owned(),
    }
}

pub fn normalize_showcase_catalog_layout(value: Option<&str>) -> String {
    match value {
        Some("labels" | "rail") => value.unwrap().to_owned(),
        _ => DEFAULT_SHOWCASE_CATALOG_LAYOUT.to_owned(),
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

pub fn read_showcase_catalog_layout(path: &Path) -> String {
    let prefs = load_preferences(path);
    let raw = prefs
        .get("showcaseCatalogLayout")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    normalize_showcase_catalog_layout(raw.as_deref())
}

pub fn write_showcase_catalog_layout(path: &Path, value: &str) -> std::io::Result<String> {
    let normalized = normalize_showcase_catalog_layout(Some(value));
    let mut prefs = load_preferences(path);
    prefs.insert(
        "showcaseCatalogLayout".to_owned(),
        serde_json::Value::String(normalized.clone()),
    );
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string(&prefs).unwrap())?;
    fs::rename(&tmp, path)?;
    Ok(normalized)
}

fn is_positive_integer_id(id: &str) -> bool {
    !id.is_empty()
        && id.bytes().all(|b| b.is_ascii_digit())
        && !id.starts_with('0')
}

/// Collapses a pathname to its first-level screen: a collection lands on its
/// table (`/catalog/collections/:id/view`), a showcase on its root view.
/// Slideshow / preview hashes, `?node=` drills, edit canvases, and the
/// standalone note editor have no first-level restore of their own. Keep in
/// sync with `collapseLastVisitedPathname` in
/// `ui-react/src/lib/lastVisitedRoute.js`.
pub fn collapse_last_visited_pathname(pathname: &str) -> Option<String> {
    if pathname == "/catalog/collections" {
        return Some(pathname.to_owned());
    }
    if pathname == "/catalog/import-export" {
        return Some(pathname.to_owned());
    }
    if pathname == "/catalog/all-notes" {
        return Some(pathname.to_owned());
    }
    if pathname == "/catalog/banknotes" {
        return Some("/catalog/collections".to_owned());
    }
    if let Some(rest) = pathname.strip_prefix("/catalog/collections/") {
        let mut segments = rest.split('/');
        let id = segments.next().unwrap_or("");
        let mode = segments.next();
        // Only `:id`, `:id/view`, and `:id/edit` (with an optional trailing
        // slash) collapse; anything deeper is not a first-level screen.
        let trailing = segments.next();
        let valid = match (mode, trailing) {
            (None, None) => true,
            (Some("view" | "edit"), None) => true,
            (Some(""), None) => true,
            (Some("view" | "edit"), Some("")) => true,
            _ => false,
        };
        if valid && is_positive_integer_id(id) {
            return Some(format!("/catalog/collections/{id}/view"));
        }
        return None;
    }
    if let Some(rest) = pathname.strip_prefix("/portfolio/showcases/") {
        let mut segments = rest.split('/');
        let id = segments.next().unwrap_or("");
        let mode = segments.next();
        let trailing = segments.next();
        let valid = match (mode, trailing) {
            (None, None) => true,
            (Some("view" | "edit"), None) => true,
            (Some(""), None) => true,
            (Some("view" | "edit"), Some("")) => true,
            _ => false,
        };
        if valid && is_positive_integer_id(id) {
            return Some(format!("/portfolio/showcases/{id}/view"));
        }
        return None;
    }
    None
}

/// Validates a last-visited route the same way on read and write: an
/// app-local pathname under `/catalog/` or `/portfolio/` (the collections
/// home included), collapsing to the first-level screen and dropping any
/// query/hash. Anything else — the `/` root,
/// unknown paths, note-editor and edit addresses, drill query / overlay
/// hash, `new`-draft addresses, overlong or suspicious values —
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
    if pathname.split('/').any(|segment| segment == "new") {
        return None;
    }
    collapse_last_visited_pathname(pathname)
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

/// The per-collection table structure (sort key + direction and visible
/// columns). Keyed by collection id, the same shape the UI keeps under its
/// `noteharbor.notesTableState.<id>` localStorage keys. Only well-formed
/// entries are handed back: a positive integer id and an object value.
pub fn read_table_states(path: &Path) -> serde_json::Map<String, serde_json::Value> {
    let prefs = load_preferences(path);
    match prefs
        .get(TABLE_STATES_KEY)
        .and_then(|value| value.as_object())
    {
        Some(states) => states
            .iter()
            .filter(|(id, state)| is_positive_integer_id(id) && state.is_object())
            .map(|(id, state)| (id.clone(), state.clone()))
            .collect(),
        None => serde_json::Map::new(),
    }
}

/// Saves one collection's table structure, leaving every other collection's
/// entry alone. Returns the stored value so the bridge can echo it back.
pub fn write_table_state(
    path: &Path,
    collection_id: &str,
    state: &serde_json::Value,
) -> std::io::Result<Option<serde_json::Value>> {
    if !is_positive_integer_id(collection_id) || !state.is_object() {
        return Ok(None);
    }

    let mut prefs = load_preferences(path);
    let mut states = match prefs
        .get(TABLE_STATES_KEY)
        .and_then(|value| value.as_object())
    {
        Some(states) => states.clone(),
        None => serde_json::Map::new(),
    };
    states.insert(collection_id.to_owned(), state.clone());

    if serde_json::to_string(&states).unwrap().len() > MAX_TABLE_STATES_JSON_LEN {
        return Ok(None);
    }

    prefs.insert(
        TABLE_STATES_KEY.to_owned(),
        serde_json::Value::Object(states),
    );
    write_preferences(path, &prefs)?;
    Ok(Some(state.clone()))
}

/// Drops one collection's structure. Deleting a collection prunes its entry,
/// so a later collection that reuses the id cannot inherit it.
pub fn remove_table_state(path: &Path, collection_id: &str) -> std::io::Result<()> {
    let mut prefs = load_preferences(path);
    let removed = prefs
        .get_mut(TABLE_STATES_KEY)
        .and_then(|value| value.as_object_mut())
        .is_some_and(|states| states.remove(collection_id).is_some());

    if removed {
        write_preferences(path, &prefs)?;
    }

    Ok(())
}

/// An archive import renumbers collections, so every saved structure is
/// dropped instead of attaching to whatever collection lands on that id.
pub fn clear_table_states(path: &Path) -> std::io::Result<()> {
    let mut prefs = load_preferences(path);
    if prefs.remove(TABLE_STATES_KEY).is_some() {
        write_preferences(path, &prefs)?;
    }
    Ok(())
}

fn write_preferences(
    path: &Path,
    prefs: &HashMap<String, serde_json::Value>,
) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string(prefs).unwrap())?;
    fs::rename(&tmp, path)?;
    Ok(())
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
    fn catalog_layout_defaults_to_labels_when_no_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_showcase_catalog_layout(&temp_path(&dir)), "labels");
    }

    #[test]
    fn catalog_layout_round_trips_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        assert_eq!(
            write_showcase_catalog_layout(&path, "rail").unwrap(),
            "rail"
        );
        assert_eq!(read_showcase_catalog_layout(&path), "rail");
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn catalog_layout_normalizes_unknown_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        assert_eq!(
            write_showcase_catalog_layout(&path, "gallery").unwrap(),
            "labels"
        );
        assert_eq!(read_showcase_catalog_layout(&path), "labels");
        assert_eq!(normalize_showcase_catalog_layout(None), "labels");
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
    fn last_visited_route_collapses_to_the_first_level_screen() {
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections")),
            Some("/catalog/collections".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/import-export")),
            Some("/catalog/import-export".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/all-notes")),
            Some("/catalog/all-notes".to_owned())
        );
        // The retired address lands on the collections home.
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/banknotes")),
            Some("/catalog/collections".to_owned())
        );
        // A collection restores on its table: edit collapses to view and the
        // slideshow / editor hash never persists.
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/1/view")),
            Some("/catalog/collections/1/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/1/edit")),
            Some("/catalog/collections/1/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/1")),
            Some("/catalog/collections/1/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/1/view#slideshow/2")),
            Some("/catalog/collections/1/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/1/view#edit/7")),
            Some("/catalog/collections/1/view".to_owned())
        );
        // A showcase restores on its root view: edit collapses to view and
        // the `?node=` drill / preview query never persists.
        assert_eq!(
            normalize_last_visited_route(Some("/portfolio/showcases/2/view")),
            Some("/portfolio/showcases/2/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/portfolio/showcases/2/edit")),
            Some("/portfolio/showcases/2/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/portfolio/showcases/2")),
            Some("/portfolio/showcases/2/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some("/portfolio/showcases/2/view?node=3")),
            Some("/portfolio/showcases/2/view".to_owned())
        );
        assert_eq!(
            normalize_last_visited_route(Some(
                "/portfolio/showcases/2/view?node=3&preview=4%3Afront"
            )),
            Some("/portfolio/showcases/2/view".to_owned())
        );
    }

    #[test]
    fn last_visited_route_rejects_root_unknown_and_draft_addresses() {
        assert_eq!(normalize_last_visited_route(None), None);
        assert_eq!(normalize_last_visited_route(Some("")), None);
        assert_eq!(normalize_last_visited_route(Some("/")), None);
        assert_eq!(
            normalize_last_visited_route(Some("/settings/advanced")),
            None
        );
        assert_eq!(normalize_last_visited_route(Some("/api/health")), None);
        // The standalone note editor names no collection, so there is no
        // first-level table to restore: fall back to the default destination.
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/notes/7/edit")),
            None
        );
        // Non-numeric ids and deeper paths have no first-level screen.
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/abc/view")),
            None
        );
        assert_eq!(
            normalize_last_visited_route(Some("/catalog/collections/1/view/extra")),
            None
        );
        assert_eq!(
            normalize_last_visited_route(Some("/portfolio/showcases")),
            None
        );
        assert_eq!(
            normalize_last_visited_route(Some("/portfolio/showcases/2/view/extra")),
            None
        );
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
        // Deep screens collapse before becoming the initial URL.
        assert_eq!(
            initial_app_url(base, Some("/catalog/collections/1/edit")),
            "http://127.0.0.1:1234/catalog/collections/1/view"
        );
        assert_eq!(
            initial_app_url(
                base,
                Some("/portfolio/showcases/2/view?node=3")
            ),
            "http://127.0.0.1:1234/portfolio/showcases/2/view"
        );
        assert_eq!(
            initial_app_url(base, Some("/catalog/notes/7/edit")),
            base
        );
    }

    #[test]
    fn table_states_round_trip_per_collection_and_preserve_other_prefs() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        write_showcase_photo_size(&path, "medium").unwrap();

        let first = serde_json::json!({
            "sortKey": "denomination",
            "sortDirection": "desc",
            "visibleColumnKeys": ["id", "denomination"],
        });
        let second = serde_json::json!({
            "sortKey": "id",
            "sortDirection": "asc",
            "visibleColumnKeys": ["id", "grade"],
        });

        assert_eq!(
            write_table_state(&path, "2", &second).unwrap(),
            Some(second.clone())
        );
        write_table_state(&path, "1", &first).unwrap();

        let states = read_table_states(&path);
        assert_eq!(states.len(), 2);
        assert_eq!(states["1"], first);
        assert_eq!(states["2"], second);
        assert_eq!(read_showcase_photo_size(&path), "medium");
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn table_states_reject_bad_ids_and_non_object_values() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        let state = serde_json::json!({ "sortKey": "id" });

        assert_eq!(write_table_state(&path, "0", &state).unwrap(), None);
        assert_eq!(write_table_state(&path, "abc", &state).unwrap(), None);
        assert_eq!(
            write_table_state(&path, "3", &serde_json::json!("nope")).unwrap(),
            None
        );
        assert!(read_table_states(&path).is_empty());
    }

    #[test]
    fn table_states_drop_unreadable_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        fs::write(
            &path,
            r#"{"tableStates":{"1":{"sortKey":"id"},"0":{},"x":{},"2":"nope"}}"#,
        )
        .unwrap();

        let states = read_table_states(&path);
        assert_eq!(states.len(), 1);
        assert_eq!(states["1"], serde_json::json!({ "sortKey": "id" }));
    }

    #[test]
    fn removing_and_clearing_table_states_leave_unrelated_prefs() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        write_showcase_catalog_layout(&path, "rail").unwrap();
        write_table_state(&path, "1", &serde_json::json!({ "sortKey": "id" })).unwrap();
        write_table_state(&path, "2", &serde_json::json!({ "sortKey": "grade" })).unwrap();

        remove_table_state(&path, "1").unwrap();
        let states = read_table_states(&path);
        assert_eq!(states.len(), 1);
        assert!(states.contains_key("2"));

        clear_table_states(&path).unwrap();
        assert!(read_table_states(&path).is_empty());
        assert_eq!(read_showcase_catalog_layout(&path), "rail");
    }

    #[test]
    fn table_states_cap_an_oversized_payload() {
        let dir = tempfile::tempdir().unwrap();
        let path = temp_path(&dir);
        let oversized = serde_json::json!({
            "sortKey": "id",
            "padding": "x".repeat(MAX_TABLE_STATES_JSON_LEN),
        });

        assert_eq!(write_table_state(&path, "1", &oversized).unwrap(), None);
        assert!(read_table_states(&path).is_empty());
    }
}
