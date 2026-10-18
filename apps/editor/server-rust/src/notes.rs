//! Notes + tags routes plus the note/tag database helpers.
//!
//! Behavior notes (ticket 09):
//! - Notes/tags routers are dual-mounted: `/api/collections/:id/notes|tags`
//!   and bare `/api/notes|tags` (bare resolves the first collection in
//!   sidebar order). A bare route on an empty library answers `500
//!   { error: 'No collections available.' }` — the db-layer throw rendered
//!   as a response instead of hanging without a response.
//! - Route-level catch semantics are: POST/PUT/reorder/move
//!   answer any database failure as 400 with the message (404s for unknown
//!   collections/notes preserved), while GET/DELETE propagate `AppError`
//!   (503/500). Collection-id validation (`400`/`404`) runs before payload
//!   validation, and move checks run target → same → target-exists → mode →
//!   reference in this order (so a bad mode against a missing target is 404).
//! - Note ids are never 400: an unparsable id simply matches no row, so it
//!   answers `404 { error: 'Note not found.' }`.
//! - Multipart and JSON share one handler each for POST/PUT (Axum cannot
//!   split one path+method by content type). Multipart text fields map to the
//!   same sanitizer as JSON; repeated `tags` fields collect into an array
//!   (the UI appends one field per tag). Files under unknown field names are
//!   ignored rather than rejected.
//! - Image slots, URL download (http→https upgrade, 15 MB cap), delete and
//!   generate-thumbnail flags, and stale-file cleanup follow the same steps;
//!   per-file uploads over 15 MB answer 400 (the whole request fails — same
//!   status family, explicit message).

use std::collections::{HashMap, HashSet};

use axum::{
    Json, Router,
    extract::{FromRequest, Multipart, Path, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use regex::Regex;
use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::{Value, json};

use crate::{
    AppState,
    db::{self, DbError, classify},
    images::{
        self, IMAGE_SLOTS, ImageRecord, delete_flag_field_name, field_name_for_slot,
        generate_flag_field_name, get_extension_for_mime_type, get_note_images_dir,
        image_slot_key, parse_boolean_flag,
    },
    js_number,
    routes::{bad_request, created, not_found, ok},
};

/// Per-file and per-download cap (15 MB). The message denominators render as
/// `15 MB`, exactly like `` `${MAX / 1024 / 1024} MB` ``.
pub const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;
const MAX_IMAGE_MB_LABEL: &str = "15 MB";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/// One tag row: `{ id, name }`, ordered `name COLLATE NOCASE`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

/// One note row: `noteFields` verbatim (nullable columns stay nullable) plus
/// parsed `scraped_data`, normalized `images`, and its `tags`.
#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub id: i64,
    pub collection_id: i64,
    pub display_order: Option<i64>,
    pub denomination: Option<String>,
    pub issue_date: Option<String>,
    pub catalog_number: Option<String>,
    pub grading_company: Option<String>,
    pub grade: Option<String>,
    pub watermark: Option<String>,
    pub serial: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub scraped_data: Option<Value>,
    pub images: Vec<ImageRecord>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub tags: Vec<Tag>,
}

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

fn map_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
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
}

/// `buildTagMap`: every note's tags in one query, `ORDER BY name NOCASE`.
fn tag_map(conn: &Connection, collection_id: Option<i64>) -> Result<HashMap<i64, Vec<Tag>>, DbError> {
    let sql = match collection_id {
        Some(_) => {
            "SELECT bt.banknote_id, t.id, t.name
             FROM banknote_tags bt
             INNER JOIN tags t ON t.id = bt.tag_id
             INNER JOIN banknotes b ON b.id = bt.banknote_id
             WHERE b.collection_id = ?1
             ORDER BY t.name COLLATE NOCASE ASC"
        }
        None => {
            "SELECT bt.banknote_id, t.id, t.name
             FROM banknote_tags bt
             INNER JOIN tags t ON t.id = bt.tag_id
             ORDER BY t.name COLLATE NOCASE ASC"
        }
    };
    let mut stmt = conn.prepare(sql).map_err(classify)?;
    let rows: Vec<(i64, Tag)> = match collection_id {
        Some(id) => stmt
            .query_map(params![id], |row| {
                Ok((row.get::<_, i64>(0)?, Tag { id: row.get(1)?, name: row.get(2)? }))
            })
            .map_err(classify)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify)?,
        None => stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, Tag { id: row.get(1)?, name: row.get(2)? }))
            })
            .map_err(classify)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify)?,
    };
    let mut map: HashMap<i64, Vec<Tag>> = HashMap::new();
    for (note_id, tag) in rows {
        map.entry(note_id).or_default().push(tag);
    }
    Ok(map)
}

fn attach_tags(mut notes: Vec<Note>, map: &HashMap<i64, Vec<Tag>>) -> Vec<Note> {
    for note in &mut notes {
        note.tags = map.get(&note.id).cloned().unwrap_or_default();
    }
    notes
}

fn list_notes(conn: &Connection, collection_id: i64) -> Result<Vec<Note>, DbError> {
    let sql = format!(
        "SELECT {NOTE_FIELDS} FROM banknotes
         WHERE collection_id = ?1
         ORDER BY display_order ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(classify)?;
    let notes = stmt
        .query_map(params![collection_id], map_note)
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify)?;
    Ok(attach_tags(notes, &tag_map(conn, Some(collection_id))?))
}

