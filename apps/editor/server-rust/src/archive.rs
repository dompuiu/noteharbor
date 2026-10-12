//! Archive import/export/delete: port of `server-node/src/routes/archive.js`.
//!
//! Storage layout parity (recorded for ticket 04):
//! - Export zip: `banknotes.db` at the root + `images/` tree (or an empty
//!   `images/.keep` when there is nothing to carry), `application/zip`,
//!   filename `noteharbor-archive-YYYY-MM-DD.zip`, `no-store` cache headers,
//!   and `X-NoteHarbor-Omitted-Showcases: encodeURIComponent(JSON(names))`.
//! - The exported snapshot is renumbered 1..N per table (notes ordered by
//!   collection then display order), image `/api/images/notes/<old>/`
//!   prefixes rewritten to the new ids, retired `scrape_*` columns stripped,
//!   orphaned rows purged, `VACUUM`ed.
//! - Import stages through a temp dir (zip-slip guarded, `banknotes.db` +
//!   `images/` required, required tables verified) and applies in a single
//!   SQLite transaction: collections merge by case-insensitive name (same
//!   name replaced), showcases by name (replaced), labels by name (reused).
//!   `replace` (default) wipes local data first so ids restart at 1.
//!
//! Concurrency note: `server-node` closes the database and swaps whole data
//! directories (`closeDatabase`/`reloadDatabase`). The Rust pool holds open
//! connections across requests, so the port applies the staged content
//! in-place in one transaction instead — same post-condition, no pool
//! rebuild, no window where the database file is absent. The
//! `... Rollback also failed: ...` suffix therefore never triggers here; a
//! failed import rolls the transaction back and answers the plain message.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde_json::{Value, json};

use crate::images::normalize_images;

pub const IMAGE_API_PREFIX: &str = "/api/images/";

#[derive(Debug, Clone)]
pub struct ArchiveError {
    pub status: u16,
    pub message: String,
    pub current_operation: Option<String>,
}

impl ArchiveError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self { status: 400, message: message.into(), current_operation: None }
    }

    /// The staged upload outgrew the streaming cap: answers 413 as JSON so
    /// callers see a message instead of a dropped connection.
    pub fn too_large() -> Self {
        Self {
            status: 413,
            message: "Archive exceeds maximum allowed size (5 GB).".to_owned(),
            current_operation: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self { status: 500, message: message.into(), current_operation: None }
    }

    pub fn unavailable() -> Self {
        Self {
            status: 503,
            message: "Database unavailable.".to_owned(),
            current_operation: None,
        }
    }
}

impl IntoResponse for ArchiveError {
    fn into_response(self) -> Response {
        let status =
            StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let mut body = serde_json::Map::new();
        body.insert("error".to_owned(), json!(self.message));
        if let Some(op) = self.current_operation {
            body.insert("currentOperation".to_owned(), json!(op));
        }
        (status, axum::Json(Value::Object(body))).into_response()
    }
}

fn db_failed(error: rusqlite::Error) -> ArchiveError {
    ArchiveError::internal(error.to_string())
}

fn io_failed(error: std::io::Error) -> ArchiveError {
    ArchiveError::internal(error.to_string())
}

fn zip_failed(error: zip::result::ZipError) -> ArchiveError {
    ArchiveError::internal(error.to_string())
}

// ---------------------------------------------------------------------------
// Request parsing (mirrors parseImportMode / parseSelectedCollectionIds)
// ---------------------------------------------------------------------------

/// Replace is the default; anything but `replace`/`merge` is a 400.
pub fn parse_import_mode(raw: Option<&str>) -> Result<String, ArchiveError> {
    match raw {
        None => Ok("replace".to_owned()),
        Some(value) if value.trim().is_empty() => Ok("replace".to_owned()),
        Some(value) => {
            let normalized = value.trim().to_lowercase();
            if normalized == "replace" || normalized == "merge" {
                Ok(normalized)
            } else {
                Err(ArchiveError::bad_request(format!(
                    "Unknown import mode \"{value}\". Use \"replace\" or \"merge\"."
                )))
            }
        }
    }
}

/// A missing filter means "no explicit selection" (`None`); a present one is
/// comma-split, `Number()`-coerced, and reduced to unique positive integers.
pub fn parse_selected_ids(raw: Option<&str>) -> Option<Vec<i64>> {
    let raw = raw?;
    let mut seen = HashSet::new();
    let mut values = Vec::new();
    for part in raw.split(',') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(number) = trimmed.parse::<f64>() {
            if number.is_finite() && number.fract() == 0.0 {
                let id = number as i64;
                if id > 0 && seen.insert(id) {
                    values.push(id);
                }
            }
        }
    }
    Some(values)
}

/// The export reports omitted showcases through a response header: the name
/// list as JSON, percent-encoded so commas, quotes, and non-ASCII stay
/// header-safe. Ids are meaningless after renumbering, so only names travel.
pub fn encode_omitted_showcases_header(names: &[String]) -> String {
    let encoded_json = serde_json::to_string(names).unwrap_or_else(|_| "[]".to_owned());
    let mut out = String::with_capacity(encoded_json.len());
    for byte in encoded_json.bytes() {
        if matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Snapshot helpers (operate on a detached snapshot copy)
// ---------------------------------------------------------------------------

fn parse_image_records(raw: Option<String>) -> Vec<Value> {
    let Some(raw) = raw else { return Vec::new() };
    if raw.is_empty() {
        return Vec::new();
    }
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Array(items)) => items,
        _ => Vec::new(),
    }
}

fn to_posix(value: &str) -> String {
    value.split(std::path::MAIN_SEPARATOR).collect::<Vec<_>>().join("/")
}

fn to_fs_path(root: &Path, relative_posix: &str) -> PathBuf {
    let mut path = root.to_path_buf();
    for segment in relative_posix.split('/') {
        if !segment.is_empty() {
            path.push(segment);
        }
    }
    path
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, ArchiveError> {
    let present: Option<String> = conn
        .query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            params![table],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_failed)?;
    Ok(present.is_some())
}

fn showcase_table_names_present(conn: &Connection) -> Result<bool, ArchiveError> {
    for table in ["categories", "showcases", "showcase_nodes"] {
        if !table_exists(conn, table)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn column_names(conn: &Connection, table: &str) -> Result<HashSet<String>, ArchiveError> {
    let mut stmt =
        conn.prepare("SELECT name FROM pragma_table_info(?1)").map_err(db_failed)?;
    let rows = stmt.query_map(params![table], |row| row.get::<_, String>(0)).map_err(db_failed)?;
    let mut names = HashSet::new();
    for name in rows {
        names.insert(name.map_err(db_failed)?);
    }
    Ok(names)
}

fn sanitize_snapshot_images(conn: &Connection) -> Result<(), ArchiveError> {
    let rows: Vec<(i64, Option<String>)> = {
        let mut stmt = conn.prepare("SELECT id, images FROM banknotes").map_err(db_failed)?;
        let mapped = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)))
            .map_err(db_failed)?;
        mapped.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    };
    for (id, raw) in rows {
        let cleaned: Vec<Value> = parse_image_records(raw)
            .into_iter()
            .filter(|image| {
                let Some(obj) = image.as_object() else { return false };
                let local = obj
                    .get("localPath")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if local.starts_with(IMAGE_API_PREFIX) {
                    return local
                        .strip_prefix(IMAGE_API_PREFIX)
                        .is_some_and(|relative| !to_posix(relative).is_empty());
                }
                true
            })
            .collect();
        let normalized = normalize_images(&Value::Array(cleaned));
        conn.execute(
            "UPDATE banknotes SET images = ?1 WHERE id = ?2",
            params![serde_json::to_string(&normalized).unwrap_or_else(|_| "[]".to_owned()), id],
        )
        .map_err(db_failed)?;
    }
    Ok(())
}

