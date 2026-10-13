//! HTTP handlers. Route-level catch semantics: collections POST/PUT/DELETE
//! answer any database failure as 400 with the message (the route-level
//! `catch` runs before the 503 mapping), while uncaught paths propagate
//! `AppError` (503/500).

use axum::{
    Json, Router,
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    archive::{self},
    db::{self},
    js_number, js_string,
    ops::with_exclusive_operation,
};

pub(crate) fn ok(body: Value) -> Response {
    (StatusCode::OK, Json(body)).into_response()
}

pub(crate) fn created(body: Value) -> Response {
    (StatusCode::CREATED, Json(body)).into_response()
}

pub(crate) fn bad_request(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
}

pub(crate) fn not_found(message: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": message }))).into_response()
}

fn body_or_empty(body: Option<Json<Value>>) -> Value {
    body.map(|Json(value)| value).unwrap_or(Value::Null)
}

fn parse_id(raw: &str) -> Option<i64> {
    js_number(&Value::String(raw.to_owned()))
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

async fn list_collections(State(state): State<AppState>) -> Result<Response, crate::AppError> {
    let collections = db::with_conn(&state.pool, |conn| db::get_all_collections(conn)).await?;
    Ok(ok(json!({ "collections": collections })))
}

async fn create_collection(
    State(state): State<AppState>,
    body: Option<Json<Value>>,
) -> Response {
    let payload = body_or_empty(body);
    let name = payload
        .get("name")
        .map(js_string)
        .unwrap_or_default();
    match db::with_conn(&state.pool, move |conn| {
        db::create_collection(conn, &name)
    })
    .await
    {
        Ok(collection) => created(json!({ "collection": collection })),
        Err(crate::AppError::DatabaseUnavailable) => {
            bad_request("Database unavailable.")
        }
        Err(crate::AppError::Http { message, .. }) => bad_request(&message),
    }
}

#[derive(Debug, Deserialize)]
struct ReorderPayload {
    ids: Option<Value>,
}

async fn reorder_collections(
    State(state): State<AppState>,
    body: Option<Json<ReorderPayload>>,
) -> Response {
    const REQUIRED: &str = "A full ordered list of collection IDs is required.";
    let ids_value = body.and_then(|Json(payload)| payload.ids);
    let Some(array) = ids_value.as_ref().and_then(Value::as_array) else {
        return bad_request(REQUIRED);
    };

    let mut ids = Vec::with_capacity(array.len());
    for item in array {
        match js_number(item) {
            Some(id) => ids.push(id),
            // `Number(x)` is NaN: it can never join the permutation, so the
            // reorder fails exactly like Node's membership check.
            None => {
                return bad_request(
                    "Reorder request must include every collection exactly once.",
                );
            }
        }
    }

    match db::with_conn(&state.pool, move |conn| {
        db::reorder_collections(conn, &ids)
    })
    .await
    {
        Ok(collections) => ok(json!({ "collections": collections })),
        Err(crate::AppError::DatabaseUnavailable) => bad_request("Database unavailable."),
        Err(crate::AppError::Http { message, .. }) => bad_request(&message),
    }
}

async fn rename_collection(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("A valid collection ID is required.");
    };
    if id <= 0 {
        return bad_request("A valid collection ID is required.");
    }

    let exists =
        match db::with_conn(&state.pool, move |conn| db::collection_exists(conn, id)).await {
            Ok(found) => found,
            Err(crate::AppError::DatabaseUnavailable) => return bad_request("Database unavailable."),
            Err(crate::AppError::Http { message, .. }) => return bad_request(&message),
        };
    if !exists {
        return not_found("Collection not found.");
    }

    let payload = body_or_empty(body);
    let name = payload.get("name").map(js_string).unwrap_or_default();
    if name.trim().is_empty() {
        return bad_request("Collection name is required.");
    }

    match db::with_conn(&state.pool, move |conn| {
        db::rename_collection(conn, id, &name)
    })
    .await
    {
        Ok(collection) => ok(json!({ "collection": collection })),
        Err(crate::AppError::DatabaseUnavailable) => bad_request("Database unavailable."),
        Err(crate::AppError::Http { message, .. }) => bad_request(&message),
    }
}