/// Unscoped lookup (mirrors `getNoteById(id)` without a collection).
fn get_note(conn: &Connection, id: i64) -> Result<Option<Note>, DbError> {
    let sql = format!("SELECT {NOTE_FIELDS} FROM banknotes WHERE id = ?1");
    let mut stmt = conn.prepare(&sql).map_err(classify)?;
    match stmt.query_row(params![id], map_note) {
        Ok(note) => {
            let map = tag_map(conn, None)?;
            Ok(attach_tags(vec![note], &map).into_iter().next())
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

fn get_note_in_collection(
    conn: &Connection,
    id: i64,
    collection_id: i64,
) -> Result<Option<Note>, DbError> {
    let sql = format!(
        "SELECT {NOTE_FIELDS} FROM banknotes
         WHERE id = ?1 AND collection_id = ?2"
    );
    let mut stmt = conn.prepare(&sql).map_err(classify)?;
    match stmt.query_row(params![id, collection_id], map_note) {
        Ok(note) => {
            let map = tag_map(conn, Some(collection_id))?;
            Ok(attach_tags(vec![note], &map).into_iter().next())
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

fn map_tag(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag { id: row.get(0)?, name: row.get(1)? })
}

fn list_tags(conn: &Connection, collection_id: i64) -> Result<Vec<Tag>, DbError> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT t.id, t.name
             FROM tags t
             INNER JOIN banknote_tags bt ON bt.tag_id = t.id
             INNER JOIN banknotes b ON b.id = bt.banknote_id
             WHERE t.collection_id = ?1
               AND b.collection_id = ?1
             ORDER BY t.name COLLATE NOCASE ASC",
        )
        .map_err(classify)?;
    let rows = stmt
        .query_map(params![collection_id], map_tag)
        .map_err(classify)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(classify);
    rows
}

/// `normalizeTagName`: trim + collapse internal whitespace runs.
pub fn normalize_tag_name(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn ensure_tag(conn: &Connection, collection_id: i64, name: &str) -> Result<Option<Tag>, DbError> {
    let normalized = normalize_tag_name(name);
    if normalized.is_empty() {
        return Ok(None);
    }
    conn.execute(
        "INSERT OR IGNORE INTO tags (name, collection_id) VALUES (?1, ?2)",
        params![normalized, collection_id],
    )
    .map_err(classify)?;
    let mut stmt = conn
        .prepare("SELECT id, name FROM tags WHERE collection_id = ?1 AND lower(name) = lower(?2)")
        .map_err(classify)?;
    match stmt.query_row(params![collection_id, normalized], |row| {
        Ok(Tag { id: row.get(0)?, name: row.get(1)? })
    }) {
        Ok(tag) => Ok(Some(tag)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

/// `replaceNoteTags`: clear links, then find-or-create each normalized,
/// deduplicated name in the target collection's scope.
fn replace_note_tags(
    conn: &Connection,
    note_id: i64,
    tag_names: &[String],
    collection_id: i64,
) -> Result<(), DbError> {
    conn.execute("DELETE FROM banknote_tags WHERE banknote_id = ?1", params![note_id])
        .map_err(classify)?;
    let mut seen: HashSet<String> = HashSet::new();
    for name in tag_names {
        let normalized = normalize_tag_name(name);
        if normalized.is_empty() || !seen.insert(normalized.clone()) {
            continue;
        }
        if let Some(tag) = ensure_tag(conn, collection_id, &normalized)? {
            conn.execute(
                "INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id) VALUES (?1, ?2)",
                params![note_id, tag.id],
            )
            .map_err(classify)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Note writes
// ---------------------------------------------------------------------------

/// Sanitized create/update payload (mirrors `sanitizeNotePayload`).
#[derive(Debug, Clone)]
pub struct NotePayload {
    pub denomination: String,
    pub issue_date: String,
    pub catalog_number: String,
    pub grading_company: String,
    pub grade: String,
    pub watermark: String,
    pub serial: String,
    pub url: String,
    pub notes: String,
    pub tags: Vec<String>,
    pub scraped_data: Option<Value>,
}

/// JS `String(x)` for tag/field coercion (`normalizeTagName`'s
/// `String(name ?? '')` and `String(body.x ?? '')`): nullish is blank,
/// arrays join with `,`, objects are `[object Object]`.
pub fn node_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        Value::Array(items) => items.iter().map(node_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// `normalizeDenomination`: thousands-separate a leading amount (`1000 Lei` →
/// `1,000 Lei`), preserving decimals and suffix text.
pub fn normalize_denomination(value: &str) -> String {
    static PATTERN: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        Regex::new(r"^(\d[\d,]*)(\.\d+)?(.*)$").expect("denomination pattern")
    });
    let trimmed = value.trim();
    let Some(captures) = pattern.captures(trimmed) else {
        return trimmed.to_owned();
    };
    let raw_integer = captures.get(1).map_or("", |part| part.as_str());
    let decimal = captures.get(2).map_or("", |part| part.as_str());
    let suffix = captures.get(3).map_or("", |part| part.as_str());
    let digits: String = raw_integer.chars().filter(|char| *char != ',').collect();
    if digits.is_empty() || !digits.chars().all(|char| char.is_ascii_digit()) {
        return trimmed.to_owned();
    }
    // `\B(?=(\d{3})+(?!\d))`: a comma before every group of three, from the
    // right, never at the start.
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, char) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(char);
    }
    format!("{grouped}{decimal}{suffix}")
}

/// `normalizeIssueDate`: zero-pad month/day parts of slash dates.
pub fn normalize_issue_date(value: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() || !normalized.contains('/') {
        return normalized.to_owned();
    }
    if normalized.len() == 4 && normalized.chars().all(|char| char.is_ascii_digit()) {
        return normalized.to_owned();
    }
    normalized
        .split('/')
        .enumerate()
        .map(|(index, part)| {
            if index < 2 && part.len() == 1 && part.chars().all(|char| char.is_ascii_digit()) {
                format!("0{part}")
            } else {
                part.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// `normalizeTags`: an array passes through, a single string becomes one tag,
/// anything else is no tags.
pub fn normalize_tags(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items.iter().map(node_string).collect(),
        Some(Value::String(text)) => vec![text.clone()],
        _ => Vec::new(),
    }
}

fn payload_string(body: &Value, key: &str) -> String {
    body.get(key).map(node_string).unwrap_or_default().trim().to_owned()
}

/// Sanitizes the note payload, including the falsy-`scraped_data` rule: a
/// missing, null, empty-string, `false`, or numeric payload means null; a
/// non-empty string must parse as JSON; any other object passes through.
pub fn sanitize_payload(body: &Value) -> Result<NotePayload, String> {
    let scraped_data = match body.get("scraped_data") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(_)) => None,
        Some(Value::Number(_)) => None,
        Some(Value::String(text)) if text.is_empty() => None,
        Some(Value::String(text)) => match serde_json::from_str(text) {
            Ok(parsed) => Some(parsed),
            Err(_) => return Err("Invalid scraped_data payload.".to_owned()),
        },
        Some(other) if other.is_object() || other.is_array() => Some(other.clone()),
        _ => None,
    };
    Ok(NotePayload {
        denomination: normalize_denomination(&payload_string(body, "denomination")),
        issue_date: normalize_issue_date(&payload_string(body, "issue_date")),
        catalog_number: payload_string(body, "catalog_number"),
        grading_company: payload_string(body, "grading_company"),
        grade: payload_string(body, "grade"),
        watermark: payload_string(body, "watermark"),
        serial: payload_string(body, "serial"),
        url: payload_string(body, "url"),
        notes: payload_string(body, "notes"),
        tags: normalize_tags(body.get("tags")),
        scraped_data,
    })
}

fn scraped_data_json(payload: &NotePayload) -> Option<String> {
    payload.scraped_data.as_ref().map(|data| data.to_string())
}

fn create_note_row(
    conn: &mut Connection,
    collection_id: i64,
    payload: &NotePayload,
    images_json: &str,
) -> Result<Note, DbError> {
    let tx = conn.transaction().map_err(classify)?;
    tx.execute(
        "INSERT INTO banknotes (
           collection_id, display_order, denomination, issue_date,
           catalog_number, grading_company, grade, watermark, serial, url,
           notes, scraped_data, images, created_at, updated_at
         )
         VALUES (
           ?1, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM banknotes WHERE collection_id = ?1),
           ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
           datetime('now'), datetime('now')
         )",
        params![
            collection_id,
            payload.denomination,
            payload.issue_date,
            payload.catalog_number,
            payload.grading_company,
            payload.grade,
            payload.watermark,
            payload.serial,
            payload.url,
            payload.notes,
            scraped_data_json(payload),
            images_json,
        ],
    )
    .map_err(classify)?;
    let note_id = tx.last_insert_rowid();
    replace_note_tags(&tx, note_id, &payload.tags, collection_id)?;
    tx.commit().map_err(classify)?;
    get_note_in_collection(conn, note_id, collection_id)?
        .ok_or_else(|| DbError::Failed("Note not found.".to_owned()))
}

fn update_note_row(
    conn: &mut Connection,
    images_dir: &std::path::Path,
    note_id: i64,
    collection_id: i64,
    payload: &NotePayload,
    images_json: &str,
) -> Result<Note, DbError> {
    if get_note(conn, note_id)?.is_none() {
        return Err(DbError::Failed("Note not found.".to_owned()));
    }
    let tx = conn.transaction().map_err(classify)?;
    tx.execute(
        "UPDATE banknotes
         SET denomination = ?1, issue_date = ?2, catalog_number = ?3,
             grading_company = ?4, grade = ?5, watermark = ?6, serial = ?7,
             url = ?8, notes = ?9, scraped_data = ?10, images = ?11,
             updated_at = datetime('now')
         WHERE id = ?12",
        params![
            payload.denomination,
            payload.issue_date,
            payload.catalog_number,
            payload.grading_company,
            payload.grade,
            payload.watermark,
            payload.serial,
            payload.url,
            payload.notes,
            scraped_data_json(payload),
            images_json,
            note_id,
        ],
    )
    .map_err(classify)?;
    replace_note_tags(&tx, note_id, &payload.tags, collection_id)?;
    tx.commit().map_err(classify)?;
    let images_value: Value = serde_json::from_str(images_json).unwrap_or(Value::Null);
    images::remove_stale_managed_files(images_dir, note_id, &images_value);
    get_note_in_collection(conn, note_id, collection_id)?
        .ok_or_else(|| DbError::Failed("Note not found.".to_owned()))
}

fn remove_managed_note_images(images_dir: &std::path::Path, note_id: i64) {
    let dir = get_note_images_dir(images_dir, note_id);
    if dir.is_dir() {
        let _ = std::fs::remove_dir_all(&dir);
    }
}

fn delete_note_row(
    conn: &mut Connection,
    images_dir: &std::path::Path,
    note_id: i64,
    collection_id: i64,
    display_order: Option<i64>,
) -> Result<(), DbError> {
    let tx = conn.transaction().map_err(classify)?;
    tx.execute("DELETE FROM banknotes WHERE id = ?1", params![note_id])
        .map_err(classify)?;
    if let Some(order) = display_order {
        tx.execute(
            "UPDATE banknotes
             SET display_order = display_order - 1, updated_at = datetime('now')
             WHERE collection_id = ?1 AND display_order > ?2",
            params![collection_id, order],
        )
        .map_err(classify)?;
    }
    tx.commit().map_err(classify)?;
    remove_managed_note_images(images_dir, note_id);
    Ok(())
}

fn reorder_notes_row(
    conn: &mut Connection,
    ids: &[i64],
    collection_id: i64,
) -> Result<Vec<Note>, DbError> {
    const MESSAGE: &str = "Reorder request must include every note exactly once.";
    let existing: Vec<i64> =
        list_notes(conn, collection_id)?.iter().map(|note| note.id).collect();
    let unique: HashSet<i64> = ids.iter().copied().collect();
    if ids.is_empty() || ids.len() != existing.len() || unique.len() != ids.len() {
        return Err(DbError::Failed(MESSAGE.to_owned()));
    }
    if existing.iter().any(|id| !unique.contains(id)) {
        return Err(DbError::Failed(MESSAGE.to_owned()));
    }
    let tx = conn.transaction().map_err(classify)?;
    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE banknotes
             SET display_order = ?1, updated_at = datetime('now')
             WHERE id = ?2",
            params![(index + 1) as i64, id],
        )
        .map_err(classify)?;
    }
    tx.commit().map_err(classify)?;
    list_notes(conn, collection_id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveMode {
    Start,
    End,
    Before,
    After,
}

impl MoveMode {
    fn parse(raw: Option<&Value>) -> Option<Self> {
        match raw.and_then(Value::as_str) {
            Some("start") => Some(Self::Start),
            Some("end") => Some(Self::End),
            Some("before") => Some(Self::Before),
            Some("after") => Some(Self::After),
            _ => None,
        }
    }
}

fn move_note_row(
    conn: &mut Connection,
    note_id: i64,
    source_collection_id: i64,
    target_collection_id: i64,
    mode: MoveMode,
    reference_id: Option<i64>,
) -> Result<Note, DbError> {
    if source_collection_id == target_collection_id {
        return Err(DbError::Failed("Note is already in this collection.".to_owned()));
    }
    let existing = get_note_in_collection(conn, note_id, source_collection_id)?
        .ok_or_else(|| DbError::Failed("Note not found.".to_owned()))?;
    let tag_names: Vec<String> = existing.tags.iter().map(|tag| tag.name.clone()).collect();
    let target_ids: Vec<i64> = list_notes(conn, target_collection_id)?
        .iter()
        .map(|note| note.id)
        .collect();

    let mut next_order: Vec<i64> = Vec::with_capacity(target_ids.len() + 1);
    match mode {
        MoveMode::Start => {
            next_order.push(note_id);
            next_order.extend(target_ids);
        }
        MoveMode::End => {
            next_order.extend(target_ids);
            next_order.push(note_id);
        }
        MoveMode::Before | MoveMode::After => {
            let position = reference_id.and_then(|reference| {
                target_ids.iter().position(|id| *id == reference).map(|index| {
                    if mode == MoveMode::Before { index } else { index + 1 }
                })
            });
            match position {
                // Unknown references fall back to appending, exactly like Node.
                None => {
                    next_order.extend(target_ids);
                    next_order.push(note_id);
                }
                Some(index) => {
                    next_order.extend(target_ids[..index].iter().copied());
                    next_order.push(note_id);
                    next_order.extend(target_ids[index..].iter().copied());
                }
            }
        }
    }

    let tx = conn.transaction().map_err(classify)?;
    tx.execute(
        "UPDATE banknotes
         SET collection_id = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        params![target_collection_id, note_id],
    )
    .map_err(classify)?;
    for (index, id) in next_order.iter().enumerate() {
        tx.execute(
            "UPDATE banknotes
             SET display_order = ?1, updated_at = datetime('now')
             WHERE id = ?2",
            params![(index + 1) as i64, id],
        )
        .map_err(classify)?;
    }
    replace_note_tags(&tx, note_id, &tag_names, target_collection_id)?;
    if let Some(order) = existing.display_order {
        tx.execute(
            "UPDATE banknotes
             SET display_order = display_order - 1, updated_at = datetime('now')
             WHERE collection_id = ?1 AND display_order > ?2",
            params![source_collection_id, order],
        )
        .map_err(classify)?;
    }
    tx.commit().map_err(classify)?;
    get_note_in_collection(conn, note_id, target_collection_id)?
        .ok_or_else(|| DbError::Failed("Note not found.".to_owned()))
}

// ---------------------------------------------------------------------------
// Image pipeline (port of the `buildNextImages` block in `routes/notes.js`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct UploadedFile {
    bytes: Vec<u8>,
    mime: String,
    filename: String,
}

#[derive(Debug, Default)]
struct FormInput {
    /// Text fields; repeated names (the UI appends one `tags` field per tag)
    /// keep every value in order.
    fields: HashMap<String, Vec<String>>,
    files: HashMap<String, UploadedFile>,
}

fn field_text(fields: &HashMap<String, Vec<String>>, name: &str) -> Option<String> {
    fields.get(name).and_then(|values| values.last()).cloned()
}

fn form_to_value(fields: &HashMap<String, Vec<String>>) -> Value {
    let mut map = serde_json::Map::new();
    for (name, values) in fields {
        if name == "tags" {
            map.insert(
                name.clone(),
                Value::Array(values.iter().map(|item| Value::String(item.clone())).collect()),
            );
        } else if let Some(last) = values.last() {
            map.insert(name.clone(), Value::String(last.clone()));
        }
    }
    Value::Object(map)
}

/// Text-field view of a JSON body for the image pipeline: flags and `*_url`
/// fields read the same way in both encodings (`parseBooleanFlag` over
/// `String(value)`).
fn body_fields(body: &Value) -> HashMap<String, Vec<String>> {
    let mut fields = HashMap::new();
    let Some(object) = body.as_object() else { return fields };
    for (name, value) in object {
        match value {
            Value::String(text) => {
                fields.insert(name.clone(), vec![text.clone()]);
            }
            Value::Bool(flag) => {
                fields.insert(name.clone(), vec![flag.to_string()]);
            }
            Value::Number(number) => {
                fields.insert(name.clone(), vec![number.to_string()]);
            }
            Value::Array(items) if name == "tags" => {
                fields.insert(name.clone(), items.iter().map(node_string).collect());
            }
            _ => {}
        }
    }
    fields
}

async fn read_multipart(mut multipart: Multipart) -> Result<FormInput, String> {
    let mut input = FormInput::default();
    loop {
        match multipart.next_field().await {
            Err(error) => return Err(error.to_string()),
            Ok(None) => break,
            Ok(Some(field)) => {
                let name = field.name().unwrap_or("").to_owned();
                if name.is_empty() {
                    continue;
                }
                let is_slot = IMAGE_SLOTS.iter().any(|slot| slot.field == name);
                if is_slot && field.file_name().is_some() {
                    let mime = field.content_type().map(str::to_owned).unwrap_or_default();
                    let filename = field.file_name().map(str::to_owned).unwrap_or_default();
                    match field.bytes().await {
                        Err(error) => return Err(error.to_string()),
                        Ok(bytes) => {
                            input.files.insert(
                                name,
                                UploadedFile { bytes: bytes.to_vec(), mime, filename },
                            );
                        }
                    }
                } else {
                    match field.text().await {
                        Err(error) => return Err(error.to_string()),
                        Ok(text) => input.fields.entry(name).or_default().push(text),
                    }
                }
            }
        }
    }
    Ok(input)
}

fn url_field_name(image_type: &str, variant: &str) -> String {
    format!("image_{image_type}_{variant}_url")
}

/// Pure half of `validateScrapedImageUrl` + the http→https upgrade: rejects
/// unparsable and non-HTTP(S) URLs, rewrites `http:` to `https:`.
pub fn normalize_scraped_url(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw).map_err(|_| "Invalid image URL.".to_owned())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only HTTP(S) image URLs are accepted.".to_owned());
    }
    let mut normalized = parsed;
    if normalized.scheme() == "http" {
        normalized.set_scheme("https").map_err(|_| "Invalid image URL.".to_owned())?;
    }
    Ok(normalized)
}

async fn download_image_url(
    client: &reqwest::Client,
    images_dir: &std::path::Path,
    note_id: i64,
    image_type: &str,
    variant: &str,
    image_url: &str,
) -> Result<ImageRecord, String> {
    let normalized = normalize_scraped_url(image_url)?;
    let response =
        client.get(normalized.clone()).send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_owned();
    if response.content_length().is_some_and(|len| len > MAX_IMAGE_BYTES as u64) {
        return Err(format!("Image exceeds maximum allowed size ({MAX_IMAGE_MB_LABEL})."));
    }
    if !status.is_success() {
        return match status.canonical_reason() {
            Some(reason) => Err(format!("Failed to download image: {} {reason}", status.as_u16())),
            None => Err(format!("Failed to download image: {}", status.as_u16())),
        };
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!("Downloaded image exceeds maximum allowed size ({MAX_IMAGE_MB_LABEL})."));
    }
    let extension = get_extension_for_mime_type(&content_type, normalized.path());
    images::store_ingest_buffer(
        images_dir,
        note_id,
        image_type,
        variant,
        &bytes,
        &extension,
        "scraped",
        Some(normalized.to_string()),
    )
    .map_err(|error| error.to_string())
}

/// Full `buildNextImages` port. `existing` is the note's current image list;
/// uploads win over URL downloads, deletions win over both, and an explicit
/// thumbnail upload disables generation for its face.
async fn build_next_images(
    client: &reqwest::Client,
    images_dir: &std::path::Path,
    note_id: i64,
    existing: &[ImageRecord],
    fields: &HashMap<String, Vec<String>>,
    files: &HashMap<String, UploadedFile>,
) -> Result<Vec<ImageRecord>, String> {
    let mut by_slot: HashMap<String, ImageRecord> = HashMap::new();
    for image in existing {
        by_slot.insert(image_slot_key(&image.image_type, &image.variant), image.clone());
    }
    let mut deleted: HashSet<String> = HashSet::new();

    for slot in IMAGE_SLOTS {
        if parse_boolean_flag(
            field_text(fields, &delete_flag_field_name(slot.image_type, slot.variant)).as_deref(),
        ) {
            let key = image_slot_key(slot.image_type, slot.variant);
            if let Some(stale) = by_slot.remove(&key) {
                images::remove_file_if_managed(images_dir, Some(&stale.local_path));
            }
            deleted.insert(key);
        }
    }

    for slot in IMAGE_SLOTS {
        let Some(file) = files.get(slot.field) else { continue };
        if !file.mime.to_lowercase().starts_with("image/") {
            continue;
        }
        if file.bytes.len() > MAX_IMAGE_BYTES {
            return Err("File too large.".to_owned());
        }
        let key = image_slot_key(slot.image_type, slot.variant);
        if let Some(stale) = by_slot.remove(&key) {
            images::remove_file_if_managed(images_dir, Some(&stale.local_path));
        }
        let extension = get_extension_for_mime_type(&file.mime, &file.filename);
        let record = images::store_ingest_buffer(
            images_dir,
            note_id,
            slot.image_type,
            slot.variant,
            &file.bytes,
            &extension,
            "uploaded",
            None,
        )
        .map_err(|error| error.to_string())?;
        by_slot.insert(key, record);
    }

    for slot in IMAGE_SLOTS {
        let key = image_slot_key(slot.image_type, slot.variant);
        let image_url = field_text(fields, &url_field_name(slot.image_type, slot.variant))
            .map(|value| value.trim().to_owned())
            .unwrap_or_default();
        if image_url.is_empty() || files.contains_key(slot.field) || deleted.contains(&key) {
            continue;
        }
        if let Some(stale) = by_slot.remove(&key) {
            images::remove_file_if_managed(images_dir, Some(&stale.local_path));
        }
        let downloaded = download_image_url(
            client,
            images_dir,
            note_id,
            slot.image_type,
            slot.variant,
            &image_url,
        )
        .await?;
        by_slot.insert(key, downloaded);
    }

    for image_type in ["front", "back"] {
        if files.contains_key(field_name_for_slot(image_type, "thumbnail").as_str())
            || !parse_boolean_flag(
                field_text(fields, &generate_flag_field_name(image_type)).as_deref(),
            )
        {
            continue;
        }
        let source: Option<(Vec<u8>, String, String)> =
            match files.get(field_name_for_slot(image_type, "full").as_str()) {
                Some(full) => {
                    Some((full.bytes.clone(), full.mime.clone(), full.filename.clone()))
                }
                None => by_slot.get(&image_slot_key(image_type, "full")).and_then(|full| {
                    images::resolve_local_path(images_dir, &full.local_path)
                        .and_then(|path| std::fs::read(path).ok())
                        .map(|bytes| (bytes, String::new(), full.local_path.clone()))
                }),
            };
        let Some((source_bytes, mime, name)) = source else { continue };
        let generated = images::generate_thumbnail_buffer(&source_bytes)?;
        let key = image_slot_key(image_type, "thumbnail");
        if let Some(stale) = by_slot.remove(&key) {
            images::remove_file_if_managed(images_dir, Some(&stale.local_path));
        }
        let extension = get_extension_for_mime_type(&mime, &name);
        let record = images::store_ingest_buffer(
            images_dir,
            note_id,
            image_type,
            "thumbnail",
            &generated,
            &extension,
            "generated",
            None,
        )
        .map_err(|error| error.to_string())?;
        by_slot.insert(key, record);
    }

    Ok(IMAGE_SLOTS
        .iter()
        .filter_map(|slot| by_slot.remove(&image_slot_key(slot.image_type, slot.variant)))
        .collect())
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

fn status_response(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn app_error_response(error: crate::AppError) -> Response {
    match error {
        crate::AppError::DatabaseUnavailable => {
            status_response(StatusCode::SERVICE_UNAVAILABLE, "Database unavailable.")
        }
        crate::AppError::Http { status, message } => status_response(status, &message),
    }
}

fn captures(collection: Option<Path<Vec<String>>>) -> Vec<String> {
    collection.map(|Path(values)| values).unwrap_or_default()
}

/// Scoped (`/api/collections/:id/...`, one capture) vs bare (`/api/...`, no
/// capture) collection resolution. `Err(status, message)` preserves the exact
/// status: 400 for `abc`/`0`, 404 for unknown ids.
fn resolve_collection(conn: &Connection, raw: Option<&str>) -> Result<i64, (StatusCode, String)> {
    match raw {
        None => {
            let mut stmt = conn
                .prepare("SELECT id FROM collections ORDER BY display_order ASC, id ASC LIMIT 1")
                .map_err(classify)
                .map_err(|error| {
                    (StatusCode::INTERNAL_SERVER_ERROR, error.user_message().to_owned())
                })?;
            match stmt.query_row([], |row| row.get::<_, i64>(0)) {
                Ok(id) => Ok(id),
                Err(rusqlite::Error::QueryReturnedNoRows) => Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "No collections available.".to_owned(),
                )),
                Err(error) => Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    classify(error).user_message().to_owned(),
                )),
            }
        }
        Some(raw_id) => {
            let Some(id) = js_number(&Value::String(raw_id.to_owned())) else {
                return Err((StatusCode::BAD_REQUEST, "A valid collection ID is required.".to_owned()));
            };
            if id <= 0 {
                return Err((StatusCode::BAD_REQUEST, "A valid collection ID is required.".to_owned()));
            }
            let mut stmt = conn
                .prepare("SELECT id FROM collections WHERE id = ?1")
                .map_err(classify)
                .map_err(|error| {
                    (StatusCode::INTERNAL_SERVER_ERROR, error.user_message().to_owned())
                })?;
            match stmt.query_row(params![id], |_| Ok(())) {
                Ok(()) => Ok(id),
                Err(rusqlite::Error::QueryReturnedNoRows) => {
                    Err((StatusCode::NOT_FOUND, "Collection not found.".to_owned()))
                }
                Err(error) => Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    classify(error).user_message().to_owned(),
                )),
            }
        }
    }
}