fn strip_scrape_columns(conn: &Connection) -> Result<(), ArchiveError> {
    let columns = column_names(conn, "banknotes")?;
    for column in ["scrape_error", "scrape_status"] {
        if columns.contains(column) {
            conn.execute_batch(&format!("ALTER TABLE banknotes DROP COLUMN {column}"))
                .map_err(db_failed)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopyEntry {
    pub from_relative: String,
    pub to_relative: String,
}

fn remap_note_image_path(local_path: &str, old_note_id: i64, new_note_id: i64) -> String {
    let prefix = format!("{IMAGE_API_PREFIX}notes/{old_note_id}/");
    if let Some(suffix) = local_path.strip_prefix(&prefix) {
        format!("{IMAGE_API_PREFIX}notes/{new_note_id}/{suffix}")
    } else {
        local_path.to_owned()
    }
}

fn remap_reference(map: &HashMap<i64, i64>, value: Option<i64>) -> Option<i64> {
    value.and_then(|id| map.get(&id).copied())
}

fn update_sequence(conn: &Connection, table: &str, size: usize) -> Result<(), ArchiveError> {
    if size == 0 {
        conn.execute("DELETE FROM sqlite_sequence WHERE name = ?1", params![table])
            .map_err(db_failed)?;
        return Ok(());
    }
    let changed = conn
        .execute(
            "UPDATE sqlite_sequence SET seq = ?1 WHERE name = ?2",
            params![size as i64, table],
        )
        .map_err(db_failed)?;
    if changed == 0 {
        conn.execute(
            "INSERT INTO sqlite_sequence (name, seq) VALUES (?1, ?2)",
            params![table, size as i64],
        )
        .map_err(db_failed)?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct NodeRow {
    id: i64,
    showcase_id: Option<i64>,
    parent_node_id: Option<i64>,
    category_id: Option<i64>,
    note_id: Option<i64>,
    cover_note_id: Option<i64>,
}

fn renumber_showcase_tables(
    conn: &Connection,
    category_map: &HashMap<i64, i64>,
    showcase_map: &HashMap<i64, i64>,
    node_map: &HashMap<i64, i64>,
    note_map: &HashMap<i64, i64>,
    node_rows: &[NodeRow],
) -> Result<(), ArchiveError> {
    conn.execute_batch("UPDATE categories SET id = -id").map_err(db_failed)?;
    conn.execute_batch("UPDATE showcases SET id = -id").map_err(db_failed)?;
    conn.execute_batch("UPDATE showcase_nodes SET id = -id").map_err(db_failed)?;

    for (old_id, new_id) in category_map {
        conn.execute("UPDATE categories SET id = ?1 WHERE id = ?2", params![new_id, -old_id])
            .map_err(db_failed)?;
    }
    for (old_id, new_id) in showcase_map {
        conn.execute("UPDATE showcases SET id = ?1 WHERE id = ?2", params![new_id, -old_id])
            .map_err(db_failed)?;
    }
    for row in node_rows {
        conn.execute(
            "UPDATE showcase_nodes
             SET id = ?1, showcase_id = ?2, category_id = ?3, note_id = ?4,
                 cover_note_id = ?5, parent_node_id = NULL
             WHERE id = ?6",
            params![
                node_map.get(&row.id),
                remap_reference(showcase_map, row.showcase_id),
                remap_reference(category_map, row.category_id),
                remap_reference(note_map, row.note_id),
                remap_reference(note_map, row.cover_note_id),
                -row.id,
            ],
        )
        .map_err(db_failed)?;
    }
    for row in node_rows {
        conn.execute(
            "UPDATE showcase_nodes SET parent_node_id = ?1 WHERE id = ?2",
            params![
                remap_reference(node_map, row.parent_node_id),
                node_map.get(&row.id),
            ],
        )
        .map_err(db_failed)?;
    }
    Ok(())
}

#[derive(Debug, Default)]
pub struct RenumberPlan {
    pub copy_plan: Vec<CopyEntry>,
}

fn query_ids(conn: &Connection, sql: &str) -> Result<Vec<i64>, ArchiveError> {
    let mut stmt = conn.prepare(sql).map_err(db_failed)?;
    let rows = stmt.query_map([], |row| row.get::<_, i64>(0)).map_err(db_failed)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)
}

/// Renumbers every PK from 1, rewrites note image paths, and returns the
/// image copy plan. Mirrors `renumberSnapshot` verbatim (notes ordered by
/// collection then display order; showcase parents resolved in a second
/// pass over negated ids).
pub fn renumber_snapshot(conn: &Connection) -> Result<RenumberPlan, ArchiveError> {
    let collection_ids = query_ids(conn, "SELECT id FROM collections ORDER BY id ASC")?;
    let mut collection_map = HashMap::new();
    for (index, id) in collection_ids.iter().enumerate() {
        collection_map.insert(*id, index as i64 + 1);
    }

    let note_rows: Vec<(i64, Option<i64>, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, collection_id, images FROM banknotes
                 ORDER BY collection_id ASC, display_order ASC, id ASC",
            )
            .map_err(db_failed)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?, row.get::<_, Option<String>>(2)?))
            })
            .map_err(db_failed)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    };
    let mut note_map = HashMap::new();
    for (index, (id, _, _)) in note_rows.iter().enumerate() {
        note_map.insert(*id, index as i64 + 1);
    }

    let tag_rows: Vec<(i64, Option<i64>)> = {
        let mut stmt = conn
            .prepare("SELECT id, collection_id FROM tags ORDER BY collection_id ASC, id ASC")
            .map_err(db_failed)?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)))
            .map_err(db_failed)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    };
    let mut tag_map = HashMap::new();
    for (index, (id, _)) in tag_rows.iter().enumerate() {
        tag_map.insert(*id, index as i64 + 1);
    }

    let link_rows: Vec<(Option<i64>, Option<i64>)> = {
        let mut stmt =
            conn.prepare("SELECT banknote_id, tag_id FROM banknote_tags").map_err(db_failed)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?))
            })
            .map_err(db_failed)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    };

    let has_showcases = showcase_table_names_present(conn)?;
    let category_ids = if has_showcases {
        query_ids(conn, "SELECT id FROM categories ORDER BY id ASC")?
    } else {
        Vec::new()
    };
    let showcase_ids = if has_showcases {
        query_ids(conn, "SELECT id FROM showcases ORDER BY id ASC")?
    } else {
        Vec::new()
    };
    let node_rows: Vec<NodeRow> = if has_showcases {
        let mut stmt = conn
            .prepare(
                "SELECT id, showcase_id, parent_node_id, category_id, note_id, cover_note_id
                 FROM showcase_nodes ORDER BY id ASC",
            )
            .map_err(db_failed)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(NodeRow {
                    id: row.get(0)?,
                    showcase_id: row.get(1)?,
                    parent_node_id: row.get(2)?,
                    category_id: row.get(3)?,
                    note_id: row.get(4)?,
                    cover_note_id: row.get(5)?,
                })
            })
            .map_err(db_failed)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    } else {
        Vec::new()
    };
    let mut category_map = HashMap::new();
    for (index, id) in category_ids.iter().enumerate() {
        category_map.insert(*id, index as i64 + 1);
    }
    let mut showcase_map = HashMap::new();
    for (index, id) in showcase_ids.iter().enumerate() {
        showcase_map.insert(*id, index as i64 + 1);
    }
    let mut node_map = HashMap::new();
    for (index, row) in node_rows.iter().enumerate() {
        node_map.insert(row.id, index as i64 + 1);
    }

    conn.execute_batch("PRAGMA foreign_keys = OFF").map_err(db_failed)?;
    let outcome = renumber_snapshot_inner(
        conn,
        &collection_map,
        &note_map,
        &tag_map,
        &category_map,
        &showcase_map,
        &node_map,
        &note_rows,
        &tag_rows,
        &link_rows,
        &node_rows,
        has_showcases,
    );
    conn.execute_batch("PRAGMA foreign_keys = ON").map_err(db_failed)?;
    outcome
}

