//! Showcases + nodes + categories port (`server-node/src/routes/showcases.js`
//! + `routes/categories.js` + the showcase parts of `src/db.js`).
//!
//! Parity notes (ticket 10):
//! - Showcase CRUD + order, node tree building with embedded notes, placement
//!   rules (top-level categories, groupings under category/grouping, notes
//!   under parents), node reorder/rename/cover/delete, category pool with
//!   get-or-create (no delete).
//! - Route-level catch semantics mirror Express exactly: POST/PUT/reorder
//!   answer any database failure as 400 with the message (existence checks
//!   before the `try` still propagate 503/500, 404s preserved), while
//!   GET/DELETE propagate `AppError`.
//! - `readShowcaseId`/`parseId` use `Number()` coercion (`js_number`): an
//!   unparsable id is 400, an unknown id is 404. Node ids in reorder bodies
//!   use `Number()` too: NaN can never join the permutation, so the reorder
//!   fails with the permutation message exactly like Node's membership check.
//! - Category placements check only `parent_id` for the top-level rule (a
//!   `parent_node_id` alias does not trigger it), groupings require
//!   `parent_id`, and the notes batch reads `parent_id ?? parent_node_id`,
//!   exactly like Node. Node reorder reads only the canonical
//!   `parent_node_id`/`node_ids` keys.
//! - The tree nests rows ordered `position, id` at every level; note and cover
//!   payloads are full `rowToNote` shapes with their tags.

use std::collections::{HashMap, HashSet};

