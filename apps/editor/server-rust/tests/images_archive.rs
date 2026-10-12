use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use editor_server_rust::{AppState, DbPool, create_app, db};

fn state_with_images() -> (tempfile::TempDir, AppState, Vec<u8>) {
    let dir = tempfile::tempdir().expect("tempdir");
    let pool = db::open_pool(&dir.path().join("banknotes.db")).expect("pool opens");
    let state = AppState::test(pool, dir.path().to_path_buf());
    let bytes = vec![0x89, b'P', b'N', b'G', 1, 2, 3];
    let note_dir = dir.path().join("images").join("notes").join("1");
    std::fs::create_dir_all(&note_dir).expect("note images dir");
    std::fs::write(note_dir.join("front-full.jpg"), &bytes).expect("write image");
    (dir, state, bytes)
}

async fn raw(app: Router, path: &str) -> (StatusCode, Vec<u8>, Option<String>) {
    let request = Request::builder()
        .uri(path)
        .body(Body::from(()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|value| value.to_str().expect("ascii").to_owned());
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads");
    (status, bytes.to_vec(), content_type)
}

#[tokio::test]
async fn images_serve_managed_files_with_mime() {
    let (_dir, state, bytes) = state_with_images();
    let (status, body, content_type) =
        raw(create_app(state), "/api/images/notes/1/front-full.jpg").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, bytes);
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("image/jpeg"),
        "unexpected content-type: {content_type:?}"
    );
}

#[tokio::test]
async fn images_missing_file_answers_json_404() {
    let (_dir, state, _) = state_with_images();
    let (status, body, content_type) =
        raw(create_app(state), "/api/images/notes/1/no-such-file.jpg").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).expect("body is JSON"),
        serde_json::json!({ "error": "Not found." })
    );
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("application/json"),
        "unexpected content-type: {content_type:?}"
    );
}

#[tokio::test]
async fn images_path_cannot_escape_images_root() {
    let (dir, state, _) = state_with_images();
    std::fs::write(dir.path().join("secret.txt"), "secret").expect("write outside file");
    let (status, body, _) =
        raw(create_app(state), "/api/images/../secret.txt").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_ne!(body, b"secret");
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

fn archive_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().expect("tempdir");
    let pool: DbPool = db::open_pool(&dir.path().join("banknotes.db")).expect("pool opens");
    let state = AppState::test(pool, dir.path().to_path_buf());
    (dir, state)
}

async fn send(app: Router, request: Request<Body>) -> axum::response::Response {
    app.oneshot(request).await.expect("service answers")
}

async fn response_parts(
    response: axum::response::Response,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads")
        .to_vec();
    (status, headers, bytes)
}

fn decode_header(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).expect("utf8")
}

fn omitted_names(headers: &axum::http::HeaderMap) -> Vec<String> {
    let raw = headers
        .get("x-noteharbor-omitted-showcases")
        .expect("omitted header")
        .to_str()
        .expect("ascii");
    serde_json::from_str(&decode_header(raw)).expect("names json")
}

fn zip_names(bytes: &[u8]) -> Vec<String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("valid zip");
    (0..archive.len())
        .map(|index| archive.by_index(index).expect("entry").name().to_owned())
        .collect()
}

/// Seeds two collections (`Keep`/`Drop`), one note in each, and one showcase
/// (`Outside Show`) reaching the dropped note. Returns
/// (keep_id, drop_id, showcase_id).
async fn seed_showcase_fixture(pool: &DbPool) -> (i64, i64, i64) {
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().expect("conn");
        conn.execute(
            "INSERT INTO collections (name, display_order) VALUES ('Keep', 1), ('Drop', 2)",
            [],
        )
        .expect("collections");
        let keep: i64 = conn
            .query_row("SELECT id FROM collections WHERE name = 'Keep'", [], |row| row.get(0))
            .expect("keep id");
        let drop_id: i64 = conn
            .query_row("SELECT id FROM collections WHERE name = 'Drop'", [], |row| row.get(0))
            .expect("drop id");
        conn.execute(
            "INSERT INTO banknotes (collection_id, display_order, denomination, images)
             VALUES (?1, 1, 'Kept Note', '[]'), (?2, 1, 'Dropped Note', '[]')",
            [keep, drop_id],
        )
        .expect("notes");
        let kept_note: i64 = conn
            .query_row(
                "SELECT id FROM banknotes WHERE denomination = 'Kept Note'",
                [],
                |row| row.get(0),
            )
            .expect("kept note");
        let dropped_note: i64 = conn
            .query_row(
                "SELECT id FROM banknotes WHERE denomination = 'Dropped Note'",
                [],
                |row| row.get(0),
            )
            .expect("dropped note");
        conn.execute("INSERT INTO categories (name) VALUES ('Shared Label')", [])
            .expect("label");
        conn.execute("INSERT INTO showcases (name, display_order) VALUES ('Outside Show', 1)", [])
            .expect("showcase");
        let showcase: i64 = conn
            .query_row("SELECT id FROM showcases WHERE name = 'Outside Show'", [], |row| {
                row.get(0)
            })
            .expect("showcase id");
        conn.execute(
            "INSERT INTO showcase_nodes
               (showcase_id, parent_node_id, node_type, category_id, name, note_id, position)
             VALUES (?1, NULL, 'category', 1, NULL, NULL, 1)",
            [showcase],
        )
        .expect("category node");
        let parent: i64 = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO showcase_nodes
               (showcase_id, parent_node_id, node_type, name, note_id, position)
             VALUES (?1, ?2, 'note', NULL, ?3, 1)",
            rusqlite_params(showcase, parent, dropped_note),
        )
        .expect("note node");
        let _ = kept_note;
        (keep, drop_id, showcase)
    })
    .await
    .expect("join")
}