#[allow(clippy::too_many_arguments)]
fn renumber_snapshot_inner(
    conn: &Connection,
    collection_map: &HashMap<i64, i64>,
    note_map: &HashMap<i64, i64>,
    tag_map: &HashMap<i64, i64>,
    category_map: &HashMap<i64, i64>,
    showcase_map: &HashMap<i64, i64>,
    node_map: &HashMap<i64, i64>,
    note_rows: &[(i64, Option<i64>, Option<String>)],
    tag_rows: &[(i64, Option<i64>)],
    link_rows: &[(Option<i64>, Option<i64>)],
    node_rows: &[NodeRow],
    has_showcases: bool,
) -> Result<RenumberPlan, ArchiveError> {
    conn.execute_batch("UPDATE collections SET id = -id").map_err(db_failed)?;
    conn.execute_batch("UPDATE banknotes SET id = -id").map_err(db_failed)?;
    conn.execute_batch("UPDATE tags SET id = -id").map_err(db_failed)?;

    for (old_id, new_id) in collection_map {
        conn.execute("UPDATE collections SET id = ?1 WHERE id = ?2", params![new_id, -old_id])
            .map_err(db_failed)?;
    }

    let mut copy_plan = Vec::new();
    let mut seen_targets = HashSet::new();
    let mut next_order: HashMap<i64, i64> = HashMap::new();
    for (old_id, collection_id, raw_images) in note_rows {
        let new_id = note_map.get(old_id).copied().unwrap_or(0);
        let new_collection_id = collection_id
            .and_then(|id| collection_map.get(&id).copied())
            .ok_or_else(|| {
                ArchiveError::internal("Export snapshot has invalid collection references.")
            })?;
        let mut rewritten = Vec::new();
        for image in parse_image_records(raw_images.clone()) {
            let Some(obj) = image.as_object().cloned() else {
                rewritten.push(image);
                continue;
            };
            let local = obj
                .get("localPath")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if !local.starts_with(IMAGE_API_PREFIX) {
                rewritten.push(image);
                continue;
            }
            let new_local = remap_note_image_path(&local, *old_id, new_id);
            let old_relative = to_posix(&local[IMAGE_API_PREFIX.len()..]);
            let new_relative = to_posix(&new_local[IMAGE_API_PREFIX.len()..]);
            if !old_relative.is_empty() && !new_relative.is_empty() && seen_targets.insert(new_relative.clone()) {
                copy_plan.push(CopyEntry {
                    from_relative: old_relative,
                    to_relative: new_relative,
                });
            }
            let mut updated = obj;
            updated.insert("localPath".to_owned(), Value::String(new_local));
            rewritten.push(Value::Object(updated));
        }
        let order = next_order.entry(new_collection_id).or_insert(0);
        *order += 1;
        conn.execute(
            "UPDATE banknotes SET id = ?1, collection_id = ?2, display_order = ?3, images = ?4 WHERE id = ?5",
            params![
                new_id,
                new_collection_id,
                *order,
                Value::Array(rewritten).to_string(),
                -old_id,
            ],
        )
        .map_err(db_failed)?;
    }

    for (old_id, collection_id) in tag_rows {
        let new_collection_id = collection_id
            .and_then(|id| collection_map.get(&id).copied())
            .ok_or_else(|| {
                ArchiveError::internal("Export snapshot has invalid collection references.")
            })?;
        conn.execute(
            "UPDATE tags SET id = ?1, collection_id = ?2 WHERE id = ?3",
            params![tag_map.get(old_id), new_collection_id, -old_id],
        )
        .map_err(db_failed)?;
    }

    conn.execute("DELETE FROM banknote_tags", []).map_err(db_failed)?;
    for (note_id, tag_id) in link_rows {
        let (Some(new_note), Some(new_tag)) = (
            note_id.and_then(|id| note_map.get(&id).copied()),
            tag_id.and_then(|id| tag_map.get(&id).copied()),
        ) else {
            continue;
        };
        conn.execute(
            "INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id) VALUES (?1, ?2)",
            params![new_note, new_tag],
        )
        .map_err(db_failed)?;
    }

    if has_showcases {
        renumber_showcase_tables(
            conn,
            category_map,
            showcase_map,
            node_map,
            note_map,
            node_rows,
        )?;
    }

    let mut sequences: Vec<(&str, usize)> = vec![
        ("collections", collection_map.len()),
        ("banknotes", note_map.len()),
        ("tags", tag_map.len()),
    ];
    if has_showcases {
        sequences.extend([
            ("categories", category_map.len()),
            ("showcases", showcase_map.len()),
            ("showcase_nodes", node_map.len()),
        ]);
    }
    for (table, size) in sequences {
        update_sequence(conn, table, size)?;
    }

    Ok(RenumberPlan { copy_plan })
}

fn delete_orphaned_snapshot_rows(conn: &Connection) -> Result<(), ArchiveError> {
    conn.execute_batch(
        "DELETE FROM banknote_tags
         WHERE banknote_id IN (
           SELECT id FROM banknotes
           WHERE collection_id IS NULL OR collection_id NOT IN (SELECT id FROM collections)
         ) OR tag_id IN (
           SELECT id FROM tags
           WHERE collection_id IS NULL OR collection_id NOT IN (SELECT id FROM collections)
         );
         DELETE FROM banknotes
         WHERE collection_id IS NULL OR collection_id NOT IN (SELECT id FROM collections);
         DELETE FROM tags
         WHERE collection_id IS NULL OR collection_id NOT IN (SELECT id FROM collections);
         DELETE FROM banknote_tags
         WHERE banknote_id NOT IN (SELECT id FROM banknotes)
            OR tag_id NOT IN (SELECT id FROM tags);",
    )
    .map_err(db_failed)?;
    if showcase_table_names_present(conn)? {
        conn.execute_batch(
            "DELETE FROM showcase_nodes
             WHERE note_id IS NOT NULL AND note_id NOT IN (SELECT id FROM banknotes);
             UPDATE showcase_nodes
             SET cover_note_id = NULL
             WHERE cover_note_id IS NOT NULL
               AND cover_note_id NOT IN (SELECT id FROM banknotes);",
        )
        .map_err(db_failed)?;
    }
    Ok(())
}

// --- filtered-export showcase helpers --------------------------------------

fn list_showcases_with_unkept_notes(
    conn: &Connection,
    kept: &[i64],
) -> Result<Vec<(i64, String)>, ArchiveError> {
    if kept.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = kept.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT DISTINCT showcases.id AS id, showcases.name AS name
         FROM showcases
         INNER JOIN showcase_nodes ON showcase_nodes.showcase_id = showcases.id
         WHERE (
           showcase_nodes.note_id IS NOT NULL AND showcase_nodes.note_id NOT IN (
             SELECT id FROM banknotes WHERE collection_id IN ({placeholders})
           )
         ) OR (
           showcase_nodes.cover_note_id IS NOT NULL
           AND showcase_nodes.cover_note_id NOT IN (
             SELECT id FROM banknotes WHERE collection_id IN ({placeholders})
           )
         )
         ORDER BY showcases.id ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(db_failed)?;
    let mut query_params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(kept.len() * 2);
    for id in kept {
        query_params.push(id);
    }
    for id in kept {
        query_params.push(id);
    }
    let rows = stmt
        .query_map(query_params.as_slice(), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(db_failed)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)
}