use axum::{
    Json, Router,
    extract::{Path, State},
    response::Response,
    routing::{get, post, put},
};
use rusqlite::{Connection, Row, params};
use serde::Serialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    db::{self, DbError, classify},
    images,
    js_number,
    notes::{Note, Tag, node_string},
    routes::{bad_request, created, not_found, ok},
};

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Showcase {
    pub id: i64,
    pub name: String,
    pub display_order: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub note_count: i64,
    pub required_collection_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShowcaseNode {
    pub id: i64,
    pub node_type: String,
    pub name: Option<String>,
    pub category_id: Option<i64>,
    pub parent_node_id: Option<i64>,
    pub note_id: Option<i64>,
    pub cover_note_id: Option<i64>,
    pub position: Option<i64>,
    pub note: Option<Note>,
    pub cover_note: Option<Note>,
    pub children: Vec<ShowcaseNode>,
}

/// Raw placement row (includes `showcase_id` for parent validation).
struct NodeRow {
    id: i64,
    showcase_id: i64,
    parent_node_id: Option<i64>,
    node_type: String,
    category_id: Option<i64>,
    name: Option<String>,
    note_id: Option<i64>,
    cover_note_id: Option<i64>,
    position: Option<i64>,
}

fn map_node_row(row: &Row<'_>) -> rusqlite::Result<NodeRow> {
    Ok(NodeRow {
        id: row.get(0)?,
        showcase_id: row.get(1)?,
        parent_node_id: row.get(2)?,
        node_type: row.get(3)?,
        category_id: row.get(4)?,
        note_id: row.get(5)?,
        cover_note_id: row.get(6)?,
        position: row.get(7)?,
        name: row.get(8)?,
    })
}

const LIST_NODES_SQL: &str = "SELECT
        showcase_nodes.id,
        showcase_nodes.showcase_id,
        showcase_nodes.parent_node_id,
        showcase_nodes.node_type,
        showcase_nodes.category_id,
        showcase_nodes.note_id,
        showcase_nodes.cover_note_id,
        showcase_nodes.position,
        CASE
          WHEN showcase_nodes.node_type = 'category' THEN categories.name
          ELSE showcase_nodes.name
        END AS name
      FROM showcase_nodes
      LEFT JOIN categories ON categories.id = showcase_nodes.category_id
      WHERE showcase_nodes.showcase_id = ?1
      ORDER BY showcase_nodes.position ASC, showcase_nodes.id ASC";

const GET_NODE_SQL: &str = "SELECT
        showcase_nodes.id,
        showcase_nodes.showcase_id,
        showcase_nodes.parent_node_id,
        showcase_nodes.node_type,
        showcase_nodes.category_id,
        showcase_nodes.note_id,
        showcase_nodes.cover_note_id,
        showcase_nodes.position,
        CASE
          WHEN showcase_nodes.node_type = 'category' THEN categories.name
          ELSE showcase_nodes.name
        END AS name
      FROM showcase_nodes
      LEFT JOIN categories ON categories.id = showcase_nodes.category_id
      WHERE showcase_nodes.id = ?1";

// ---------------------------------------------------------------------------
// Small helpers (mirror `db.js`)
// ---------------------------------------------------------------------------

/// Trim + collapse internal whitespace runs, like `normalizeName` in `db.js`.
pub fn normalize_name(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Route-level trim (Express `String(value ?? '').trim()` via `node_string`,
/// which carries the JS `String()` fidelity for arrays/objects).
fn route_name(value: Option<&Value>) -> String {
    value.map(node_string).unwrap_or_default().trim().to_owned()
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    error.to_string().contains("UNIQUE constraint failed")
}

fn map_showcase(row: &Row<'_>, required: Vec<i64>) -> rusqlite::Result<Showcase> {
    Ok(Showcase {
        id: row.get(0)?,
        name: row.get(1)?,
        display_order: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        note_count: row.get(5)?,
        required_collection_ids: required,
    })
}

fn required_map(conn: &Connection) -> Result<HashMap<i64, Vec<i64>>, DbError> {
    let mut stmt = conn
        .prepare(
            "SELECT showcase_nodes.showcase_id AS showcase_id, banknotes.collection_id AS collection_id
             FROM showcase_nodes
             INNER JOIN banknotes ON banknotes.id = showcase_nodes.note_id
             WHERE showcase_nodes.note_id IS NOT NULL
             UNION
             SELECT showcase_nodes.showcase_id AS showcase_id, banknotes.collection_id AS collection_id
             FROM showcase_nodes
             INNER JOIN banknotes ON banknotes.id = showcase_nodes.cover_note_id
             WHERE showcase_nodes.cover_note_id IS NOT NULL
             ORDER BY showcase_id ASC, collection_id ASC",
        )
        .map_err(classify)?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    let mut map: HashMap<i64, Vec<i64>> = HashMap::new();
    for (showcase_id, collection_id) in rows {
        let list = map.entry(showcase_id).or_default();
        if !list.contains(&collection_id) {
            list.push(collection_id);
        }
    }
    Ok(map)
}

const LIST_SHOWCASES_SQL: &str = "SELECT
        showcases.id,
        showcases.name,
        showcases.display_order,
        showcases.created_at,
        showcases.updated_at,
        (SELECT COUNT(*) FROM showcase_nodes
          WHERE showcase_nodes.showcase_id = showcases.id
            AND showcase_nodes.node_type = 'note') AS note_count
      FROM showcases
      ORDER BY display_order ASC, id ASC";

const GET_SHOWCASE_SQL: &str = "SELECT
        showcases.id,
        showcases.name,
        showcases.display_order,
        showcases.created_at,
        showcases.updated_at,
        (SELECT COUNT(*) FROM showcase_nodes
          WHERE showcase_nodes.showcase_id = showcases.id
            AND showcase_nodes.node_type = 'note') AS note_count
      FROM showcases
      WHERE id = ?1";

fn list_showcases(conn: &Connection) -> Result<Vec<Showcase>, DbError> {
    let required = required_map(conn)?;
    let mut stmt = conn.prepare(LIST_SHOWCASES_SQL).map_err(classify)?;
    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let list = required.get(&id).cloned().unwrap_or_default();
            map_showcase(row, list)
        })
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    Ok(rows)
}

fn get_showcase(conn: &Connection, id: i64) -> Result<Option<Showcase>, DbError> {
    let required = required_map(conn)?;
    let mut stmt = conn.prepare(GET_SHOWCASE_SQL).map_err(classify)?;
    match stmt.query_row(params![id], |row| {
        let list = required.get(&id).cloned().unwrap_or_default();
        map_showcase(row, list)
    }) {
        Ok(showcase) => Ok(Some(showcase)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

fn next_default_showcase_name(conn: &Connection) -> Result<String, DbError> {
    let taken: HashSet<String> = list_showcases(conn)?
        .iter()
        .map(|showcase| showcase.name.to_lowercase())
        .collect();
    if !taken.contains("showcase") {
        return Ok("Showcase".to_owned());
    }
    let mut suffix = 2;
    while taken.contains(&format!("showcase {suffix}")) {
        suffix += 1;
    }
    Ok(format!("Showcase {suffix}"))
}

pub fn create_showcase(
    conn: &mut Connection,
    name: &str,
) -> Result<Showcase, DbError> {
    let normalized = normalize_name(name);
    let final_name = if normalized.is_empty() {
        next_default_showcase_name(conn)?
    } else {
        normalized
    };
    match conn.execute(
        "INSERT INTO showcases (name, display_order, created_at, updated_at)
         VALUES (?1, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM showcases), datetime('now'), datetime('now'))",
        params![final_name],
    ) {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(DbError::Failed(
                "A showcase with this name already exists.".to_owned(),
            ));
        }
        Err(error) => return Err(classify(error)),
    }
    let id = conn.last_insert_rowid();
    get_showcase(conn, id)?.ok_or_else(|| DbError::Failed("Showcase not found.".to_owned()))
}

pub fn rename_showcase(
    conn: &mut Connection,
    id: i64,
    name: &str,
) -> Result<Showcase, DbError> {
    let normalized = normalize_name(name);
    if normalized.is_empty() {
        return Err(DbError::Failed("Showcase name is required.".to_owned()));
    }
    if get_showcase(conn, id)?.is_none() {
        return Err(DbError::Failed("Showcase not found.".to_owned()));
    }
    match conn.execute(
        "UPDATE showcases SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![normalized, id],
    ) {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(DbError::Failed(
                "A showcase with this name already exists.".to_owned(),
            ));
        }
        Err(error) => return Err(classify(error)),
    }
    get_showcase(conn, id)?.ok_or_else(|| DbError::Failed("Showcase not found.".to_owned()))
}

pub fn delete_showcase(conn: &mut Connection, id: i64) -> Result<(), DbError> {
    if get_showcase(conn, id)?.is_none() {
        return Err(DbError::Failed("Showcase not found.".to_owned()));
    }
    conn.execute("DELETE FROM showcases WHERE id = ?1", params![id])
        .map_err(classify)?;
    Ok(())
}

fn assert_full_permutation(current: &[i64], requested: &[i64], message: &str) -> Result<(), DbError> {
    // Mirrors Node: reject partial, duplicated, foreign, or non-positive lists.
    if requested.len() != current.len()
        || requested.iter().any(|id| *id <= 0)
        || HashSet::<i64>::from_iter(requested.iter().copied()).len() != requested.len()
        || current.iter().any(|id| !requested.contains(id))
    {
        return Err(DbError::Failed(message.to_owned()));
    }
    Ok(())
}

pub fn reorder_showcases(conn: &mut Connection, ids: &[i64]) -> Result<Vec<Showcase>, DbError> {
    const MESSAGE: &str = "Reorder request must include every showcase exactly once.";
    if ids.is_empty() {
        return Err(DbError::Failed(MESSAGE.to_owned()));
    }
    let existing: Vec<i64> = list_showcases(conn)?.iter().map(|row| row.id).collect();
    // `Number(x)` is NaN (non-positive here): it can never join the
    // permutation, so the reorder fails exactly like Node's membership check.
    assert_full_permutation(&existing, ids, MESSAGE)?;
    let tx = conn.transaction().map_err(classify)?;
    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE showcases SET display_order = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![(index + 1) as i64, id],
        )
        .map_err(classify)?;
    }
    tx.commit().map_err(classify)?;
    list_showcases(conn)
}

