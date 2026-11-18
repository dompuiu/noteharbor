//! Showcases + nodes + categories routes plus the showcase database helpers.
//!
//! Behavior notes (ticket 10):
//! - Showcase CRUD + order, node tree building with embedded notes, placement
//!   rules (top-level categories, groupings under category/grouping, notes
//!   under parents), node reorder/rename/cover/delete, category pool with
//!   get-or-create and delete of unplaced labels.
//! - Route-level catch semantics are: POST/PUT/reorder
//!   answer any database failure as 400 with the message (existence checks
//!   before the `try` still propagate 503/500, 404s preserved), while
//!   GET/DELETE propagate `AppError`.
//! - `readShowcaseId`/`parseId` use `Number()` coercion (`js_number`): an
//!   unparsable id is 400, an unknown id is 404. Node ids in reorder bodies
//!   use `Number()` too: NaN can never join the permutation, so the reorder
//!   fails with the permutation message, like the original membership check.
//! - Category placements check only `parent_id` for the top-level rule (a
//!   `parent_node_id` alias does not trigger it), groupings require
//!   `parent_id`, and the notes batch reads `parent_id ?? parent_node_id`.
//!   Node reorder reads only the canonical
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
    js_number,
    notes::{NOTE_FIELDS, Note, Tag, map_note, node_string},
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
    pub entry_count: i64,
    pub owned_count: i64,
    pub catalog_entry_count: i64,
    pub required_collection_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// How many Showcases place this label. Zero means the pool may delete it.
    pub showcase_count: i64,
}

/// The four catalog metadata fields a Catalog entry carries on its node.
/// They are meaningful only for `catalog_entry`; absent values serialize as
/// empty strings so the wire shape stays four strings.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CatalogEntry {
    pub catalog_number: String,
    pub denomination: String,
    pub issue_date: String,
    pub source: String,
}

/// A Catalog entry's position fields: its own catalog metadata, the ordered
/// specimens, and the primary. Flattened into `ShowcaseNode` so only a
/// `catalog_entry` carries them. An entry with no specimens still sends
/// `specimens: []` and `primary_note_id: null`.
#[derive(Debug, Clone, Serialize)]
pub struct CatalogEntryPayload {
    pub entry: CatalogEntry,
    pub specimens: Vec<Note>,
    pub primary_note_id: Option<i64>,
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
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub catalog: Option<CatalogEntryPayload>,
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
    catalog_number: Option<String>,
    denomination: Option<String>,
    issue_date: Option<String>,
    source: Option<String>,
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
        catalog_number: row.get(9)?,
        denomination: row.get(10)?,
        issue_date: row.get(11)?,
        source: row.get(12)?,
    })
}

const NODE_SELECT: &str = "SELECT
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
        END AS name,
        showcase_nodes.catalog_number,
        showcase_nodes.denomination,
        showcase_nodes.issue_date,
        showcase_nodes.source
      FROM showcase_nodes
      LEFT JOIN categories ON categories.id = showcase_nodes.category_id";

/// One node row, or every node of a Showcase, sharing the same 13 columns.
fn node_rows_sql(tail: &str) -> String {
    format!("{NODE_SELECT}\n      {tail}")
}

const LIST_NODES_TAIL: &str =
    "WHERE showcase_nodes.showcase_id = ?1
      ORDER BY showcase_nodes.position ASC, showcase_nodes.id ASC";

// ---------------------------------------------------------------------------
// Small helpers (mirror `db.js`)
// ---------------------------------------------------------------------------

/// Trim + collapse internal whitespace runs.
pub fn normalize_name(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Route-level trim (`String(value ?? '').trim()` semantics via `node_string`,
/// which carries the JS `String()` fidelity for arrays/objects).
fn route_name(value: Option<&Value>) -> String {
    value.map(node_string).unwrap_or_default().trim().to_owned()
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    error.to_string().contains("UNIQUE constraint failed")
}

fn map_showcase(row: &Row<'_>, required: Vec<i64>) -> rusqlite::Result<Showcase> {
    let note_count: i64 = row.get(5)?;
    let catalog_entry_count: i64 = row.get(6)?;
    Ok(Showcase {
        id: row.get(0)?,
        name: row.get(1)?,
        display_order: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        // A catalog Showcase counts every presentable position: note leaves
        // plus Catalog entries (an entry with no specimens is still a slot).
        note_count,
        entry_count: note_count + catalog_entry_count,
        owned_count: row.get(7)?,
        catalog_entry_count,
        required_collection_ids: required,
    })
}

/// `owned_count`: the owned positions in a Showcase — a note leaf whose Note is
/// owned, plus a Catalog entry with at least one owned specimen. The primary is
/// display-only and never decides ownership.
const OWNED_COUNT_SQL: &str = "(SELECT COUNT(*) FROM showcase_nodes owned_nodes
          WHERE owned_nodes.showcase_id = showcases.id
            AND (
              (owned_nodes.node_type = 'note' AND EXISTS (
                 SELECT 1 FROM banknotes owned_note
                 WHERE owned_note.id = owned_nodes.note_id AND owned_note.owned = 1))
              OR (owned_nodes.node_type = 'catalog_entry' AND EXISTS (
                 SELECT 1 FROM showcase_catalog_notes owned_specimen
                 INNER JOIN banknotes owned_note ON owned_note.id = owned_specimen.note_id
                 WHERE owned_specimen.node_id = owned_nodes.id AND owned_note.owned = 1))
            )) AS owned_count";

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

/// The Showcase row's count columns, shared by the list and the single read.
/// `tail` supplies the `ORDER BY`/`WHERE` clause.
fn showcase_rows_sql(tail: &str) -> String {
    format!(
        "SELECT
        showcases.id,
        showcases.name,
        showcases.display_order,
        showcases.created_at,
        showcases.updated_at,
        (SELECT COUNT(*) FROM showcase_nodes
          WHERE showcase_nodes.showcase_id = showcases.id
            AND showcase_nodes.node_type = 'note') AS note_count,
        (SELECT COUNT(*) FROM showcase_nodes
          WHERE showcase_nodes.showcase_id = showcases.id
            AND showcase_nodes.node_type = 'catalog_entry') AS catalog_entry_count,
        {OWNED_COUNT_SQL}
      FROM showcases
      {tail}"
    )
}

fn list_showcases(conn: &Connection) -> Result<Vec<Showcase>, DbError> {
    let required = required_map(conn)?;
    let mut stmt = conn
        .prepare(&showcase_rows_sql("ORDER BY display_order ASC, id ASC"))
        .map_err(classify)?;
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
    let mut stmt = conn
        .prepare(&showcase_rows_sql("WHERE id = ?1"))
        .map_err(classify)?;
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
    // Reject partial, duplicated, foreign, or non-positive lists.
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
// Categories (shared label pool, get-or-create, delete when unplaced)
// ---------------------------------------------------------------------------

const CATEGORY_SELECT: &str = "SELECT
        categories.id,
        categories.name,
        categories.created_at,
        categories.updated_at,
        (SELECT COUNT(DISTINCT showcase_nodes.showcase_id)
           FROM showcase_nodes
           WHERE showcase_nodes.category_id = categories.id) AS showcase_count
      FROM categories";

fn map_category(row: &Row<'_>) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        showcase_count: row.get(4)?,
    })
}