fn rusqlite_params(a: i64, b: i64, c: i64) -> [i64; 3] {
    [a, b, c]
}

fn multipart_body(boundary: &str, parts: Vec<(&str, Option<&str>, &[u8], &str)>) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, filename, bytes, content_type) in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        if let Some(filename) = filename {
            body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n"
                )
                .as_bytes(),
            );
        } else {
            body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n").as_bytes(),
            );
        }
        body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

#[tokio::test]
async fn export_empty_library_downloads_zip_with_no_omissions() {
    let (_dir, state) = archive_state();
    let request = Request::builder()
        .uri("/api/archive/export")
        .body(Body::from(()))
        .expect("request builds");
    let (status, headers, bytes) = response_parts(send(create_app(state), request).await).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers.get("content-type").expect("content-type").to_str().expect("ascii"),
        "application/zip"
    );
    let disposition = headers
        .get("content-disposition")
        .expect("disposition")
        .to_str()
        .expect("ascii");
    assert!(disposition.starts_with("attachment; filename=\"noteharbor-archive-"), "{disposition}");
    assert!(disposition.ends_with(".zip\""), "{disposition}");
    assert_eq!(omitted_names(&headers), Vec::<String>::new());
    let names = zip_names(&bytes);
    assert!(names.contains(&"banknotes.db".to_owned()), "{names:?}");
}

#[tokio::test]
async fn export_filtered_reports_stranded_showcase() {
    let (_dir, state) = archive_state();
    let (keep, _drop, _showcase) = seed_showcase_fixture(&state.pool).await;

    let request = Request::builder()
        .uri(format!("/api/archive/export?collectionIds={keep}"))
        .body(Body::from(()))
        .expect("request builds");
    let (status, headers, bytes) = response_parts(send(create_app(state), request).await).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(omitted_names(&headers), vec!["Outside Show".to_owned()]);
    let names = zip_names(&bytes);
    assert!(names.contains(&"banknotes.db".to_owned()), "{names:?}");
}

#[tokio::test]
async fn export_blocked_showcase_selection_answers_400() {
    let (_dir, state) = archive_state();
    let (keep, _drop, showcase) = seed_showcase_fixture(&state.pool).await;

    let request = Request::builder()
        .uri(format!("/api/archive/export?collectionIds={keep}&showcaseIds={showcase}"))
        .body(Body::from(()))
        .expect("request builds");
    let (status, _headers, bytes) = response_parts(send(create_app(state), request).await).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("body is JSON");
    assert!(
        body["error"].as_str().unwrap_or("").contains("Outside Show"),
        "{body:?}"
    );
}

#[tokio::test]
async fn export_empty_selection_answers_400() {
    let (_dir, state) = archive_state();
    let request = Request::builder()
        .uri("/api/archive/export?collectionIds=999999")
        .body(Body::from(()))
        .expect("request builds");
    let (status, _headers, bytes) = response_parts(send(create_app(state), request).await).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("body is JSON");
    assert_eq!(body, serde_json::json!({ "error": "Choose at least one valid collection to export." }));
}

#[tokio::test]
async fn export_conflicts_while_busy() {
    let (_dir, state) = archive_state();
    state
        .ops
        .lock()
        .expect("lock")
        .begin("importing_archive", None)
        .expect("begin");

    let request = Request::builder()
        .uri("/api/archive/export")
        .body(Body::from(()))
        .expect("request builds");
    let (status, _headers, bytes) = response_parts(send(create_app(state), request).await).await;

    assert_eq!(status, StatusCode::CONFLICT);
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("body is JSON");
    assert_eq!(
        body,
        serde_json::json!({
            "error": "This action is unavailable while importing archive is in progress.",
            "currentOperation": "importing_archive",
        })
    );
}

#[tokio::test]
async fn import_requires_a_file_even_when_idle() {
    let (_dir, state) = archive_state();
    let boundary = "testboundary";
    let body = multipart_body(boundary, vec![("mode", None, b"replace", "text/plain")]);
    let request = Request::builder()
        .method("POST")
        .uri("/api/archive/import")
        .header("content-type", format!("multipart/form-data; boundary={boundary}"))
        .body(Body::from(body))
        .expect("request builds");
    let (status, _headers, bytes) = response_parts(send(create_app(state), request).await).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    let parsed: serde_json::Value = serde_json::from_slice(&bytes).expect("body is JSON");
    assert_eq!(parsed, serde_json::json!({ "error": "Archive file is required." }));
}

