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
async fn categories_delete_removes_only_unused_labels() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let first = create_showcase(app.clone(), Some("First")).await;
    let first_id = first["id"].as_i64().unwrap();
    let second = create_showcase(app.clone(), Some("Second")).await;
    let second_id = second["id"].as_i64().unwrap();

    // A label with no placement reports zero usage and deletes.
    let (_, created) =
        call(app.clone(), "POST", "/api/categories", Some(json!({ "name": "Spare" }))).await;
    let spare_id = created["category"]["id"].as_i64().unwrap();
    assert_eq!(created["category"]["showcase_count"], json!(0));

    let (status, body) =
        call(app.clone(), "DELETE", &format!("/api/categories/{spare_id}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "success": true }));

    let (_, pool) = call(app.clone(), "GET", "/api/categories", None).await;
    assert!(pool["categories"].as_array().unwrap().is_empty());

    // A placed label is refused, counts its showcases, and keeps its row.
    let placed = place_category(app.clone(), first_id, "Shared").await;
    let placed_id = placed["category_id"].as_i64().unwrap();
    let (status, body) =
        call(app.clone(), "DELETE", &format!("/api/categories/{placed_id}"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], json!("This category is placed in 1 showcase."));

    let (status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{second_id}/nodes"),
        Some(json!({ "type": "category", "category_id": placed_id })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (_, pool) = call(app.clone(), "GET", "/api/categories", None).await;
    assert_eq!(pool["categories"][0]["id"], json!(placed_id));
    assert_eq!(pool["categories"][0]["showcase_count"], json!(2));

    let (status, body) =
        call(app.clone(), "DELETE", &format!("/api/categories/{placed_id}"), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], json!("This category is placed in 2 showcases."));

    let (status, _) = call(app.clone(), "DELETE", "/api/categories/999999", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) =
        call(app.clone(), "DELETE", "/api/categories/not-a-number", None).await;
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
async fn category_rename_rebinds_only_this_placement_and_keeps_the_old_label() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let first = create_showcase(app.clone(), Some("Rename A")).await;
    let second = create_showcase(app.clone(), Some("Rename B")).await;
    let first_id = first["id"].as_i64().unwrap();
    let second_id = second["id"].as_i64().unwrap();
    let placed = place_category(app.clone(), first_id, "Before").await;
    let before_id = placed["category_id"].as_i64().unwrap();
    place_category(app.clone(), second_id, "Before").await;

    let node_id = placed["id"].as_i64().unwrap();
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "name": "After" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["name"], json!("After"));
    assert_ne!(body["node"]["category_id"], json!(before_id));

    // The other showcase keeps its placement of the old label.
    let (_, tree) = call(
        app.clone(),
        "GET",
        &format!("/api/showcases/{second_id}/tree"),
        None,
    )
    .await;
    assert_eq!(tree["nodes"][0]["name"], json!("Before"));

    let (_, pool) = call(app.clone(), "GET", "/api/categories", None).await;
    let categories = pool["categories"].as_array().unwrap();
    assert_eq!(categories.len(), 2);
    for (name, count) in [("After", 1), ("Before", 1)] {
        let row = categories
            .iter()
            .find(|row| row["name"] == json!(name))
            .unwrap_or_else(|| panic!("{name} missing from the pool"));
        assert_eq!(row["showcase_count"], json!(count));
    }
}

#[tokio::test]
async fn category_rename_adopts_an_existing_pool_label_and_prunes_the_old_one() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let first = create_showcase(app.clone(), Some("Adopt A")).await;
    let second = create_showcase(app.clone(), Some("Adopt B")).await;
    let first_id = first["id"].as_i64().unwrap();
    let kingdom = place_category(app.clone(), second["id"].as_i64().unwrap(), "Kingdom").await;
    let kingdom_id = kingdom["category_id"].as_i64().unwrap();
    let country = place_category(app.clone(), first_id, "Country").await;

    let node_id = country["id"].as_i64().unwrap();
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "name": "kingdom" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["category_id"], json!(kingdom_id));
    // The pool keeps its own spelling, not the typed one.
    assert_eq!(body["node"]["name"], json!("Kingdom"));

    // The old label had no other placement, so the pool drops it.
    let (_, pool) = call(app.clone(), "GET", "/api/categories", None).await;
    let categories = pool["categories"].as_array().unwrap();
    assert_eq!(categories.len(), 1);
    assert_eq!(categories[0]["id"], json!(kingdom_id));
    assert_eq!(categories[0]["name"], json!("Kingdom"));
    assert_eq!(categories[0]["showcase_count"], json!(2));
}

