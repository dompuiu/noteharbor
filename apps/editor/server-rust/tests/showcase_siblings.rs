//! Sibling notes: the Showcase tree's batched `sibling_count` and the
//! `GET /api/notes/{id}/siblings` list. The key is the exact normalized triple
//! (Catalog value, Denomination, Issue date), never the Catalog family.

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
    let request = builder
        .body(Body::from(bytes.unwrap_or_default()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let raw = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads");
    let parsed: Value = serde_json::from_slice(&raw).expect("body is JSON");
    (status, parsed)
}

fn note_payload() -> Value {
    json!({
        "denomination": "",
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

async fn create_collection(app: Router, name: &str) -> i64 {
    let (status, body) = call(
        app,
        "POST",
        "/api/collections",
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["collection"]["id"].as_i64().unwrap()
}

async fn create_note(app: Router, collection_id: i64, overrides: Value) -> Value {
    let mut payload = note_payload();
    for (key, value) in overrides.as_object().expect("overrides object") {
        payload[key] = value.clone();
    }
    let (status, body) = call(
        app,
        "POST",
        &format!("/api/collections/{collection_id}/notes"),
        Some(payload),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["note"].clone()
}

async fn create_showcase(app: Router, name: &str) -> i64 {
    let (status, body) = call(
        app,
        "POST",
        "/api/showcases",
        Some(json!({ "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["showcase"]["id"].as_i64().unwrap()
}

async fn place_category(app: Router, showcase_id: i64, name: &str) -> i64 {
    let (status, body) = call(
        app,
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({ "type": "category", "name": name })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["node"]["id"].as_i64().unwrap()
}

async fn place_notes(app: Router, showcase_id: i64, parent_id: i64, note_ids: &[i64]) -> Vec<Value> {
    let (status, body) = call(
        app,
        "POST",
        &format!("/api/showcases/{showcase_id}/nodes"),
        Some(json!({
            "type": "notes",
            "parent_id": parent_id,
            "note_ids": note_ids,
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    body["nodes"].as_array().cloned().unwrap_or_default()
}

async fn tree_notes(app: Router, showcase_id: i64) -> Vec<Value> {
    let (status, body) = call(
        app,
        "GET",
        &format!("/api/showcases/{showcase_id}/tree"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let mut out = Vec::new();
    fn walk(nodes: &[Value], out: &mut Vec<Value>) {
        for node in nodes {
            if node["node_type"] == json!("note") || node["node_type"] == json!("catalog_entry") {
                out.push(node.clone());
            }
            if let Some(children) = node["children"].as_array() {
                walk(children, out);
            }
        }
    }
    walk(body["nodes"].as_array().unwrap(), &mut out);
    out
}

fn triple(
    catalog_number: &str,
    denomination: &str,
    issue_date: &str,
) -> Value {
    json!({
        "catalog_number": catalog_number,
        "denomination": denomination,
        "issue_date": issue_date,
    })
}

// --- tree count -------------------------------------------------------------

#[tokio::test]
async fn tree_counts_notes_that_share_the_exact_triple_across_collections() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let alpha = create_collection(app.clone(), "Alpha").await;
    let beta = create_collection(app.clone(), "Beta").await;
    let first = create_note(
        app.clone(),
        alpha,
        triple("22a", "1 leu", "1917"),
    )
    .await;
    let second = create_note(
        app.clone(),
        beta,
        triple("22a", "1 leu", "1917"),
    )
    .await;
    let showcase = create_showcase(app.clone(), "Siblings").await;
    let category = place_category(app.clone(), showcase, "Holder").await;
    place_notes(
        app.clone(),
        showcase,
        category,
        &[first["id"].as_i64().unwrap(), second["id"].as_i64().unwrap()],
    )
    .await;

    let nodes = tree_notes(app, showcase).await;
    assert_eq!(nodes[0]["sibling_count"], json!(1));
    assert_eq!(nodes[1]["sibling_count"], json!(1));
}

#[tokio::test]
async fn tree_count_ignores_catalog_families_other_dates_and_blank_keys() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Alpha").await;
    let base = create_note(
        app.clone(),
        collection,
        triple("22a", "1 leu", "1917"),
    )
    .await;
    // Family sibling only: 22b is a different Catalog value.
    create_note(app.clone(), collection, triple("22b", "1 leu", "1917")).await;
    // Same family and date, different denomination.
    create_note(app.clone(), collection, triple("22a", "2 lei", "1917")).await;
    // Same catalog and denomination, different date rendering of the data.
    create_note(app.clone(), collection, triple("22a", "1 leu", "1917-01-01")).await;
    // A blank Catalog value never groups, even when the rest matches.
    create_note(app.clone(), collection, triple("", "1 leu", "1917")).await;
    create_note(app.clone(), collection, triple("", "1 leu", "1917")).await;

    let showcase = create_showcase(app.clone(), "Siblings").await;
    let category = place_category(app.clone(), showcase, "Holder").await;
    place_notes(app.clone(), showcase, category, &[base["id"].as_i64().unwrap()]).await;

    let nodes = tree_notes(app, showcase).await;
    assert_eq!(nodes[0]["sibling_count"], json!(0));
}

#[tokio::test]
async fn tree_count_matches_write_normalized_dates_denominations_and_folded_catalogs() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let collection = create_collection(app.clone(), "Alpha").await;
    let first = create_note(
        app.clone(),
        collection,
        triple("  P-82  ", "1000 Lei", "1/1/1991"),
    )
    .await;
    let second = create_note(
        app.clone(),
        collection,
        triple("p-82", "1,000 Lei", "01/01/1991"),
    )
    .await;
    let showcase = create_showcase(app.clone(), "Siblings").await;
    let category = place_category(app.clone(), showcase, "Holder").await;
    place_notes(
        app.clone(),
        showcase,
        category,
        &[first["id"].as_i64().unwrap(), second["id"].as_i64().unwrap()],
    )
    .await;

    let nodes = tree_notes(app, showcase).await;
    assert_eq!(nodes[0]["sibling_count"], json!(1));
    assert_eq!(nodes[1]["sibling_count"], json!(1));
}

#[tokio::test]
async fn tree_counts_seen_siblings_and_siblings_already_in_the_showcase() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let alpha = create_collection(app.clone(), "Alpha").await;
    let beta = create_collection(app.clone(), "Beta").await;
    let shown = create_note(
        app.clone(),
        alpha,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "owned": true,
        }),
    )
    .await;
    let also_shown = create_note(
        app.clone(),
        beta,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "owned": false,
        }),
    )
    .await;
    create_note(
        app.clone(),
        beta,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "owned": false,
        }),
    )
    .await;

    let showcase = create_showcase(app.clone(), "Siblings").await;
    let category = place_category(app.clone(), showcase, "Holder").await;
    place_notes(
        app.clone(),
        showcase,
        category,
        &[
            shown["id"].as_i64().unwrap(),
            also_shown["id"].as_i64().unwrap(),
        ],
    )
    .await;

    let nodes = tree_notes(app, showcase).await;
    // Both cards count the third note, even though one sibling is a Seen note
    // in another collection and the other is already presented here.
    assert_eq!(nodes[0]["sibling_count"], json!(2));
    assert_eq!(nodes[1]["sibling_count"], json!(2));
}

#[tokio::test]
async fn placeholders_do_not_carry_a_sibling_count() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let showcase = create_showcase(app.clone(), "Checklist").await;
    let category = place_category(app.clone(), showcase, "Holder").await;
    let (status, body) = call(
        app.clone(),
        "POST",
        &format!("/api/showcases/{showcase}/nodes"),
        Some(json!({
            "node_type": "catalog_entry",
            "parent_id": category,
            "entry": {
                "catalog_number": "22a",
                "denomination": "1 leu",
                "issue_date": "1917",
            },
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body:?}");
    assert!(body["node"].get("sibling_count").is_none(), "{body:?}");

    let nodes = tree_notes(app, showcase).await;
    assert!(nodes[0].get("sibling_count").is_none(), "{nodes:?}");
}

#[tokio::test]
async fn a_note_shown_twice_carries_the_same_count_on_both_cards() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let alpha = create_collection(app.clone(), "Alpha").await;
    let beta = create_collection(app.clone(), "Beta").await;
    let first = create_note(app.clone(), alpha, triple("22a", "1 leu", "1917")).await;
    create_note(app.clone(), beta, triple("22a", "1 leu", "1917")).await;
    let showcase = create_showcase(app.clone(), "Siblings").await;
    let category = place_category(app.clone(), showcase, "Holder").await;
    place_notes(app.clone(), showcase, category, &[first["id"].as_i64().unwrap()]).await;
    place_notes(app.clone(), showcase, category, &[first["id"].as_i64().unwrap()]).await;

    let nodes = tree_notes(app, showcase).await;
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0]["sibling_count"], json!(1));
    assert_eq!(nodes[1]["sibling_count"], json!(1));
}

#[tokio::test]
async fn a_replacement_write_answers_the_new_sibling_count() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let alpha = create_collection(app.clone(), "Alpha").await;
    let beta = create_collection(app.clone(), "Beta").await;
    let shown = create_note(app.clone(), alpha, triple("22a", "1 leu", "1917")).await;
    let replacement = create_note(app.clone(), beta, triple("22a", "1 leu", "1917")).await;
    create_note(app.clone(), beta, triple("22a", "1 leu", "1917")).await;
    let showcase = create_showcase(app.clone(), "Siblings").await;
    let category = place_category(app.clone(), showcase, "Holder").await;
    let nodes = place_notes(
        app.clone(),
        showcase,
        category,
        &[shown["id"].as_i64().unwrap()],
    )
    .await;
    let node_id = nodes[0]["id"].as_i64().unwrap();
    assert_eq!(nodes[0]["sibling_count"], json!(2));

    let (status, body) = call(
        app,
        "PUT",
        &format!("/api/nodes/{node_id}"),
        Some(json!({ "note_id": replacement["id"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["node"]["note_id"], replacement["id"]);
    // The old Note is now a sibling of the new one: two siblings remain.
    assert_eq!(body["node"]["sibling_count"], json!(2));
}

// --- endpoint ---------------------------------------------------------------

#[tokio::test]
async fn siblings_endpoint_returns_full_notes_without_the_target() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let alpha = create_collection(app.clone(), "Alpha").await;
    let beta = create_collection(app.clone(), "Beta").await;
    let target = create_note(
        app.clone(),
        alpha,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "serial": "A.1",
            "grade": "66",
            "tags": ["paper"],
        }),
    )
    .await;
    let sibling = create_note(
        app.clone(),
        beta,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "serial": "B.2",
            "grade": "67",
            "tags": ["rare", "paper"],
        }),
    )
    .await;
    create_note(
        app.clone(),
        beta,
        json!({
            "catalog_number": "22b",
            "denomination": "1 leu",
            "issue_date": "1917",
            "serial": "C.3",
        }),
    )
    .await;

    let (status, body) = call(
        app,
        "GET",
        &format!("/api/notes/{}/siblings", target["id"]),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let siblings = body["siblings"].as_array().expect("siblings array");
    assert_eq!(siblings.len(), 1, "{body:?}");
    assert_eq!(siblings[0]["id"], sibling["id"]);
    assert_eq!(siblings[0]["collection_id"], json!(beta));
    assert_eq!(siblings[0]["serial"], json!("B.2"));
    // Full Note shape: images present plus the sibling's tags.
    assert!(siblings[0]["images"].is_array());
    let tags: Vec<&str> = siblings[0]["tags"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tag| tag["name"].as_str().unwrap())
        .collect();
    assert_eq!(tags, vec!["paper", "rare"]);
}

#[tokio::test]
async fn siblings_endpoint_orders_owned_first_then_collection_and_serial() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    let zulu = create_collection(app.clone(), "Zulu").await;
    let alpha = create_collection(app.clone(), "Alpha").await;
    let beta = create_collection(app.clone(), "beta").await;
    let target = create_note(
        app.clone(),
        alpha,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "owned": true,
            "serial": "T.0",
        }),
    )
    .await;
    let owned_zulu = create_note(
        app.clone(),
        zulu,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "owned": true,
            "serial": "Z.9",
        }),
    )
    .await;
    let seen_alpha = create_note(
        app.clone(),
        alpha,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "owned": false,
            "serial": "A.1",
        }),
    )
    .await;
    let seen_beta_b = create_note(
        app.clone(),
        beta,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "owned": false,
            "serial": "B.2",
        }),
    )
    .await;
    let seen_beta_a = create_note(
        app.clone(),
        beta,
        json!({
            "catalog_number": "22a",
            "denomination": "1 leu",
            "issue_date": "1917",
            "owned": false,
            "serial": "A.2",
        }),
    )
    .await;

    let (status, body) = call(
        app,
        "GET",
        &format!("/api/notes/{}/siblings", target["id"]),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let ids: Vec<&Value> = body["siblings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|note| &note["id"])
        .collect();
    assert_eq!(
        ids,
        vec![
            &owned_zulu["id"],
            &seen_alpha["id"],
            &seen_beta_a["id"],
            &seen_beta_b["id"],
        ]
    );
}

#[tokio::test]
async fn siblings_endpoint_answers_not_found_for_an_unknown_note() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);
    create_collection(app.clone(), "Alpha").await;

    let (status, body) = call(app, "GET", "/api/notes/999/siblings", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body:?}");
    assert_eq!(body["error"], json!("Note not found."));
}

#[tokio::test]
async fn siblings_endpoint_answers_bad_request_for_an_invalid_id() {
    let (_dir, state) = fresh_state();
    let app = create_app(state);

    let (status, _body) = call(app, "GET", "/api/notes/not-a-number/siblings", None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
