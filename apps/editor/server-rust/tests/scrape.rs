use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use tower::ServiceExt;

use editor_server_rust::{create_app, db, AppState, DbPool};

// Port of the server half of `server-node/src/scrape.test.js`: only paths
// that answer before any browser is touched (no live browser here either).
fn test_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().expect("tempdir");
    let pool: DbPool = db::open_pool(&dir.path().join("banknotes.db")).expect("pool opens");
    let state = AppState::test(pool, dir.path().to_path_buf());
    (dir, state)
}

async fn post_preview(app: Router, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
    let request = Request::builder()
        .method("POST")
        .uri("/api/scrape/preview")
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&body).expect("body serializes"),
        ))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let raw = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads");
    let parsed: serde_json::Value = serde_json::from_slice(&raw).expect("body is JSON");
    (status, parsed)
}

#[tokio::test]
async fn preview_without_url_answers_400() {
    let (_dir, state) = test_state();
    let (status, body) = post_preview(create_app(state), serde_json::json!({ "url": "   " })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body["error"]
            .as_str()
            .unwrap_or("")
            .contains("A URL is required."),
        "unexpected body: {body}"
    );
}

#[tokio::test]
async fn preview_for_unsupported_site_answers_400_without_touching_browser() {
    let (_dir, state) = test_state();
    let (status, body) = post_preview(
        create_app(state),
        serde_json::json!({ "url": "https://example.com/cert/1" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body["error"]
            .as_str()
            .unwrap_or("")
            .contains("No scraper is implemented"),
        "unexpected body: {body}"
    );
}