fn omit_showcases(conn: &Connection, ids: &[i64]) -> Result<(), ArchiveError> {
    if ids.is_empty() {
        return Ok(());
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let params: Vec<&dyn rusqlite::ToSql> =
        ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    conn.execute(
        &format!("DELETE FROM showcase_nodes WHERE showcase_id IN ({placeholders})"),
        params.as_slice(),
    )
    .map_err(db_failed)?;
    conn.execute(
        &format!("DELETE FROM showcases WHERE id IN ({placeholders})"),
        params.as_slice(),
    )
    .map_err(db_failed)?;
    Ok(())
}

fn showcase_requirements(conn: &Connection) -> Result<HashMap<i64, Vec<i64>>, ArchiveError> {
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
        .map_err(db_failed)?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
        .map_err(db_failed)?;
    let mut by_showcase: HashMap<i64, Vec<i64>> = HashMap::new();
    for row in rows {
        let (showcase_id, collection_id) = row.map_err(db_failed)?;
        by_showcase.entry(showcase_id).or_default();
        let list = by_showcase.get_mut(&showcase_id).expect("entry exists");
        if !list.contains(&collection_id) {
            list.push(collection_id);
        }
    }
    Ok(by_showcase)
}

fn names_by_id(
    conn: &Connection,
    table: &str,
    ids: &[i64],
) -> Result<HashMap<i64, String>, ArchiveError> {
    let mut names = HashMap::new();
    if ids.is_empty() {
        return Ok(names);
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let mut stmt = conn
        .prepare(&format!("SELECT id, name FROM {table} WHERE id IN ({placeholders})"))
        .map_err(db_failed)?;
    let params: Vec<&dyn rusqlite::ToSql> =
        ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(db_failed)?;
    for row in rows {
        let (id, name) = row.map_err(db_failed)?;
        names.insert(id, name);
    }
    Ok(names)
}

fn assert_selected_showcases_have_collections(
    conn: &Connection,
    selected: &[i64],
    kept: &[i64],
) -> Result<(), ArchiveError> {
    if selected.is_empty() {
        return Ok(());
    }
    let requirements = showcase_requirements(conn)?;
    let kept_set: HashSet<i64> = kept.iter().copied().collect();
    let showcase_names = names_by_id(conn, "showcases", selected)?;
    let mut violations = Vec::new();
    for showcase_id in selected {
        let required = requirements.get(showcase_id).cloned().unwrap_or_default();
        let missing: Vec<i64> =
            required.into_iter().filter(|id| !kept_set.contains(id)).collect();
        if !missing.is_empty() {
            let collection_names = names_by_id(conn, "collections", &missing)?;
            let missing_names: Vec<String> = missing
                .iter()
                .map(|id| collection_names.get(id).cloned().unwrap_or_else(|| format!("#{id}")))
                .collect();
            let name =
                showcase_names.get(showcase_id).cloned().unwrap_or_else(|| format!("#{showcase_id}"));
            violations.push(format!(
                "Showcase \"{name}\" needs {}",
                missing_names.iter().map(|name| format!("\"{name}\"")).collect::<Vec<_>>().join(", ")
            ));
        }
    }
    if !violations.is_empty() {
        return Err(ArchiveError::bad_request(format!(
            "{}. Select the missing collections or deselect the showcase.",
            violations.join("; ")
        )));
    }
    Ok(())
}

fn omit_unselected_showcases(conn: &Connection, selected: &[i64]) -> Result<(), ArchiveError> {
    if selected.is_empty() {
        conn.execute("DELETE FROM showcase_nodes", []).map_err(db_failed)?;
        conn.execute("DELETE FROM showcases", []).map_err(db_failed)?;
        return Ok(());
    }
    let placeholders = selected.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let params: Vec<&dyn rusqlite::ToSql> =
        selected.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    conn.execute(
        &format!("DELETE FROM showcase_nodes WHERE showcase_id NOT IN ({placeholders})"),
        params.as_slice(),
    )
    .map_err(db_failed)?;
    conn.execute(
        &format!("DELETE FROM showcases WHERE id NOT IN ({placeholders})"),
        params.as_slice(),
    )
    .map_err(db_failed)?;
    Ok(())
}

fn delete_unplaced_categories(conn: &Connection) -> Result<(), ArchiveError> {
    conn.execute(
        "DELETE FROM categories
         WHERE id NOT IN (
           SELECT DISTINCT category_id FROM showcase_nodes WHERE category_id IS NOT NULL
         )",
        [],
    )
    .map_err(db_failed)?;
    Ok(())
}

#[derive(Debug)]
pub struct FilteredExport {
    pub export_images_dir: PathBuf,
    pub selected_count: usize,
    pub selected_showcase_count: Option<i64>,
    pub omitted_showcases: Vec<(i64, String)>,
}

#[allow(clippy::too_many_arguments)]
pub fn build_filtered_export_snapshot(
    snapshot_path: &Path,
    selected_collections: Option<Vec<i64>>,
    export_images_dir: &Path,
    source_images_dir: &Path,
    selected_showcases: Option<Vec<i64>>,
) -> Result<FilteredExport, ArchiveError> {
    let conn = Connection::open(snapshot_path).map_err(db_failed)?;
    conn.execute_batch("PRAGMA foreign_keys = ON").map_err(db_failed)?;

    let all_ids = query_ids(&conn, "SELECT id FROM collections ORDER BY id ASC")?;
    let selected_set: Option<HashSet<i64>> =
        selected_collections.as_ref().map(|ids| ids.iter().copied().collect());
    let kept: Vec<i64> = all_ids
        .iter()
        .filter(|id| selected_set.as_ref().is_some_and(|set| set.contains(id)) || selected_set.is_none())
        .copied()
        .collect();

    if selected_set.is_some() && kept.is_empty() {
        return Err(ArchiveError::bad_request(
            "Choose at least one valid collection to export.",
        ));
    }
    let unselected: Vec<i64> =
        all_ids.iter().filter(|id| !kept.contains(id)).copied().collect();

    delete_orphaned_snapshot_rows(&conn)?;

    let mut omitted = Vec::new();
    let has_showcases = showcase_table_names_present(&conn)?;
    if let Some(selected) = selected_showcases.as_ref() {
        if has_showcases {
            let existing: HashSet<i64> =
                query_ids(&conn, "SELECT id FROM showcases")?.into_iter().collect();
            let kept_showcases: Vec<i64> =
                selected.iter().filter(|id| existing.contains(id)).copied().collect();
            assert_selected_showcases_have_collections(&conn, &kept_showcases, &kept)?;
            omit_unselected_showcases(&conn, &kept_showcases)?;
            delete_unplaced_categories(&conn)?;
        }
    } else if selected_set.is_some() && has_showcases {
        let stranded = list_showcases_with_unkept_notes(&conn, &kept)?;
        omit_showcases(&conn, &stranded.iter().map(|(id, _)| *id).collect::<Vec<_>>())?;
        delete_unplaced_categories(&conn)?;
        omitted = stranded;
    }

    if !unselected.is_empty() {
        let placeholders = unselected.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let params: Vec<&dyn rusqlite::ToSql> =
            unselected.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        conn.execute(
            &format!("DELETE FROM banknotes WHERE collection_id IN ({placeholders})"),
            params.as_slice(),
        )
        .map_err(db_failed)?;
        conn.execute(
            &format!("DELETE FROM tags WHERE collection_id IN ({placeholders})"),
            params.as_slice(),
        )
        .map_err(db_failed)?;
        conn.execute(
            "DELETE FROM banknote_tags
             WHERE banknote_id NOT IN (SELECT id FROM banknotes)
                OR tag_id NOT IN (SELECT id FROM tags)",
            [],
        )
        .map_err(db_failed)?;
        conn.execute(
            &format!("DELETE FROM collections WHERE id IN ({placeholders})"),
            params.as_slice(),
        )
        .map_err(db_failed)?;
    }

    sanitize_snapshot_images(&conn)?;
    let plan = renumber_snapshot(&conn)?;
    strip_scrape_columns(&conn)?;

    let violations: Vec<i64> = {
        let mut stmt = conn.prepare("PRAGMA foreign_key_check").map_err(db_failed)?;
        let rows = stmt.query_map([], |_| Ok(0_i64)).map_err(db_failed)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    };
    if !violations.is_empty() {
        return Err(ArchiveError::internal(
            "Export snapshot has invalid collection references.",
        ));
    }

    conn.execute_batch("VACUUM").map_err(db_failed)?;

    let selected_showcase_count = if selected_showcases.is_some() && has_showcases {
        Some(
            conn.query_row("SELECT COUNT(*) FROM showcases", [], |row| row.get::<_, i64>(0))
                .map_err(db_failed)?,
        )
    } else {
        None
    };

    copy_image_plan_for_export(source_images_dir, export_images_dir, &plan.copy_plan)?;
    drop(conn);

    Ok(FilteredExport {
        export_images_dir: export_images_dir.to_path_buf(),
        selected_count: kept.len(),
        selected_showcase_count,
        omitted_showcases: omitted,
    })
}

fn copy_image_plan_for_export(
    source_images_dir: &Path,
    target_images_dir: &Path,
    copy_plan: &[CopyEntry],
) -> Result<(), ArchiveError> {
    std::fs::create_dir_all(target_images_dir).map_err(io_failed)?;
    for entry in copy_plan {
        let source = to_fs_path(source_images_dir, &entry.from_relative);
        if !source.is_file() {
            continue;
        }
        let target = to_fs_path(target_images_dir, &entry.to_relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(io_failed)?;
        }
        std::fs::copy(&source, &target).map_err(io_failed)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Export zip assembly
// ---------------------------------------------------------------------------

fn collect_export_files(dir: &Path) -> Result<Vec<PathBuf>, ArchiveError> {
    let mut files = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(&current)
            .map_err(io_failed)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        entries.sort();
        for entry in entries {
            if entry.is_dir() {
                stack.push(entry);
            } else if entry.is_file() {
                files.push(entry);
            }
        }
    }
    files.sort();
    Ok(files)
}

pub fn build_export_zip(
    snapshot_db_path: &Path,
    export_images_dir: &Path,
) -> Result<Vec<u8>, ArchiveError> {
    let mut db_bytes = Vec::new();
    File::open(snapshot_db_path)
        .map_err(io_failed)?
        .read_to_end(&mut db_bytes)
        .map_err(io_failed)?;
    let cursor = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(9));
    zip.start_file("banknotes.db", options).map_err(zip_failed)?;
    zip.write_all(&db_bytes).map_err(io_failed)?;

    if export_images_dir.is_dir() {
        let files = collect_export_files(export_images_dir)?;
        if files.is_empty() {
            // Mirrors `archive.directory(imagesDir, 'images')` on an empty
            // dir: the `images/` prefix itself travels so the import's
            // `banknotes.db` + `images/` probe still matches.
            zip.add_directory("images/", options).map_err(zip_failed)?;
        }
        for file in files {
            let relative = file
                .strip_prefix(export_images_dir)
                .map_err(|_| ArchiveError::internal("Export snapshot has invalid image paths."))?;
            let name = format!("images/{}", to_posix(&relative.to_string_lossy()));
            zip.start_file(&name, options).map_err(zip_failed)?;
            let mut content = Vec::new();
            File::open(&file).map_err(io_failed)?.read_to_end(&mut content).map_err(io_failed)?;
            zip.write_all(&content).map_err(io_failed)?;
        }
    } else {
        zip.start_file("images/.keep", options).map_err(zip_failed)?;
    }
    Ok(zip.finish().map_err(zip_failed)?.into_inner())
}

// ---------------------------------------------------------------------------
// Live snapshot + import staging (file helpers)
// ---------------------------------------------------------------------------

fn sqlite_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Consistent point-in-time copy of the live database (the `backupDatabase`
/// counterpart; `VACUUM INTO` copies and compacts in one step).
pub fn snapshot_live_database(
    conn: &Connection,
    snapshot_path: &Path,
) -> Result<(), ArchiveError> {
    if let Some(parent) = snapshot_path.parent() {
        std::fs::create_dir_all(parent).map_err(io_failed)?;
    }
    conn.execute_batch(&format!(
        "VACUUM INTO {}",
        sqlite_literal(&snapshot_path.to_string_lossy())
    ))
    .map_err(db_failed)?;
    Ok(())
}

pub fn extract_archive(zip_path: &Path, output_dir: &Path) -> Result<(), ArchiveError> {
    let file = File::open(zip_path).map_err(io_failed)?;
    let mut archive = zip::ZipArchive::new(file).map_err(zip_failed)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_failed)?;
        let Some(destination) = entry.enclosed_name() else {
            return Err(ArchiveError::internal("Archive contains invalid file paths."));
        };
        let destination = output_dir.join(destination);
        if entry.is_dir() {
            std::fs::create_dir_all(&destination).map_err(io_failed)?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(io_failed)?;
        }
        let mut output = File::create(&destination).map_err(io_failed)?;
        std::io::copy(&mut entry, &mut output).map_err(io_failed)?;
    }
    Ok(())
}

pub fn find_archive_data_dir(root: &Path) -> Option<PathBuf> {
    let mut queue = vec![root.to_path_buf()];
    let mut visited = HashSet::new();
    while let Some(current) = queue.pop() {
        if !visited.insert(current.clone()) {
            continue;
        }
        if current.join("banknotes.db").is_file() && current.join("images").is_dir() {
            return Some(current);
        }
        let Ok(entries) = std::fs::read_dir(&current) else { continue };
        for entry in entries.filter_map(Result::ok) {
            if entry.path().is_dir() {
                queue.push(entry.path());
            }
        }
    }
    None
}

pub fn verify_database_file(path: &Path) -> Result<(), ArchiveError> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| ArchiveError::internal(error.to_string()))?;
    conn.execute_batch("PRAGMA foreign_keys = ON").map_err(db_failed)?;
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name IN ('banknotes', 'tags', 'banknote_tags')",
        )
        .map_err(db_failed)?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(db_failed)?;
    let mut tables = HashSet::new();
    for name in rows {
        tables.insert(name.map_err(db_failed)?);
    }
    if !(tables.contains("banknotes") && tables.contains("tags") && tables.contains("banknote_tags")) {
        return Err(ArchiveError::internal("Archive database is missing required tables."));
    }
    conn.query_row("SELECT COUNT(*) FROM banknotes", [], |row| row.get::<_, i64>(0))
        .map_err(db_failed)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// In-place import merge (single transaction on the live database)
