//! Ticket 10 parity: HTTP-level port of `showcases.test.js`,
//! `showcaseCategories.test.js`, `showcaseGroupings.test.js`,
//! `showcaseNotes.test.js` and `showcaseOrders.test.js`.

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
    let request = builder.body(Body::from(bytes.unwrap_or_default())).expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let raw = axum::body::to_bytes(response.into_body(), usize::MAX).await.expect("body reads");
    let parsed: Value = serde_json::from_slice(&raw).expect("body is JSON");
    (status, parsed)
}

async fn create_showcase(app: Router, name: Option<&str>) -> Value {
    let body = name.map(|name| json!({ "name": name }));
    let (status, payload) = call(app, "POST", "/api/showcases", body).await;
    assert_eq!(status, StatusCode::CREATED, "{payload:?}");
    payload["showcase"].clone()
}

async fn place_category(app: Router, showcase_id: i64, name: &str) -> Value {
    let (status, payload) = call(
        app,
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "category", "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{payload:?}");
    payload["node"].clone()
}

async fn add_grouping(app: Router, showcase_id: i64, parent_id: i64, name: &str) -> (StatusCode, Value) {
    call(
        app,
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "grouping", "parent_id": parent_id, "name": name })),
    )
    .await
}

async fn create_collection(app: Router, name: &str) -> Value {
    let (status, body) = call(app, "POST", "/api/collections", Some(json!({ "name": name }))).await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["collection"].clone()
}