// ---------------------------------------------------------------------------
// Categories (shared label pool, get-or-create, no delete)
// ---------------------------------------------------------------------------

fn map_category(row: &Row<'_>) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

fn list_categories(conn: &Connection) -> Result<Vec<Category>, DbError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, created_at, updated_at
             FROM categories
             ORDER BY name COLLATE NOCASE ASC, id ASC",
        )
        .map_err(classify)?;
    let rows: Vec<Category> = stmt
        .query_map([], map_category)
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    Ok(rows)
}

fn get_category(conn: &Connection, id: i64) -> Result<Option<Category>, DbError> {
    let mut stmt = conn
        .prepare("SELECT id, name, created_at, updated_at FROM categories WHERE id = ?1")
        .map_err(classify)?;
    match stmt.query_row(params![id], map_category) {
        Ok(category) => Ok(Some(category)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

pub fn create_category(conn: &mut Connection, name: &str) -> Result<Category, DbError> {
    let normalized = normalize_name(name);
    if normalized.is_empty() {
        return Err(DbError::Failed("Category name is required.".to_owned()));
    }
    let mut stmt = conn
        .prepare("SELECT id, name, created_at, updated_at FROM categories WHERE name = ?1 COLLATE NOCASE")
        .map_err(classify)?;
    if let Ok(existing) = stmt.query_row(params![normalized], map_category) {
        return Ok(existing);
    }
    conn.execute(
        "INSERT INTO categories (name, created_at, updated_at)
         VALUES (?1, datetime('now'), datetime('now'))",
        params![normalized],
    )
    .map_err(classify)?;
    let id = conn.last_insert_rowid();
    get_category(conn, id)?.ok_or_else(|| DbError::Failed("Category not found.".to_owned()))
}

pub fn rename_category(
    conn: &mut Connection,
    id: i64,
    name: &str,
) -> Result<Category, DbError> {
    let normalized = normalize_name(name);
    if normalized.is_empty() {
        return Err(DbError::Failed("Category name is required.".to_owned()));
    }
    match conn.execute(
        "UPDATE categories SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![normalized, id],
    ) {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(DbError::Failed(
                "A category with this name already exists.".to_owned(),
            ));
        }
        Err(error) => return Err(classify(error)),
    }
    // The route checks existence first; a missing row surfaces as not found.
    get_category(conn, id)?.ok_or_else(|| DbError::Failed("Category not found.".to_owned()))
}

// ---------------------------------------------------------------------------
// Notes embedded in the tree (full `rowToNote` shapes with tags)
// ---------------------------------------------------------------------------

const NOTE_FIELDS: &str = "id,
    collection_id,
    display_order,
    denomination,
    issue_date,
    catalog_number,
    grading_company,
    grade,
    watermark,
    serial,
    url,
    notes,
    scraped_data,
    images,
    created_at,
    updated_at";

fn parse_json_text(value: Option<String>) -> Value {
    match value {
        None => Value::Null,
        Some(text) if text.trim().is_empty() => Value::Null,
        Some(text) => serde_json::from_str(&text).unwrap_or(Value::Null),
    }
}

fn fetch_notes(conn: &Connection, ids: &[i64]) -> Result<HashMap<i64, Note>, DbError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("SELECT {NOTE_FIELDS} FROM banknotes WHERE id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql).map_err(classify)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            let scraped_raw: Option<String> = row.get(12)?;
            let images_raw: Option<String> = row.get(13)?;
            let scraped = parse_json_text(scraped_raw);
            Ok(Note {
                id: row.get(0)?,
                collection_id: row.get(1)?,
                display_order: row.get(2)?,
                denomination: row.get(3)?,
                issue_date: row.get(4)?,
                catalog_number: row.get(5)?,
                grading_company: row.get(6)?,
                grade: row.get(7)?,
                watermark: row.get(8)?,
                serial: row.get(9)?,
                url: row.get(10)?,
                notes: row.get(11)?,
                scraped_data: if scraped.is_null() { None } else { Some(scraped) },
                images: images::normalize_images(&parse_json_text(images_raw)),
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
                tags: Vec::new(),
            })
        })
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    // Every note's tags in one query, `ORDER BY name NOCASE`.
    let mut tag_stmt = conn
        .prepare(&format!(
            "SELECT bt.banknote_id, t.id, t.name
             FROM banknote_tags bt
             INNER JOIN tags t ON t.id = bt.tag_id
             WHERE bt.banknote_id IN ({placeholders})
             ORDER BY t.name COLLATE NOCASE ASC"
        ))
        .map_err(classify)?;
    let tag_rows: Vec<(i64, Tag)> = tag_stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, i64>(0)?, Tag { id: row.get(1)?, name: row.get(2)? }))
        })
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    let mut tag_map: HashMap<i64, Vec<Tag>> = HashMap::new();
    for (note_id, tag) in tag_rows {
        tag_map.entry(note_id).or_default().push(tag);
    }
    let mut out = HashMap::new();
    for mut note in rows {
        note.tags = tag_map.remove(&note.id).unwrap_or_default();
        out.insert(note.id, note);
    }
    Ok(out)
}

