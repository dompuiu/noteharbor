//! Ticket 09 parity: HTTP-level port of `notes.test.js`, `tags.test.js` and
//! the `move.test.js` scenarios (via the move route), plus multipart
//! upload/flag coverage from `routes/notes.js`.

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;

use editor_server_rust::{AppState, DbPool, create_app, db};

fn fresh_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().expect("tempdir");
    let pool: DbPool = db::open_pool(&dir.path().join("banknotes.db")).expect("pool opens");
    let state = AppState::test(pool, dir.path().to_path_buf());
    (dir, state)
}

async fn call(app: Router, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let bytes = body.map(|value| serde_json::to_vec(&value).expect("body serializes"));
    let mut builder = Request::builder().method(method).uri(path);
    if bytes.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let request =
        builder.body(Body::from(bytes.unwrap_or_default())).expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let raw = axum::body::to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    let parsed: Value = serde_json::from_slice(&raw).expect("body is JSON");
    (status, parsed)
}

async fn call_multipart(app: Router, method: &str, path: &str, body: Vec<u8>, boundary: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", format!("multipart/form-data; boundary={boundary}"))
        .body(Body::from(body))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let raw = axum::body::to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    let parsed: Value = serde_json::from_slice(&raw).expect("body is JSON");
    (status, parsed)
}

fn multipart_body(boundary: &str, parts: Vec<(&str, Option<&str>, &[u8], &str)>) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, filename, bytes, content_type) in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        if let Some(filename) = filename {
            body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n")
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

fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_pixel(width, height, image::Rgb([200, 100, 50]));
    let mut out = Vec::new();
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("encode");
    out
}

async fn create_collection(app: Router, name: &str) -> Value {
    let (status, body) =
        call(app, "POST", "/api/collections", Some(json!({ "name": name }))).await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["collection"].clone()
}

fn note_payload(denomination: &str) -> Value {
    json!({
        "denomination": denomination,
        "issue_date": "",
        "catalog_number": "",
        "grading_company": "",
        "grade": "",
        "watermark": "",
        "serial": "",
        "url": "",
        "notes": "",
        "tags": [],
        "scraped_data": null,
    })
}

async fn create_note(app: Router, collection_id: i64, overrides: Value) -> Value {
    let mut payload = note_payload("5 Lei");
    for (key, value) in overrides.as_object().expect("overrides object") {
        payload[key] = value.clone();
    }
    let (status, body) =
        call(app, "POST", &format!("/api/collections/{collection_id}/notes"), Some(payload)).await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["note"].clone()
}

// --- notes.test.js ----------------------------------------------------------

#[tokio::test]
async fn note_created_is_retrievable_with_tags() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Retrieve").await;
    let id = collection["id"].as_i64().unwrap();

    let created = create_note(app.clone(), id, json!({ "denomination": "5 Lei", "tags": ["paper", "old"] })).await;
    assert_eq!(created["denomination"], json!("5 Lei"));

    let (status, body) =
        call(app.clone(), "GET", &format!("/api/collections/{id}/notes/{}", created["id"]), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["note"]["denomination"], json!("5 Lei"));
    let mut tags: Vec<String> = body["note"]["tags"]
        .as_array().unwrap().iter().map(|tag| tag["name"].as_str().unwrap().to_owned()).collect();
    tags.sort();
    assert_eq!(tags, vec!["old", "paper"]);
}

#[tokio::test]
async fn note_create_without_denomination_is_rejected() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Required").await;
    let id = collection["id"].as_i64().unwrap();

    let (status, body) = call(
        app, "POST", &format!("/api/collections/{id}/notes"),
        Some(json!({ "denomination": "   " })),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("Denomination is required"), "{body:?}");
}

#[tokio::test]
async fn note_create_with_unparsable_scraped_data_is_rejected() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Scraped").await;
    let id = collection["id"].as_i64().unwrap();

    let (status, body) = call(
        app, "POST", &format!("/api/collections/{id}/notes"),
        Some(json!({ "denomination": "5 Lei", "scraped_data": "{oops" })),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("Invalid scraped_data payload"), "{body:?}");
}

#[tokio::test]
async fn note_read_unknown_answers_404() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Missing").await;
    let id = collection["id"].as_i64().unwrap();

    let (status, _) =
        call(app.clone(), "GET", &format!("/api/collections/{id}/notes/999999"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    for bad_id in ["abc", "2.5", "0", "-3"] {
        let (status, body) = call(
            app.clone(), "GET", &format!("/api/collections/{id}/notes/{bad_id}"), None,
        ).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "id {bad_id}");
        assert_eq!(body, json!({ "error": "Note not found." }));
    }
}