async fn delete_collection(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("A valid collection ID is required.");
    };
    if id <= 0 {
        return bad_request("A valid collection ID is required.");
    }

    let exists =
        match db::with_conn(&state.pool, move |conn| db::collection_exists(conn, id)).await {
            Ok(found) => found,
            Err(crate::AppError::DatabaseUnavailable) => return bad_request("Database unavailable."),
            Err(crate::AppError::Http { message, .. }) => return bad_request(&message),
        };
    if !exists {
        return not_found("Collection not found.");
    }

    let images_dir = state.data_dir.join("images").join("notes");
    match db::with_conn(&state.pool, move |conn| {
        db::delete_collection(conn, &images_dir, id)
    })
    .await
    {
        Ok(()) => ok(json!({ "success": true })),
        Err(crate::AppError::DatabaseUnavailable) => bad_request("Database unavailable."),
        Err(crate::AppError::Http { message, .. }) => bad_request(&message),
    }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async fn operation_status(State(state): State<AppState>) -> Response {
    let status = state
        .ops
        .lock()
        .map(|guard| guard.status())
        .unwrap_or_else(|_| json!({"currentOperation": "idle", "isBusy": false, "startedAt": null, "details": null}));
    ok(status)
}

// ---------------------------------------------------------------------------
// Images (static passthrough)
// ---------------------------------------------------------------------------

/// Serves one managed image file from `<data_dir>/images`. Unknown paths
/// answer the same JSON 404 as every other `/api/*` route; traversal
/// attempts that escape the images root are confined, never served.
async fn serve_image(State(state): State<AppState>, Path(tail): Path<String>) -> Response {
    let images_root = state.data_dir.join("images");
    // Reuse the managed-path resolver so the traversal rule lives in one
    // place (`images.rs`): anything that does not map inside the images root
    // answers the API 404.
    let Some(candidate) = crate::images::resolve_local_path(&images_root, &format!("/api/images/{tail}")) else {
        return not_found("Not found.");
    };
    let canonical_root = tokio::fs::canonicalize(&images_root).await.ok();
    let canonical = tokio::fs::canonicalize(&candidate).await.ok();
    match (canonical_root, canonical) {
        (Some(root), Some(path)) if path.starts_with(&root) && path.is_file() => {
            match tokio::fs::read(&path).await {
                Ok(bytes) => {
                    let mime = mime_guess::from_path(&path).first_or_octet_stream();
                    axum::response::Response::builder()
                        .status(StatusCode::OK)
                        .header(
                            axum::http::header::CONTENT_TYPE,
                            mime.essence_str().to_owned(),
                        )
                        .body(axum::body::Body::from(bytes))
                        .expect("image response builds")
                        .into_response()
                }
                Err(_) => not_found("Not found."),
            }
        }
        _ => not_found("Not found."),
    }
}

pub fn images_router() -> Router<AppState> {
    Router::new().route("/api/images/{*path}", get(serve_image))
}

// ---------------------------------------------------------------------------
// Archive (export / import / delete, each under its exclusive operation)
// ---------------------------------------------------------------------------

fn query_values(params: &[(String, String)], key: &str) -> Option<String> {
    let mut found = false;
    let mut joined = String::new();
    for (name, value) in params {
        if name == key {
            if found {
                joined.push(',');
            }
            joined.push_str(value);
            found = true;
        }
    }
    found.then_some(joined)
}

fn operation_conflict(conflict: crate::ops::OperationConflict) -> Response {
    (conflict.status_code(), Json(conflict.body())).into_response()
}

fn join_failed() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Request failed." })),
    )
        .into_response()
}

fn multipart_failed(error: impl ToString) -> Response {
    archive::ArchiveError::internal(error.to_string()).into_response()
}

async fn export_archive(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
) -> Response {
    let collections =
        archive::parse_selected_ids(query_values(&params, "collectionIds").as_deref());
    let showcases =
        archive::parse_selected_ids(query_values(&params, "showcaseIds").as_deref());
    let pool = state.pool.clone();
    let data_dir = state.data_dir.clone();
    let outcome = with_exclusive_operation(&state.ops, "exporting_archive", None, async move {
        tokio::task::spawn_blocking(move || {
            archive::run_export(&pool, &data_dir, collections, showcases)
        })
        .await
    })
    .await;
    let output = match outcome {
        Err(conflict) => return operation_conflict(conflict),
        Ok(Err(_)) => return join_failed(),
        Ok(Ok(Err(error))) => return error.into_response(),
        Ok(Ok(Ok(output))) => output,
    };
    let omitted = archive::encode_omitted_showcases_header(&output.omitted_names);
    match axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "application/zip")
        .header(
            axum::http::header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        )
        .header(axum::http::header::PRAGMA, "no-cache")
        .header(axum::http::header::EXPIRES, "0")
        .header(
            axum::http::header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", output.filename),
        )
        .header("x-noteharbor-omitted-showcases", omitted)
        .body(axum::body::Body::from(output.zip_bytes))
    {
        Ok(response) => response.into_response(),
        Err(_) => join_failed(),
    }
}