fn note_exists(conn: &Connection, id: i64) -> Result<bool, DbError> {
    let mut stmt = conn
        .prepare("SELECT id FROM banknotes WHERE id = ?1")
        .map_err(classify)?;
    match stmt.query_row(params![id], |_| Ok(())) {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(classify(error)),
    }
}

// ---------------------------------------------------------------------------
// Node tree
// ---------------------------------------------------------------------------

fn build_tree(rows: Vec<NodeRow>, notes: &HashMap<i64, Note>) -> Vec<ShowcaseNode> {
    let mut by_id: HashMap<i64, ShowcaseNode> = HashMap::new();
    for row in &rows {
        by_id.insert(
            row.id,
            ShowcaseNode {
                id: row.id,
                node_type: row.node_type.clone(),
                name: row.name.clone(),
                category_id: row.category_id,
                parent_node_id: row.parent_node_id,
                note_id: row.note_id,
                cover_note_id: row.cover_note_id,
                position: row.position,
                note: row.note_id.and_then(|id| notes.get(&id).cloned()),
                cover_note: row.cover_note_id.and_then(|id| notes.get(&id).cloned()),
                children: Vec::new(),
            },
        );
    }
    // Rows arrive ordered `position, id`; appending in that order keeps every
    // sibling group ordered without a second sort.
    let mut child_ids: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut roots: Vec<i64> = Vec::new();
    for row in &rows {
        match row.parent_node_id {
            Some(parent) if by_id.contains_key(&parent) => {
                child_ids.entry(parent).or_default().push(row.id);
            }
            _ => roots.push(row.id),
        }
    }
    fn nest(
        id: i64,
        by_id: &mut HashMap<i64, ShowcaseNode>,
        child_ids: &HashMap<i64, Vec<i64>>,
    ) -> Option<ShowcaseNode> {
        let mut node = by_id.remove(&id)?;
        if let Some(children) = child_ids.get(&id) {
            for child in children {
                if let Some(nested) = nest(*child, by_id, child_ids) {
                    node.children.push(nested);
                }
            }
        }
        Some(node)
    }
    let mut nodes_by_id = by_id;
    roots
        .into_iter()
        .filter_map(|id| nest(id, &mut nodes_by_id, &child_ids))
        .collect()
}

fn get_tree(conn: &Connection, showcase_id: i64) -> Result<Vec<ShowcaseNode>, DbError> {
    let mut stmt = conn.prepare(LIST_NODES_SQL).map_err(classify)?;
    let rows = stmt
        .query_map(params![showcase_id], map_node_row)
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    let mut wanted: Vec<i64> = Vec::new();
    for row in &rows {
        for id in [row.note_id, row.cover_note_id].into_iter().flatten() {
            if !wanted.contains(&id) {
                wanted.push(id);
            }
        }
    }
    let notes = fetch_notes(conn, &wanted)?;
    Ok(build_tree(rows, &notes))
}

fn get_node(conn: &Connection, id: i64) -> Result<Option<ShowcaseNode>, DbError> {
    let mut stmt = conn.prepare(GET_NODE_SQL).map_err(classify)?;
    let row = match stmt.query_row(params![id], map_node_row) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(classify(error)),
    };
    let mut wanted = Vec::new();
    for maybe in [row.note_id, row.cover_note_id].into_iter().flatten() {
        wanted.push(maybe);
    }
    let notes = fetch_notes(conn, &wanted)?;
    Ok(Some(ShowcaseNode {
        id: row.id,
        node_type: row.node_type.clone(),
        name: row.name.clone(),
        category_id: row.category_id,
        parent_node_id: row.parent_node_id,
        note_id: row.note_id,
        cover_note_id: row.cover_note_id,
        position: row.position,
        note: row.note_id.and_then(|note_id| notes.get(&note_id).cloned()),
        cover_note: row
            .cover_note_id
            .and_then(|note_id| notes.get(&note_id).cloned()),
        children: Vec::new(),
    }))
}

fn next_position(
    conn: &Connection,
    showcase_id: i64,
    parent_node_id: Option<i64>,
) -> Result<i64, DbError> {
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(MAX(position), 0) + 1 AS value
             FROM showcase_nodes
             WHERE showcase_id = ?1 AND parent_node_id IS ?2",
        )
        .map_err(classify)?;
    stmt.query_row(params![showcase_id, parent_node_id], |row| row.get(0))
        .map_err(classify)
}

#[allow(clippy::too_many_arguments)]
fn insert_node(
    conn: &Connection,
    showcase_id: i64,
    parent_node_id: Option<i64>,
    node_type: &str,
    category_id: Option<i64>,
    name: Option<&str>,
    note_id: Option<i64>,
    position: i64,
) -> Result<i64, DbError> {
    conn.execute(
        "INSERT INTO showcase_nodes (
           showcase_id, parent_node_id, node_type, category_id, name,
           note_id, cover_note_id, position, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, datetime('now'), datetime('now'))",
        params![showcase_id, parent_node_id, node_type, category_id, name, note_id, position],
    )
    .map_err(classify)?;
    Ok(conn.last_insert_rowid())
}

fn ensure_showcase(conn: &Connection, id: i64) -> Result<(), DbError> {
    if get_showcase(conn, id)?.is_none() {
        return Err(DbError::Failed("Showcase not found.".to_owned()));
    }
    Ok(())
}