async fn create_note(app: Router, collection_id: i64, denomination: &str) -> Value {
    let (status, body) = call(
        app,
        "POST",
        &format!("/api/collections/{collection_id}/notes"),
        Some(json!({
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
            "scraped_data": Value::Null,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["note"].clone()
}

// --- showcases.test.js --------------------------------------------------------

#[tokio::test]
async fn showcase_create_assigns_unique_default_names() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let first = create_showcase(app.clone(), None).await;
    let second = create_showcase(app.clone(), None).await;
    assert_eq!(first["name"], json!("Showcase"));
    assert_eq!(second["name"], json!("Showcase 2"));
    assert_ne!(first["id"], second["id"]);
}

#[tokio::test]
async fn showcase_list_reports_note_count_and_order() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Counted")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Showcase notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let note = create_note(app.clone(), collection_id, "1").await;
    let category = place_category(app.clone(), showcase_id, "Holder").await;
    let (status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": category["id"],
            "note_ids": [note["id"]],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, payload) = call(app.clone(), "GET", "/api/showcases", None).await;
    assert_eq!(status, StatusCode::OK);
    let counted = payload["showcases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == showcase["id"])
        .expect("showcase listed");
    assert_eq!(counted["note_count"], json!(1));
    assert_eq!(counted["required_collection_ids"], json!([collection_id]));
    let fresh = payload["showcases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == json!("Counted"))
        .expect("found");
    assert_eq!(fresh["id"], showcase["id"]);
}

#[tokio::test]
async fn showcase_rename_validates_id_and_name() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Before rename")).await;
    let id = showcase["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/showcases/{id}"),
        Some(json!({ "name": "After rename" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["showcase"]["name"], json!("After rename"));

    let (status, _) = call(
        app.clone(),
        "PUT",
        &format!("/api/showcases/{id}"),
        Some(json!({ "name": "   " })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) = call(
        app.clone(),
        "PUT",
        "/api/showcases/not-a-number",
        Some(json!({ "name": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) =
        call(app.clone(), "PUT", "/api/showcases/999999", Some(json!({ "name": "x" }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn showcase_rename_rejects_duplicates() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    create_showcase(app.clone(), Some("Duplicate target")).await;
    let source = create_showcase(app.clone(), Some("Duplicate source")).await;
    let id = source["id"].as_i64().unwrap();
    let (status, _) = call(
        app,
        "PUT",
        &format!("/api/showcases/{id}"),
        Some(json!({ "name": "Duplicate target" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn showcase_delete_cascades_and_reports_missing() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Doomed")).await;
    let id = showcase["id"].as_i64().unwrap();
    place_category(app.clone(), id, "Gone").await;

    let (status, body) =
        call(app.clone(), "DELETE", &format!("/api/showcases/{id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));

    let (status, _) = call(app.clone(), "DELETE", &format!("/api/showcases/{id}"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn showcase_order_persists_full_permutation_and_rejects_partial() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    create_showcase(app.clone(), Some("Order A")).await;
    create_showcase(app.clone(), Some("Order B")).await;
    let (_, before) = call(app.clone(), "GET", "/api/showcases", None).await;
    let ids: Vec<Value> = before["showcases"].as_array().unwrap().iter().map(|row| row["id"].clone()).collect();
    let mut reversed = ids.clone();
    reversed.reverse();

    let (status, body) = call(
        app.clone(),
        "PUT",
        "/api/showcases/order",
        Some(json!({ "ids": reversed })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["showcases"].as_array().unwrap().iter().map(|row| &row["id"]).collect::<Vec<_>>(),
        reversed.iter().collect::<Vec<_>>());

    let (status, _) = call(
        app.clone(),
        "PUT",
        "/api/showcases/order",
        Some(json!({ "ids": [ids[0].clone()] })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, _) =
        call(app.clone(), "PUT", "/api/showcases/order", Some(json!({}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// --- categories ---------------------------------------------------------------

#[tokio::test]
async fn categories_pool_creates_lists_and_dedupes_case_insensitively() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    let (status, body) = call(app.clone(), "GET", "/api/categories", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "categories": [] }));

    let (status, created) =
        call(app.clone(), "POST", "/api/categories", Some(json!({ "name": "Themes" }))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["category"]["name"], json!("Themes"));

    let first = call(app.clone(), "POST", "/api/categories", Some(json!({ "name": "Shared" }))).await;
    let second = call(
        app.clone(),
        "POST",
        "/api/categories",
        Some(json!({ "name": "  sHaReD " })),
    )
    .await;
    assert_eq!(second.0, StatusCode::CREATED);
    assert_eq!(second.1["category"]["id"], first.1["category"]["id"]);

    let (status, body) =
        call(app.clone(), "POST", "/api/categories", Some(json!({ "name": "   " }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, json!({ "error": "Category name is required." }));
}

#[tokio::test]
async fn categories_rename_reports_missing() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let (_, created) =
        call(app.clone(), "POST", "/api/categories", Some(json!({ "name": "Old name" }))).await;
    let id = created["category"]["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/categories/{id}"),
        Some(json!({ "name": "New name" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["category"]["name"], json!("New name"));

    let (status, body) =
        call(app.clone(), "PUT", "/api/categories/999999", Some(json!({ "name": "Nope" }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Category not found." }));

    let (status, _) = call(
        app.clone(),
        "PUT",
        "/api/categories/not-a-number",
        Some(json!({ "name": "Nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn category_placement_by_name_and_id_with_top_level_rule() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Named placement")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "category", "name": "Anniversary" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    assert_eq!(body["node"]["node_type"], json!("category"));
    assert_eq!(body["node"]["name"], json!("Anniversary"));
    assert_eq!(body["node"]["parent_node_id"], Value::Null);

    let (_, tree) =
        call(app.clone(), "GET", &format!("/api/showcases/{showcase_id}/tree"), None).await;
    assert_eq!(tree["nodes"].as_array().unwrap().len(), 1);

    // Duplicate placement rejected.
    let (_, created) =
        call(app.clone(), "POST", "/api/categories", Some(json!({ "name": "Once" }))).await;
    let category_id = created["category"]["id"].clone();
    let payload = json!({ "type": "category", "category_id": category_id });
    let (status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, body) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(payload),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().to_lowercase().contains("already in the showcase"));

    // Top-level only.
    let (status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "category", "category_id": category_id, "parent_id": 123 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Unknown type.
    let (status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "wat", "name": "Nope" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn category_rename_through_node_placement_updates_every_showcase() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let first = create_showcase(app.clone(), Some("Rename A")).await;
    let second = create_showcase(app.clone(), Some("Rename B")).await;
    let (_, created) =
        call(app.clone(), "POST", "/api/categories", Some(json!({ "name": "Before" }))).await;
    let category_id = created["category"]["id"].clone();
    let payload = json!({ "type": "category", "category_id": category_id });
    let (_, placed) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{}/nodes", first["id"]),
        Some(payload.clone()),
    )
    .await;
    call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{}/nodes", second["id"]),
        Some(payload),
    )
    .await;

    let node_id = placed["node"]["id"].as_i64().unwrap();
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "name": "After" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["name"], json!("After"));
}

#[tokio::test]
async fn node_delete_keeps_label_and_reports_missing() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Remove placement")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let (_, created) =
        call(app.clone(), "POST", "/api/categories", Some(json!({ "name": "Keep me" }))).await;
    let category_id = created["category"]["id"].clone();
    let (_, placed) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "category", "category_id": category_id })),
    )
    .await;
    let node_id = placed["node"]["id"].as_i64().unwrap();

    let (status, body) =
        call(app.clone(), "DELETE", &format!("/api/nodes/{node_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));

    let (_, pool) = call(app.clone(), "GET", "/api/categories", None).await;
    assert!(pool["categories"].as_array().unwrap().iter().any(|row| row["name"] == json!("Keep me")));

    let (status, _) = call(app.clone(), "DELETE", "/api/nodes/999999", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) =
        call(app.clone(), "PUT", "/api/nodes/999999", Some(json!({ "name": "Nope" }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// --- groupings ------------------------------------------------------------------

#[tokio::test]
async fn grouping_nests_and_validates_parent_and_name() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Grouping parent")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Themes").await;
    let category_id = category["id"].as_i64().unwrap();

    let (status, body) = add_grouping(app.clone(), showcase_id, category_id, "Sub group").await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    assert_eq!(body["node"]["node_type"], json!("grouping"));
    assert_eq!(body["node"]["parent_node_id"], json!(category_id));

    let nested = add_grouping(
        app.clone(),
        showcase_id,
        body["node"]["id"].as_i64().unwrap(),
        "Inner",
    )
    .await;
    assert_eq!(nested.0, StatusCode::CREATED, "{:?}", nested.1);

    let no_parent = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "grouping", "name": "Orphan" })),
    )
    .await;
    assert_eq!(no_parent.0, StatusCode::BAD_REQUEST);

    let no_name = add_grouping(app.clone(), showcase_id, category_id, "   ").await;
    assert_eq!(no_name.0, StatusCode::BAD_REQUEST);

    let unknown = add_grouping(app.clone(), showcase_id, 999999, "Nowhere").await;
    assert_eq!(unknown.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn grouping_rename_and_delete() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Rename grouping")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Rename parent").await;
    let (_, grouped) = add_grouping(
        app.clone(),
        showcase_id,
        category["id"].as_i64().unwrap(),
        "Before",
    )
    .await;
    let node_id = grouped["node"]["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "name": "  After  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["name"], json!("After"));

    let (status, body) =
        call(app.clone(), "DELETE", &format!("/api/nodes/{node_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));
}

#[tokio::test]
async fn grouping_cover_set_clear_and_guards() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Grouping cover")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Cover parent").await;
    let (_, grouped) = add_grouping(
        app.clone(),
        showcase_id,
        category["id"].as_i64().unwrap(),
        "Cover group",
    )
    .await;
    let node_id = grouped["node"]["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Cover notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let note = create_note(app.clone(), collection_id, "1").await;
    let note_id = note["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "cover_note_id": note_id })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["cover_note_id"], json!(note_id));

    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "cover_note_id": Value::Null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["cover_note_id"], Value::Null);

    let (status, _) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "cover_note_id": 999999 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let category_node_id = category["id"].as_i64().unwrap();
    let (status, _) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{category_node_id}"),
        Some(json!({ "cover_note_id": note_id })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// --- notes batch ------------------------------------------------------------------

#[tokio::test]
async fn notes_batch_appends_dedupes_and_validates() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Batch HTTP")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Kingdom").await;
    let category_id = category["id"].clone();
    let collection = create_collection(app.clone(), "Batch notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), collection_id, "1 leu").await;
    let second = create_note(app.clone(), collection_id, "2 lei").await;

    let (status, body) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": category_id,
            "note_ids": [first["id"], second["id"], first["id"]],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    assert_eq!(body["nodes"].as_array().unwrap().len(), 2);
    assert_eq!(
        body["nodes"].as_array().unwrap().iter().map(|node| node["position"].clone()).collect::<Vec<_>>(),
        vec![json!(1), json!(2)]
    );

    // Second batch appends.
    let third = create_note(app.clone(), collection_id, "3 lei").await;
    let (status, body) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": category_id,
            "note_ids": [third["id"]],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    assert_eq!(body["nodes"][0]["position"], json!(3));

    // Guards.
    let no_parent = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "notes", "note_ids": [first["id"]] })),
    )
    .await;
    assert_eq!(no_parent.0, StatusCode::BAD_REQUEST);

    let empty = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "notes", "parent_id": category_id, "note_ids": [] })),
    )
    .await;
    assert_eq!(empty.0, StatusCode::BAD_REQUEST);

    let unknown = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "notes", "parent_id": category_id, "note_ids": [999999] })),
    )
    .await;
    assert_eq!(unknown.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn notes_batch_rejects_note_parent() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Note parent")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Note parent category").await;
    let collection = create_collection(app.clone(), "Note parent notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let note = create_note(app.clone(), collection_id, "1").await;
    let (_, placed) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": category["id"],
            "note_ids": [note["id"]],
        })),
    )
    .await;
    let note_node_id = placed["nodes"][0]["id"].clone();
    let other = create_note(app.clone(), collection_id, "2").await;
    let (status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": note_node_id,
            "note_ids": [other["id"]],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// --- orders -----------------------------------------------------------------------

#[tokio::test]
async fn nodes_order_reorders_children_and_top_level() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Reorder children")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Order").await;
    let category_id = category["id"].as_i64().unwrap();
    let (_, grouped) =
        add_grouping(app.clone(), showcase_id, category_id, "Group A").await;
    let grouping_id = grouped["node"]["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Reorder notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let note_a = create_note(app.clone(), collection_id, "A").await;
    let (_, added) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": category_id,
            "note_ids": [note_a["id"]],
        })),
    )
    .await;
    let note_node_id = added["nodes"][0]["id"].as_i64().unwrap();
    let reversed = json!([note_node_id, grouping_id]);

    let (status, body) = call(
        app.clone(),
        "PUT",
        "/api/nodes/order",
        Some(json!({
            "showcase_id": showcase_id,
            "parent_node_id": category_id,
            "node_ids": reversed,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["nodes"].as_array().unwrap().iter().map(|node| node["id"].as_i64().unwrap()).collect::<Vec<_>>(),
        vec![note_node_id, grouping_id]
    );

    // Top level with null parent.
    let second = place_category(app.clone(), showcase_id, "Top B").await;
    let second_id = second["id"].as_i64().unwrap();
    let (status, body) = call(
        app.clone(),
        "PUT",
        "/api/nodes/order",
        Some(json!({
            "showcase_id": showcase_id,
            "parent_node_id": Value::Null,
            "node_ids": [second_id, category_id],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    // Guards: partial, unknown showcase/parent, alias keys.
    let partial = call(
        app.clone(),
        "PUT",
        "/api/nodes/order",
        Some(json!({
            "showcase_id": showcase_id,
            "parent_node_id": category_id,
            "node_ids": [grouping_id],
        })),
    )
    .await;
    assert_eq!(partial.0, StatusCode::BAD_REQUEST);

    let unknown_showcase = call(
        app.clone(),
        "PUT",
        "/api/nodes/order",
        Some(json!({ "showcase_id": 999999, "parent_node_id": Value::Null, "node_ids": [] })),
    )
    .await;
    assert_eq!(unknown_showcase.0, StatusCode::BAD_REQUEST);

    let aliased = call(
        app.clone(),
        "PUT",
        "/api/nodes/order",
        Some(json!({ "showcase_id": showcase_id, "parent_id": Value::Null, "ids": [1] })),
    )
    .await;
    assert_eq!(aliased.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn tree_returns_empty_and_reports_missing_showcase() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Tree empty")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();

    let (status, body) =
        call(app.clone(), "GET", &format!("/api/showcases/{showcase_id}/tree"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["showcase_id"], json!(showcase_id));
    assert_eq!(body["nodes"], json!([]));

    let (status, body) =
        call(app.clone(), "GET", "/api/showcases/999999/tree", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "Showcase not found." }));

    let (status, _) =
        call(app.clone(), "GET", "/api/showcases/abc/tree", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
