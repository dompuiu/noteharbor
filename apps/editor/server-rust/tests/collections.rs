use std::sync::{
    Arc,
    atomic::AtomicBool,
};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use tower::ServiceExt;

use editor_server_rust::{
    AppState, DbPool, create_app,
    db::{self},
};

fn test_state(db_path: &std::path::Path) -> AppState {
    let pool: DbPool = db::open_pool(db_path).expect("pool opens");
    AppState::test(pool, std::path::PathBuf::from("/nonexistent-data"))
}

fn fresh_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("banknotes.db");
    let state = test_state(&db_path);
    (dir, state)
}

async fn call(
    app: Router,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> (StatusCode, serde_json::Value) {
    let body_bytes = body.map(|value| serde_json::to_vec(&value).expect("body serializes"));
    let mut builder = Request::builder().method(method).uri(path);
    if body_bytes.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let request = builder
        .body(Body::from(body_bytes.unwrap_or_default()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let raw = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads");
    let parsed: serde_json::Value = serde_json::from_slice(&raw).expect("body is JSON");
    (status, parsed)
}

fn article_names(body: &serde_json::Value) -> Vec<String> {
    body["collections"]
        .as_array()
        .expect("collections array")
        .iter()
        .map(|collection| collection["name"].as_str().expect("name").to_owned())
        .collect()
}

#[tokio::test]
async fn collections_list_starts_empty() {
    let (_dir, state) = fresh_state();

    let (status, body) = call(create_app(state), "GET", "/api/collections", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "collections": [] }));
}

#[tokio::test]
async fn collections_create_assigns_unique_defaults_and_shape() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    for (want, payload) in [
        ("Collection", json!({})),
        ("Collection 2", json!({ "name": "" })),
        ("Collection 3", json!({ "name": "   " })),
    ] {
        let (status, body) = call(app.clone(), "POST", "/api/collections", Some(payload)).await;
        assert_eq!(status, StatusCode::CREATED);
        let collection = &body["collection"];
        assert_eq!(collection["name"], json!(want));
        assert!(collection["id"].is_number());
        assert!(collection["display_order"].is_number());
        assert!(collection["created_at"].is_string());
        assert!(collection["updated_at"].is_string());
        assert_eq!(collection["note_count"], json!(0));
        assert!(collection.get("is_default").is_none());
    }
}

#[tokio::test]
async fn collections_create_rejects_case_insensitive_duplicates() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    let (created, _) = call(app.clone(), "POST", "/api/collections", Some(json!({ "name": "Denver" }))).await;
    assert_eq!(created, StatusCode::CREATED);

    for payload in [json!({ "name": "Denver" }), json!({ "name": "  dEnVeR  " })] {
        let (status, body) = call(app.clone(), "POST", "/api/collections", Some(payload)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "error": "A collection with this name already exists." }));
    }
}