#[tokio::test]
async fn category_rename_refuses_a_label_already_placed_in_the_showcase() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Clash")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let summer = place_category(app.clone(), showcase_id, "Summer").await;
    place_category(app.clone(), showcase_id, "Winter").await;

    let node_id = summer["id"].as_i64().unwrap();
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "name": "winter" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        json!({ "error": "This category is already in the showcase." })
    );

    let (_, tree) = call(
        app.clone(),
        "GET",
        &format!("/api/showcases/{showcase_id}/tree"),
        None,
    )
    .await;
    let names: Vec<&str> = tree["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Summer", "Winter"]);
}

#[tokio::test]
async fn node_delete_keeps_label_and_pool_can_delete_it() {
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

    // Removing the last placement orphans the label, so the pool can drop it.
    let (status, _) =
        call(app.clone(), "DELETE", &format!("/api/categories/{category_id}"), None).await;
    assert_eq!(status, StatusCode::OK);

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

// --- catalog entries and specimens -----------------------------------------

fn catalog_entry_body(parent_id: i64, note_ids: Option<Value>) -> Value {
    let mut body = json!({
        "node_type": "catalog_entry",
        "parent_id": parent_id,
        "entry": {
            "catalog_number": "22a",
            "denomination": "20 lei",
            "issue_date": "1877",
            "source": "Pick catalog",
        },
    });
    if let Some(ids) = note_ids {
        body["note_ids"] = ids;
    }
    body
}

async fn add_catalog_entry(
    app: Router,
    showcase_id: i64,
    parent_id: i64,
    note_ids: Option<Value>,
) -> (StatusCode, Value) {
    call(
        app,
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(catalog_entry_body(parent_id, note_ids)),
    )
    .await
}

fn set_owned(dir: &tempfile::TempDir, note_id: i64, owned: bool) {
    let conn = rusqlite::Connection::open(dir.path().join("banknotes.db")).expect("db opens");
    conn.execute(
        "UPDATE banknotes SET owned = ?1 WHERE id = ?2",
        rusqlite::params![i64::from(owned), note_id],
    )
    .expect("ownership updates");
}

fn specimen_rows(dir: &tempfile::TempDir, node_id: i64) -> Vec<(i64, i64, bool)> {
    let conn = rusqlite::Connection::open(dir.path().join("banknotes.db")).expect("db opens");
    let mut stmt = conn
        .prepare(
            "SELECT note_id, position, is_primary
             FROM showcase_catalog_notes
             WHERE node_id = ?1
             ORDER BY position ASC, note_id ASC",
        )
        .expect("query prepares");
    let rows = stmt
        .query_map(rusqlite::params![node_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .expect("rows read")
        .collect::<Result<Vec<_>, _>>()
        .expect("rows collect");
    rows
}

/// The specimen ids of a node payload, in wire order.
fn specimen_ids(node: &Value) -> Vec<Value> {
    node["specimens"]
        .as_array()
        .unwrap()
        .iter()
        .map(|specimen| specimen["id"].clone())
        .collect()
}

/// Fetch the tree and return one direct child of the first root, by id.
async fn tree_child(app: Router, showcase_id: i64, node_id: Value) -> Value {
    let (status, tree) = call(
        app,
        "GET",
        &format!("/api/showcases/{showcase_id}/tree"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{tree:?}");
    tree["nodes"][0]["children"]
        .as_array()
        .expect("root children")
        .iter()
        .find(|node| node["id"] == node_id)
        .cloned()
        .expect("node in tree")
}

#[tokio::test]
async fn catalog_entry_creates_with_zero_one_and_many_specimens() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Catalog entries")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Kingdom").await;
    let category_id = category["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Specimen notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), collection_id, "1 leu").await;
    let second = create_note(app.clone(), collection_id, "2 lei").await;
    let third = create_note(app.clone(), collection_id, "3 lei").await;
    set_owned(&dir, second["id"].as_i64().unwrap(), true);

    // Zero specimens: a planned position, still a catalog entry.
    let (status, body) = add_catalog_entry(app.clone(), showcase_id, category_id, None).await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let empty = body["node"].clone();
    assert_eq!(empty["node_type"], json!("catalog_entry"));
    assert_eq!(empty["parent_node_id"], json!(category_id));
    assert_eq!(empty["entry"]["catalog_number"], json!("22a"));
    assert_eq!(empty["entry"]["denomination"], json!("20 lei"));
    assert_eq!(empty["specimens"], json!([]));
    assert!(empty["primary_note_id"].is_null());
    assert!(empty.as_object().unwrap().contains_key("primary_note_id"));
    assert_eq!(empty["children"], json!([]));

    // One specimen: it is the primary.
    let (status, body) = add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([second["id"]])),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let single = body["node"].clone();
    assert_eq!(single["specimens"].as_array().unwrap().len(), 1);
    assert_eq!(single["specimens"][0]["id"], second["id"]);
    assert_eq!(single["specimens"][0]["owned"], json!(true));
    assert_eq!(single["primary_note_id"], second["id"]);

    // Several specimens keep the caller's order; the first id is primary.
    let (status, body) = add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([third["id"], first["id"], second["id"]])),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let many = body["node"].clone();
    let ordered = specimen_ids(&many);
    assert_eq!(ordered, vec![third["id"].clone(), first["id"].clone(), second["id"].clone()]);
    assert_eq!(many["primary_note_id"], third["id"]);

    // The tree batches every specimen and reports them in position order.
    let (status, body) = call(
        app.clone(),
        "GET",
        &format!("/api/showcases/{showcase_id}/tree"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let children = body["nodes"][0]["children"].as_array().unwrap();
    assert_eq!(children.len(), 3);
    let tree_many = children
        .iter()
        .find(|node| node["id"] == many["id"])
        .expect("entry in tree");
    assert_eq!(tree_many["entry"]["source"], json!("Pick catalog"));
    assert_eq!(tree_many["specimens"].as_array().unwrap().len(), 3);
    assert_eq!(tree_many["specimens"][0]["id"], third["id"]);
    assert_eq!(tree_many["specimens"][1]["issue_date"], first["issue_date"]);
    assert_eq!(tree_many["primary_note_id"], third["id"]);
}

#[tokio::test]
async fn catalog_entry_metadata_update_leaves_the_note_alone() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Entry metadata")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Metadata").await;
    let collection = create_collection(app.clone(), "Metadata notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let note = create_note(app.clone(), collection_id, "5 lei").await;
    let (_, body) = add_catalog_entry(
        app.clone(),
        showcase_id,
        category["id"].as_i64().unwrap(),
        Some(json!([note["id"]])),
    )
    .await;
    let node_id = body["node"]["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({
            "entry": {
                "catalog_number": "22b",
                "denomination": "50 lei",
                "issue_date": "",
                "source": "My collection",
            },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["entry"]["catalog_number"], json!("22b"));
    assert_eq!(body["node"]["entry"]["denomination"], json!("50 lei"));
    assert_eq!(body["node"]["entry"]["issue_date"], json!(""));
    assert_eq!(body["node"]["specimens"][0]["id"], note["id"]);
    // The library record keeps its own catalog number.
    assert_eq!(body["node"]["specimens"][0]["catalog_number"], note["catalog_number"]);

    let invalid = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "entry": "not an object" })),
    )
    .await;
    assert_eq!(invalid.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn catalog_entry_notes_replace_reorder_promote_and_clear() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Specimen sets")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Sets").await;
    let collection = create_collection(app.clone(), "Set notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), collection_id, "1").await;
    let second = create_note(app.clone(), collection_id, "2").await;
    let third = create_note(app.clone(), collection_id, "3").await;
    let (_, body) = add_catalog_entry(
        app.clone(),
        showcase_id,
        category["id"].as_i64().unwrap(),
        Some(json!([first["id"], second["id"], third["id"]])),
    )
    .await;
    let node_id = body["node"]["id"].as_i64().unwrap();

    // Replace with a shorter set and no primary: the first id promotes.
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({ "note_ids": [third["id"], first["id"]] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let ids = specimen_ids(&body["node"]);
    assert_eq!(ids, vec![third["id"].clone(), first["id"].clone()]);
    assert_eq!(body["node"]["primary_note_id"], third["id"]);

    // Reorder and promote an explicit primary in one call.
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({
            "note_ids": [first["id"], third["id"]],
            "primary_note_id": third["id"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let ids = specimen_ids(&body["node"]);
    assert_eq!(ids, vec![first["id"].clone(), third["id"].clone()]);
    assert_eq!(body["node"]["primary_note_id"], third["id"]);

    // An explicit primary may sit anywhere in the list.
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({
            "note_ids": [first["id"], second["id"], third["id"]],
            "primary_note_id": second["id"],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["primary_note_id"], second["id"]);

    // Empty is allowed: the entry degrades to unseen, never disappears.
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({ "note_ids": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["node_type"], json!("catalog_entry"));
    assert_eq!(body["node"]["specimens"], json!([]));
    assert!(body["node"]["primary_note_id"].is_null());
    assert!(body["node"].as_object().unwrap().contains_key("primary_note_id"));

    // Failed replacements leave the previous set untouched (atomic).
    let (status, _) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({ "note_ids": [first["id"], second["id"]], "primary_note_id": second["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let before = specimen_rows(&dir, node_id);
    assert_eq!(before.len(), 2);

    let outside = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({ "note_ids": [first["id"]], "primary_note_id": second["id"] })),
    )
    .await;
    assert_eq!(outside.0, StatusCode::BAD_REQUEST);
    assert_eq!(specimen_rows(&dir, node_id), before);

    let duplicated = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({ "note_ids": [first["id"], first["id"]] })),
    )
    .await;
    assert_eq!(duplicated.0, StatusCode::BAD_REQUEST);
    assert_eq!(specimen_rows(&dir, node_id), before);

    let unknown_note = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({ "note_ids": [999999] })),
    )
    .await;
    assert_eq!(unknown_note.0, StatusCode::BAD_REQUEST);
    assert_eq!(specimen_rows(&dir, node_id), before);

    let missing = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}/notes"),
        Some(json!({})),
    )
    .await;
    assert_eq!(missing.0, StatusCode::BAD_REQUEST);
    assert_eq!(specimen_rows(&dir, node_id), before);

    let unknown_node = call(
        app.clone(),
        "PUT",
        "/api/nodes/999999/notes",
        Some(json!({ "note_ids": [] })),
    )
    .await;
    assert_eq!(unknown_node.0, StatusCode::NOT_FOUND);

    // A category placement is not a specimen set.
    let category_node = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{}/notes", category["id"]),
        Some(json!({ "note_ids": [first["id"]] })),
    )
    .await;
    assert_eq!(category_node.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn catalog_entry_placement_rules_are_unchanged() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Entry placement")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Placement").await;
    let category_id = category["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Placement notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let note = create_note(app.clone(), collection_id, "1").await;
    let (_, grouping) = add_grouping(app.clone(), showcase_id, category_id, "Nested").await;
    let grouping_id = grouping["node"]["id"].as_i64().unwrap();

    // Never at the top level.
    let top = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "node_type": "catalog_entry",
            "entry": { "catalog_number": "1" },
        })),
    )
    .await;
    assert_eq!(top.0, StatusCode::BAD_REQUEST);

    // Not under a note leaf.
    let (_, placed) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": category_id,
            "note_ids": [note["id"]],
        })),
    )
    .await;
    let note_node_id = placed["nodes"][0]["id"].as_i64().unwrap();
    let under_note = add_catalog_entry(app.clone(), showcase_id, note_node_id, None).await;
    assert_eq!(under_note.0, StatusCode::BAD_REQUEST);

    // A Grouping is a valid parent.
    let (status, body) = add_catalog_entry(app.clone(), showcase_id, grouping_id, None).await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let entry_id = body["node"]["id"].as_i64().unwrap();

    // Not under another catalog entry.
    let under_entry = add_catalog_entry(app.clone(), showcase_id, entry_id, None).await;
    assert_eq!(under_entry.0, StatusCode::BAD_REQUEST);

    // A parent must belong to this Showcase.
    let other = create_showcase(app.clone(), Some("Other showcase")).await;
    let other_id = other["id"].as_i64().unwrap();
    let other_category = place_category(app.clone(), other_id, "Elsewhere").await;
    let foreign = add_catalog_entry(
        app.clone(),
        showcase_id,
        other_category["id"].as_i64().unwrap(),
        None,
    )
    .await;
    assert_eq!(foreign.0, StatusCode::BAD_REQUEST);

    // The entry body is required; only strings are stored.
    let missing_entry = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "node_type": "catalog_entry", "parent_id": category_id })),
    )
    .await;
    assert_eq!(missing_entry.0, StatusCode::BAD_REQUEST);

    let unknown_note = add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([999999])),
    )
    .await;
    assert_eq!(unknown_note.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn catalog_entry_survives_note_deletion_and_cascades_on_entry_delete() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Entry deletion")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Deletion").await;
    let category_id = category["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Deletion notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), collection_id, "1").await;
    let second = create_note(app.clone(), collection_id, "2").await;
    let lone = create_note(app.clone(), collection_id, "3").await;
    let (_, body) = add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([first["id"], second["id"]])),
    )
    .await;
    let entry_id = body["node"]["id"].as_i64().unwrap();
    let (_, body) = add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([lone["id"]])),
    )
    .await;
    let lone_entry_id = body["node"]["id"].as_i64().unwrap();

    // Deleting the primary Note promotes the lowest-position survivor.
    let (status, body) = call(
        app.clone(),
        "DELETE",
        &format!("/api/notes/{}", first["id"]),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let entry = tree_child(app.clone(), showcase_id, json!(entry_id)).await;
    assert_eq!(entry["specimens"].as_array().unwrap().len(), 1);
    assert_eq!(entry["specimens"][0]["id"], second["id"]);
    assert_eq!(entry["primary_note_id"], second["id"]);

    // Deleting its last Note leaves the entry unseen, not deleted.
    let (status, _) = call(
        app.clone(),
        "DELETE",
        &format!("/api/notes/{}", lone["id"]),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let lone_entry = tree_child(app.clone(), showcase_id, json!(lone_entry_id)).await;
    assert_eq!(lone_entry["specimens"], json!([]));
    assert!(lone_entry["primary_note_id"].is_null());
    assert!(lone_entry.as_object().unwrap().contains_key("primary_note_id"));

    // Deleting an entry cascades its join rows.
    assert_eq!(specimen_rows(&dir, entry_id).len(), 1);
    let (status, body) = call(
        app.clone(),
        "DELETE",
        &format!("/api/nodes/{entry_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert!(specimen_rows(&dir, entry_id).is_empty());
}

#[tokio::test]
async fn showcase_counts_positions_by_ownership() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Catalog counts")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Counts").await;
    let category_id = category["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Count notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let owned_note = create_note(app.clone(), collection_id, "owned").await;
    let seen_note = create_note(app.clone(), collection_id, "seen").await;
    let owned_specimen = create_note(app.clone(), collection_id, "owned specimen").await;
    let seen_specimen = create_note(app.clone(), collection_id, "seen specimen").await;
    set_owned(&dir, owned_note["id"].as_i64().unwrap(), true);
    set_owned(&dir, owned_specimen["id"].as_i64().unwrap(), true);
    set_owned(&dir, seen_note["id"].as_i64().unwrap(), false);
    set_owned(&dir, seen_specimen["id"].as_i64().unwrap(), false);

    // Two note leaves (one owned, one seen).
    let (status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": category_id,
            "note_ids": [owned_note["id"], seen_note["id"]],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    // One owned entry, one seen entry, one unseen entry.
    add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([owned_specimen["id"]])),
    )
    .await;
    add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([seen_specimen["id"]])),
    )
    .await;
    add_catalog_entry(app.clone(), showcase_id, category_id, None).await;

    let (status, body) = call(app.clone(), "GET", "/api/showcases", None).await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let counted = body["showcases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == json!(showcase_id))
        .expect("showcase listed");
    assert_eq!(counted["note_count"], json!(2));
    assert_eq!(counted["catalog_entry_count"], json!(3));
    assert_eq!(counted["entry_count"], json!(5));
    assert_eq!(counted["owned_count"], json!(2));

    // The single-showcase payload carries the same counts.
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/showcases/{showcase_id}"),
        Some(json!({ "name": "Catalog counts renamed" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["showcase"]["note_count"], json!(2));
    assert_eq!(body["showcase"]["catalog_entry_count"], json!(3));
    assert_eq!(body["showcase"]["entry_count"], json!(5));
    assert_eq!(body["showcase"]["owned_count"], json!(2));

    // The tree's note payloads carry the owned flag for leaves and specimens.
    let (_, tree) = call(
        app.clone(),
        "GET",
        &format!("/api/showcases/{showcase_id}/tree"),
        None,
    )
    .await;
    let children = tree["nodes"][0]["children"].as_array().unwrap();
    let seen_leaf = children
        .iter()
        .find(|node| node["note_id"] == seen_note["id"])
        .expect("seen leaf");
    assert_eq!(seen_leaf["note"]["owned"], json!(false));
    let seen_entry = children
        .iter()
        .find(|node| node["specimens"][0]["id"] == seen_specimen["id"])
        .expect("seen entry");
    assert_eq!(seen_entry["specimens"][0]["owned"], json!(false));

    // A presentation-only Showcase keeps note_count and reports no entries.
    let plain = create_showcase(app.clone(), Some("Plain")).await;
    let plain_id = plain["id"].as_i64().unwrap();
    let plain_category = place_category(app.clone(), plain_id, "Plain").await;
    call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{plain_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": plain_category["id"],
            "note_ids": [owned_note["id"]],
        })),
    )
    .await;
    let (_, body) = call(app.clone(), "GET", "/api/showcases", None).await;
    let plain_row = body["showcases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == json!(plain_id))
        .expect("plain showcase listed");
    assert_eq!(plain_row["note_count"], json!(1));
    assert_eq!(plain_row["catalog_entry_count"], json!(0));
    assert_eq!(plain_row["entry_count"], json!(1));
    assert_eq!(plain_row["owned_count"], json!(1));
}

