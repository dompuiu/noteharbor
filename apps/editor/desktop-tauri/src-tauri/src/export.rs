//! Native "save archive" pipeline for the desktop shell.
//!
//! The web build streams the archive through `GET /api/archive/export` into a
//! browser download. The desktop shell owns the file system, so it asks for a
//! destination with the OS save dialog and then runs the same export pipeline
//! straight into that file: no blob, no silent drop into the download folder.
//!
//! Pure helpers (directory choice, serialized payload) live here so `cargo
//! test` covers them without a WebView; `main.rs` wires the dialog and the
//! command that calls [`export_archive_to_path`].

use std::path::PathBuf;

use serde::Serialize;

/// What the UI gets back after a successful save. `path` lets the export
/// screen tell the collector where the archive landed; the web build omits it
/// because the browser's download flow never exposes the destination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

/// Runs the editor's export pipeline under the `exporting_archive` operation
/// and writes the finished zip to `path`. Errors carry user-facing text: a
/// conflicting import/export, a failed export, or a failed write.
pub async fn export_archive_to_path(
    state: &editor_server_rust::AppState,
    collection_ids: Option<Vec<i64>>,
    showcase_ids: Option<Vec<i64>>,
    path: PathBuf,
) -> Result<SavedArchive, String> {
    let pool = state.pool.clone();
    let data_dir = state.data_dir.clone();
    let outcome = editor_server_rust::ops::with_exclusive_operation(
        &state.ops,
        "exporting_archive",
        None,
        async move {
            tokio::task::spawn_blocking(move || {
                editor_server_rust::archive::run_export(
                    &pool,
                    &data_dir,
                    collection_ids,
                    showcase_ids,
                )
            })
            .await
        },
    )
    .await
    .map_err(|conflict| conflict.message)?;
    let output = outcome
        .map_err(|error| format!("Export task failed: {error}"))?
        .map_err(|error| error.message)?;

    tokio::fs::write(&path, &output.zip_bytes)
        .await
        .map_err(|error| format!("Cannot write {}: {error}", path.display()))?;

    Ok(SavedArchive {
        filename: output.filename,
        path: path.display().to_string(),
        omitted_showcases: output.omitted_names,
    })
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

    #[tokio::test]
    async fn writes_the_zip_to_the_chosen_path() {
        let (dir, state) = temp_state();
        let path = dir.path().join("chosen").join("my archive.zip");
        std::fs::create_dir_all(path.parent().expect("parent")).expect("parent dir");

        let saved = export_archive_to_path(&state, None, None, path.clone())
            .await
            .expect("export succeeds");

        assert_eq!(saved.path, path.display().to_string());
        assert!(saved.filename.starts_with("noteharbor-archive-"));
        assert!(saved.filename.ends_with(".zip"));
        assert!(saved.omitted_showcases.is_empty());
        let bytes = std::fs::read(&path).expect("archive is written");
        assert!(bytes.starts_with(b"PK"), "not a zip: {bytes:?}");
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