#[tokio::test]
async fn notes_invalid_collection_is_400_and_unknown_is_404() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    let (status, body) = call(app.clone(), "GET", "/api/collections/nope/notes", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "A valid collection ID is required." }));

    let (status, body) = call(app.clone(), "GET", "/api/collections/999999/notes", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Collection not found." }));
}

#[tokio::test]
async fn note_update_persists_through_reread() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Update").await;
    let id = collection["id"].as_i64().unwrap();
    let created = create_note(app.clone(), id, json!({ "denomination": "1 Leu", "notes": "before" })).await;
    let note_id = created["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(), "PUT", &format!("/api/collections/{id}/notes/{note_id}"),
        Some(json!({ "denomination": "10 Lei", "notes": "after", "tags": [] })),
    ).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["note"]["denomination"], json!("10 Lei"));

    let (_, reread) =
        call(app, "GET", &format!("/api/collections/{id}/notes/{note_id}"), None).await;
    assert_eq!(reread["note"]["notes"], json!("after"));
}

#[tokio::test]
async fn note_update_unknown_answers_404() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Update Missing").await;
    let id = collection["id"].as_i64().unwrap();

    let (status, _) = call(
        app, "PUT", &format!("/api/collections/{id}/notes/999999"),
        Some(json!({ "denomination": "10 Lei" })),
    ).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn note_delete_stays_deleted_and_compacts_order() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Delete").await;
    let id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), id, json!({ "denomination": "1 Leu" })).await;
    let second = create_note(app.clone(), id, json!({ "denomination": "2 Lei" })).await;

    let (status, body) = call(
        app.clone(), "DELETE",
        &format!("/api/collections/{id}/notes/{}", first["id"]), None,
    ).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));

    let (status, _) = call(
        app.clone(), "GET",
        &format!("/api/collections/{id}/notes/{}", first["id"]), None,
    ).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, listed) = call(app, "GET", &format!("/api/collections/{id}/notes"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed["notes"].as_array().unwrap().len(), 1);
    assert_eq!(listed["notes"][0]["id"], second["id"]);
    assert_eq!(listed["notes"][0]["display_order"], json!(1));
}

#[tokio::test]
async fn notes_reorder_persists_and_rejects_partial() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Reorder").await;
    let id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), id, json!({ "denomination": "1 Leu" })).await;
    let second = create_note(app.clone(), id, json!({ "denomination": "2 Lei" })).await;

    let (status, body) = call(
        app.clone(), "POST", &format!("/api/collections/{id}/notes/reorder"),
        Some(json!({ "ids": [second["id"], first["id"]] })),
    ).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["notes"][0]["id"], second["id"]);
    assert_eq!(body["notes"][1]["id"], first["id"]);

    let (status, body) = call(
        app.clone(), "POST", &format!("/api/collections/{id}/notes/reorder"),
        Some(json!({ "ids": [first["id"]] })),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "Reorder request must include every note exactly once." }));

    let (status, body) = call(
        app.clone(), "POST", &format!("/api/collections/{id}/notes/reorder"),
        Some(json!({ "ids": "nope" })),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "A full ordered list of note IDs is required." }));
}

#[tokio::test]
async fn notes_move_validates_target_and_position_first() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Notes Move From").await;
    let id = collection["id"].as_i64().unwrap();
    let created = create_note(app.clone(), id, json!({})).await;
    let note_id = created["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(), "POST", &format!("/api/collections/{id}/notes/{note_id}/move"),
        Some(json!({ "target_collection_id": id, "position_mode": "end" })),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("already in this collection"), "{body:?}");

    // A bad mode against a missing target is 404: target checks run first.
    let (status, _) = call(
        app.clone(), "POST", &format!("/api/collections/{id}/notes/{note_id}/move"),
        Some(json!({ "target_collection_id": id + 1000, "position_mode": "middle" })),
    ).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let other = create_collection(app.clone(), "Notes Move To").await;
    let other_id = other["id"].as_i64().unwrap();
    let (status, body) = call(
        app.clone(), "POST", &format!("/api/collections/{id}/notes/{note_id}/move"),
        Some(json!({ "target_collection_id": other_id, "position_mode": "before" })),
    ).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("reference note"), "{body:?}");
}

