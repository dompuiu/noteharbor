//! HTTP handlers. Route-level catch semantics mirror the Express routers
//! exactly: collections POST/PUT/DELETE answer any database failure as 400
//! with the message (the `catch` in `routes/collections.js` runs before the
//! 503 middleware), while uncaught paths propagate `AppError` (503/500).

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    db::{self},
    js_number, js_string,
};

fn ok(body: Value) -> Response {
    (StatusCode::OK, Json(body)).into_response()
}

fn created(body: Value) -> Response {
    (StatusCode::CREATED, Json(body)).into_response()
}

fn bad_request(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": message }))).into_response()
}

fn not_found(message: &str) -> Response {
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