/// Resolves the collection on its own checkout so handlers stay flat: the
/// `400`/`404`/`500` travels as `AppError::Http` with the exact status.
async fn resolve_collection_id(
    pool: &db::DbPool,
    raw: Option<String>,
) -> Result<i64, crate::AppError> {
    let outcome = db::with_conn(pool, move |conn| Ok(resolve_collection(conn, raw.as_deref())))
        .await?;
    outcome.map_err(|(status, message)| crate::AppError::Http { status, message })
}

/// Caught-style resolution (POST/PUT/reorder/move): 404 stays 404, everything
/// else in the catch answers 400 with the message.
async fn resolve_for_write(
    pool: &db::DbPool,
    raw: Option<String>,
) -> Result<i64, (StatusCode, String)> {
    resolve_collection_id(pool, raw).await.map_err(|error| match error {
        crate::AppError::Http { status: StatusCode::NOT_FOUND, message } => {
            (StatusCode::NOT_FOUND, message)
        }
        crate::AppError::DatabaseUnavailable => {
            (StatusCode::BAD_REQUEST, "Database unavailable.".to_owned())
        }
        crate::AppError::Http { message, .. } => (StatusCode::BAD_REQUEST, message),
    })
}

/// Caught-style database failure: any error answers 400 with the message.
fn db_failure(error: crate::AppError) -> Response {
    match error {
        crate::AppError::DatabaseUnavailable => bad_request("Database unavailable."),
        crate::AppError::Http { message, .. } => bad_request(&message),
    }
}