// ---------------------------------------------------------------------------

fn copy_referenced_image(
    source_images_dir: &Path,
    target_images_dir: &Path,
    from_relative: &str,
    to_relative: &str,
) -> Result<(), ArchiveError> {
    let source = to_fs_path(source_images_dir, from_relative);
    if !source.is_file() {
        return Ok(());
    }
    let target = to_fs_path(target_images_dir, to_relative);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(io_failed)?;
    }
    std::fs::copy(&source, &target).map_err(io_failed)?;
    Ok(())
}

fn rewrite_image_records_for_import(
    images: Vec<Value>,
    archive_note_id: i64,
    staged_note_id: i64,
) -> (Vec<Value>, Vec<CopyEntry>) {
    let mut copy_plan = Vec::new();
    let mut rewritten = Vec::new();
    for image in images {
        let Some(obj) = image.as_object().cloned() else {
            rewritten.push(image);
            continue;
        };
        let local = obj
            .get("localPath")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if !local.starts_with(IMAGE_API_PREFIX) {
            rewritten.push(image);
            continue;
        }
        let relative = to_posix(&local[IMAGE_API_PREFIX.len()..]);
        let mut target_relative = relative.clone();
        let note_prefix = format!("notes/{archive_note_id}/");
        if let Some(suffix) = relative.strip_prefix(&note_prefix) {
            target_relative = format!("notes/{staged_note_id}/{suffix}");
        }
        copy_plan.push(CopyEntry {
            from_relative: relative,
            to_relative: target_relative.clone(),
        });
        let mut updated = obj;
        updated.insert(
            "localPath".to_owned(),
            Value::String(format!("{IMAGE_API_PREFIX}{target_relative}")),
        );
        rewritten.push(Value::Object(updated));
    }
    (rewritten, copy_plan)
}

fn list_archive_collections(archive: &Connection) -> Result<Vec<(i64, String)>, ArchiveError> {
    if !table_exists(archive, "collections")? {
        return Err(ArchiveError::internal("Archive must include collections metadata."));
    }
    let mut stmt = archive
        .prepare("SELECT id, name FROM collections ORDER BY id ASC")
        .map_err(db_failed)?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)))
        .map_err(db_failed)?;
    let mut collections = Vec::new();
    for row in rows {
        let (id, name) = row.map_err(db_failed)?;
        let name = name.unwrap_or_default().trim().to_owned();
        if !name.is_empty() {
            collections.push((id, name));
        }
    }
    if collections.is_empty() {
        return Err(ArchiveError::internal("Archive contains no collections."));
    }
    Ok(collections)
}