// --- tags.test.js -----------------------------------------------------------

#[tokio::test]
async fn tags_fresh_collection_reports_none() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Tags Empty").await;
    let id = collection["id"].as_i64().unwrap();

    let (status, body) = call(app, "GET", &format!("/api/collections/{id}/tags"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "tags": [] }));
}

#[tokio::test]
async fn tags_used_by_notes_listed_once_and_sorted() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Tags Listed").await;
    let id = collection["id"].as_i64().unwrap();

    create_note(app.clone(), id, json!({ "tags": ["bimetal", "anchor"] })).await;
    create_note(app.clone(), id, json!({ "tags": ["anchor", "commemorative"] })).await;

    let (_, body) = call(app, "GET", &format!("/api/collections/{id}/tags"), None).await;
    let names: Vec<String> = body["tags"]
        .as_array().unwrap().iter().map(|tag| tag["name"].as_str().unwrap().to_owned()).collect();
    assert_eq!(names, vec!["anchor", "bimetal", "commemorative"]);
}

#[tokio::test]
async fn tags_suggestions_mirror_the_list() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Tags Suggestions").await;
    let id = collection["id"].as_i64().unwrap();
    create_note(app.clone(), id, json!({ "tags": ["paper"] })).await;

    let (status, body) =
        call(app, "GET", &format!("/api/collections/{id}/tags/suggestions"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["tags"][0]["name"], json!("paper"));
}

#[tokio::test]
async fn tags_are_scoped_per_collection() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let first = create_collection(app.clone(), "Tags Scope A").await;
    let second = create_collection(app.clone(), "Tags Scope B").await;

    create_note(app.clone(), first["id"].as_i64().unwrap(), json!({ "tags": ["only-a"] })).await;

    let (_, body) = call(
        app, "GET", &format!("/api/collections/{}/tags", second["id"].as_i64().unwrap()), None,
    ).await;
    assert_eq!(body, json!({ "tags": [] }));
}

#[tokio::test]
async fn tags_invalid_collection_is_400_and_unknown_is_404() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    let (status, _) = call(app.clone(), "GET", "/api/collections/nope/tags", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = call(app.clone(), "GET", "/api/collections/999999/tags", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// --- move.test.js scenarios (through the route) -----------------------------

async fn ordered_ids(app: Router, collection_id: i64) -> Vec<i64> {
    let (_, body) = call(app, "GET", &format!("/api/collections/{collection_id}/notes"), None).await;
    body["notes"].as_array().unwrap().iter().map(|note| note["id"].as_i64().unwrap()).collect()
}

#[tokio::test]
async fn move_appends_to_empty_destination() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let source = create_collection(app.clone(), "Move Source A").await;
    let target = create_collection(app.clone(), "Move Target A").await;
    let (source_id, target_id) = (source["id"].as_i64().unwrap(), target["id"].as_i64().unwrap());
    let note = create_note(app.clone(), source_id, json!({ "denomination": "100 Lei" })).await;
    let note_id = note["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(), "POST", &format!("/api/collections/{source_id}/notes/{note_id}/move"),
        Some(json!({ "target_collection_id": target_id, "position_mode": "end" })),
    ).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["note"]["collection_id"], json!(target_id));
    assert_eq!(body["note"]["display_order"], json!(1));
    assert_eq!(ordered_ids(app.clone(), target_id).await, vec![note_id]);
    assert!(ordered_ids(app.clone(), source_id).await.is_empty());
}

#[tokio::test]
async fn move_before_unknown_reference_appends() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let source = create_collection(app.clone(), "Move Source B").await;
    let target = create_collection(app.clone(), "Move Target B").await;
    let (source_id, target_id) = (source["id"].as_i64().unwrap(), target["id"].as_i64().unwrap());
    let note = create_note(app.clone(), source_id, json!({})).await;
    let note_id = note["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(), "POST", &format!("/api/collections/{source_id}/notes/{note_id}/move"),
        Some(json!({
            "target_collection_id": target_id,
            "position_mode": "before",
            "position_reference_id": 999999,
        })),
    ).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(ordered_ids(app, target_id).await, vec![note_id]);
}

