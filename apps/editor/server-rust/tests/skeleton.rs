use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use editor_server_rust::{AppState, create_app};

fn live_state() -> AppState {
    AppState {
        static_root: None,
        db_available: Arc::new(AtomicBool::new(true)),
    }
}

fn down_state() -> AppState {
    AppState {
        static_root: None,
        db_available: Arc::new(AtomicBool::new(false)),
    }
}

async fn get(app: Router, path: &str) -> (StatusCode, serde_json::Value, Option<String>) {
    let request = Request::builder()
        .uri(path)
        .body(Body::from(()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|value| value.to_str().expect("content-type is ascii").to_owned());
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads");
    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("body is JSON");
    (status, json, content_type)
}

#[tokio::test]
async fn health_reports_ok_when_database_answers() {
    let (status, body, content_type) = get(create_app(live_state()), "/api/health").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({ "ok": true }));
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("application/json"),
        "unexpected content-type: {content_type:?}"
    );
}

#[tokio::test]
async fn health_reports_unavailable_when_database_is_down() {
    let (status, body, _) = get(create_app(down_state()), "/api/health").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, serde_json::json!({ "ok": false }));
}

#[tokio::test]
async fn health_reflects_later_database_state() {
    let flag = Arc::new(AtomicBool::new(true));
    let state = AppState {
        static_root: None,
        db_available: Arc::clone(&flag),
    };
    let app = create_app(state);

    let (before, _, _) = get(app.clone(), "/api/health").await;
    flag.store(false, Ordering::SeqCst);
    let (after, body, _) = get(app, "/api/health").await;

    assert_eq!(before, StatusCode::OK);
    assert_eq!(after, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, serde_json::json!({ "ok": false }));
}

async fn raw(app: Router, method: &str, path: &str) -> (StatusCode, Vec<u8>, Option<String>) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .body(Body::from(()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|value| value.to_str().expect("content-type is ascii").to_owned());
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads");
    (status, bytes.to_vec(), content_type)
}

fn json_body(bytes: &[u8]) -> serde_json::Value {
    serde_json::from_slice(bytes).expect("body is JSON")
}

#[tokio::test]
async fn unknown_api_route_answers_json_404() {
    for method in ["GET", "POST", "PUT", "DELETE"] {
        let (status, bytes, content_type) =
            raw(create_app(live_state()), method, "/api/no-such-thing").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "method {method}");
        assert_eq!(json_body(&bytes), serde_json::json!({ "error": "Not found." }));
        assert!(
            content_type.as_deref().unwrap_or("").starts_with("application/json"),
            "unexpected content-type: {content_type:?}"
        );
    }
}

#[tokio::test]
async fn bare_api_prefix_answers_json_404() {
    let (status, bytes, _) = raw(create_app(live_state()), "GET", "/api").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json_body(&bytes), serde_json::json!({ "error": "Not found." }));
}

/// A near-`/api` prefix must NOT be swallowed by the API 404: like
/// `/apiary-trails` in `spaFallback.test.js`, it is an SPA route.
#[tokio::test]
async fn api_like_prefix_is_an_spa_route() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("index.html"), "<p>spa</p>").expect("write entry");
    let state = AppState {
        static_root: Some(dir.path().canonicalize().expect("canonical")),
        db_available: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
    };

    let (status, bytes, content_type) =
        raw(create_app(state), "GET", "/apiary-trails").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, b"<p>spa</p>");
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("text/html"),
        "unexpected content-type: {content_type:?}"
    );
}

fn serving_state(dir: &tempfile::TempDir) -> AppState {
    AppState {
        static_root: Some(dir.path().canonicalize().expect("canonical")),
        db_available: Arc::new(AtomicBool::new(true)),
    }
}

#[tokio::test]
async fn spa_entry_serves_at_root_and_deep_routes() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("index.html"), "<p>spa</p>").expect("write entry");
    std::fs::write(dir.path().join("app.js"), "console.log(1)").expect("write asset");

    for path in ["/", "/collections/1", "/showcases/abc/notes"] {
        let (status, bytes, content_type) =
            raw(create_app(serving_state(&dir)), "GET", path).await;
        assert_eq!(status, StatusCode::OK, "path {path}");
        assert_eq!(bytes, b"<p>spa</p>");
        assert!(
            content_type.as_deref().unwrap_or("").starts_with("text/html"),
            "unexpected content-type: {content_type:?}"
        );
    }

    let (status, bytes, content_type) =
        raw(create_app(serving_state(&dir)), "GET", "/app.js").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, b"console.log(1)");
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("text/javascript")
            || content_type.as_deref().unwrap_or("").starts_with("application/javascript"),
        "unexpected content-type: {content_type:?}"
    );
}

#[tokio::test]
async fn missing_spa_entry_answers_json_not_html() {
    let dir = tempfile::tempdir().expect("tempdir");

    let (status, bytes, content_type) =
        raw(create_app(serving_state(&dir)), "GET", "/collections").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json_body(&bytes), serde_json::json!({ "error": "Not found." }));
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("application/json"),
        "unexpected content-type: {content_type:?}"
    );
}

#[tokio::test]
async fn static_serving_disabled_answers_json_404() {
    let (status, bytes, _) = raw(create_app(live_state()), "GET", "/collections").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json_body(&bytes), serde_json::json!({ "error": "Not found." }));
}

#[tokio::test]
async fn request_path_cannot_escape_static_root() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("index.html"), "<p>spa</p>").expect("write entry");
    let outside = dir.path().join("secret.txt");
    std::fs::write(&outside, "secret").expect("write outside file");

    let (status, bytes, _) =
        raw(create_app(serving_state(&dir)), "GET", "/../secret.txt").await;
    // Never serve the outside file: fall back to the SPA entry or 404.
    assert_ne!(bytes, b"secret");
    assert!(status == StatusCode::OK || status == StatusCode::NOT_FOUND);
}