fn get_node_row(conn: &Connection, id: i64) -> Result<Option<NodeRow>, DbError> {
    let mut stmt = conn.prepare(GET_NODE_SQL).map_err(classify)?;
    match stmt.query_row(params![id], map_node_row) {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

/// Category placement: top level only, by id or by name (get-or-create).
fn add_category_placement(
    conn: &mut Connection,
    showcase_id: i64,
    body: &Value,
) -> Result<ShowcaseNode, DbError> {
    // Only `parent_id` triggers the top-level rule, exactly like Node.
    if body.get("parent_id").is_some_and(|value| !value.is_null()) {
        return Err(DbError::Failed(
            "A category is placed at the top level.".to_owned(),
        ));
    }
    let category = if body.get("category_id").is_some_and(|value| !value.is_null()) {
        let raw = body.get("category_id");
        let Some(category_id) = raw.and_then(js_number) else {
            return Err(DbError::Failed("Category not found.".to_owned()));
        };
        match get_category(conn, category_id)? {
            Some(category) => category,
            None => return Err(DbError::Failed("Category not found.".to_owned())),
        }
    } else {
        create_category(conn, &route_name(body.get("name")))?
    };
    let position = next_position(conn, showcase_id, None)?;
    let node_id = match insert_node(
        conn,
        showcase_id,
        None,
        "category",
        Some(category.id),
        None,
        None,
        position,
    ) {
        Ok(id) => id,
        Err(DbError::Failed(message)) if message.contains("UNIQUE constraint failed") => {
            return Err(DbError::Failed(
                "This category is already in the showcase.".to_owned(),
            ));
        }
        Err(error) => {
            if error.user_message().contains("UNIQUE constraint failed") {
                return Err(DbError::Failed(
                    "This category is already in the showcase.".to_owned(),
                ));
            }
            return Err(error);
        }
    };
    get_node(conn, node_id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))
}

/// Grouping under a category placement or another grouping.
fn add_grouping(
    conn: &mut Connection,
    showcase_id: i64,
    body: &Value,
) -> Result<ShowcaseNode, DbError> {
    let Some(parent_id) = body.get("parent_id").and_then(js_number) else {
        return Err(DbError::Failed("A parent node is required.".to_owned()));
    };
    if parent_id <= 0 {
        return Err(DbError::Failed("A parent node is required.".to_owned()));
    }
    let parent = get_node_row(conn, parent_id)?;
    let Some(parent) = parent else {
        return Err(DbError::Failed("Parent node not found.".to_owned()));
    };
    if parent.showcase_id != showcase_id {
        return Err(DbError::Failed("Parent node not found.".to_owned()));
    }
    if parent.node_type == "note" {
        return Err(DbError::Failed(
            "A grouping cannot be nested under a note.".to_owned(),
        ));
    }
    let name = normalize_name(&route_name(body.get("name")));
    if name.is_empty() {
        return Err(DbError::Failed("Node name is required.".to_owned()));
    }
    let position = next_position(conn, showcase_id, Some(parent_id))?;
    let node_id = insert_node(
        conn,
        showcase_id,
        Some(parent_id),
        "grouping",
        None,
        Some(&name),
        None,
        position,
    )?;
    get_node(conn, node_id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))
}

/// Notes batch under one parent, appended in the caller's order.
fn add_notes_batch(
    conn: &mut Connection,
    showcase_id: i64,
    body: &Value,
) -> Result<Vec<ShowcaseNode>, DbError> {
    ensure_showcase(conn, showcase_id)?;
    // `??`: `parent_id` wins unless null/missing, then `parent_node_id`.
    let raw_parent = match body.get("parent_id") {
        Some(value) if !value.is_null() => Some(value),
        _ => body.get("parent_node_id"),
    };
    let Some(parent_value) = raw_parent.filter(|value| !value.is_null()) else {
        return Err(DbError::Failed(
            "A parent node is required for notes.".to_owned(),
        ));
    };
    let Some(parent_id) = js_number(parent_value) else {
        return Err(DbError::Failed(
            "A valid parent node is required.".to_owned(),
        ));
    };
    if parent_id <= 0 {
        return Err(DbError::Failed(
            "A valid parent node is required.".to_owned(),
        ));
    }
    let parent = get_node_row(conn, parent_id)?;
    let Some(parent) = parent else {
        return Err(DbError::Failed("Parent node not found.".to_owned()));
    };
    if parent.showcase_id != showcase_id {
        return Err(DbError::Failed("Parent node not found.".to_owned()));
    }
    if parent.node_type == "note" {
        return Err(DbError::Failed(
            "A note node cannot hold notes.".to_owned(),
        ));
    }
    let raw_ids = body.get("note_ids").and_then(Value::as_array);
    let Some(raw_ids) = raw_ids else {
        return Err(DbError::Failed("At least one note is required.".to_owned()));
    };
    if raw_ids.is_empty() {
        return Err(DbError::Failed("At least one note is required.".to_owned()));
    }
    let mut note_ids: Vec<i64> = Vec::new();
    let mut seen: HashSet<i64> = HashSet::new();
    for raw in raw_ids {
        let Some(note_id) = js_number(raw) else {
            return Err(DbError::Failed("A valid note id is required.".to_owned()));
        };
        if note_id <= 0 {
            return Err(DbError::Failed("A valid note id is required.".to_owned()));
        }
        if seen.contains(&note_id) {
            continue;
        }
        if !note_exists(conn, note_id)? {
            return Err(DbError::Failed(format!("Note {note_id} was not found.")));
        }
        seen.insert(note_id);
        note_ids.push(note_id);
    }
    if note_ids.is_empty() {
        return Err(DbError::Failed("At least one note is required.".to_owned()));
    }
    let start = next_position(conn, showcase_id, Some(parent_id))?;
    let tx = conn.transaction().map_err(classify)?;
    let mut created: Vec<i64> = Vec::with_capacity(note_ids.len());
    for (index, note_id) in note_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO showcase_nodes (
               showcase_id, parent_node_id, node_type, category_id, name,
               note_id, cover_note_id, position, created_at, updated_at
             )
             VALUES (?1, ?2, 'note', NULL, NULL, ?3, NULL, ?4, datetime('now'), datetime('now'))",
            params![showcase_id, parent_id, note_id, start + index as i64],
        )
        .map_err(classify)?;
        created.push(tx.last_insert_rowid());
    }
    tx.commit().map_err(classify)?;
    let mut nodes = Vec::with_capacity(created.len());
    for id in created {
        nodes.push(
            get_node(conn, id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))?,
        );
    }
    Ok(nodes)
}