async fn find_note(
    pool: &db::DbPool,
    collection_id: i64,
    raw_id: &str,
) -> Result<Option<Note>, crate::AppError> {
    let Some(note_id) = js_number(&Value::String(raw_id.to_owned())) else {
        return Ok(None);
    };
    db::with_conn(pool, move |conn| get_note_in_collection(conn, note_id, collection_id)).await
}

/// The parsed POST/PUT body: sanitizer-ready JSON, text fields for the image
/// pipeline, plus any uploaded files.
struct NoteInput {
    body: Value,
    fields: HashMap<String, Vec<String>>,
    files: HashMap<String, UploadedFile>,
}

async fn read_note_input(state: &AppState, req: Request) -> Result<NoteInput, (StatusCode, String)> {
    let is_multipart = req
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|content_type| content_type.starts_with("multipart/form-data"));
    if !is_multipart {
        let bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
            .await
            .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
        if bytes.is_empty() {
            let fields = HashMap::new();
            return Ok(NoteInput { body: Value::Object(Default::default()), fields, files: HashMap::new() });
        }
        let body: Value = serde_json::from_slice(&bytes)
            .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
        let fields = body_fields(&body);
        return Ok(NoteInput { body, fields, files: HashMap::new() });
    }
    // A malformed multipart body fails in middleware (the multipart layer
    // runs before the route), surfacing as a 500 — same here.
    match Multipart::from_request(req, state).await {
        Err(error) => Err((StatusCode::INTERNAL_SERVER_ERROR, error.to_string())),
        Ok(multipart) => match read_multipart(multipart).await {
            Err(message) => Err((StatusCode::INTERNAL_SERVER_ERROR, message)),
            Ok(input) => {
                let body = form_to_value(&input.fields);
                Ok(NoteInput { body, fields: input.fields, files: input.files })
            }
        },
    }
}