async fn import_archive(
    State(state): State<AppState>,
    Query(params): Query<Vec<(String, String)>>,
    mut multipart: Multipart,
) -> Response {
    // The upload streams straight to disk: archives can be gigabytes, so the
    // file field must never be buffered in memory. The staging directory is
    // kept alive until the blocking import finishes. A missing file answers
    // 400 even while another operation runs: the missing-file check runs
    // before the exclusive-operation guard.
    let mut upload_stage: Option<tempfile::TempDir> = None;
    let mut upload_path: Option<std::path::PathBuf> = None;
    let mut body_mode: Option<String> = None;
    loop {
        match multipart.next_field().await {
            Err(error) => return multipart_failed(error),
            Ok(None) => break,
            Ok(Some(mut field)) => {
                let name = field.name().unwrap_or("").to_owned();
                if name == "file" {
                    // A repeated file field supersedes the previous one, like
                    // the old whole-body read's last-wins assignment.
                    let mut uploaded_bytes: u64 = 0;
                    let stage = match tempfile::TempDir::new() {
                        Ok(stage) => stage,
                        Err(error) => return multipart_failed(error),
                    };
                    let path = stage.path().join("upload.zip");
                    let mut file = match tokio::fs::File::create(&path).await {
                        Ok(file) => file,
                        Err(error) => return multipart_failed(error),
                    };
                    loop {
                        match field.chunk().await {
                            Err(error) => return multipart_failed(error),
                            Ok(None) => break,
                            Ok(Some(chunk)) => {
                                uploaded_bytes += chunk.len() as u64;
                                if uploaded_bytes > archive::MAX_ARCHIVE_UPLOAD_BYTES {
                                    // Close the handle so the staging dir can
                                    // be cleaned up (Windows holds open files).
                                    drop(file);
                                    return archive::ArchiveError::too_large().into_response();
                                }
                                if let Err(error) = tokio::io::AsyncWriteExt::write_all(
                                    &mut file,
                                    &chunk,
                                )
                                .await
                                {
                                    return multipart_failed(error);
                                }
                            }
                        }
                    }
                    if let Err(error) =
                        tokio::io::AsyncWriteExt::flush(&mut file).await
                    {
                        return multipart_failed(error);
                    }
                    drop(file);
                    upload_stage = Some(stage);
                    upload_path = Some(path);
                } else if name == "mode" {
                    match field.text().await {
                        Err(error) => return multipart_failed(error),
                        Ok(text) => body_mode = Some(text),
                    }
                }
            }
        }
    }
    let (Some(stage), Some(path)) = (upload_stage, upload_path) else {
        return bad_request("Archive file is required.");
    };
    let query_mode = query_values(&params, "mode");
    let pool = state.pool.clone();
    let data_dir = state.data_dir.clone();
    let outcome = with_exclusive_operation(&state.ops, "importing_archive", None, async move {
        tokio::task::spawn_blocking(move || {
            // `stage` is only held to keep `upload.zip` on disk until the
            // import below finishes.
            let _stage_guard = &stage;
            archive::run_import(&pool, &data_dir, &path, query_mode.as_deref(), body_mode.as_deref())
        })
        .await
    })
    .await;
    match outcome {
        Err(conflict) => operation_conflict(conflict),
        Ok(Err(_)) => join_failed(),
        Ok(Ok(Err(error))) => error.into_response(),
        Ok(Ok(Ok(mode))) => ok(json!({ "success": true, "mode": mode, "currentOperation": "idle" })),
    }
}

async fn delete_archive_data(State(state): State<AppState>) -> Response {
    let pool = state.pool.clone();
    let data_dir = state.data_dir.clone();
    let outcome = with_exclusive_operation(&state.ops, "clearing_data", None, async move {
        tokio::task::spawn_blocking(move || {
            let mut conn = pool.get().map_err(|_| archive::ArchiveError::unavailable())?;
            archive::clear_live_data(&mut conn, &data_dir)
        })
        .await
    })
    .await;
    match outcome {
        Err(conflict) => operation_conflict(conflict),
        Ok(Err(_)) => join_failed(),
        Ok(Ok(Err(error))) => error.into_response(),
        Ok(Ok(Ok(()))) => ok(json!({ "success": true, "currentOperation": "idle" })),
    }
}

pub fn archive_router() -> Router<AppState> {
    Router::new()
        .route("/api/archive/export", get(export_archive))
        .route("/api/archive/data", delete(delete_archive_data))
}

/// Large-upload route: merged separately in `create_app` so it gets the
/// multi-gigabyte body cap instead of the normal 10 MiB one.
pub fn archive_import_router() -> Router<AppState> {
    Router::new().route("/api/archive/import", post(import_archive))
}

pub fn collections_router() -> Router<AppState> {
    Router::new()
        .route("/api/collections", get(list_collections).post(create_collection))
        .route("/api/collections/reorder", post(reorder_collections))
        .route(
            "/api/collections/{id}",
            put(rename_collection).delete(delete_collection),
        )
}

pub fn operations_router() -> Router<AppState> {
    Router::new().route("/api/operations/status", get(operation_status))
}