#[tokio::test]
async fn move_positions_and_compacts_source_order() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let source = create_collection(app.clone(), "Move Source C").await;
    let target = create_collection(app.clone(), "Move Target C").await;
    let (source_id, target_id) = (source["id"].as_i64().unwrap(), target["id"].as_i64().unwrap());

    let note_a = create_note(app.clone(), source_id, json!({ "notes": "A" })).await;
    let note_b = create_note(app.clone(), source_id, json!({ "notes": "B" })).await;
    let note_c = create_note(app.clone(), source_id, json!({ "notes": "C" })).await;
    let note_x = create_note(app.clone(), target_id, json!({ "notes": "X" })).await;
    let note_y = create_note(app.clone(), target_id, json!({ "notes": "Y" })).await;
    let (aid, bid, cid, xid, yid) = (
        note_a["id"].as_i64().unwrap(), note_b["id"].as_i64().unwrap(),
        note_c["id"].as_i64().unwrap(), note_x["id"].as_i64().unwrap(),
        note_y["id"].as_i64().unwrap(),
    );

    async fn move_it(app: Router, path: String, target_id: i64, mode: &str, reference: Option<i64>) -> (StatusCode, Value) {
        let reference = reference.map(|id| json!(id)).unwrap_or(Value::Null);
        call(app, "POST", &path, Some(json!({
            "target_collection_id": target_id,
            "position_mode": mode,
            "position_reference_id": reference,
        }))).await
    }
    let path_for = |note: i64| format!("/api/collections/{source_id}/notes/{note}/move");

    let (status, _) = move_it(app.clone(), path_for(bid), target_id, "before", Some(yid)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ordered_ids(app.clone(), target_id).await, vec![xid, bid, yid]);
    assert_eq!(ordered_ids(app.clone(), source_id).await, vec![aid, cid]);

    let (status, _) = move_it(app.clone(), path_for(aid), target_id, "start", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ordered_ids(app.clone(), target_id).await, vec![aid, xid, bid, yid]);

    let (status, _) = move_it(app.clone(), path_for(cid), target_id, "after", Some(xid)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ordered_ids(app.clone(), target_id).await, vec![aid, xid, cid, bid, yid]);
    assert!(ordered_ids(app.clone(), source_id).await.is_empty());

    // Source display orders compact to a contiguous 1..N.
    let (_, body) = call(app, "GET", &format!("/api/collections/{target_id}/notes"), None).await;
    let orders: Vec<i64> = body["notes"]
        .as_array().unwrap().iter().map(|note| note["display_order"].as_i64().unwrap()).collect();
    assert_eq!(orders, vec![1, 2, 3, 4, 5]);
}

#[tokio::test]
async fn move_rematches_tags_into_destination_scope() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let source = create_collection(app.clone(), "Move Source D").await;
    let target = create_collection(app.clone(), "Move Target D").await;
    let (source_id, target_id) = (source["id"].as_i64().unwrap(), target["id"].as_i64().unwrap());

    let note1 = create_note(app.clone(), source_id, json!({ "tags": ["Rare"] })).await;
    let note2 = create_note(app.clone(), source_id, json!({ "tags": ["Rare"] })).await;
    create_note(app.clone(), target_id, json!({ "tags": ["Rare"] })).await;

    let (status, body) = call(
        app.clone(), "POST",
        &format!("/api/collections/{source_id}/notes/{}/move", note1["id"].as_i64().unwrap()),
        Some(json!({ "target_collection_id": target_id, "position_mode": "end" })),
    ).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["note"]["tags"][0]["name"], json!("Rare"));

    let (_, tags) = call(app.clone(), "GET", &format!("/api/collections/{target_id}/tags"), None).await;
    assert_eq!(tags["tags"].as_array().unwrap().len(), 1);

    let (_, reread) = call(
        app.clone(), "GET",
        &format!("/api/collections/{source_id}/notes/{}", note2["id"].as_i64().unwrap()), None,
    ).await;
    assert_eq!(reread["note"]["tags"][0]["name"], json!("Rare"));
}

// --- bare mounts ------------------------------------------------------------