enum AddNodeResult {
    Single(Box<ShowcaseNode>),
    Batch(Vec<ShowcaseNode>),
}

fn add_showcase_node(
    conn: &mut Connection,
    showcase_id: i64,
    body: &Value,
) -> Result<AddNodeResult, DbError> {
    let kind = body
        .get("type")
        .or_else(|| body.get("node_type"))
        .filter(|value| !value.is_null())
        .and_then(Value::as_str)
        .unwrap_or("");
    match kind {
        "category" => add_category_placement(conn, showcase_id, body)
            .map(|node| AddNodeResult::Single(Box::new(node))),
        "grouping" => add_grouping(conn, showcase_id, body)
            .map(|node| AddNodeResult::Single(Box::new(node))),
        "notes" => add_notes_batch(conn, showcase_id, body).map(AddNodeResult::Batch),
        _ => {
            let label = body
                .get("type")
                .or_else(|| body.get("node_type"))
                .map(node_string)
                .unwrap_or_default();
            Err(DbError::Failed(format!("Unsupported node type: {label}.")))
        }
    }
}

/// Rename a node, or set/clear a grouping's manual cover.
fn update_showcase_node(
    conn: &mut Connection,
    id: i64,
    body: &Value,
) -> Result<ShowcaseNode, DbError> {
    let existing = get_node_row(conn, id)?
        .ok_or_else(|| DbError::Failed("Node not found.".to_owned()))?;
    if body.get("cover_note_id").is_some_and(|value| !value.is_null()) {
        if existing.node_type != "grouping" {
            return Err(DbError::Failed(
                "A cover note can only be set on a grouping.".to_owned(),
            ));
        }
        let raw = body.get("cover_note_id");
        let Some(cover_id) = raw.and_then(js_number) else {
            return Err(DbError::Failed("Cover note not found.".to_owned()));
        };
        if !note_exists(conn, cover_id)? {
            return Err(DbError::Failed("Cover note not found.".to_owned()));
        }
    }
    if existing.node_type == "category" {
        let Some(category_id) = existing.category_id else {
            return Err(DbError::Failed("Category not found.".to_owned()));
        };
        rename_category(conn, category_id, &route_name(body.get("name")))?;
    } else if existing.node_type == "grouping" {
        if let Some(raw_name) = body.get("name") {
            if !raw_name.is_null() || body.get("name").is_some() {
                let name = normalize_name(node_string(raw_name).trim());
                if name.is_empty() {
                    return Err(DbError::Failed("Node name is required.".to_owned()));
                }
                conn.execute(
                    "UPDATE showcase_nodes SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
                    params![name, id],
                )
                .map_err(classify)?;
            }
        }
        if body.get("cover_note_id").is_some() {
            let cover: Option<i64> = match body.get("cover_note_id") {
                None | Some(Value::Null) => None,
                Some(value) => js_number(value),
            };
            // Validated above when non-null; null clears.
            conn.execute(
                "UPDATE showcase_nodes SET cover_note_id = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![cover, id],
            )
            .map_err(classify)?;
        }
    } else {
        return Err(DbError::Failed("A note node cannot be renamed.".to_owned()));
    }
    get_node(conn, id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))
}

fn delete_showcase_node(conn: &mut Connection, id: i64) -> Result<bool, DbError> {
    let changed = conn
        .execute("DELETE FROM showcase_nodes WHERE id = ?1", params![id])
        .map_err(classify)?;
    Ok(changed > 0)
}

fn child_ids(
    conn: &Connection,
    showcase_id: i64,
    parent_node_id: Option<i64>,
) -> Result<Vec<i64>, DbError> {
    let mut stmt = conn
        .prepare(
            "SELECT id FROM showcase_nodes
             WHERE showcase_id = ?1 AND parent_node_id IS ?2
             ORDER BY position ASC, id ASC",
        )
        .map_err(classify)?;
    let rows: Vec<i64> = stmt
        .query_map(params![showcase_id, parent_node_id], |row| row.get(0))
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    Ok(rows)
}

fn reorder_showcase_nodes(
    conn: &mut Connection,
    showcase_id: i64,
    parent_node_id: Option<i64>,
    ordered: &[i64],
) -> Result<Vec<ShowcaseNode>, DbError> {
    const MESSAGE: &str = "Reorder request must include every child exactly once.";
    ensure_showcase(conn, showcase_id)?;
    if let Some(parent_id) = parent_node_id {
        if parent_id <= 0 {
            return Err(DbError::Failed(
                "A valid parent node is required.".to_owned(),
            ));
        }
        let parent = get_node_row(conn, parent_id)?;
        let Some(parent) = parent else {
            return Err(DbError::Failed("Parent node not found.".to_owned()));
        };
        if parent.showcase_id != showcase_id {
            return Err(DbError::Failed("Parent node not found.".to_owned()));
        }
    }
    let current = child_ids(conn, showcase_id, parent_node_id)?;
    // `Number(x)` is NaN (non-positive here): it can never join the
    // permutation, so the reorder fails exactly like Node.
    if ordered.iter().any(|id| *id <= 0)
        || HashSet::<i64>::from_iter(ordered.iter().copied()).len() != ordered.len()
        || ordered.len() != current.len()
        || current.iter().any(|id| !ordered.contains(id))
    {
        return Err(DbError::Failed(MESSAGE.to_owned()));
    }
    let tx = conn.transaction().map_err(classify)?;
    for (index, id) in ordered.iter().enumerate() {
        tx.execute(
            "UPDATE showcase_nodes SET position = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![(index + 1) as i64, id],
        )
        .map_err(classify)?;
    }
    tx.commit().map_err(classify)?;
    let mut nodes = Vec::with_capacity(ordered.len());
    for id in ordered {
        nodes.push(
            get_node(conn, *id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))?,
        );
    }
    Ok(nodes)
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