fn list_archive_tags_by_note(
    archive: &Connection,
    archive_collection_id: i64,
) -> Result<HashMap<i64, Vec<String>>, ArchiveError> {
    let mut stmt = archive
        .prepare(
            "SELECT bt.banknote_id AS banknote_id, t.name AS name
             FROM banknote_tags bt
             INNER JOIN tags t ON t.id = bt.tag_id
             INNER JOIN banknotes b ON b.id = bt.banknote_id
             WHERE b.collection_id = ?1
             ORDER BY bt.banknote_id ASC, t.name COLLATE NOCASE ASC",
        )
        .map_err(db_failed)?;
    let rows = stmt
        .query_map(params![archive_collection_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(db_failed)?;
    let mut by_note: HashMap<i64, Vec<String>> = HashMap::new();
    for row in rows {
        let (note_id, name) = row.map_err(db_failed)?;
        let name = name.unwrap_or_default().trim().to_owned();
        if note_id != 0 && !name.is_empty() {
            by_note.entry(note_id).or_default().push(name);
        }
    }
    Ok(by_note)
}

#[allow(clippy::too_many_lines)]
fn import_showcases(
    tx: &rusqlite::Transaction<'_>,
    archive: &Connection,
    note_map: &HashMap<i64, i64>,
) -> Result<(), ArchiveError> {
    let showcase_rows: Vec<(i64, String)> = {
        let mut stmt = archive
            .prepare("SELECT id, name FROM showcases ORDER BY display_order ASC, id ASC")
            .map_err(db_failed)?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(db_failed)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    };
    if showcase_rows.is_empty() {
        return Ok(());
    }

    for (_, name) in &showcase_rows {
        tx.execute("DELETE FROM showcases WHERE lower(name) = lower(?1)", params![name])
            .map_err(db_failed)?;
    }

    let archive_ids: Vec<i64> = showcase_rows.iter().map(|(id, _)| *id).collect();
    let placeholders = archive_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let node_rows: Vec<NodeRow> = {
        let mut stmt = archive
            .prepare(&format!(
                "SELECT id, showcase_id, parent_node_id, category_id, note_id, cover_note_id
                 FROM showcase_nodes WHERE showcase_id IN ({placeholders})
                 ORDER BY position ASC, id ASC"
            ))
            .map_err(db_failed)?;
        let params: Vec<&dyn rusqlite::ToSql> =
            archive_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        #[allow(clippy::type_complexity)]
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                Ok(NodeRow {
                    id: row.get(0)?,
                    showcase_id: row.get(1)?,
                    parent_node_id: row.get(2)?,
                    category_id: row.get(3)?,
                    note_id: row.get(4)?,
                    cover_note_id: row.get(5)?,
                })
            })
            .map_err(db_failed)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    };

    // Node rows also carry node_type/name/position; fetch the full rows for insert.
    let full_nodes: Vec<(i64, String, Option<String>, Option<i64>)> = {
        let mut stmt = archive
            .prepare(&format!(
                "SELECT id, node_type, name, position FROM showcase_nodes
                 WHERE showcase_id IN ({placeholders}) ORDER BY position ASC, id ASC"
            ))
            .map_err(db_failed)?;
        let params: Vec<&dyn rusqlite::ToSql> =
            archive_ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            })
            .map_err(db_failed)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
    };

    let mut category_ids: Vec<i64> = node_rows
        .iter()
        .filter_map(|row| row.category_id)
        .collect();
    category_ids.sort_unstable();
    category_ids.dedup();
    let mut category_map: HashMap<i64, i64> = HashMap::new();
    for archive_category_id in category_ids {
        let archive_name: Option<String> = archive
            .query_row("SELECT name FROM categories WHERE id = ?1", params![archive_category_id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(db_failed)?
            .flatten();
        let name = archive_name.unwrap_or_default().trim().to_owned();
        if name.is_empty() {
            continue;
        }
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM categories WHERE lower(name) = lower(?1) ORDER BY id ASC LIMIT 1",
                params![name],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_failed)?;
        let staged_id = match existing {
            Some(id) => id,
            None => {
                tx.execute(
                    "INSERT INTO categories (name, created_at, updated_at)
                     VALUES (?1, datetime('now'), datetime('now'))",
                    params![name],
                )
                .map_err(db_failed)?;
                tx.last_insert_rowid()
            }
        };
        category_map.insert(archive_category_id, staged_id);
    }

    let mut showcase_map: HashMap<i64, i64> = HashMap::new();
    for (archive_id, name) in &showcase_rows {
        tx.execute(
            "INSERT INTO showcases (name, display_order, created_at, updated_at)
             VALUES (?1, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM showcases),
                     datetime('now'), datetime('now'))",
            params![name],
        )
        .map_err(db_failed)?;
        showcase_map.insert(*archive_id, tx.last_insert_rowid());
    }

    let full_by_id: HashMap<i64, (String, Option<String>, Option<i64>)> = full_nodes
        .into_iter()
        .map(|(id, node_type, name, position)| (id, (node_type, name, position)))
        .collect();
    let mut node_map: HashMap<i64, i64> = HashMap::new();
    for row in &node_rows {
        let (node_type, name, position) =
            full_by_id.get(&row.id).cloned().unwrap_or_else(|| ("grouping".to_owned(), None, None));
        tx.execute(
            "INSERT INTO showcase_nodes (
               showcase_id, parent_node_id, node_type, category_id, name,
               note_id, cover_note_id, position, created_at, updated_at
             ) VALUES (?1, NULL, ?2, NULL, ?3, NULL, NULL, ?4, datetime('now'), datetime('now'))",
            params![
                remap_reference(&showcase_map, row.showcase_id),
                node_type,
                name,
                position,
            ],
        )
        .map_err(db_failed)?;
        node_map.insert(row.id, tx.last_insert_rowid());
    }
    for row in &node_rows {
        tx.execute(
            "UPDATE showcase_nodes
             SET parent_node_id = ?1, category_id = ?2, note_id = ?3, cover_note_id = ?4
             WHERE id = ?5",
            params![
                remap_reference(&node_map, row.parent_node_id),
                remap_reference(&category_map, row.category_id),
                remap_reference(note_map, row.note_id),
                remap_reference(note_map, row.cover_note_id),
                node_map.get(&row.id),
            ],
        )
        .map_err(db_failed)?;
    }
    Ok(())
}

/// Wipes every user row (and the autoincrement counters) so a `replace`
/// import restarts ids from 1 — the in-place counterpart of staging from a
/// freshly initialized database.
pub const WIPE_SQL: &str = "DELETE FROM showcase_nodes;
         DELETE FROM showcases;
         DELETE FROM categories;
         DELETE FROM banknote_tags;
         DELETE FROM banknotes;
         DELETE FROM tags;
         DELETE FROM collections;
         DELETE FROM sqlite_sequence;";

pub fn wipe_live_data(conn: &Connection) -> Result<(), ArchiveError> {
    conn.execute_batch(WIPE_SQL).map_err(db_failed)?;
    Ok(())
}

/// Clears the whole workspace in one transaction and resets the image store
/// — the in-place counterpart of swapping in a freshly initialized data dir.
pub fn clear_live_data(conn: &mut Connection, data_dir: &Path) -> Result<(), ArchiveError> {
    let tx = conn.transaction().map_err(db_failed)?;
    tx.execute_batch(WIPE_SQL).map_err(db_failed)?;
    tx.commit().map_err(db_failed)?;
    let notes_dir = data_dir.join("images").join("notes");
    if notes_dir.exists() {
        std::fs::remove_dir_all(&notes_dir).map_err(io_failed)?;
    }
    std::fs::create_dir_all(data_dir.join("images")).map_err(io_failed)?;
    std::fs::create_dir_all(&notes_dir).map_err(io_failed)?;
    Ok(())
}