#[tokio::test]
async fn bare_notes_and_tags_resolve_the_first_collection() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let first = create_collection(app.clone(), "Bare First").await;
    create_collection(app.clone(), "Bare Second").await;
    let first_id = first["id"].as_i64().unwrap();
    create_note(app.clone(), first_id, json!({ "denomination": "7 Lei", "tags": ["bare"] })).await;

    let (status, body) = call(app.clone(), "GET", "/api/notes", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["notes"][0]["denomination"], json!("7 Lei"));

    let (status, body) = call(app.clone(), "POST", "/api/notes", Some(note_payload("9 Lei"))).await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    assert_eq!(body["note"]["collection_id"], json!(first_id));

    let (status, body) = call(app.clone(), "GET", "/api/tags", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["tags"][0]["name"], json!("bare"));

    let (status, _) = call(app.clone(), "GET", "/api/tags/suggestions", None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn reorder_route_wins_over_note_id_on_both_mounts() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Reorder Precedence").await;
    let id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), id, json!({})).await;
    let second = create_note(app.clone(), id, json!({})).await;

    for path in [format!("/api/collections/{id}/notes/reorder"), "/api/notes/reorder".to_owned()] {
        let (status, body) = call(
            app.clone(), "POST", &path,
            Some(json!({ "ids": [second["id"], first["id"]] })),
        ).await;
        assert_eq!(status, StatusCode::OK, "{path}: {body:?}");
    }
}

// --- payload normalization through the API ----------------------------------

#[tokio::test]
async fn denomination_and_issue_date_normalize_on_create() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Normalization").await;
    let id = collection["id"].as_i64().unwrap();

    let created = create_note(
        app.clone(), id,
        json!({ "denomination": "1000 Lei", "issue_date": "1/1/1991" }),
    ).await;
    assert_eq!(created["denomination"], json!("1,000 Lei"));
    assert_eq!(created["issue_date"], json!("01/01/1991"));
}

#[tokio::test]
async fn scraped_data_object_round_trips() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Scraped Round Trip").await;
    let id = collection["id"].as_i64().unwrap();

    let created = create_note(
        app.clone(), id,
        json!({ "scraped_data": { "grade": "65", "images": [] } }),
    ).await;
    assert_eq!(created["scraped_data"], json!({ "grade": "65", "images": [] }));
}

// --- multipart ----------------------------------------------------------------

#[tokio::test]
async fn multipart_create_uploads_an_image_and_collects_repeated_tags() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Multipart Create").await;
    let id = collection["id"].as_i64().unwrap();
    let bytes = png_bytes(100, 80);

    let boundary = "multipartcreate";
    let mut body = multipart_body(boundary, vec![
        ("denomination", None, b"5 Lei", "text/plain"),
        ("tags", None, b"paper", "text/plain"),
        ("image_front_full", Some("front.png"), &bytes, "image/png"),
    ]);
    // A second `tags` field, exactly like the UI's FormData append loop.
    body.splice(body.len() - format!("--{boundary}--\r\n").len().., Vec::new());
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"tags\"\r\nContent-Type: text/plain\r\n\r\nold\r\n").as_bytes(),
    );
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let (status, created) = call_multipart(
        app.clone(), "POST", &format!("/api/collections/{id}/notes"), body, boundary,
    ).await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    let note_id = created["note"]["id"].as_i64().unwrap();
    assert_eq!(created["note"]["images"][0]["origin"], json!("uploaded"));
    assert_eq!(
        created["note"]["images"][0]["localPath"],
        json!(format!("/api/images/notes/{note_id}/front-full.webp")),
    );
    let mut tags: Vec<String> = created["note"]["tags"]
        .as_array().unwrap().iter().map(|tag| tag["name"].as_str().unwrap().to_owned()).collect();
    tags.sort();
    assert_eq!(tags, vec!["old", "paper"]);
    assert!(dir.path().join("images").join("notes").join(note_id.to_string()).join("front-full.webp").is_file());
}

#[tokio::test]
async fn multipart_create_ignores_non_image_mime_types() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Multipart Mime").await;
    let id = collection["id"].as_i64().unwrap();

    let boundary = "multipartmime";
    let body = multipart_body(boundary, vec![
        ("denomination", None, b"5 Lei", "text/plain"),
        ("image_front_full", Some("note.txt"), b"not an image", "text/plain"),
    ]);
    let (status, created) = call_multipart(
        app.clone(), "POST", &format!("/api/collections/{id}/notes"), body, boundary,
    ).await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    assert_eq!(created["note"]["images"], json!([]));
}