#[tokio::test]
async fn collections_reorder_needs_full_permutation() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    for name in ["R One", "R Two", "R Three"] {
        let _ = call(app.clone(), "POST", "/api/collections", Some(json!({ "name": name }))).await;
    }
    let (_, listed) = call(app.clone(), "GET", "/api/collections", None).await;
    let ids: Vec<i64> = listed["collections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|collection| collection["id"].as_i64().unwrap())
        .collect();

    let (status, body) = call(
        app.clone(),
        "POST",
        "/api/collections/reorder",
        Some(json!({ "ids": "nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "A full ordered list of collection IDs is required." }));

    let mut dup = ids.clone();
    dup.push(ids[0]);
    for bad in [vec![ids[0]], vec![], dup, vec![ids[0], ids[0], ids[2]]] {
        let (status, body) = call(
            app.clone(),
            "POST",
            "/api/collections/reorder",
            Some(json!({ "ids": bad })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "error": "Reorder request must include every collection exactly once." }));
    }

    let reversed: Vec<i64> = ids.iter().rev().cloned().collect();
    let (status, body) = call(
        app.clone(),
        "POST",
        "/api/collections/reorder",
        Some(json!({ "ids": reversed })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let got: Vec<i64> = body["collections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|collection| collection["id"].as_i64().unwrap())
        .collect();
    assert_eq!(got, reversed);

    // Manual order is stable: listing follows the reorder, not insertion.
    let (_, relisted) = call(app.clone(), "GET", "/api/collections", None).await;
    assert_eq!(article_names(&relisted), article_names(&body));
}

#[tokio::test]
async fn collections_rename_validates_id_existence_and_name() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    let (_, created) = call(app.clone(), "POST", "/api/collections", Some(json!({ "name": "Original" }))).await;
    let id = created["collection"]["id"].as_i64().unwrap();
    let _ = call(app.clone(), "POST", "/api/collections", Some(json!({ "name": "Taken" }))).await;

    for bad in ["abc", "0", "-3", "2.5"] {
        let (status, body) =
            call(app.clone(), "PUT", &format!("/api/collections/{bad}"), Some(json!({ "name": "X" }))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "id {bad}");
        assert_eq!(body, json!({ "error": "A valid collection ID is required." }));
    }

    let (status, body) =
        call(app.clone(), "PUT", "/api/collections/999999", Some(json!({ "name": "X" }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Collection not found." }));

    let (status, body) =
        call(app.clone(), "PUT", &format!("/api/collections/{id}"), Some(json!({ "name": "  " }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "Collection name is required." }));

    let (status, body) =
        call(app.clone(), "PUT", &format!("/api/collections/{id}"), Some(json!({ "name": "taken" }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "A collection with this name already exists." }));

    let (status, body) =
        call(app.clone(), "PUT", &format!("/api/collections/{id}"), Some(json!({ "name": "Renamed" }))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["collection"]["name"], json!("Renamed"));
}

#[tokio::test]
async fn collections_delete_validates_and_removes() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    let (_, created) = call(app.clone(), "POST", "/api/collections", Some(json!({ "name": "Gone" }))).await;
    let id = created["collection"]["id"].as_i64().unwrap();

    let (status, body) =
        call(app.clone(), "DELETE", "/api/collections/abc", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "A valid collection ID is required." }));

    let (status, body) =
        call(app.clone(), "DELETE", "/api/collections/999999", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Collection not found." }));

    let (status, body) =
        call(app.clone(), "DELETE", &format!("/api/collections/{id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));

    let (_, listed) = call(app.clone(), "GET", "/api/collections", None).await;
    assert!(listed["collections"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn collections_list_reports_note_counts() {
    let (dir, state) = fresh_state();
    let pool = state.pool.clone();
    let app = create_app(state);

    let (_, a) = call(app.clone(), "POST", "/api/collections", Some(json!({ "name": "Counts A" }))).await;
    let (_, b) = call(app.clone(), "POST", "/api/collections", Some(json!({ "name": "Counts B" }))).await;
    let aid = a["collection"]["id"].as_i64().unwrap();
    let bid = b["collection"]["id"].as_i64().unwrap();

    tokio::task::spawn_blocking(move || {
        let conn = pool.get().expect("conn");
        for collection_id in [aid, aid, bid] {
            conn.execute(
                "INSERT INTO banknotes (collection_id, denomination) VALUES (?1, 'x')",
                [collection_id],
            )
            .expect("insert note");
        }
    })
    .await
    .expect("join");

    let (status, listed) = call(app.clone(), "GET", "/api/collections", None).await;
    assert_eq!(status, StatusCode::OK);
    let counts: std::collections::HashMap<i64, i64> = listed["collections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|collection| {
            (
                collection["id"].as_i64().unwrap(),
                collection["note_count"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(counts.get(&aid), Some(&2));
    assert_eq!(counts.get(&bid), Some(&1));
    let _ = dir;
}

#[tokio::test]
async fn legacy_collections_gain_display_order_and_lose_default_flag() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("banknotes.db");

    {
        let conn = rusqlite::Connection::open(&db_path).expect("legacy open");
        conn.execute_batch(
            "CREATE TABLE collections (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL,
               is_default INTEGER NOT NULL DEFAULT 0,
               created_at TEXT DEFAULT (datetime('now')),
               updated_at TEXT DEFAULT (datetime('now'))
             );
             INSERT INTO collections (id, name, is_default) VALUES (10, 'Old B', 0);
             INSERT INTO collections (id, name, is_default) VALUES (11, 'Old A', 1);
             INSERT INTO collections (id, name, is_default) VALUES (12, 'Old C', 0);",
        )
        .expect("legacy seed");
    }

    let state = test_state(&db_path);
    let (status, listed) = call(create_app(state), "GET", "/api/collections", None).await;
    assert_eq!(status, StatusCode::OK);
    let names: Vec<String> = listed["collections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|collection| collection["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, vec!["Old B", "Old A", "Old C"]);
    for collection in listed["collections"].as_array().unwrap() {
        assert!(collection.get("is_default").is_none());
        assert!(collection["display_order"].is_number());
    }
}

#[tokio::test]
async fn operations_status_reports_idle() {
    let (_dir, state) = fresh_state();

    let (status, body) = call(create_app(state), "GET", "/api/operations/status", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "currentOperation": "idle",
            "isBusy": false,
            "startedAt": null,
            "details": null,
        })
    );
}

#[tokio::test]
async fn health_answers_through_a_real_pool() {
    let (_dir, state) = fresh_state();
    let live = Arc::new(AtomicBool::new(true));
    let state = AppState {
        db_available: live,
        ..state
    };

    let (status, body) = call(create_app(state), "GET", "/api/health", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "ok": true }));
}