#[allow(clippy::too_many_lines, clippy::type_complexity)]
pub fn merge_archive_into_live(
    live: &mut Connection,
    live_images_dir: &Path,
    archive_data_dir: &Path,
    mode: &str,
) -> Result<(), ArchiveError> {
    let archive_images_dir = archive_data_dir.join("images");
    let archive = Connection::open_with_flags(
        archive_data_dir.join("banknotes.db"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(db_failed)?;

    let tx = live.transaction().map_err(db_failed)?;
    if mode == "replace" {
        tx.execute_batch(WIPE_SQL).map_err(db_failed)?;
    }

    let archive_collections = list_archive_collections(&archive)?;
    let mut removed_note_ids = Vec::new();
    let mut image_copy_plan: Vec<CopyEntry> = Vec::new();
    let mut note_map: HashMap<i64, i64> = HashMap::new();

    for (archive_collection_id, name) in &archive_collections {
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM collections WHERE lower(name) = lower(?1) ORDER BY id ASC LIMIT 1",
                params![name],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_failed)?;
        if let Some(staged_id) = existing {
            let note_ids: Vec<i64> = {
                let mut stmt = tx
                    .prepare("SELECT id FROM banknotes WHERE collection_id = ?1 ORDER BY id ASC")
                    .map_err(db_failed)?;
                let rows = stmt
                    .query_map(params![staged_id], |row| row.get(0))
                    .map_err(db_failed)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
            };
            removed_note_ids.extend(note_ids);
            tx.execute(
                "DELETE FROM banknote_tags
                 WHERE banknote_id IN (SELECT id FROM banknotes WHERE collection_id = ?1)",
                params![staged_id],
            )
            .map_err(db_failed)?;
            tx.execute("DELETE FROM banknotes WHERE collection_id = ?1", params![staged_id])
                .map_err(db_failed)?;
            tx.execute("DELETE FROM tags WHERE collection_id = ?1", params![staged_id])
                .map_err(db_failed)?;
            tx.execute(
                "DELETE FROM banknote_tags
                 WHERE tag_id NOT IN (SELECT id FROM tags)
                    OR banknote_id NOT IN (SELECT id FROM banknotes)",
                [],
            )
            .map_err(db_failed)?;
            tx.execute("DELETE FROM collections WHERE id = ?1", params![staged_id])
                .map_err(db_failed)?;
        }

        tx.execute(
            "INSERT INTO collections (name, created_at, updated_at)
             VALUES (?1, datetime('now'), datetime('now'))",
            params![name],
        )
        .map_err(db_failed)?;
        let staged_collection_id = tx.last_insert_rowid();
        // New collections append after the current manual order.
        tx.execute(
            "UPDATE collections SET display_order =
               (SELECT COALESCE(MAX(display_order), 0) + 1 FROM collections
                WHERE id != ?1) WHERE id = ?1",
            params![staged_collection_id],
        )
        .map_err(db_failed)?;

        let tags_by_note = list_archive_tags_by_note(&archive, *archive_collection_id)?;
        let archive_notes: Vec<(
            i64, Option<i64>, Option<String>, Option<String>, Option<String>,
            Option<String>, Option<String>, Option<String>, Option<String>,
            Option<String>, Option<String>, Option<String>, Option<String>,
            Option<String>, Option<String>,
        )> = {
            let mut stmt = archive
                .prepare(
                    "SELECT id, display_order, denomination, issue_date, catalog_number,
                            grading_company, grade, watermark, serial, url, notes,
                            scraped_data, images, created_at, updated_at
                     FROM banknotes WHERE collection_id = ?1
                     ORDER BY display_order ASC, id ASC",
                )
                .map_err(db_failed)?;
            let rows = stmt
                .query_map(params![archive_collection_id], |row| {
                    Ok((
                        row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?,
                        row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?,
                        row.get(10)?, row.get(11)?, row.get(12)?, row.get(13)?, row.get(14)?,
                    ))
                })
                .map_err(db_failed)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(db_failed)?
        };

        for (offset, note) in archive_notes.iter().enumerate() {
            let archive_note_id = note.0;
            let next_order = offset as i64 + 1;
            tx.execute(
                "INSERT INTO banknotes (
                   collection_id, display_order, denomination, issue_date,
                   catalog_number, grading_company, grade, watermark, serial,
                   url, notes, scraped_data, images, created_at, updated_at
                 ) VALUES (
                   ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, '[]',
                   COALESCE(?13, datetime('now')), COALESCE(?14, datetime('now'))
                 )",
                params![
                    staged_collection_id, next_order,
                    note.2, note.3, note.4, note.5, note.6, note.7, note.8,
                    note.9, note.10, note.11, note.13, note.14,
                ],
            )
            .map_err(db_failed)?;
            let staged_note_id = tx.last_insert_rowid();
            note_map.insert(archive_note_id, staged_note_id);

            let (rewritten, copy_plan) = rewrite_image_records_for_import(
                parse_image_records(note.12.clone()),
                archive_note_id,
                staged_note_id,
            );
            tx.execute(
                "UPDATE banknotes SET images = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![
                    Value::Array(rewritten).to_string(),
                    staged_note_id,
                ],
            )
            .map_err(db_failed)?;
            image_copy_plan.extend(copy_plan);

            let empty_tags = Vec::new();
            for tag_name in tags_by_note.get(&archive_note_id).unwrap_or(&empty_tags) {
                tx.execute(
                    "INSERT OR IGNORE INTO tags (name, collection_id) VALUES (?1, ?2)",
                    params![tag_name, staged_collection_id],
                )
                .map_err(db_failed)?;
                let tag_id: Option<i64> = tx
                    .query_row(
                        "SELECT id FROM tags WHERE collection_id = ?1 AND lower(name) = lower(?2)
                         ORDER BY id ASC LIMIT 1",
                        params![staged_collection_id, tag_name],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(db_failed)?;
                if let Some(tag_id) = tag_id {
                    tx.execute(
                        "INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id) VALUES (?1, ?2)",
                        params![staged_note_id, tag_id],
                    )
                    .map_err(db_failed)?;
                }
            }
        }
    }

    if showcase_table_names_present(&archive)? && showcase_table_names_present(&tx)? {
        import_showcases(&tx, &archive, &note_map)?;
    }
    tx.commit().map_err(db_failed)?;
    drop(archive);

    if mode == "replace" {
        let notes_dir = live_images_dir.join("notes");
        if notes_dir.exists() {
            std::fs::remove_dir_all(&notes_dir).map_err(io_failed)?;
        }
        std::fs::create_dir_all(&notes_dir).map_err(io_failed)?;
    } else {
        for note_id in removed_note_ids {
            let dir = live_images_dir.join("notes").join(note_id.to_string());
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(io_failed)?;
            }
        }
    }
    for entry in image_copy_plan {
        copy_referenced_image(
            &archive_images_dir,
            live_images_dir,
            &entry.from_relative,
            &entry.to_relative,
        )?;
    }
    Ok(())
}

/// Blocking export pipeline: snapshot the live database, filter + renumber
/// the snapshot, and assemble the download zip. Runs on a blocking thread.
pub struct ExportOutput {
    pub zip_bytes: Vec<u8>,
    pub filename: String,
    pub omitted_names: Vec<String>,
}

pub fn run_export(
    pool: &crate::DbPool,
    data_dir: &Path,
    selected_collections: Option<Vec<i64>>,
    selected_showcases: Option<Vec<i64>>,
) -> Result<ExportOutput, ArchiveError> {
    let temp = tempfile::TempDir::new().map_err(io_failed)?;
    let snapshot_path = temp.path().join("banknotes.db");
    let pooled = pool.get().map_err(|_| ArchiveError::unavailable())?;
    snapshot_live_database(&pooled, &snapshot_path)?;
    drop(pooled);
    let export_images_dir = temp.path().join("images");
    let filtered = build_filtered_export_snapshot(
        &snapshot_path,
        selected_collections,
        &export_images_dir,
        &data_dir.join("images"),
        selected_showcases,
    )?;
    let zip_bytes = build_export_zip(&snapshot_path, &filtered.export_images_dir)?;
    Ok(ExportOutput {
        zip_bytes,
        filename: format!("noteharbor-archive-{}.zip", crate::ops::now_iso8601_utc()[..10].to_owned()),
        omitted_names: filtered.omitted_showcases.into_iter().map(|(_, name)| name).collect(),
    })
}