#[tokio::test]
async fn update_delete_flag_removes_the_image_and_prunes_the_dir() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Delete Flag").await;
    let id = collection["id"].as_i64().unwrap();
    let bytes = png_bytes(100, 80);

    let boundary = "deleteflagcreate";
    let body = multipart_body(boundary, vec![
        ("denomination", None, b"5 Lei", "text/plain"),
        ("image_front_full", Some("front.png"), &bytes, "image/png"),
    ]);
    let (status, created) = call_multipart(
        app.clone(), "POST", &format!("/api/collections/{id}/notes"), body, boundary,
    ).await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    let note_id = created["note"]["id"].as_i64().unwrap();

    let (status, updated) = call(
        app.clone(), "PUT", &format!("/api/collections/{id}/notes/{note_id}"),
        Some(json!({ "denomination": "5 Lei", "delete_image_front_full": true })),
    ).await;
    assert_eq!(status, StatusCode::OK, "{updated:?}");
    assert_eq!(updated["note"]["images"], json!([]));
    assert!(
        !dir.path().join("images").join("notes").join(note_id.to_string()).exists(),
        "stale note dir pruned"
    );
}

#[tokio::test]
async fn update_generate_flag_builds_a_thumbnail_from_the_full_image() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Generate Flag").await;
    let id = collection["id"].as_i64().unwrap();
    let bytes = png_bytes(1200, 800);

    let boundary = "generateflagcreate";
    let body = multipart_body(boundary, vec![
        ("denomination", None, b"5 Lei", "text/plain"),
        ("image_front_full", Some("front.png"), &bytes, "image/png"),
    ]);
    let (status, created) = call_multipart(
        app.clone(), "POST", &format!("/api/collections/{id}/notes"), body, boundary,
    ).await;
    assert_eq!(status, StatusCode::CREATED, "{created:?}");
    let note_id = created["note"]["id"].as_i64().unwrap();

    let (status, updated) = call(
        app.clone(), "PUT", &format!("/api/collections/{id}/notes/{note_id}"),
        Some(json!({ "denomination": "5 Lei", "generate_image_front_thumbnail_from_full": true })),
    ).await;
    assert_eq!(status, StatusCode::OK, "{updated:?}");
    let images = updated["note"]["images"].as_array().unwrap();
    assert_eq!(images.len(), 2);
    assert!(images.iter().any(|image| image["variant"] == json!("thumbnail")
        && image["origin"] == json!("generated")));
}

#[tokio::test]
async fn image_url_validation_rejects_before_any_download() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Image URL").await;
    let id = collection["id"].as_i64().unwrap();

    for (url, message) in [
        ("ftp://example.com/a.jpg", "Only HTTP(S) image URLs are accepted."),
        ("not a url", "Invalid image URL."),
    ] {
        let boundary = "imageurl";
        let body = multipart_body(boundary, vec![
            ("denomination", None, b"5 Lei", "text/plain"),
            ("image_front_full_url", None, url.as_bytes(), "text/plain"),
        ]);
        let (status, failed) = call_multipart(
            app.clone(), "POST", &format!("/api/collections/{id}/notes"), body, boundary,
        ).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{url}: {failed:?}");
        assert_eq!(failed, json!({ "error": message }));
    }
}

#[tokio::test]
async fn notes_accept_two_large_images_above_old_10mib_cap() {
    // Regression: pasting front+back photos (~12 MiB total, each under the
    // 15 MB per-file cap) exceeded the old 10 MiB global `RequestBodyLimitLayer`,
    // which surfaced through Vite as ECONNABORTED / `Failed to fetch`.
    // The notes routes get their own large body cap so the handler answers
    // 201 instead of 413.
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Large Paste").await;
    let id = collection["id"].as_i64().unwrap();
    let front = vec![0x89u8; 6 * 1024 * 1024];
    let back = vec![0x89u8; 6 * 1024 * 1024];
    let boundary = "largepasteboundary";
    let body = multipart_body(boundary, vec![
        ("denomination", None, b"5 Lei", "text/plain"),
        ("image_front_full", Some("front.png"), &front, "image/png"),
        ("image_back_full", Some("back.png"), &back, "image/png"),
    ]);
    // Browsers send Content-Length, which is what lets the small cap
    // short-circuit with 413.
    let request = Request::builder()
        .method("POST")
        .uri(format!("/api/collections/{id}/notes"))
        .header("content-type", format!("multipart/form-data; boundary={boundary}"))
        .header("content-length", body.len())
        .body(Body::from(body))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let raw = axum::body::to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    assert_ne!(status, StatusCode::PAYLOAD_TOO_LARGE, "{}", String::from_utf8_lossy(&raw));
    assert_eq!(status, StatusCode::CREATED, "{}", String::from_utf8_lossy(&raw));
}