#[tokio::test]
async fn import_round_trip_replace_restores_collections() {
    let (_dir, state) = archive_state();
    let pool = state.pool.clone();

    // Seed one collection with a note carrying a managed image file.
    let note_id: i64 = tokio::task::spawn_blocking(move || {
        let conn = pool.get().expect("conn");
        conn.execute(
            "INSERT INTO collections (name, display_order) VALUES ('Round Trip', 1)",
            [],
        )
        .expect("collection");
        let collection: i64 = conn
            .query_row("SELECT id FROM collections WHERE name = 'Round Trip'", [], |row| {
                row.get(0)
            })
            .expect("collection id");
        conn.execute(
            "INSERT INTO banknotes (collection_id, display_order, denomination, images)
             VALUES (?1, 1, 'Kept', '[]')",
            [collection],
        )
        .expect("note");
        conn.query_row("SELECT id FROM banknotes WHERE denomination = 'Kept'", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("note id")
    })
    .await
    .expect("join");

    let data_dir = _dir.path().to_path_buf();
    let note_images = data_dir.join("images").join("notes").join(note_id.to_string());
    std::fs::create_dir_all(&note_images).expect("note dir");
    std::fs::write(note_images.join("front-full.jpg"), b"full-bytes").expect("image");
    let images_json = serde_json::json!([
        { "type": "front", "variant": "full", "localPath": format!("/api/images/notes/{note_id}/front-full.jpg"), "origin": "uploaded" }
    ])
    .to_string();
    let pool = state.pool.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().expect("conn");
        conn.execute("UPDATE banknotes SET images = ?1", [images_json]).expect("images");
    })
    .await
    .expect("join");

    // Export, wipe, then re-import the same bytes in replace mode.
    let export = Request::builder()
        .uri("/api/archive/export")
        .body(Body::from(()))
        .expect("request builds");
    let (status, _, zip_bytes) = response_parts(send(create_app(state.clone()), export).await).await;
    assert_eq!(status, StatusCode::OK);

    let delete = Request::builder()
        .method("DELETE")
        .uri("/api/archive/data")
        .body(Body::from(()))
        .expect("request builds");
    let (status, _, bytes) = response_parts(send(create_app(state.clone()), delete).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).expect("json"),
        serde_json::json!({ "success": true, "currentOperation": "idle" })
    );

    let boundary = "roundtripboundary";
    let body = multipart_body(
        boundary,
        vec![("file", Some("noteharbor-archive.zip"), &zip_bytes, "application/zip")],
    );
    let import = Request::builder()
        .method("POST")
        .uri("/api/archive/import?mode=replace")
        .header("content-type", format!("multipart/form-data; boundary={boundary}"))
        .body(Body::from(body))
        .expect("request builds");
    let (status, _, bytes) = response_parts(send(create_app(state.clone()), import).await).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&bytes));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).expect("json"),
        serde_json::json!({ "success": true, "mode": "replace", "currentOperation": "idle" })
    );

    // The collection, note, image record, and image file all survived.
    let pool = state.pool.clone();
    let (names, images): (Vec<String>, String) = tokio::task::spawn_blocking(move || {
        let conn = pool.get().expect("conn");
        let mut stmt = conn.prepare("SELECT name FROM collections ORDER BY id").expect("stmt");
        let names = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .expect("rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect");
        let images: String = conn
            .query_row("SELECT images FROM banknotes", [], |row| row.get(0))
            .expect("images");
        (names, images)
    })
    .await
    .expect("join");
    assert_eq!(names, vec!["Round Trip".to_owned()]);
    assert!(images.contains("front-full.jpg"), "{images}");
    assert!(
        data_dir.join("images").join("notes").join(note_id.to_string()).join("front-full.jpg").is_file()
            || data_dir.join("images").join("notes").join("1").join("front-full.jpg").is_file()
    );
}

#[tokio::test]
async fn delete_data_empties_the_workspace() {
    let (_dir, state) = archive_state();
    let pool = state.pool.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().expect("conn");
        conn.execute("INSERT INTO collections (name, display_order) VALUES ('Gone', 1)", [])
            .expect("insert");
    })
    .await
    .expect("join");

    let request = Request::builder()
        .method("DELETE")
        .uri("/api/archive/data")
        .body(Body::from(()))
        .expect("request builds");
    let (status, _, bytes) = response_parts(send(create_app(state.clone()), request).await).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).expect("json"),
        serde_json::json!({ "success": true, "currentOperation": "idle" })
    );

    let get = Request::builder()
        .uri("/api/collections")
        .body(Body::from(()))
        .expect("request builds");
    let response = send(create_app(state), get).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.expect("body");
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).expect("json"),
        serde_json::json!({ "collections": [] })
    );
}