fn body_or_empty(body: Option<Json<Value>>) -> Value {
    body.map(|Json(value)| value).unwrap_or(Value::Null)
}

/// `parseId` for route params: `Number()` coercion, positive integers only.
fn parse_id(raw: &str) -> Option<i64> {
    js_number(&Value::String(raw.to_owned())).filter(|id| *id > 0)
}

/// Caught-style database failure: any error answers 400 with the message.
fn db_failure(error: crate::AppError) -> Response {
    match error {
        crate::AppError::DatabaseUnavailable => bad_request("Database unavailable."),
        crate::AppError::Http { message, .. } => bad_request(&message),
    }
}

async fn list_showcases_handler(State(state): State<AppState>) -> Result<Response, crate::AppError> {
    let showcases =
        db::with_conn(&state.pool, |conn| list_showcases(conn)).await?;
    Ok(ok(json!({ "showcases": showcases })))
}

async fn create_showcase_handler(
    State(state): State<AppState>,
    body: Option<Json<Value>>,
) -> Response {
    let payload = body_or_empty(body);
    let name = route_name(payload.get("name"));
    match db::with_conn(&state.pool, move |conn| create_showcase(conn, &name)).await {
        Ok(showcase) => created(json!({ "showcase": showcase })),
        Err(error) => db_failure(error),
    }
}

async fn reorder_showcases_handler(
    State(state): State<AppState>,
    body: Option<Json<Value>>,
) -> Response {
    const REQUIRED: &str = "A full ordered list of showcase IDs is required.";
    const PERMUTATION: &str = "Reorder request must include every showcase exactly once.";
    let payload = body_or_empty(body);
    let Some(array) = payload.get("ids").and_then(Value::as_array) else {
        return bad_request(REQUIRED);
    };
    let mut ids = Vec::with_capacity(array.len());
    for item in array {
        match js_number(item) {
            Some(id) => ids.push(id),
            None => return bad_request(PERMUTATION),
        }
    }
    match db::with_conn(&state.pool, move |conn| reorder_showcases(conn, &ids)).await {
        Ok(showcases) => ok(json!({ "showcases": showcases })),
        Err(error) => db_failure(error),
    }
}

async fn rename_showcase_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("A valid showcase ID is required.");
    };
    let exists = match db::with_conn(&state.pool, move |conn| get_showcase(conn, id)).await {
        Ok(showcase) => showcase.is_some(),
        Err(error) => return db_failure(error),
    };
    if !exists {
        return not_found("Showcase not found.");
    }
    let payload = body_or_empty(body);
    let name = route_name(payload.get("name"));
    if name.is_empty() {
        return bad_request("Showcase name is required.");
    }
    match db::with_conn(&state.pool, move |conn| rename_showcase(conn, id, &name)).await {
        Ok(showcase) => ok(json!({ "showcase": showcase })),
        Err(error) => db_failure(error),
    }
}

async fn delete_showcase_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("A valid showcase ID is required.");
    };
    let exists = match db::with_conn(&state.pool, move |conn| get_showcase(conn, id)).await {
        Ok(showcase) => showcase.is_some(),
        Err(error) => return db_failure(error),
    };
    if !exists {
        return not_found("Showcase not found.");
    }
    match db::with_conn(&state.pool, move |conn| delete_showcase(conn, id)).await {
        Ok(()) => ok(json!({ "success": true })),
        Err(error) => db_failure(error),
    }
}

async fn get_tree_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Result<Response, crate::AppError> {
    let Some(id) = parse_id(&raw_id) else {
        return Ok(bad_request("Showcase id must be a positive integer."));
    };
    let exists =
        db::with_conn(&state.pool, move |conn| get_showcase(conn, id)).await?.is_some();
    if !exists {
        return Ok(not_found("Showcase not found."));
    }
    let nodes = db::with_conn(&state.pool, move |conn| get_tree(conn, id)).await?;
    Ok(ok(json!({ "showcase_id": id, "nodes": nodes })))
}

async fn add_node_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("Showcase id must be a positive integer.");
    };
    let exists = match db::with_conn(&state.pool, move |conn| get_showcase(conn, id)).await {
        Ok(showcase) => showcase.is_some(),
        Err(error) => return db_failure(error),
    };
    if !exists {
        return not_found("Showcase not found.");
    }
    let payload = body_or_empty(body);
    // An empty body has no `type`: the dispatch answers `Unsupported node
    // type: .` exactly like Node.
    let payload = if payload.is_null() { json!({}) } else { payload };
    match db::with_conn(&state.pool, move |conn| add_showcase_node(conn, id, &payload)).await {
        Ok(AddNodeResult::Single(node)) => created(json!({ "node": node })),
        Ok(AddNodeResult::Batch(nodes)) => created(json!({ "nodes": nodes })),
        Err(error) => db_failure(error),
    }
}

