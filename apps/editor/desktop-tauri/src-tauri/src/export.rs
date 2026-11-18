//! Native "save archive" pipeline for the desktop shell.
//!
//! The web build streams the archive through `GET /api/archive/export` into a
//! browser download. The desktop shell owns the file system, so it asks for a
//! destination with the OS save dialog and then runs the same export pipeline
//! straight into that file: no blob, no silent drop into the download folder.
//!
//! Pure helpers (directory choice, serialized payload) live here so `cargo
//! test` covers them without a WebView; [`export_archive_to_path`] is
//! exercised against a temporary database. `main.rs` wires the dialog and the
//! command that calls it.

use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use editor_server_rust::ops::OperationState;
use serde::Serialize;

/// What the UI gets back after a successful save. `filename` is the name the
/// file actually got (the user may rename the suggested one); `path` lets the
/// export screen tell the collector where the archive landed. The web build
/// omits `path` because the browser's download flow never exposes it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArchive {
    pub filename: String,
    pub path: String,
    pub omitted_showcases: Vec<String>,
}

/// First candidate that exists and is a directory. The save dialog needs a
/// start folder, and the XDG download directory is simply absent on minimal
/// Linux setups, so the caller passes document/home as fallbacks.
pub fn preferred_archive_directory(candidates: &[Option<PathBuf>]) -> Option<PathBuf> {
    candidates
        .iter()
        .flatten()
        .find(|directory| directory.is_dir())
        .cloned()
}

/// Appends `.zip` when the chosen name has no extension. The save dialog's
/// filter is advisory and GTK appends nothing, so `myarchive` would otherwise
/// land as an extensionless file the import picker cannot see.
pub fn ensure_zip_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().is_none() {
        path.set_extension("zip");
    }
    path
}

/// Mirrors the route's `parse_selected_ids`: drop non-positive ids and
/// duplicates while keeping the request's order. `None` still means "no
/// filter"; an empty list is a real selection (e.g. "no showcases").
pub fn sanitize_ids(ids: Option<Vec<i64>>) -> Option<Vec<i64>> {
    ids.map(|values| {
        let mut seen = HashSet::new();
        values
            .into_iter()
            .filter(|id| *id > 0 && seen.insert(*id))
            .collect()
    })
}

/// Claims the `exporting_archive` operation for the whole shell interaction,
/// dialog included, so a running import is reported before the user picks a
/// folder. Dropping the claim (cancel, error, or success) ends the operation.
pub struct ExportClaim {
    ops: Arc<Mutex<OperationState>>,
}

impl ExportClaim {
    pub fn begin(state: &editor_server_rust::AppState) -> Result<Self, String> {
        state
            .ops
            .lock()
            .map_err(|_| "This action is unavailable while unknown is in progress.".to_owned())?
            .begin("exporting_archive", None)
            .map_err(|conflict| conflict.message)?;
        Ok(Self {
            ops: state.ops.clone(),
        })
    }
}

impl Drop for ExportClaim {
    fn drop(&mut self) {
        if let Ok(mut ops) = self.ops.lock() {
            ops.end("exporting_archive");
        }
    }
}

/// Runs the editor's export pipeline under an already-claimed
/// [`ExportClaim`].
pub async fn run_export(
    state: &editor_server_rust::AppState,
    collection_ids: Option<Vec<i64>>,
    showcase_ids: Option<Vec<i64>>,
) -> Result<editor_server_rust::archive::ExportOutput, String> {
    let pool = state.pool.clone();
    let data_dir = state.data_dir.clone();
    let collection_ids = sanitize_ids(collection_ids);
    let showcase_ids = sanitize_ids(showcase_ids);
    let join_result = tokio::task::spawn_blocking(move || {
        editor_server_rust::archive::run_export(
            &pool,
            &data_dir,
            collection_ids,
            showcase_ids,
        )
    })
    .await
    .map_err(|error| format!("Export task failed: {error}"))?;

    join_result.map_err(|error| error.message)
}

/// Writes a finished export to `path` and reports what landed there.
pub async fn write_archive(
    output: editor_server_rust::archive::ExportOutput,
    path: PathBuf,
) -> Result<SavedArchive, String> {
    tokio::fs::write(&path, &output.zip_bytes)
        .await
        .map_err(|error| format!("Cannot write {}: {error}", path.display()))?;

    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or(output.filename);

    Ok(SavedArchive {
        filename,
        path: path.display().to_string(),
        omitted_showcases: output.omitted_names,
    })
}

/// Claim, export, and write in one call: the path used by tests and by any
/// caller that already knows its destination.
pub async fn export_archive_to_path(
    state: &editor_server_rust::AppState,
    collection_ids: Option<Vec<i64>>,
    showcase_ids: Option<Vec<i64>>,
    path: PathBuf,
) -> Result<SavedArchive, String> {
    let _claim = ExportClaim::begin(state)?;
    let output = run_export(state, collection_ids, showcase_ids).await?;
    write_archive(output, path).await
}

