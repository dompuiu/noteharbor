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