/// Largest archive upload the import handler will stream to disk (5 GiB).
/// Anything bigger answers 413 as JSON mid-stream instead of buffering.
pub const MAX_ARCHIVE_UPLOAD_BYTES: u64 = 5 * 1024 * 1024 * 1024;

/// Blocking import pipeline: validate the staged zip file and merge it into
/// the live database. The caller stages the upload on disk (never in memory)
/// and keeps that directory alive until this returns. Runs on a blocking thread.
pub fn run_import(
    pool: &crate::DbPool,
    data_dir: &Path,
    upload_path: &Path,
    query_mode: Option<&str>,
    body_mode: Option<&str>,
) -> Result<String, ArchiveError> {
    let stage = tempfile::TempDir::new().map_err(io_failed)?;
    let extracted_root = stage.path().join("extracted");
    std::fs::create_dir_all(&extracted_root).map_err(io_failed)?;
    extract_archive(upload_path, &extracted_root)?;
    let archive_data_dir = find_archive_data_dir(&extracted_root).ok_or_else(|| {
        ArchiveError::internal("Archive must contain a banknotes.db file and an images directory.")
    })?;
    verify_database_file(&archive_data_dir.join("banknotes.db"))?;
    let mode = parse_import_mode(query_mode.or(body_mode))?;
    let mut pooled = pool.get().map_err(|_| ArchiveError::unavailable())?;
    merge_archive_into_live(&mut pooled, &data_dir.join("images"), &archive_data_dir, &mode)?;
    Ok(mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        conn.execute_batch("PRAGMA foreign_keys = OFF").expect("pragma");
        conn
    }

    #[test]
    fn import_mode_defaults_to_replace_and_rejects_unknown() {
        assert_eq!(parse_import_mode(None).expect("default").as_str(), "replace");
        assert_eq!(parse_import_mode(Some("")).expect("blank").as_str(), "replace");
        assert_eq!(parse_import_mode(Some("merge")).expect("merge").as_str(), "merge");
        let error = parse_import_mode(Some("overwrite")).expect_err("unknown mode");
        assert_eq!(error.status, 400);
        assert_eq!(
            error.message,
            "Unknown import mode \"overwrite\". Use \"replace\" or \"merge\"."
        );
    }

    #[tokio::test]
    async fn too_large_answers_413_json() {
        let response = ArchiveError::too_large().into_response();
        assert_eq!(response.status(), StatusCode::from_u16(413).unwrap());
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body reads");
        let body: Value = serde_json::from_slice(&bytes).expect("body is JSON");
        assert_eq!(
            body,
            json!({ "error": "Archive exceeds maximum allowed size (5 GB)." })
        );
    }

    #[test]
    fn selected_ids_coerce_like_number_and_dedupe() {
        assert_eq!(parse_selected_ids(None), None);
        assert_eq!(parse_selected_ids(Some("1,2, 2,abc,0,-3,2.5")), Some(vec![1, 2]));
        assert_eq!(parse_selected_ids(Some("nope")), Some(vec![]));
    }

    #[test]
    fn omitted_header_is_uri_encoded_json_names() {
        let header = encode_omitted_showcases_header(&["A, B".to_owned(), "C\"d".to_owned()]);
        let decoded: Vec<String> = serde_json::from_str(
            &percent_decode(&header),
        )
        .expect("decodes to names");
        assert_eq!(decoded, vec!["A, B", "C\"d"]);
        assert!(!header.contains(',') || header.contains("%2C"));
    }

    fn percent_decode(input: &str) -> String {
        let bytes = input.as_bytes();
        let mut out = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
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

    #[test]
    fn strip_scrape_columns_drops_and_preserves() {
        let conn = memory_db();
        conn.execute_batch(
            "CREATE TABLE banknotes (
               id INTEGER PRIMARY KEY AUTOINCREMENT, denomination TEXT,
               scrape_status TEXT DEFAULT 'pending', scrape_error TEXT
             );
             INSERT INTO banknotes (denomination, scrape_status, scrape_error)
             VALUES ('10 Lei', 'failed', 'boom');",
        )
        .expect("seed");
        strip_scrape_columns(&conn).expect("strip");
        let columns = column_names(&conn, "banknotes").expect("columns");
        assert!(!columns.contains("scrape_status"));
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM banknotes", [], |row| row.get(0)).expect("count");
        assert_eq!(count, 1);
        strip_scrape_columns(&conn).expect("idempotent");
    }

    #[test]
    fn sanitize_and_renumber_preserve_thumbnails_and_remap() {
        let conn = memory_db();
        conn.execute_batch(
            "CREATE TABLE collections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
             CREATE TABLE banknotes (
               id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER,
               display_order INTEGER, denomination TEXT, images TEXT
             );
             CREATE TABLE tags (
               id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, collection_id INTEGER NOT NULL
             );
             CREATE TABLE banknote_tags (
               banknote_id INTEGER NOT NULL, tag_id INTEGER NOT NULL,
               PRIMARY KEY (banknote_id, tag_id)
             );
             INSERT INTO collections (id, name) VALUES (10, 'A'), (25, 'B');
             INSERT INTO tags (id, name, collection_id) VALUES (50, 't1', 10), (60, 't2', 25);",
        )
        .expect("seed");
        for (id, collection, order, name, images) in [
            (
                100,
                10,
                5,
                "10 Lei",
                serde_json::json!([
                    { "type": "front", "variant": "full", "localPath": "/api/images/notes/100/front-full.jpg", "origin": "scraped" },
                    { "type": "front", "variant": "thumbnail", "localPath": "/api/images/notes/100/front-thumbnail.jpg", "origin": "scraped" },
                ])
                .to_string(),
            ),
            (
                300,
                10,
                1,
                "20 Lei",
                serde_json::json!([
                    { "type": "back", "variant": "full", "localPath": "/api/images/notes/300/back-full.jpg", "origin": "uploaded" },
                ])
                .to_string(),
            ),
        ] {
            conn.execute(
                "INSERT INTO banknotes (id, collection_id, display_order, denomination, images)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, collection, order, name, images],
            )
            .expect("insert note");
        }
        conn.execute(
            "INSERT INTO banknote_tags (banknote_id, tag_id) VALUES (100, 50), (300, 50)",
            [],
        )
        .expect("links");

        sanitize_snapshot_images(&conn).expect("sanitize");
        let dirty: String = conn
            .query_row("SELECT images FROM banknotes WHERE id = 100", [], |row| row.get(0))
            .expect("dirty");
        assert!(dirty.contains("thumbnail"));

        let plan = renumber_snapshot(&conn).expect("renumber");
        let ids: Vec<i64> = query_ids(&conn, "SELECT id FROM collections ORDER BY id").expect("ids");
        assert_eq!(ids, vec![1, 2]);
        let images: Vec<String> = {
            let mut stmt =
                conn.prepare("SELECT images FROM banknotes ORDER BY id").expect("stmt");
            let rows = stmt.query_map([], |row| row.get::<_, String>(0)).expect("rows");
            rows.collect::<Result<Vec<_>, _>>().expect("collect")
        };
        assert!(images[1].contains("/api/images/notes/2/front-thumbnail.jpg"));
        let targets: Vec<String> = {
            let mut list = plan.copy_plan.iter().map(|entry| entry.to_relative.clone()).collect::<Vec<_>>();
            list.sort();
            list
        };
        assert_eq!(
            targets,
            vec![
                "notes/1/back-full.jpg",
                "notes/2/front-full.jpg",
                "notes/2/front-thumbnail.jpg",
            ]
        );
    }

    #[test]
    fn verify_rejects_databases_missing_tables() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("banknotes.db");
        Connection::open(&path)
            .expect("open")
            .execute_batch("CREATE TABLE collections (id INTEGER PRIMARY KEY)")
            .expect("seed");
        let error = verify_database_file(&path).expect_err("missing tables");
        assert_eq!(error.status, 500);
        assert_eq!(error.message, "Archive database is missing required tables.");
    }
}