#[cfg(test)]
mod tests {
    use editor_server_rust::{AppState, db};
    use serde_json::json;

    use super::*;

    fn temp_state() -> (tempfile::TempDir, AppState) {
        let dir = tempfile::tempdir().expect("temp dir");
        let data_dir = dir.path().join("data");
        let pool = db::open_pool(&data_dir.join("banknotes.db")).expect("pool opens");
        (dir, AppState::test(pool, data_dir))
    }

    #[test]
    fn archive_directory_uses_the_first_existing_candidate() {
        let dir = tempfile::tempdir().expect("temp dir");
        let missing = dir.path().join("missing");
        let present = dir.path().join("Downloads");
        std::fs::create_dir_all(&present).expect("downloads dir");

        assert_eq!(
            preferred_archive_directory(&[
                Some(missing),
                Some(present.clone()),
                Some(dir.path().to_path_buf()),
            ]),
            Some(present),
        );
        assert_eq!(preferred_archive_directory(&[None, None]), None);
    }

    #[test]
    fn saved_archive_serializes_with_camel_case_fields() {
        let payload = SavedArchive {
            filename: "noteharbor-archive-2026-01-01.zip".to_owned(),
            path: "/home/collector/Downloads/noteharbor-archive-2026-01-01.zip".to_owned(),
            omitted_showcases: vec!["Outside Show".to_owned()],
        };

        assert_eq!(
            serde_json::to_value(payload).expect("serializes"),
            json!({
                "filename": "noteharbor-archive-2026-01-01.zip",
                "path": "/home/collector/Downloads/noteharbor-archive-2026-01-01.zip",
                "omittedShowcases": ["Outside Show"],
            }),
        );
    }

    #[test]
    fn appends_zip_when_the_chosen_name_has_no_extension() {
        let dir = tempfile::tempdir().expect("temp dir");

        assert_eq!(
            ensure_zip_extension(dir.path().join("myarchive")),
            dir.path().join("myarchive.zip"),
        );
        assert_eq!(
            ensure_zip_extension(dir.path().join("myarchive ZIP.zip")),
            dir.path().join("myarchive ZIP.zip"),
        );
        assert_eq!(
            ensure_zip_extension(dir.path().join("notes.tar.gz")),
            dir.path().join("notes.tar.gz"),
        );
    }

    #[test]
    fn selected_ids_drop_non_positive_and_duplicates() {
        assert_eq!(sanitize_ids(None), None);
        assert_eq!(sanitize_ids(Some(vec![])), Some(vec![]));
        assert_eq!(
            sanitize_ids(Some(vec![2, 0, -3, 2, 5, 5])),
            Some(vec![2, 5]),
        );
    }

    #[test]
    fn export_claim_marks_the_operation_busy_until_dropped() {
        let (_dir, state) = temp_state();

        let claim = ExportClaim::begin(&state).expect("claim");
        assert_eq!(
            state.ops.lock().expect("lock").current_operation,
            "exporting_archive",
        );
        assert_eq!(
            ExportClaim::begin(&state)
                .err()
                .expect("second claim conflicts"),
            "This action is unavailable while exporting archive is in progress.",
        );

        drop(claim);
        assert_eq!(
            state.ops.lock().expect("lock").current_operation,
            "idle",
        );
    }

    #[tokio::test]
    async fn writes_the_zip_to_the_chosen_path() {
        let (dir, state) = temp_state();
        let path = dir.path().join("chosen").join("my archive.zip");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("parent dir");

        let saved = export_archive_to_path(&state, None, None, path.clone())
            .await
            .expect("export succeeds");

        assert_eq!(saved.path, path.display().to_string());
        assert_eq!(saved.filename, "my archive.zip");
        assert!(saved.omitted_showcases.is_empty());
        let bytes = std::fs::read(&path).expect("archive is written");
        assert!(bytes.starts_with(b"PK"), "not a zip: {bytes:?}");
        assert_eq!(
            state.ops.lock().expect("lock").current_operation, "idle",
            "the claim must be released after the export",
        );
    }

    #[tokio::test]
    async fn refuses_while_another_operation_runs() {
        let (dir, state) = temp_state();
        state
            .ops
            .lock()
            .expect("lock")
            .begin("importing_archive", None)
            .expect("begin");

        let error = export_archive_to_path(&state, None, None, dir.path().join("archive.zip"))
            .await
            .expect_err("conflict");

        assert_eq!(
            error,
            "This action is unavailable while importing archive is in progress."
        );
        assert!(!dir.path().join("archive.zip").exists());
    }
}