async fn reorder_nodes_handler(
    State(state): State<AppState>,
    body: Option<Json<Value>>,
) -> Response {
    const REQUIRED: &str = "A full ordered list of child node IDs is required.";
    const PERMUTATION: &str = "Reorder request must include every child exactly once.";
    let payload = body_or_empty(body);
    let Some(showcase_id) = payload.get("showcase_id").and_then(js_number) else {
        return bad_request("A valid showcase ID is required.");
    };
    if showcase_id <= 0 {
        return bad_request("A valid showcase ID is required.");
    }
    // Only the canonical `parent_node_id` key counts; `parent_id`/`ids`
    // aliases are not the contract and fail the shape check below. A
    // non-null, non-numeric parent answers the parent message; `None` means
    // null/missing (top level).
    let parent_node_id = match payload.get("parent_node_id") {
        None | Some(Value::Null) => None,
        Some(value) => match js_number(value) {
            Some(id) => Some(id),
            None => {
                return bad_request("A valid parent node is required.");
            }
        },
    };
    let Some(array) = payload.get("node_ids").and_then(Value::as_array) else {
        return bad_request(REQUIRED);
    };
    let mut ordered = Vec::with_capacity(array.len());
    for item in array {
        match js_number(item) {
            Some(id) => ordered.push(id),
            None => return bad_request(PERMUTATION),
        }
    }
    match db::with_conn(&state.pool, move |conn| {
        reorder_showcase_nodes(conn, showcase_id, parent_node_id, &ordered)
    })
    .await
    {
        Ok(nodes) => ok(json!({ "nodes": nodes })),
        Err(error) => db_failure(error),
    }
}

async fn update_node_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("Node id must be a positive integer.");
    };
    let exists = match db::with_conn(&state.pool, move |conn| get_node(conn, id)).await {
        Ok(node) => node.is_some(),
        Err(error) => return db_failure(error),
    };
    if !exists {
        return not_found("Node not found.");
    }
    let payload = body_or_empty(body);
    let payload = if payload.is_null() { json!({}) } else { payload };
    match db::with_conn(&state.pool, move |conn| update_showcase_node(conn, id, &payload)).await {
        Ok(node) => ok(json!({ "node": node })),
        Err(error) => db_failure(error),
    }
}

async fn delete_node_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
) -> Result<Response, crate::AppError> {
    let Some(id) = parse_id(&raw_id) else {
        return Ok(bad_request("Node id must be a positive integer."));
    };
    let exists = db::with_conn(&state.pool, move |conn| get_node(conn, id))
        .await?
        .is_some();
    if !exists {
        return Ok(not_found("Node not found."));
    }
    // The subtree cascades; the label stays in the pool.
    db::with_conn(&state.pool, move |conn| delete_showcase_node(conn, id)).await?;
    Ok(ok(json!({ "success": true })))
}

async fn list_categories_handler(
    State(state): State<AppState>,
) -> Result<Response, crate::AppError> {
    let categories = db::with_conn(&state.pool, |conn| list_categories(conn)).await?;
    Ok(ok(json!({ "categories": categories })))
}

async fn create_category_handler(
    State(state): State<AppState>,
    body: Option<Json<Value>>,
) -> Response {
    let payload = body_or_empty(body);
    let name = route_name(payload.get("name"));
    if name.is_empty() {
        return bad_request("Category name is required.");
    }
    match db::with_conn(&state.pool, move |conn| create_category(conn, &name)).await {
        Ok(category) => created(json!({ "category": category })),
        Err(error) => db_failure(error),
    }
}

async fn rename_category_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let Some(id) = js_number(&Value::String(raw_id)).filter(|value| *value > 0) else {
        return bad_request("Category id must be a positive integer.");
    };
    let exists = match db::with_conn(&state.pool, move |conn| get_category(conn, id)).await {
        Ok(category) => category.is_some(),
        Err(error) => return db_failure(error),
    };
    if !exists {
        return not_found("Category not found.");
    }
    let payload = body_or_empty(body);
    let name = route_name(payload.get("name"));
    if name.is_empty() {
        return bad_request("Category name is required.");
    }
    match db::with_conn(&state.pool, move |conn| rename_category(conn, id, &name)).await {
        Ok(category) => ok(json!({ "category": category })),
        Err(error) => db_failure(error),
    }
}

pub fn showcases_router() -> Router<AppState> {
    Router::new()
        .route("/api/showcases", get(list_showcases_handler).post(create_showcase_handler))
        // `/order` sits before `/:showcaseId` so the literal wins.
        .route("/api/showcases/order", put(reorder_showcases_handler))
        .route(
            "/api/showcases/{showcaseId}",
            put(rename_showcase_handler).delete(delete_showcase_handler),
        )
        .route("/api/showcases/{id}/tree", get(get_tree_handler))
        .route("/api/showcases/{id}/nodes", post(add_node_handler))
}

pub fn nodes_router() -> Router<AppState> {
    Router::new()
        // `/order` sits before `/:id` so the literal wins.
        .route("/api/nodes/order", put(reorder_nodes_handler))
        .route("/api/nodes/{id}", put(update_node_handler).delete(delete_node_handler))
}

pub fn categories_router() -> Router<AppState> {
    Router::new()
        .route("/api/categories", get(list_categories_handler).post(create_category_handler))
        .route("/api/categories/{id}", put(rename_category_handler))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_normalization_collapses_whitespace() {
        assert_eq!(normalize_name("  Themes   and  more "), "Themes and more");
        assert_eq!(normalize_name("   "), "");
    }

    #[test]
    fn full_permutation_rejects_partial_and_foreign() {
        assert!(assert_full_permutation(&[1, 2], &[1, 2], "x").is_ok());
        assert!(assert_full_permutation(&[1, 2], &[1], "x").is_err());
        assert!(assert_full_permutation(&[1, 2], &[1, 1], "x").is_err());
        assert!(assert_full_permutation(&[1, 2], &[1, 3], "x").is_err());
        assert!(assert_full_permutation(&[1, 2], &[], "x").is_err());
    }
}