fn list_categories(conn: &Connection) -> Result<Vec<Category>, DbError> {
    let mut stmt = conn
        .prepare(&format!(
            "{CATEGORY_SELECT} ORDER BY categories.name COLLATE NOCASE ASC, categories.id ASC"
        ))
        .map_err(classify)?;
    let rows: Vec<Category> = stmt
        .query_map([], map_category)
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    Ok(rows)
}

fn find_category_by_name(conn: &Connection, name: &str) -> Result<Option<Category>, DbError> {
    let mut stmt = conn
        .prepare(&format!(
            "{CATEGORY_SELECT} WHERE categories.name = ?1 COLLATE NOCASE"
        ))
        .map_err(classify)?;
    match stmt.query_row(params![name], map_category) {
        Ok(category) => Ok(Some(category)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

fn get_category(conn: &Connection, id: i64) -> Result<Option<Category>, DbError> {
    let mut stmt = conn
        .prepare(&format!("{CATEGORY_SELECT} WHERE categories.id = ?1"))
        .map_err(classify)?;
    match stmt.query_row(params![id], map_category) {
        Ok(category) => Ok(Some(category)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

/// Resolve a pool label by name, inserting it when the name is new. An existing
/// label wins on a case-insensitive match and keeps its own spelling.
fn get_or_create_category(conn: &Connection, name: &str) -> Result<Category, DbError> {
    let normalized = normalize_name(name);
    if normalized.is_empty() {
        return Err(DbError::Failed("Category name is required.".to_owned()));
    }
    if let Some(existing) = find_category_by_name(conn, &normalized)? {
        return Ok(existing);
    }
    match conn.execute(
        "INSERT INTO categories (name, created_at, updated_at)
         VALUES (?1, datetime('now'), datetime('now'))",
        params![normalized],
    ) {
        Ok(_) => {
            let id = conn.last_insert_rowid();
            get_category(conn, id)?
                .ok_or_else(|| DbError::Failed("Category not found.".to_owned()))
        }
        // Another writer created the same name first: adopt its label.
        Err(error) if is_unique_violation(&error) => find_category_by_name(conn, &normalized)?
            .ok_or_else(|| DbError::Failed("Category not found.".to_owned())),
        Err(error) => Err(classify(error)),
    }
}

pub fn create_category(conn: &mut Connection, name: &str) -> Result<Category, DbError> {
    get_or_create_category(conn, name)
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

/// Point one Category Placement at a pool label. Only this Showcase changes:
/// a new name creates a label, an existing name reuses it, and the label left
/// behind is pruned when this was its last placement. A label the Showcase
/// already places is refused, since one Showcase places each label once.
fn set_category_placement_label(
    conn: &mut Connection,
    existing: &NodeRow,
    name: &str,
) -> Result<(), DbError> {
    let tx = conn.transaction().map_err(classify)?;
    let target = get_or_create_category(&tx, name)?;
    if existing.category_id == Some(target.id) {
        tx.commit().map_err(classify)?;
        return Ok(());
    }
    // The partial unique index on (showcase_id, category_id) enforces "one
    // placement per label per Showcase"; its violation reads as a clash.
    match tx.execute(
        "UPDATE showcase_nodes SET category_id = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![target.id, existing.id],
    ) {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(DbError::Failed(
                "This category is already in the showcase.".to_owned(),
            ));
        }
        Err(error) => return Err(classify(error)),
    }
    if let Some(old_category_id) = existing.category_id {
        tx.execute(
            "DELETE FROM categories
             WHERE id = ?1
               AND NOT EXISTS (SELECT 1 FROM showcase_nodes WHERE category_id = ?1)",
            params![old_category_id],
        )
        .map_err(classify)?;
    }
    tx.commit().map_err(classify)?;
    Ok(())
}

/// Delete a label only while no Showcase places it. A used label stays in the
/// pool; removing its last placement first makes it deletable.
pub fn delete_category(conn: &mut Connection, id: i64) -> Result<(), DbError> {
    let Some(category) = get_category(conn, id)? else {
        return Err(DbError::Failed("Category not found.".to_owned()));
    };
    if category.showcase_count > 0 {
        let noun = if category.showcase_count == 1 {
            "showcase"
        } else {
            "showcases"
        };
        return Err(DbError::Failed(format!(
            "This category is placed in {} {noun}.",
            category.showcase_count
        )));
    }
    conn.execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(classify)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Notes embedded in the tree (full `rowToNote` shapes with tags)
// ---------------------------------------------------------------------------

fn fetch_notes(conn: &Connection, ids: &[i64]) -> Result<HashMap<i64, Note>, DbError> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("SELECT {NOTE_FIELDS} FROM banknotes WHERE id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql).map_err(classify)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), map_note)
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

/// One entry's specimens in display order, plus the id the server marks
/// primary. The triggers keep this set consistent with the database.
#[derive(Debug, Default)]
struct SpecimenSet {
    ordered: Vec<i64>,
    primary: Option<i64>,
}

/// Specimen rows for a `showcase_nodes` filter column, grouped by entry node.
/// `filter` is one of the two internal column paths below, never user input.
fn query_specimens(
    conn: &Connection,
    filter: &str,
    key: i64,
) -> Result<HashMap<i64, SpecimenSet>, DbError> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT showcase_catalog_notes.node_id,
                    showcase_catalog_notes.note_id,
                    showcase_catalog_notes.is_primary
             FROM showcase_catalog_notes
             INNER JOIN showcase_nodes
               ON showcase_nodes.id = showcase_catalog_notes.node_id
             WHERE {filter} = ?1
             ORDER BY showcase_catalog_notes.node_id ASC,
                      showcase_catalog_notes.position ASC,
                      showcase_catalog_notes.note_id ASC"
        ))
        .map_err(classify)?;
    let rows: Vec<(i64, i64, bool)> = stmt
        .query_map(params![key], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    let mut out: HashMap<i64, SpecimenSet> = HashMap::new();
    for (node_id, note_id, is_primary) in rows {
        let set = out.entry(node_id).or_default();
        set.ordered.push(note_id);
        if is_primary {
            set.primary = Some(note_id);
        }
    }
    Ok(out)
}

/// Every specimen in a Showcase, grouped by its entry node.
fn fetch_specimens(
    conn: &Connection,
    showcase_id: i64,
) -> Result<HashMap<i64, SpecimenSet>, DbError> {
    query_specimens(conn, "showcase_nodes.showcase_id", showcase_id)
}

/// One entry's specimens, without reading the rest of its Showcase.
fn fetch_entry_specimens(conn: &Connection, node_id: i64) -> Result<SpecimenSet, DbError> {
    Ok(query_specimens(conn, "showcase_catalog_notes.node_id", node_id)?
        .remove(&node_id)
        .unwrap_or_default())
}

fn node_from_row(
    row: NodeRow,
    notes: &HashMap<i64, Note>,
    specimens: Option<&SpecimenSet>,
) -> ShowcaseNode {
    // Only a catalog_entry carries the catalog payload; every other node kind
    // omits it from the wire.
    let is_entry = row.node_type == "catalog_entry";
    ShowcaseNode {
        id: row.id,
        node_type: row.node_type,
        name: row.name,
        category_id: row.category_id,
        parent_node_id: row.parent_node_id,
        note_id: row.note_id,
        cover_note_id: row.cover_note_id,
        position: row.position,
        note: row.note_id.and_then(|id| notes.get(&id).cloned()),
        cover_note: row.cover_note_id.and_then(|id| notes.get(&id).cloned()),
        catalog: is_entry.then(|| CatalogEntryPayload {
            entry: CatalogEntry {
                catalog_number: row.catalog_number.unwrap_or_default(),
                denomination: row.denomination.unwrap_or_default(),
                issue_date: row.issue_date.unwrap_or_default(),
                source: row.source.unwrap_or_default(),
            },
            specimens: specimens
                .map(|set| {
                    set.ordered
                        .iter()
                        .filter_map(|id| notes.get(id).cloned())
                        .collect()
                })
                .unwrap_or_default(),
            primary_note_id: specimens.and_then(|set| set.primary),
        }),
        children: Vec::new(),
    }
}

fn build_tree(
    rows: Vec<NodeRow>,
    notes: &HashMap<i64, Note>,
    specimens: &HashMap<i64, SpecimenSet>,
) -> Vec<ShowcaseNode> {
    let mut by_id: HashMap<i64, ShowcaseNode> = HashMap::new();
    let mut parents: HashMap<i64, Option<i64>> = HashMap::new();
    let mut order: Vec<i64> = Vec::new();
    for row in rows {
        let id = row.id;
        order.push(id);
        parents.insert(id, row.parent_node_id);
        by_id.insert(id, node_from_row(row, notes, specimens.get(&id)));
    }
    // Rows arrive ordered `position, id`; appending in that order keeps every
    // sibling group ordered without a second sort.
    let mut child_ids: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut roots: Vec<i64> = Vec::new();
    for id in &order {
        match parents[id] {
            Some(parent) if by_id.contains_key(&parent) => {
                child_ids.entry(parent).or_default().push(*id);
            }
            _ => roots.push(*id),
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
    let mut stmt = conn
        .prepare(&node_rows_sql(LIST_NODES_TAIL))
        .map_err(classify)?;
    let rows = stmt
        .query_map(params![showcase_id], map_node_row)
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    let specimens = fetch_specimens(conn, showcase_id)?;
    let mut wanted: Vec<i64> = rows
        .iter()
        .flat_map(|row| [row.note_id, row.cover_note_id])
        .flatten()
        .collect();
    wanted.extend(specimens.values().flat_map(|set| set.ordered.iter().copied()));
    let notes = fetch_notes(conn, &wanted)?;
    Ok(build_tree(rows, &notes, &specimens))
}

fn get_node(conn: &Connection, id: i64) -> Result<Option<ShowcaseNode>, DbError> {
    let mut stmt = conn
        .prepare(&node_rows_sql("WHERE showcase_nodes.id = ?1"))
        .map_err(classify)?;
    let row = match stmt.query_row(params![id], map_node_row) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(error) => return Err(classify(error)),
    };
    let specimens = fetch_entry_specimens(conn, id)?;
    let mut wanted: Vec<i64> = [row.note_id, row.cover_note_id]
        .into_iter()
        .flatten()
        .collect();
    wanted.extend(specimens.ordered.iter().copied());
    let notes = fetch_notes(conn, &wanted)?;
    Ok(Some(node_from_row(row, &notes, Some(&specimens))))
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
    let mut stmt = conn
        .prepare(&node_rows_sql("WHERE showcase_nodes.id = ?1"))
        .map_err(classify)?;
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

fn showcase_places_category(
    conn: &Connection,
    showcase_id: i64,
    category_id: i64,
) -> Result<bool, DbError> {
    let mut stmt = conn
        .prepare(
            "SELECT 1 FROM showcase_nodes
             WHERE showcase_id = ?1 AND category_id = ?2 AND node_type = 'category'",
        )
        .map_err(classify)?;
    match stmt.query_row(params![showcase_id, category_id], |_| Ok(())) {
        Ok(()) => Ok(true),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(classify(error)),
    }
}

/// The source subtree in preorder: the root followed by every descendant,
/// sibling groups ordered `position, id`. Rows arrive already sorted, so
/// grouping them by parent keeps each level's order without a second sort.
fn subtree_rows(conn: &Connection, root: NodeRow) -> Result<Vec<NodeRow>, DbError> {
    let mut stmt = conn
        .prepare(&node_rows_sql(LIST_NODES_TAIL))
        .map_err(classify)?;
    let rows = stmt
        .query_map(params![root.showcase_id], map_node_row)
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    let mut by_parent: HashMap<i64, Vec<NodeRow>> = HashMap::new();
    for row in rows {
        if let Some(parent_id) = row.parent_node_id {
            by_parent.entry(parent_id).or_default().push(row);
        }
    }
    fn walk(
        row: NodeRow,
        by_parent: &mut HashMap<i64, Vec<NodeRow>>,
        ordered: &mut Vec<NodeRow>,
    ) {
        let id = row.id;
        ordered.push(row);
        if let Some(children) = by_parent.remove(&id) {
            for child in children {
                walk(child, by_parent, ordered);
            }
        }
    }
    let mut ordered = Vec::new();
    walk(root, &mut by_parent, &mut ordered);
    Ok(ordered)
}

/// Insert one copied node. A label clash that slipped past the pre-check (a
/// stale client, or a category row nested in the source) answers the same
/// conflict message as a direct placement.
fn insert_copied_node(
    conn: &Connection,
    showcase_id: i64,
    row: &NodeRow,
    parent_node_id: Option<i64>,
    position: i64,
) -> Result<i64, DbError> {
    match conn.execute(
        "INSERT INTO showcase_nodes (
           showcase_id, parent_node_id, node_type, category_id, name,
           note_id, cover_note_id, catalog_number, denomination, issue_date,
           source, position, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                 datetime('now'), datetime('now'))",
        params![
            showcase_id,
            parent_node_id,
            row.node_type,
            row.category_id,
            row.name,
            row.note_id,
            row.cover_note_id,
            row.catalog_number,
            row.denomination,
            row.issue_date,
            row.source,
            position,
        ],
    ) {
        Ok(_) => Ok(conn.last_insert_rowid()),
        Err(error) if is_unique_violation(&error) => Err(DbError::Failed(
            "This category is already in the showcase.".to_owned(),
        )),
        Err(error) => Err(classify(error)),
    }
}

/// Copy a top-level Category placement and its whole subtree into another
/// Showcase, inside one transaction. Notes are referenced, never cloned; the
/// shared pool label is reused. The copy appends after the target's last
/// top-level Category and keeps every sibling order below it.
pub fn duplicate_category_placement(
    conn: &mut Connection,
    node_id: i64,
    target_showcase_id: i64,
) -> Result<ShowcaseNode, DbError> {
    let source = get_node_row(conn, node_id)?
        .ok_or_else(|| DbError::Failed("Node not found.".to_owned()))?;
    if source.node_type != "category" || source.parent_node_id.is_some() {
        return Err(DbError::Failed(
            "Only a top-level category can be duplicated.".to_owned(),
        ));
    }
    // The source Showcase already places the label, so this reads as the same
    // conflict a second placement would.
    if target_showcase_id == source.showcase_id {
        return Err(DbError::Failed(
            "This category is already in the showcase.".to_owned(),
        ));
    }
    ensure_showcase(conn, target_showcase_id)?;
    let Some(category_id) = source.category_id else {
        return Err(DbError::Failed("Category not found.".to_owned()));
    };
    if showcase_places_category(conn, target_showcase_id, category_id)? {
        return Err(DbError::Failed(
            "This category is already in the showcase.".to_owned(),
        ));
    }
    let source_showcase_id = source.showcase_id;
    let rows = subtree_rows(conn, source)?;
    let specimens = fetch_specimens(conn, source_showcase_id)?;
    let tx = conn.transaction().map_err(classify)?;
    let root_position = next_position(&tx, target_showcase_id, None)?;
    let mut copied: HashMap<i64, i64> = HashMap::with_capacity(rows.len());
    for row in &rows {
        let parent_node_id = match row.parent_node_id {
            None => None,
            Some(old_parent) => Some(*copied.get(&old_parent).ok_or_else(|| {
                DbError::Failed("Only a top-level category can be duplicated.".to_owned())
            })?),
        };
        // The root takes the target's next top-level slot; every descendant
        // keeps the position it had under its now-copied parent.
        let position = if row.parent_node_id.is_none() {
            root_position
        } else {
            row.position.unwrap_or(0)
        };
        let new_id = insert_copied_node(&tx, target_showcase_id, row, parent_node_id, position)?;
        if row.node_type == "catalog_entry" {
            if let Some(set) = specimens.get(&row.id) {
                insert_specimens(&tx, new_id, &set.ordered, set.primary)?;
            }
        }
        copied.insert(row.id, new_id);
    }
    let root_id = *copied
        .get(&node_id)
        .ok_or_else(|| DbError::Failed("Node not found.".to_owned()))?;
    tx.commit().map_err(classify)?;
    get_node(conn, root_id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))
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

/// Resolve the placement parent for notes and Catalog entries: `parent_id`
/// wins unless null, then `parent_node_id`. The row must exist in this
/// Showcase; callers add their own node-type rule.
fn resolve_parent(
    conn: &Connection,
    showcase_id: i64,
    body: &Value,
    missing_message: &str,
) -> Result<NodeRow, DbError> {
    let raw_parent = match body.get("parent_id") {
        Some(value) if !value.is_null() => Some(value),
        _ => body.get("parent_node_id"),
    };
    let Some(parent_value) = raw_parent.filter(|value| !value.is_null()) else {
        return Err(DbError::Failed(missing_message.to_owned()));
    };
    let Some(parent_id) = js_number(parent_value).filter(|id| *id > 0) else {
        return Err(DbError::Failed(
            "A valid parent node is required.".to_owned(),
        ));
    };
    let Some(parent) = get_node_row(conn, parent_id)? else {
        return Err(DbError::Failed("Parent node not found.".to_owned()));
    };
    if parent.showcase_id != showcase_id {
        return Err(DbError::Failed("Parent node not found.".to_owned()));
    }
    Ok(parent)
}

/// Notes batch under one parent, appended in the caller's order.
fn add_notes_batch(
    conn: &mut Connection,
    showcase_id: i64,
    body: &Value,
) -> Result<Vec<ShowcaseNode>, DbError> {
    ensure_showcase(conn, showcase_id)?;
    let parent = resolve_parent(
        conn,
        showcase_id,
        body,
        "A parent node is required for notes.",
    )?;
    let parent_id = parent.id;
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

/// The catalog metadata of a Catalog entry, trimmed; empty fields are stored
/// as NULL. The wire shape still reports them as empty strings.
#[derive(Debug, Default)]
struct CatalogEntryValues {
    catalog_number: Option<String>,
    denomination: Option<String>,
    issue_date: Option<String>,
    source: Option<String>,
}

/// `{ entry: { catalog_number, denomination, issue_date, source } }` is
/// required and replaced as a whole; a missing or non-object entry is a bad
/// body.
fn parse_catalog_entry(body: &Value) -> Result<CatalogEntryValues, DbError> {
    let Some(entry) = body.get("entry").filter(|value| value.is_object()) else {
        return Err(DbError::Failed(
            "Catalog entry details are required.".to_owned(),
        ));
    };
    let field = |name: &str| {
        let text = route_name(entry.get(name));
        (!text.is_empty()).then_some(text)
    };
    Ok(CatalogEntryValues {
        catalog_number: field("catalog_number"),
        denomination: field("denomination"),
        issue_date: field("issue_date"),
        source: field("source"),
    })
}

/// A specimen list: ids stay in the caller's order, must be unique, and must
/// exist. An empty list is allowed (an entry with no specimens is unseen).
fn parse_specimen_ids(conn: &Connection, raw: &Value) -> Result<Vec<i64>, DbError> {
    let Some(values) = raw.as_array() else {
        return Err(DbError::Failed(
            "A list of note ids is required.".to_owned(),
        ));
    };
    let mut note_ids = Vec::with_capacity(values.len());
    for value in values {
        let Some(note_id) = js_number(value).filter(|id| *id > 0) else {
            return Err(DbError::Failed("A valid note id is required.".to_owned()));
        };
        if note_ids.contains(&note_id) {
            return Err(DbError::Failed(
                "A note can only appear once on an entry.".to_owned(),
            ));
        }
        if !note_exists(conn, note_id)? {
            return Err(DbError::Failed(format!("Note {note_id} was not found.")));
        }
        note_ids.push(note_id);
    }
    Ok(note_ids)
}

/// Insert a specimen set in order. The schema triggers make the explicit
/// primary win wherever it sits and fall back to the first row when none is
/// named, so insertion order does not matter.
fn insert_specimens(
    conn: &Connection,
    node_id: i64,
    note_ids: &[i64],
    primary: Option<i64>,
) -> Result<(), DbError> {
    for (index, note_id) in note_ids.iter().enumerate() {
        let is_primary = match primary {
            Some(primary) => *note_id == primary,
            None => index == 0,
        };
        conn.execute(
            "INSERT INTO showcase_catalog_notes (node_id, note_id, position, is_primary)
             VALUES (?1, ?2, ?3, ?4)",
            params![node_id, note_id, (index + 1) as i64, i64::from(is_primary)],
        )
        .map_err(classify)?;
    }
    Ok(())
}

/// A Catalog entry leaf: its own catalog metadata plus zero or more specimens,
/// the first of which becomes primary.
fn add_catalog_entry(
    conn: &mut Connection,
    showcase_id: i64,
    body: &Value,
) -> Result<ShowcaseNode, DbError> {
    ensure_showcase(conn, showcase_id)?;
    let parent = resolve_parent(
        conn,
        showcase_id,
        body,
        "A parent node is required for a catalog entry.",
    )?;
    if parent.node_type != "category" && parent.node_type != "grouping" {
        return Err(DbError::Failed(
            "A catalog entry must sit under a category or grouping.".to_owned(),
        ));
    }
    let parent_id = parent.id;
    let entry = parse_catalog_entry(body)?;
    let note_ids = match body.get("note_ids") {
        None | Some(Value::Null) => Vec::new(),
        Some(raw) => parse_specimen_ids(conn, raw)?,
    };
    let position = next_position(conn, showcase_id, Some(parent_id))?;
    let tx = conn.transaction().map_err(classify)?;
    tx.execute(
        "INSERT INTO showcase_nodes (
           showcase_id, parent_node_id, node_type, category_id, name,
           note_id, cover_note_id, catalog_number, denomination, issue_date,
           source, position, created_at, updated_at
         )
         VALUES (?1, ?2, 'catalog_entry', NULL, NULL, NULL, NULL,
                 ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))",
        params![
            showcase_id,
            parent_id,
            entry.catalog_number,
            entry.denomination,
            entry.issue_date,
            entry.source,
            position,
        ],
    )
    .map_err(classify)?;
    let node_id = tx.last_insert_rowid();
    insert_specimens(&tx, node_id, &note_ids, None)?;
    tx.commit().map_err(classify)?;
    get_node(conn, node_id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))
}

/// Replace an entry's whole specimen set atomically: add, remove, reorder, and
/// promote are all this one call. An omitted primary means the first id.
fn replace_node_notes(
    conn: &mut Connection,
    id: i64,
    body: &Value,
) -> Result<ShowcaseNode, DbError> {
    let existing = get_node_row(conn, id)?
        .ok_or_else(|| DbError::Failed("Node not found.".to_owned()))?;
    if existing.node_type != "catalog_entry" {
        return Err(DbError::Failed(
            "Only a catalog entry can hold specimens.".to_owned(),
        ));
    }
    let Some(raw) = body.get("note_ids").filter(|value| !value.is_null()) else {
        return Err(DbError::Failed(
            "A list of note ids is required.".to_owned(),
        ));
    };
    let note_ids = parse_specimen_ids(conn, raw)?;
    let primary = match body.get("primary_note_id") {
        None | Some(Value::Null) => None,
        Some(value) => match js_number(value).filter(|id| *id > 0) {
            Some(id) if note_ids.contains(&id) => Some(id),
            _ => {
                return Err(DbError::Failed(
                    "The primary note must be one of the specimens.".to_owned(),
                ));
            }
        },
    };
    let tx = conn.transaction().map_err(classify)?;
    tx.execute(
        "DELETE FROM showcase_catalog_notes WHERE node_id = ?1",
        params![id],
    )
    .map_err(classify)?;
    insert_specimens(&tx, id, &note_ids, primary)?;
    tx.commit().map_err(classify)?;
    get_node(conn, id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))
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
        "catalog_entry" => add_catalog_entry(conn, showcase_id, body)
            .map(|node| AddNodeResult::Single(Box::new(node))),
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

/// Read the `note_id` a replace request names and confirm the note exists.
fn required_note_id(conn: &Connection, body: &Value) -> Result<i64, DbError> {
    let Some(note_id) = body.get("note_id").and_then(js_number) else {
        return Err(DbError::Failed("A valid note id is required.".to_owned()));
    };
    if !note_exists(conn, note_id)? {
        return Err(DbError::Failed("Note not found.".to_owned()));
    }
    Ok(note_id)
}

/// Rename a node, set/clear a grouping's manual cover, edit a catalog shell's
/// metadata, or swap the note a note card (or a shell, which becomes one)
/// presents in place.
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
        set_category_placement_label(conn, &existing, &route_name(body.get("name")))?;
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
    } else if existing.node_type == "catalog_entry" {
        // A shell becomes a real note card in place: the node keeps its
        // parent, position, and id, so replacing a shell never disturbs the
        // surrounding order. Any legacy specimen links are dropped with it.
        if body.get("note_id").is_some() {
            let note_id = required_note_id(conn, body)?;
            let tx = conn.transaction().map_err(classify)?;
            tx.execute(
                "DELETE FROM showcase_catalog_notes WHERE node_id = ?1",
                params![id],
            )
            .map_err(classify)?;
            tx.execute(
                "UPDATE showcase_nodes
                 SET node_type = 'note', note_id = ?1, catalog_number = NULL,
                     denomination = NULL, issue_date = NULL, source = NULL,
                     updated_at = datetime('now')
                 WHERE id = ?2",
                params![note_id, id],
            )
            .map_err(classify)?;
            tx.commit().map_err(classify)?;
        } else if body.get("entry").is_some() {
            // Metadata is replaced as a whole; the linked Notes stay untouched.
            let entry = parse_catalog_entry(body)?;
            conn.execute(
                "UPDATE showcase_nodes
                 SET catalog_number = ?1, denomination = ?2, issue_date = ?3,
                     source = ?4, updated_at = datetime('now')
                 WHERE id = ?5",
                params![
                    entry.catalog_number,
                    entry.denomination,
                    entry.issue_date,
                    entry.source,
                    id,
                ],
            )
            .map_err(classify)?;
        }
    } else if existing.node_type == "note" {
        // A note card can swap the note it presents in place: the node keeps
        // its parent, position, and id, so replacing a note never disturbs the
        // surrounding order.
        if body.get("note_id").is_none() {
            return Err(DbError::Failed(
                "A note id is required to replace the note.".to_owned(),
            ));
        }
        let note_id = required_note_id(conn, body)?;
        let tx = conn.transaction().map_err(classify)?;
        tx.execute(
            "UPDATE showcase_nodes
             SET note_id = ?1, updated_at = datetime('now')
             WHERE id = ?2",
            params![note_id, id],
        )
        .map_err(classify)?;
        // A grouping that had manually chosen this card as its cover follows
        // the replacement; otherwise its card would show a note it no longer
        // holds.
        if let (Some(old_note_id), Some(parent_id)) =
            (existing.note_id, existing.parent_node_id)
        {
            tx.execute(
                "UPDATE showcase_nodes
                 SET cover_note_id = ?1, updated_at = datetime('now')
                 WHERE id = ?2 AND node_type = 'grouping' AND cover_note_id = ?3",
                params![note_id, parent_id, old_note_id],
            )
            .map_err(classify)?;
        }
        tx.commit().map_err(classify)?;
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
    write_sibling_positions(&tx, ordered)?;
    tx.commit().map_err(classify)?;
    let mut nodes = Vec::with_capacity(ordered.len());
    for id in ordered {
        nodes.push(load_node(conn, *id)?);
    }
    Ok(nodes)
}

/// Whether `node_id` sits anywhere inside the subtree rooted at `ancestor_id`
/// (including the root itself). Used to keep a grouping from moving into its
/// own subtree.
fn is_within_subtree(
    conn: &Connection,
    node_id: i64,
    ancestor_id: i64,
) -> Result<bool, DbError> {
    let mut cursor = Some(node_id);
    let mut steps = 0;
    while let Some(current) = cursor {
        if current == ancestor_id {
            return Ok(true);
        }
        cursor = get_node_row(conn, current)?.and_then(|row| row.parent_node_id);
        steps += 1;
        if steps > 256 {
            return Err(DbError::Failed(
                "The showcase tree contains a cycle.".to_owned(),
            ));
        }
    }
    Ok(false)
}

fn load_node(conn: &Connection, id: i64) -> Result<ShowcaseNode, DbError> {
    get_node(conn, id)?.ok_or_else(|| DbError::Failed("Node not found.".to_owned()))
}

fn write_sibling_positions(
    conn: &Connection,
    ordered: &[i64],
) -> Result<(), DbError> {
    for (index, id) in ordered.iter().enumerate() {
        conn.execute(
            "UPDATE showcase_nodes SET position = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![(index + 1) as i64, id],
        )
        .map_err(classify)?;
    }
    Ok(())
}

/// Move one node to another parent and position. `position` is the final
/// zero-based index in the target sibling list after the source is removed;
/// both sibling lists are renumbered in one transaction. Placement rules match
/// creation: categories stay at the top level, and notes, placeholders and
/// groupings need a category or grouping.
fn move_showcase_node(
    conn: &mut Connection,
    id: i64,
    body: &Value,
) -> Result<ShowcaseNode, DbError> {
    let Some(node) = get_node_row(conn, id)? else {
        return Err(DbError::Failed("Node not found.".to_owned()));
    };

    let parent_node_id = match body.get("parent_node_id") {
        None | Some(Value::Null) => None,
        Some(value) => match js_number(value) {
            Some(parent_id) if parent_id > 0 => Some(parent_id),
            _ => {
                return Err(DbError::Failed(
                    "A valid parent node is required.".to_owned(),
                ));
            }
        },
    };

    let position = match body.get("position") {
        Some(Value::Number(number)) => number.as_i64(),
        _ => None,
    };
    let Some(position) = position else {
        return Err(DbError::Failed(
            "A position is required.".to_owned(),
        ));
    };
    if position < 0 {
        return Err(DbError::Failed(
            "Position must be zero or greater.".to_owned(),
        ));
    }

    if node.node_type == "category" {
        if parent_node_id.is_some() {
            return Err(DbError::Failed(
                "A category is placed at the top level.".to_owned(),
            ));
        }
    } else if parent_node_id.is_none() {
        let message = match node.node_type.as_str() {
            "grouping" => "A grouping needs a category or grouping.",
            "catalog_entry" => "A placeholder needs a category or grouping.",
            _ => "A note needs a category or grouping.",
        };
        return Err(DbError::Failed(message.to_owned()));
    }

    if let Some(parent_id) = parent_node_id {
        let Some(parent) = get_node_row(conn, parent_id)? else {
            return Err(DbError::Failed("Parent node not found.".to_owned()));
        };
        if parent.showcase_id != node.showcase_id {
            return Err(DbError::Failed("Parent node not found.".to_owned()));
        }
        if parent.node_type != "category" && parent.node_type != "grouping" {
            return Err(DbError::Failed(
                "Only a category or grouping can hold items.".to_owned(),
            ));
        }
        if is_within_subtree(conn, parent_id, id)? {
            return Err(DbError::Failed(
                "A node cannot move inside itself.".to_owned(),
            ));
        }
    }

    let showcase_id = node.showcase_id;
    let old_parent = node.parent_node_id;
    let old_children = child_ids(conn, showcase_id, old_parent)?;
    let Some(old_index) = old_children.iter().position(|child| *child == id) else {
        return Err(DbError::Failed("Node not found.".to_owned()));
    };

    let same_parent = parent_node_id == old_parent;
    let mut target_children: Vec<i64> = if same_parent {
        old_children
            .iter()
            .copied()
            .filter(|child| *child != id)
            .collect()
    } else {
        child_ids(conn, showcase_id, parent_node_id)?
    };

    let index = position as usize;
    if index > target_children.len() {
        return Err(DbError::Failed(
            "Position is out of range.".to_owned(),
        ));
    }

    // Dropping an item back where it already sits writes nothing.
    if same_parent && index == old_index {
        return load_node(conn, id);
    }

    target_children.insert(index, id);
    let tx = conn.transaction().map_err(classify)?;
    if !same_parent {
        tx.execute(
            "UPDATE showcase_nodes SET parent_node_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![parent_node_id, id],
        )
        .map_err(classify)?;
        let remaining: Vec<i64> = old_children
            .into_iter()
            .filter(|child| *child != id)
            .collect();
        write_sibling_positions(&tx, &remaining)?;
    }
    write_sibling_positions(&tx, &target_children)?;
    tx.commit().map_err(classify)?;

    load_node(conn, id)
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

/// `PUT /api/nodes/:id/move` — one atomic reparent plus insertion position.
async fn move_node_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("Node id must be a positive integer.");
    };
    let exists = match db::with_conn(&state.pool, move |conn| get_node_row(conn, id)).await {
        Ok(node) => node.is_some(),
        Err(error) => return db_failure(error),
    };
    if !exists {
        return not_found("Node not found.");
    }
    let payload = body_or_empty(body);
    let payload = if payload.is_null() { json!({}) } else { payload };
    match db::with_conn(&state.pool, move |conn| move_showcase_node(conn, id, &payload)).await {
        Ok(node) => ok(json!({ "node": node })),
        Err(error) => db_failure(error),
    }
}

async fn update_node_notes_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("Node id must be a positive integer.");
    };
    let exists = match db::with_conn(&state.pool, move |conn| get_node_row(conn, id)).await {
        Ok(node) => node.is_some(),
        Err(error) => return db_failure(error),
    };
    if !exists {
        return not_found("Node not found.");
    }
    let payload = body_or_empty(body);
    let payload = if payload.is_null() { json!({}) } else { payload };
    match db::with_conn(&state.pool, move |conn| replace_node_notes(conn, id, &payload)).await {
        Ok(node) => ok(json!({ "node": node })),
        Err(error) => db_failure(error),
    }
}

async fn duplicate_node_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
    body: Option<Json<Value>>,
) -> Response {
    let Some(id) = parse_id(&raw_id) else {
        return bad_request("Node id must be a positive integer.");
    };
    let payload = body_or_empty(body);
    let Some(target_showcase_id) = payload
        .get("showcase_id")
        .and_then(js_number)
        .filter(|id| *id > 0)
    else {
        return bad_request("A valid showcase ID is required.");
    };
    let exists = match db::with_conn(&state.pool, move |conn| get_node_row(conn, id)).await {
        Ok(node) => node.is_some(),
        Err(error) => return db_failure(error),
    };
    if !exists {
        return not_found("Node not found.");
    }
    let target_exists =
        match db::with_conn(&state.pool, move |conn| get_showcase(conn, target_showcase_id)).await
        {
            Ok(showcase) => showcase.is_some(),
            Err(error) => return db_failure(error),
        };
    if !target_exists {
        return not_found("Showcase not found.");
    }
    match db::with_conn(&state.pool, move |conn| {
        duplicate_category_placement(conn, id, target_showcase_id)
    })
    .await
    {
        Ok(node) => created(json!({ "node": node })),
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

async fn delete_category_handler(
    State(state): State<AppState>,
    Path(raw_id): Path<String>,
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
    match db::with_conn(&state.pool, move |conn| delete_category(conn, id)).await {
        Ok(()) => ok(json!({ "success": true })),
        // The row can vanish between the existence check and the delete.
        Err(crate::AppError::Http { message, .. }) if message == "Category not found." => {
            not_found("Category not found.")
        }
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
        .route("/api/nodes/{id}/move", put(move_node_handler))
        .route("/api/nodes/{id}/notes", put(update_node_notes_handler))
        .route("/api/nodes/{id}/duplicate", post(duplicate_node_handler))
}

pub fn categories_router() -> Router<AppState> {
    Router::new()
        .route("/api/categories", get(list_categories_handler).post(create_category_handler))
        .route(
            "/api/categories/{id}",
            put(rename_category_handler).delete(delete_category_handler),
        )
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