/// Lenient JSON-body read for reorder/move (no multipart there: a
/// non-JSON body parses to nothing and fails the shape checks below).
async fn read_json_body(req: Request) -> Value {
    let Ok(bytes) = axum::body::to_bytes(req.into_body(), usize::MAX).await else {
        return Value::Null;
    };
    if bytes.is_empty() {
        return Value::Null;
    }
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

fn images_json(images: &[ImageRecord]) -> String {
    serde_json::to_value(images).map(|value| value.to_string()).unwrap_or_else(|_| "[]".to_owned())
}

async fn list_notes_handler(
    State(state): State<AppState>,
    collection: Option<Path<Vec<String>>>,
) -> Result<Response, crate::AppError> {
    let raw = captures(collection);
    let collection_id = resolve_collection_id(&state.pool, raw.first().cloned()).await?;
    let notes = db::with_conn(&state.pool, move |conn| list_notes(conn, collection_id)).await?;
    Ok(ok(json!({ "notes": notes })))
}

async fn get_note_handler(
    State(state): State<AppState>,
    collection: Option<Path<Vec<String>>>,
) -> Result<Response, crate::AppError> {
    let raw = captures(collection);
    let (raw_collection, raw_id) = match raw.as_slice() {
        [collection_id, id] => (Some(collection_id.clone()), id.clone()),
        [id] => (None, id.clone()),
        _ => (None, String::new()),
    };
    let collection_id = resolve_collection_id(&state.pool, raw_collection).await?;
    let note = db::with_conn(&state.pool, move |conn| {
        let Some(note_id) = js_number(&Value::String(raw_id)) else {
            return Ok(None);
        };
        get_note_in_collection(conn, note_id, collection_id)
    })
    .await?;
    match note {
        Some(note) => Ok(ok(json!({ "note": note }))),
        None => Ok(not_found("Note not found.")),
    }
}

async fn create_note_handler(
    State(state): State<AppState>,
    collection: Option<Path<Vec<String>>>,
    req: Request,
) -> Response {
    let raw = captures(collection);
    let collection_id = match resolve_for_write(&state.pool, raw.first().cloned()).await {
        Ok(id) => id,
        Err((status, message)) => return status_response(status, &message),
    };
    let input = match read_note_input(&state, req).await {
        Ok(input) => input,
        Err((status, message)) => return status_response(status, &message),
    };
    let payload = match sanitize_payload(&input.body) {
        Ok(payload) => payload,
        Err(message) => return bad_request(&message),
    };
    if payload.denomination.is_empty() {
        return bad_request("Denomination is required.");
    }
    let create_payload = payload.clone();
    let inserted = db::with_conn(&state.pool, move |conn| {
        create_note_row(conn, collection_id, &create_payload, "[]")
    })
    .await;
    let note = match inserted {
        Ok(note) => note,
        Err(error) => return db_failure(error),
    };
    let client = reqwest::Client::new();
    let images_dir = state.data_dir.join("images");
    let images = match build_next_images(&client, &images_dir, note.id, &[], &input.fields, &input.files)
        .await
    {
        Ok(images) => images,
        Err(message) => return bad_request(&message),
    };
    if images.is_empty() {
        return created(json!({ "note": note }));
    }
    let stored = images_json(&images);
    match db::with_conn(&state.pool, move |conn| {
        update_note_row(conn, &images_dir, note.id, collection_id, &payload, &stored)
    })
    .await
    {
        Ok(note) => created(json!({ "note": note })),
        Err(error) => db_failure(error),
    }
}

async fn update_note_handler(
    State(state): State<AppState>,
    collection: Option<Path<Vec<String>>>,
    req: Request,
) -> Response {
    let raw = captures(collection);
    let (raw_collection, raw_id) = match raw.as_slice() {
        [collection_id, id] => (Some(collection_id.clone()), id.clone()),
        [id] => (None, id.clone()),
        _ => (None, String::new()),
    };
    let collection_id = match resolve_for_write(&state.pool, raw_collection).await {
        Ok(id) => id,
        Err((status, message)) => return status_response(status, &message),
    };
    let existing = match find_note(&state.pool, collection_id, &raw_id).await {
        Ok(note) => note,
        Err(error) => return app_error_response(error),
    };
    let Some(existing) = existing else {
        return not_found("Note not found.");
    };
    let input = match read_note_input(&state, req).await {
        Ok(input) => input,
        Err((status, message)) => return status_response(status, &message),
    };
    let payload = match sanitize_payload(&input.body) {
        Ok(payload) => payload,
        Err(message) => return bad_request(&message),
    };
    let client = reqwest::Client::new();
    let images_dir = state.data_dir.join("images");
    let images = match build_next_images(
        &client,
        &images_dir,
        existing.id,
        &existing.images,
        &input.fields,
        &input.files,
    )
    .await
    {
        Ok(images) => images,
        Err(message) => return bad_request(&message),
    };
    let stored = images_json(&images);
    match db::with_conn(&state.pool, move |conn| {
        update_note_row(conn, &images_dir, existing.id, collection_id, &payload, &stored)
    })
    .await
    {
        Ok(note) => ok(json!({ "note": note })),
        Err(error) => db_failure(error),
    }
}

async fn delete_note_handler(
    State(state): State<AppState>,
    collection: Option<Path<Vec<String>>>,
) -> Result<Response, crate::AppError> {
    let raw = captures(collection);
    let (raw_collection, raw_id) = match raw.as_slice() {
        [collection_id, id] => (Some(collection_id.clone()), id.clone()),
        [id] => (None, id.clone()),
        _ => (None, String::new()),
    };
    let collection_id = resolve_collection_id(&state.pool, raw_collection).await?;
    let existing = find_note(&state.pool, collection_id, &raw_id).await?;
    let Some(existing) = existing else {
        return Ok(not_found("Note not found."));
    };
    let images_dir = state.data_dir.join("images");
    db::with_conn(&state.pool, move |conn| {
        delete_note_row(conn, &images_dir, existing.id, collection_id, existing.display_order)
    })
    .await?;
    Ok(ok(json!({ "success": true })))
}

async fn reorder_notes_handler(
    State(state): State<AppState>,
    collection: Option<Path<Vec<String>>>,
    req: Request,
) -> Response {
    let raw = captures(collection);
    let collection_id = match resolve_for_write(&state.pool, raw.first().cloned()).await {
        Ok(id) => id,
        Err((status, message)) => return status_response(status, &message),
    };
    let body = read_json_body(req).await;
    const REQUIRED: &str = "A full ordered list of note IDs is required.";
    const PERMUTATION: &str = "Reorder request must include every note exactly once.";
    let Some(ids) = body.get("ids").and_then(Value::as_array) else {
        return bad_request(REQUIRED);
    };
    let mut ordered = Vec::with_capacity(ids.len());
    for item in ids {
        match js_number(item) {
            Some(id) => ordered.push(id),
            // `Number(x)` is NaN: it can never join the permutation, so the
            // reorder fails exactly like Node's membership check.
            None => return bad_request(PERMUTATION),
        }
    }
    match db::with_conn(&state.pool, move |conn| reorder_notes_row(conn, &ordered, collection_id))
        .await
    {
        Ok(notes) => ok(json!({ "notes": notes })),
        Err(error) => db_failure(error),
    }
}

async fn move_note_handler(
    State(state): State<AppState>,
    collection: Option<Path<Vec<String>>>,
    req: Request,
) -> Response {
    let raw = captures(collection);
    let (raw_collection, raw_id) = match raw.as_slice() {
        [collection_id, id] => (Some(collection_id.clone()), id.clone()),
        [id] => (None, id.clone()),
        _ => (None, String::new()),
    };
    let collection_id = match resolve_for_write(&state.pool, raw_collection).await {
        Ok(id) => id,
        Err((status, message)) => return status_response(status, &message),
    };
    let existing = match find_note(&state.pool, collection_id, &raw_id).await {
        Ok(note) => note,
        Err(error) => return app_error_response(error),
    };
    let Some(existing) = existing else {
        return not_found("Note not found.");
    };
    let body = read_json_body(req).await;

    let target = body.get("target_collection_id").and_then(js_number);
    let Some(target_collection_id) = target else {
        return bad_request("A valid target collection ID is required.");
    };
    if target_collection_id <= 0 {
        return bad_request("A valid target collection ID is required.");
    }
    if target_collection_id == collection_id {
        return bad_request("Note is already in this collection.");
    }
    let target_exists = db::with_conn(&state.pool, move |conn| {
        db::collection_exists(conn, target_collection_id)
    })
    .await;
    match target_exists {
        Ok(true) => {}
        Ok(false) => return not_found("Target collection not found."),
        Err(error) => return db_failure(error),
    }

    let Some(mode) = MoveMode::parse(body.get("position_mode")) else {
        return bad_request("A valid position mode is required.");
    };
    let reference_id = match body.get("position_reference_id") {
        None | Some(Value::Null) => None,
        Some(value) => js_number(value),
    };
    if matches!(mode, MoveMode::Before | MoveMode::After) && reference_id.is_none() {
        return bad_request("A reference note is required for this position.");
    }

    match db::with_conn(&state.pool, move |conn| {
        move_note_row(conn, existing.id, collection_id, target_collection_id, mode, reference_id)
    })
    .await
    {
        Ok(note) => ok(json!({ "note": note })),
        Err(error) => db_failure(error),
    }
}

async fn list_tags_handler(
    State(state): State<AppState>,
    collection: Option<Path<Vec<String>>>,
) -> Result<Response, crate::AppError> {
    let raw = captures(collection);
    let collection_id = resolve_collection_id(&state.pool, raw.first().cloned()).await?;
    let tags = db::with_conn(&state.pool, move |conn| list_tags(conn, collection_id)).await?;
    Ok(ok(json!({ "tags": tags })))
}

pub fn notes_router() -> Router<AppState> {
    Router::new()
        .route("/api/collections/{collectionId}/notes", get(list_notes_handler).post(create_note_handler))
        .route(
            "/api/collections/{collectionId}/notes/reorder",
            post(reorder_notes_handler),
        )
        .route(
            "/api/collections/{collectionId}/notes/{id}",
            get(get_note_handler).put(update_note_handler).delete(delete_note_handler),
        )
        .route(
            "/api/collections/{collectionId}/notes/{id}/move",
            post(move_note_handler),
        )
        .route("/api/notes", get(list_notes_handler).post(create_note_handler))
        .route("/api/notes/reorder", post(reorder_notes_handler))
        .route(
            "/api/notes/{id}",
            get(get_note_handler).put(update_note_handler).delete(delete_note_handler),
        )
        .route("/api/notes/{id}/move", post(move_note_handler))
}

pub fn tags_router() -> Router<AppState> {
    Router::new()
        .route("/api/collections/{collectionId}/tags", get(list_tags_handler))
        .route("/api/collections/{collectionId}/tags/suggestions", get(list_tags_handler))
        .route("/api/tags", get(list_tags_handler))
        .route("/api/tags/suggestions", get(list_tags_handler))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn denomination_formatting_matches_node() {
        assert_eq!(normalize_denomination("1000 Lei"), "1,000 Lei");
        assert_eq!(normalize_denomination("100000 Lei"), "100,000 Lei");
        assert_eq!(normalize_denomination("1000.50 Lei"), "1,000.50 Lei");
        assert_eq!(normalize_denomination("1000 Lei 1991"), "1,000 Lei 1991");
        assert_eq!(normalize_denomination("1000 lei"), "1,000 lei");
        assert_eq!(normalize_denomination("P-82 1000 Lei"), "P-82 1000 Lei");
        assert_eq!(normalize_denomination("1,000 Lei"), "1,000 Lei");
        assert_eq!(normalize_denomination("   "), "");
        assert_eq!(normalize_denomination(""), "");
    }

    #[test]
    fn issue_date_normalization_matches_node() {
        assert_eq!(normalize_issue_date("1991"), "1991");
        assert_eq!(normalize_issue_date("1/1/1991"), "01/01/1991");
        assert_eq!(normalize_issue_date("06/18/1948"), "06/18/1948");
        assert_eq!(normalize_issue_date("1/1991"), "01/1991");
        assert_eq!(normalize_issue_date("1/1"), "01/01");
        assert_eq!(normalize_issue_date("1/1/91"), "01/01/91");
        assert_eq!(normalize_issue_date(" 1/1/1991 "), "01/01/1991");
        assert_eq!(normalize_issue_date("circa 1991"), "circa 1991");
        assert_eq!(normalize_issue_date(""), "");
    }

    #[test]
    fn tag_names_collapse_whitespace() {
        assert_eq!(normalize_tag_name("  rare   paper "), "rare paper");
        assert_eq!(normalize_tag_name("a\tb\nc"), "a b c");
        assert_eq!(normalize_tag_name("   "), "");
    }

    #[test]
    fn tags_normalize_like_the_route() {
        assert_eq!(normalize_tags(Some(&json!(["a", "b"]))), vec!["a", "b"]);
        assert_eq!(normalize_tags(Some(&json!("solo"))), vec!["solo"]);
        assert!(normalize_tags(Some(&json!(5))).is_empty());
        assert!(normalize_tags(None).is_empty());
    }

    #[test]
    fn scraped_data_follows_the_falsy_rule() {
        let payload = sanitize_payload(&json!({})).expect("empty sanitizes");
        assert_eq!(payload.scraped_data, None);
        for falsy in [json!(null), json!(""), json!(false), json!(0)] {
            let payload = sanitize_payload(&json!({ "scraped_data": falsy })).expect("falsy sanitizes");
            assert_eq!(payload.scraped_data, None, "{falsy}");
        }
        let payload = sanitize_payload(&json!({ "scraped_data": "{\"a\":1}" })).expect("string parses");
        assert_eq!(payload.scraped_data, Some(json!({ "a": 1 })));
        assert!(sanitize_payload(&json!({ "scraped_data": "{oops" })).is_err());
        let object = json!({ "scraped_data": { "a": 1 } });
        assert_eq!(
            sanitize_payload(&object).expect("object passes").scraped_data,
            Some(json!({ "a": 1 }))
        );
    }

    #[test]
    fn scraped_image_urls_upgrade_and_validate() {
        let upgraded = normalize_scraped_url("http://example.com/a.jpg").expect("http upgrades");
        assert_eq!(upgraded.as_str(), "https://example.com/a.jpg");
        assert!(normalize_scraped_url("https://example.com/a.jpg").is_ok());
        assert_eq!(
            normalize_scraped_url("ftp://example.com/a.jpg").unwrap_err(),
            "Only HTTP(S) image URLs are accepted."
        );
        assert_eq!(
            normalize_scraped_url("not a url").unwrap_err(),
            "Invalid image URL."
        );
    }

    #[test]
    fn node_string_mirrors_js_string_coercion() {
        assert_eq!(node_string(&Value::Null), "");
        assert_eq!(node_string(&json!(true)), "true");
        assert_eq!(node_string(&json!(5)), "5");
        assert_eq!(node_string(&json!("x")), "x");
        assert_eq!(node_string(&json!([1, 2])), "1,2");
        assert_eq!(node_string(&json!({ "a": 1 })), "[object Object]");
        assert_eq!(normalize_tags(Some(&json!([{}]))), vec!["[object Object]"]);
    }

    #[test]
    fn move_modes_parse_exactly() {
        assert_eq!(MoveMode::parse(Some(&json!("start"))), Some(MoveMode::Start));
        assert_eq!(MoveMode::parse(Some(&json!("end"))), Some(MoveMode::End));
        assert_eq!(MoveMode::parse(Some(&json!("before"))), Some(MoveMode::Before));
        assert_eq!(MoveMode::parse(Some(&json!("after"))), Some(MoveMode::After));
        assert_eq!(MoveMode::parse(Some(&json!("middle"))), None);
        assert_eq!(MoveMode::parse(None), None);
    }
}