#[tokio::test]
async fn catalog_entry_becomes_a_note_in_place() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Shell replacement")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Kingdom").await;
    let category_id = category["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Replacement notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), collection_id, "1 leu").await;
    let second = create_note(app.clone(), collection_id, "2 lei").await;

    let (status, body) = add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([first["id"], second["id"]])),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let entry = body["node"].clone();
    let entry_id = entry["id"].as_i64().unwrap();
    assert_eq!(entry["specimens"].as_array().unwrap().len(), 2);

    // Picking a library note turns the planned position into that one note,
    // keeping its id and parent. The extra specimen links leave with the shell.
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{entry_id}"),
        Some(json!({ "node_type": "note", "note_id": second["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let replaced = body["node"].clone();
    assert_eq!(replaced["node_type"], json!("note"));
    assert_eq!(replaced["note_id"], second["id"]);
    assert_eq!(replaced["parent_node_id"], json!(category_id));
    assert_eq!(replaced["note"]["denomination"], second["denomination"]);
    assert!(replaced.get("entry").is_none());
    assert!(replaced.get("specimens").is_none());
    assert!(replaced.get("primary_note_id").is_none());
    assert!(specimen_rows(&dir, entry_id).is_empty());

    let in_tree = tree_child(app, showcase_id, json!(entry_id)).await;
    assert_eq!(in_tree["node_type"], json!("note"));
    assert_eq!(in_tree["note_id"], second["id"]);
}

#[tokio::test]
async fn note_card_replaces_its_note_in_place() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Note replacement")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Kingdom").await;
    let category_id = category["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Replacement notes").await;
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
            "note_ids": [first["id"]],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let node = body["nodes"][0].clone();
    let node_id = node["id"].as_i64().unwrap();

    // Replacing a note card keeps the card's id, parent, and position; only
    // the note it presents changes.
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "note_id": second["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let replaced = body["node"].clone();
    assert_eq!(replaced["node_type"], json!("note"));
    assert_eq!(replaced["note_id"], second["id"]);
    assert_eq!(replaced["parent_node_id"], json!(category_id));
    assert_eq!(replaced["position"], node["position"]);
    assert_eq!(replaced["note"]["denomination"], second["denomination"]);

    let in_tree = tree_child(app.clone(), showcase_id, json!(node_id)).await;
    assert_eq!(in_tree["note_id"], second["id"]);
    assert_eq!(in_tree["note"]["denomination"], second["denomination"]);
    assert!(dir.path().join("banknotes.db").exists());

    // A missing note is rejected and the card keeps its current note.
    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "note_id": 999_999 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body:?}");
    let in_tree = tree_child(app, showcase_id, json!(node_id)).await;
    assert_eq!(in_tree["note_id"], second["id"]);
}

#[tokio::test]
async fn replacing_a_cover_note_card_repoints_the_grouping_cover() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Cover replacement")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Kingdom").await;
    let collection = create_collection(app.clone(), "Cover notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), collection_id, "1 leu").await;
    let second = create_note(app.clone(), collection_id, "2 lei").await;
    let (status, body) = add_grouping(
        app.clone(),
        showcase_id,
        category["id"].as_i64().unwrap(),
        "Cover",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let grouping = body["node"].clone();
    let grouping_id = grouping["id"].as_i64().unwrap();
    let (status, body) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": grouping_id,
            "note_ids": [first["id"], second["id"]],
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let first_node_id = body["nodes"][0]["id"].as_i64().unwrap();

    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{grouping_id}"),
        Some(json!({ "cover_note_id": first["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["cover_note_id"], first["id"]);

    let (status, body) = call(
        app.clone(),
        "PUT",
        &format!("/api/nodes/{first_node_id}"),
        Some(json!({ "note_id": second["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    let grouping = tree_child(app, showcase_id, json!(grouping_id)).await;
    assert_eq!(grouping["cover_note_id"], second["id"]);
    assert_eq!(grouping["cover_note"]["denomination"], second["denomination"]);
}

#[tokio::test]
async fn legacy_specimen_entries_migrate_to_single_note_cards() {
    let (dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), Some("Legacy catalog")).await;
    let showcase_id = showcase["id"].as_i64().unwrap();
    let category = place_category(app.clone(), showcase_id, "Kingdom").await;
    let category_id = category["id"].as_i64().unwrap();
    let collection = create_collection(app.clone(), "Legacy notes").await;
    let collection_id = collection["id"].as_i64().unwrap();
    let first = create_note(app.clone(), collection_id, "1 leu").await;
    let second = create_note(app.clone(), collection_id, "2 lei").await;

    let (status, body) = add_catalog_entry(
        app.clone(),
        showcase_id,
        category_id,
        Some(json!([first["id"], second["id"]])),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    let entry_id = body["node"]["id"].as_i64().unwrap();
    assert_eq!(specimen_rows(&dir, entry_id).len(), 2);

    // Reopening the database runs the shell migration: the primary specimen
    // becomes the node's note, and the extra specimen links are dropped.
    drop(app);
    let pool: DbPool = db::open_pool(&dir.path().join("banknotes.db")).expect("pool reopens");
    let conn = pool.get().expect("connection");
    let (node_type, note_id): (String, Option<i64>) = conn
        .query_row(
            "SELECT node_type, note_id FROM showcase_nodes WHERE id = ?1",
            rusqlite::params![entry_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("migrated node");
    assert_eq!(node_type, "note");
    assert_eq!(note_id, first["id"].as_i64());
    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM showcase_catalog_notes WHERE node_id = ?1",
            rusqlite::params![entry_id],
            |row| row.get(0),
        )
        .expect("specimen count");
    assert_eq!(remaining, 0);
}
