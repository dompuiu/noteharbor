//! SQLite layer: pool, schema/migrations, and collection CRUD over
//! `rusqlite` + `r2d2`. Statements keep the historical SQL verbatim so ordering,
//! defaults (`datetime('now')`), and migration behavior match exactly.

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::Duration,
};

use r2d2::{CustomizeConnection, Pool};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, ErrorCode, Row, params};
use serde::Serialize;

use crate::{AppError, is_database_unavailable};

pub type DbPool = Pool<SqliteConnectionManager>;

/// Every pooled connection enforces foreign keys (the cascade deletes the
/// schema relies on) and waits on locked rows with a 5 s busy timeout
/// instead of failing immediately.
#[derive(Debug)]
struct ConnectionSetup;

impl CustomizeConnection<Connection, rusqlite::Error> for ConnectionSetup {
    fn on_acquire(&self, conn: &mut Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.busy_timeout(Duration::from_secs(5))?;
        Ok(())
    }
}

#[derive(Debug)]
pub enum DbError {
    /// A SQLITE_* availability failure; the raw engine message is kept so
    /// routes that answer it directly stay byte-identical.
    Unavailable(String),
    /// A friendly UNIQUE-violation message.
    Conflict(String),
    /// Anything else, with the engine message.
    Failed(String),
}

impl DbError {
    pub fn user_message(&self) -> &str {
        match self {
            Self::Unavailable(message) | Self::Conflict(message) | Self::Failed(message) => message,
        }
    }
}

fn availability_prefix(code: ErrorCode) -> Option<&'static str> {
    Some(match code {
        ErrorCode::DatabaseBusy => "SQLITE_BUSY",
        ErrorCode::CannotOpen => "SQLITE_CANTOPEN",
        ErrorCode::DatabaseCorrupt => "SQLITE_CORRUPT",
        ErrorCode::SystemIoFailure => "SQLITE_IOERR",
        ErrorCode::DatabaseLocked => "SQLITE_LOCKED",
        ErrorCode::NotADatabase => "SQLITE_NOTADB",
        ErrorCode::PermissionDenied => "SQLITE_PERM",
        ErrorCode::ReadOnly => "SQLITE_READONLY",
        _ => return None,
    })
}

pub(crate) fn classify(error: rusqlite::Error) -> DbError {
    match &error {
        rusqlite::Error::SqliteFailure(sqlite_error, _) => {
            match availability_prefix(sqlite_error.code) {
                Some(prefix) if is_database_unavailable(prefix) => {
                    DbError::Unavailable(error.to_string())
                }
                _ => DbError::Failed(error.to_string()),
            }
        }
        _ => DbError::Failed(error.to_string()),
    }
}

fn is_unique_violation(error: &rusqlite::Error, constraint: &str) -> bool {
    error.to_string().contains(&format!("UNIQUE constraint failed: {constraint}"))
}

impl From<DbError> for AppError {
    fn from(error: DbError) -> Self {
        match error {
            DbError::Unavailable(_) => Self::DatabaseUnavailable,
            DbError::Conflict(message) | DbError::Failed(message) => Self::Http {
                status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                message,
            },
        }
    }
}

/// Runs `op` on a pooled connection on a blocking thread: rusqlite and pool
/// checkout both block, so they must never run on an async worker. This is
/// the sync-pool-in-async answer: one blocking-thread hop per request,
/// transactions on the checked-out connection.
pub async fn with_conn<T, F>(pool: &DbPool, op: F) -> Result<T, AppError>
where
    F: FnOnce(&mut r2d2::PooledConnection<SqliteConnectionManager>) -> Result<T, DbError>
        + Send
        + 'static,
    T: Send + 'static,
{
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get().map_err(|_| AppError::DatabaseUnavailable)?;
        op(&mut conn).map_err(AppError::from)
    })
    .await
    .map_err(|_| AppError::Http {
        status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        message: "Request failed.".to_owned(),
    })?
}

// ---------------------------------------------------------------------------
// Open + migrations (ports `openDatabase` / `initializeSchema` and helpers)
// ---------------------------------------------------------------------------

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT name FROM pragma_table_info(?1)")?;
    let rows = stmt.query_map(params![table], |row| row.get::<_, String>(0))?;
    rows.collect()
}

fn table_sql(conn: &Connection, table: &str) -> Result<String, DbError> {    match conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![table],
        |row| row.get::<_, Option<String>>(0),
    ) {
        Ok(sql) => Ok(sql.unwrap_or_default()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(String::new()),
        Err(error) => Err(classify(error)),
    }
}

/// Runs a parameter-free SELECT and collects every row. (Chaining
/// `prepare()?.query_map()?.collect()` on temporaries does not borrow-check,
/// so this helper holds the statement binding.)
fn query_all<T, F>(conn: &Connection, sql: &str, map: F) -> Result<Vec<T>, DbError>
where
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql).map_err(classify)?;
    let rows = stmt.query_map([], map).map_err(classify)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(classify)
}

fn normalize_collection_name(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn ensure_collections_table(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS collections (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           display_order INTEGER,
           created_at TEXT DEFAULT (datetime('now')),
           updated_at TEXT DEFAULT (datetime('now'))
         );

         CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name_nocase
           ON collections(name COLLATE NOCASE);",
    )
    .map_err(classify)?;

    if !table_columns(conn, "collections")
        .map_err(classify)?
        .contains(&"display_order".to_owned())
    {
        conn.execute_batch("ALTER TABLE collections ADD COLUMN display_order INTEGER")
            .map_err(classify)?;
    }

    // The default-collection flag is retired: databases written before the
    // removal lose the column (and its partial unique index) here.
    conn.execute_batch("DROP INDEX IF EXISTS idx_collections_single_default")
        .map_err(classify)?;

    if table_columns(conn, "collections")
        .map_err(classify)?
        .contains(&"is_default".to_owned())
    {
        conn.execute_batch("ALTER TABLE collections DROP COLUMN is_default")
            .map_err(classify)?;
    }

    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_collections_display_order
           ON collections(display_order, id);",
    )
    .map_err(classify)?;

    // Backfill the manual order for collections that never had one. Runs on
    // every open so a partial backfill self-heals.
    let missing: Vec<i64> = query_all(
        conn,
        "SELECT id FROM collections WHERE display_order IS NULL ORDER BY id ASC",
        |row| row.get(0),
    )?;

    if missing.is_empty() {
        return Ok(());
    }

    let max_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(display_order), 0) AS value FROM collections",
            [],
            |row| row.get(0),
        )
        .map_err(classify)?;

    let tx = conn.transaction().map_err(classify)?;
    let mut next_order = max_order + 1;
    for id in missing {
        tx.execute(
            "UPDATE collections SET display_order = ?1 WHERE id = ?2",
            params![next_order, id],
        )
        .map_err(classify)?;
        next_order += 1;
    }
    tx.commit().map_err(classify)?;
    Ok(())
}

fn find_first_collection_id(conn: &Connection) -> Result<Option<i64>, DbError> {
    match conn.query_row(
        "SELECT id FROM collections ORDER BY display_order ASC, id ASC LIMIT 1",
        [],
        |row| row.get::<_, i64>(0),
    ) {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

fn ensure_first_collection(conn: &mut Connection) -> Result<Option<i64>, DbError> {
    if let Some(id) = find_first_collection_id(conn)? {
        return Ok(Some(id));
    }

    let banknotes: i64 = conn
        .query_row("SELECT COUNT(*) AS value FROM banknotes", [], |row| row.get(0))
        .map_err(classify)?;
    let tags: i64 = conn
        .query_row("SELECT COUNT(*) AS value FROM tags", [], |row| row.get(0))
        .map_err(classify)?;

    if banknotes <= 0 && tags <= 0 {
        return Ok(None);
    }

    conn.execute(
        "INSERT INTO collections (name, display_order, created_at, updated_at)
         VALUES (?1, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM collections), datetime('now'), datetime('now'))",
        params!["Default".to_owned()],
    )
    .map_err(classify)?;
    Ok(Some(conn.last_insert_rowid()))
}

fn migrate_tags_for_collection_scope(
    conn: &mut Connection,
    first_collection_id: Option<i64>,
) -> Result<(), DbError> {
    let tags_sql = table_sql(conn, "tags")?;
    let has_collection_column = table_columns(conn, "tags")
        .map_err(classify)?
        .contains(&"collection_id".to_owned());

    if !has_collection_column {
        conn.execute_batch("ALTER TABLE tags ADD COLUMN collection_id INTEGER")
            .map_err(classify)?;
        conn.execute(
            "UPDATE tags SET collection_id = ?1 WHERE collection_id IS NULL",
            params![first_collection_id],
        )
        .map_err(classify)?;
    }

    let normalized = tags_sql
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase();
    if normalized.contains("NAME TEXT NOT NULL UNIQUE") {
        // Mirrors the template interpolation: a missing first collection
        // binds NULL, which the later UPDATE cannot repair either.
        let fallback = first_collection_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "NULL".to_owned());
        conn.execute_batch(&format!(
            "PRAGMA foreign_keys = OFF;

             CREATE TABLE tags_new (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL,
               collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE
             );

             INSERT INTO tags_new (id, name, collection_id)
             SELECT id, name, COALESCE(collection_id, {fallback})
             FROM tags;

             DROP TABLE tags;
             ALTER TABLE tags_new RENAME TO tags;

             PRAGMA foreign_keys = ON;"
        ))
        .map_err(classify)?;
    }

    conn.execute(
        "UPDATE tags SET collection_id = ?1 WHERE collection_id IS NULL",
        params![first_collection_id],
    )
    .map_err(classify)?;

    let rows: Vec<(i64, Option<i64>, String)> = query_all(
        conn,
        "SELECT id, collection_id, lower(name) AS normalized_name
         FROM tags
         ORDER BY collection_id ASC, normalized_name ASC, id ASC",
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    let tx = conn.transaction().map_err(classify)?;
    {
        let mut canonical_by_key: HashMap<(Option<i64>, String), i64> = HashMap::new();
        for (id, collection_id, normalized_name) in rows {
            let key = (collection_id, normalized_name);
            if let Some(canonical_id) = canonical_by_key.get(&key) {
                tx.execute(
                    "INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id)
                     SELECT banknote_id, ?1 FROM banknote_tags WHERE tag_id = ?2",
                    params![canonical_id, id],
                )
                .map_err(classify)?;
                tx.execute("DELETE FROM banknote_tags WHERE tag_id = ?1", params![id])
                    .map_err(classify)?;
                tx.execute("DELETE FROM tags WHERE id = ?1", params![id])
                    .map_err(classify)?;
            } else {
                canonical_by_key.insert(key, id);
            }
        }
    }
    tx.commit().map_err(classify)?;

    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_collection_name_nocase
           ON tags(collection_id, name COLLATE NOCASE);",
    )
    .map_err(classify)?;
    Ok(())
}

fn migrate_banknotes_for_collection_scope(
    conn: &mut Connection,
    first_collection_id: Option<i64>,
) -> Result<(), DbError> {
    if !table_columns(conn, "banknotes")
        .map_err(classify)?
        .contains(&"collection_id".to_owned())
    {
        conn.execute_batch("ALTER TABLE banknotes ADD COLUMN collection_id INTEGER")
            .map_err(classify)?;
    }

    if let Some(id) = first_collection_id {
        if id > 0 {
            conn.execute(
                "UPDATE banknotes SET collection_id = ?1 WHERE collection_id IS NULL",
                params![id],
            )
            .map_err(classify)?;
        }
    }
    Ok(())
}

fn migrate_banknotes_foreign_key(conn: &mut Connection) -> Result<(), DbError> {
    let hits: Vec<bool> = query_all(conn, "PRAGMA foreign_key_list(banknotes)", |row| {
        let table: String = row.get("table")?;
        let from: String = row.get("from")?;
        Ok(table == "collections" && from == "collection_id")
    })?;
    let has_fk = hits.into_iter().any(|hit| hit);

    if has_fk {
        return Ok(());
    }

    // Legacy databases added collection_id via ALTER TABLE, which cannot
    // declare a foreign key. Rebuild so deletes cascade instead of orphaning.
    let desired = [
        "id",
        "collection_id",
        "display_order",
        "denomination",
        "issue_date",
        "catalog_number",
        "grading_company",
        "grade",
        "watermark",
        "serial",
        "url",
        "notes",
        "scraped_data",
        "images",
        "scrape_status",
        "scrape_error",
        "created_at",
        "updated_at",
    ];
    let existing: HashSet<String> = table_columns(conn, "banknotes")
        .map_err(classify)?
        .into_iter()
        .collect();
    let shared: Vec<&str> = desired
        .iter()
        .filter(|column| existing.contains(**column))
        .copied()
        .collect();
    let column_list = shared.join(", ");

    conn.execute_batch(&format!(
        "PRAGMA foreign_keys = OFF;

         CREATE TABLE banknotes_new (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
           display_order INTEGER,
           denomination TEXT,
           issue_date TEXT,
           catalog_number TEXT,
           grading_company TEXT,
           grade TEXT,
           watermark TEXT,
           serial TEXT,
           url TEXT,
           notes TEXT,
           scraped_data TEXT,
           images TEXT,
           scrape_status TEXT DEFAULT 'pending',
           scrape_error TEXT,
           created_at TEXT DEFAULT (datetime('now')),
           updated_at TEXT DEFAULT (datetime('now'))
         );

         INSERT INTO banknotes_new ({column_list})
         SELECT {column_list} FROM banknotes;

         DROP TABLE banknotes;
         ALTER TABLE banknotes_new RENAME TO banknotes;

         PRAGMA foreign_keys = ON;"
    ))
    .map_err(classify)?;
    Ok(())
}

// The Showcases node tree (ADR 0001). Additive and idempotent: only
// `CREATE ... IF NOT EXISTS`, so an existing database keeps its rows.
fn ensure_showcases_schema(conn: &mut Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS categories (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           created_at TEXT DEFAULT (datetime('now')),
           updated_at TEXT DEFAULT (datetime('now'))
         );

         CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_nocase
           ON categories(name COLLATE NOCASE);

         CREATE TABLE IF NOT EXISTS showcases (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           display_order INTEGER,
           created_at TEXT DEFAULT (datetime('now')),
           updated_at TEXT DEFAULT (datetime('now'))
         );

         CREATE UNIQUE INDEX IF NOT EXISTS idx_showcases_name_nocase
           ON showcases(name COLLATE NOCASE);

         CREATE INDEX IF NOT EXISTS idx_showcases_display_order
           ON showcases(display_order, id);

         CREATE TABLE IF NOT EXISTS showcase_nodes (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           showcase_id INTEGER NOT NULL REFERENCES showcases(id) ON DELETE CASCADE,
           parent_node_id INTEGER REFERENCES showcase_nodes(id) ON DELETE CASCADE,
           node_type TEXT NOT NULL CHECK (node_type IN ('category','grouping','note')),
           category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
           name TEXT,
           note_id INTEGER REFERENCES banknotes(id) ON DELETE CASCADE,
           cover_note_id INTEGER REFERENCES banknotes(id) ON DELETE SET NULL,
           position INTEGER,
           created_at TEXT DEFAULT (datetime('now')),
           updated_at TEXT DEFAULT (datetime('now'))
         );

         CREATE UNIQUE INDEX IF NOT EXISTS idx_showcase_nodes_category_once
           ON showcase_nodes(showcase_id, category_id) WHERE node_type = 'category';

         CREATE INDEX IF NOT EXISTS idx_showcase_nodes_parent
           ON showcase_nodes(parent_node_id, position, id);",
    )
    .map_err(classify)?;

    // Fill a null position, per sibling group, in id order. Only self-heals a
    // partially written tree.
    let missing: Vec<(i64, i64, Option<i64>)> = query_all(
        conn,
        "SELECT id, showcase_id, parent_node_id
         FROM showcase_nodes
         WHERE position IS NULL
         ORDER BY id ASC",
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    if missing.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(classify)?;
    for (id, showcase_id, parent_node_id) in missing {
        let current: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position), 0) AS value
                 FROM showcase_nodes
                 WHERE showcase_id = ?1 AND parent_node_id IS ?2",
                params![showcase_id, parent_node_id],
                |row| row.get(0),
            )
            .map_err(classify)?;
        tx.execute(
            "UPDATE showcase_nodes SET position = ?1 WHERE id = ?2",
            params![current + 1, id],
        )
        .map_err(classify)?;
    }
    tx.commit().map_err(classify)?;
    Ok(())
}

fn initialize_schema(conn: &mut Connection) -> Result<(), DbError> {
    ensure_collections_table(conn)?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS banknotes (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
           display_order INTEGER,
           denomination TEXT,
           issue_date TEXT,
           catalog_number TEXT,
           grading_company TEXT,
           grade TEXT,
           watermark TEXT,
           serial TEXT,
           url TEXT,
           notes TEXT,
           scraped_data TEXT,
           images TEXT,
           scrape_status TEXT DEFAULT 'pending',
           scrape_error TEXT,
           created_at TEXT DEFAULT (datetime('now')),
           updated_at TEXT DEFAULT (datetime('now'))
         );

         CREATE TABLE IF NOT EXISTS tags (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL,
           collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE
         );

         CREATE TABLE IF NOT EXISTS banknote_tags (
           banknote_id INTEGER NOT NULL REFERENCES banknotes(id) ON DELETE CASCADE,
           tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
           PRIMARY KEY (banknote_id, tag_id)
         );",
    )
    .map_err(classify)?;

    ensure_showcases_schema(conn)?;

    let first_collection_id = ensure_first_collection(conn)?;

    if table_sql(conn, "banknotes")?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
        .contains("UNIQUE(CATALOG_NUMBER,SERIAL)")
    {
        let fallback = first_collection_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| "NULL".to_owned());
        conn.execute_batch(&format!(
            "PRAGMA foreign_keys = OFF;

             CREATE TABLE banknotes_new (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
               display_order INTEGER,
               denomination TEXT,
               issue_date TEXT,
               catalog_number TEXT,
               grading_company TEXT,
               grade TEXT,
               watermark TEXT,
               serial TEXT,
               url TEXT,
               notes TEXT,
               scraped_data TEXT,
               images TEXT,
               scrape_status TEXT DEFAULT 'pending',
               scrape_error TEXT,
               created_at TEXT DEFAULT (datetime('now')),
               updated_at TEXT DEFAULT (datetime('now'))
             );

             INSERT INTO banknotes_new (
               id, collection_id, display_order, denomination, issue_date,
               catalog_number, grading_company, grade, watermark, serial, url,
               notes, scraped_data, images, scrape_status, scrape_error,
               created_at, updated_at
             )
             SELECT
               id, {fallback}, display_order, denomination, issue_date,
               catalog_number, grading_company, grade, watermark, serial, url,
               notes, scraped_data, images, scrape_status, scrape_error,
               created_at, updated_at
             FROM banknotes;

             DROP TABLE banknotes;
             ALTER TABLE banknotes_new RENAME TO banknotes;

             PRAGMA foreign_keys = ON;"
        ))
        .map_err(classify)?;
    }

    migrate_banknotes_for_collection_scope(conn, first_collection_id)?;
    migrate_tags_for_collection_scope(conn, first_collection_id)?;
    migrate_banknotes_foreign_key(conn)?;

    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_banknotes_collection_display_order
           ON banknotes(collection_id, display_order, id);

         CREATE INDEX IF NOT EXISTS idx_banknotes_collection_id
           ON banknotes(collection_id);

         CREATE INDEX IF NOT EXISTS idx_tags_collection_id
           ON tags(collection_id);",
    )
    .map_err(classify)?;

    // Drop the legacy share-token table if it exists.
    conn.execute_batch("DROP TABLE IF EXISTS slideshow_sessions")
        .map_err(classify)?;

    if !table_columns(conn, "banknotes")
        .map_err(classify)?
        .contains(&"display_order".to_owned())
    {
        conn.execute_batch("ALTER TABLE banknotes ADD COLUMN display_order INTEGER")
            .map_err(classify)?;
    }

    let collection_ids: Vec<i64> = query_all(
        conn,
        "SELECT id FROM collections ORDER BY id ASC",
        |row| row.get(0),
    )?;

    let tx = conn.transaction().map_err(classify)?;
    for collection_id in collection_ids {
        let mut missing_stmt = tx
            .prepare(
                "SELECT id FROM banknotes
                 WHERE collection_id = ?1 AND display_order IS NULL
                 ORDER BY id ASC",
            )
            .map_err(classify)?;
        let missing_rows = missing_stmt
            .query_map(params![collection_id], |row| row.get::<_, i64>(0))
            .map_err(classify)?;
        let missing: Vec<i64> = missing_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify)?;

        if missing.is_empty() {
            continue;
        }

        let max_order: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(display_order), 0) AS value FROM banknotes WHERE collection_id = ?1",
                params![collection_id],
                |row| row.get(0),
            )
            .map_err(classify)?;

        let mut next_order = max_order + 1;
        for id in missing {
            tx.execute(
                "UPDATE banknotes SET display_order = ?1 WHERE id = ?2",
                params![next_order, id],
            )
            .map_err(classify)?;
            next_order += 1;
        }
    }
    tx.commit().map_err(classify)?;
    Ok(())
}

/// Opens (creating dirs and file as needed) the database at `db_path` and
/// runs the full migration chain once, before serving. Synchronous by design:
/// callers on async workers wrap this in `spawn_blocking`.
pub fn open_pool(db_path: &Path) -> Result<DbPool, String> {
    if let Some(data_dir) = db_path.parent() {
        for dir in [
            data_dir.to_path_buf(),
            data_dir.join("images"),
            data_dir.join("images").join("notes"),
        ] {
            std::fs::create_dir_all(&dir).map_err(|error| {
                format!("cannot create {}: {error}", dir.display())
            })?;
        }
    }

    let manager = SqliteConnectionManager::file(db_path);
    let pool = Pool::builder()
        .connection_customizer(Box::new(ConnectionSetup))
        .build(manager)
        .map_err(|error| format!("cannot open pool: {error}"))?;

    let mut conn = pool
        .get()
        .map_err(|error| format!("cannot open database: {error}"))?;
    initialize_schema(&mut conn).map_err(|error| error.user_message().to_owned())?;
    Ok(pool)
}

pub fn default_db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("banknotes.db")
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub display_order: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub note_count: i64,
}

fn map_collection(row: &Row<'_>) -> rusqlite::Result<Collection> {
    Ok(Collection {
        id: row.get(0)?,
        name: row.get(1)?,
        display_order: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        note_count: row.get(5)?,
    })
}

const LIST_COLLECTIONS_SQL: &str = "SELECT
    collections.id,
    collections.name,
    collections.display_order,
    collections.created_at,
    collections.updated_at,
    (SELECT COUNT(*) FROM banknotes WHERE banknotes.collection_id = collections.id) AS note_count
  FROM collections
  ORDER BY display_order ASC, id ASC";

const GET_COLLECTION_SQL: &str = "SELECT
    collections.id,
    collections.name,
    collections.display_order,
    collections.created_at,
    collections.updated_at,
    (SELECT COUNT(*) FROM banknotes WHERE banknotes.collection_id = collections.id) AS note_count
  FROM collections
  WHERE id = ?1";

pub fn get_all_collections(
    conn: &mut r2d2::PooledConnection<SqliteConnectionManager>,
) -> Result<Vec<Collection>, DbError> {
    list_collections(conn)
}

fn list_collections(conn: &Connection) -> Result<Vec<Collection>, DbError> {
    let mut stmt = conn.prepare(LIST_COLLECTIONS_SQL).map_err(classify)?;
    let rows = stmt.query_map([], map_collection).map_err(classify)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(classify)
}

fn get_collection(conn: &Connection, id: i64) -> Result<Option<Collection>, DbError> {
    let mut stmt = conn.prepare(GET_COLLECTION_SQL).map_err(classify)?;
    match stmt.query_row(params![id], map_collection) {
        Ok(collection) => Ok(Some(collection)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(classify(error)),
    }
}

fn next_default_collection_name(conn: &Connection) -> Result<String, DbError> {
    let taken: HashSet<String> = list_collections(conn)?
        .iter()
        .map(|collection| collection.name.to_lowercase())
        .collect();

    if !taken.contains("collection") {
        return Ok("Collection".to_owned());
    }

    let mut suffix = 2;
    while taken.contains(&format!("collection {suffix}")) {
        suffix += 1;
    }
    Ok(format!("Collection {suffix}"))
}

pub fn create_collection(
    conn: &mut r2d2::PooledConnection<SqliteConnectionManager>,
    name: &str,
) -> Result<Collection, DbError> {
    let normalized = normalize_collection_name(name);
    let final_name = if normalized.is_empty() {
        next_default_collection_name(conn)?
    } else {
        normalized
    };

    let inserted = conn.execute(
        "INSERT INTO collections (name, display_order, created_at, updated_at)
         VALUES (?1, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM collections), datetime('now'), datetime('now'))",
        params![final_name],
    );
    match inserted {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error, "collections.name") => {
            return Err(DbError::Conflict(
                "A collection with this name already exists.".to_owned(),
            ));
        }
        Err(error) => return Err(classify(error)),
    }

    let id = conn.last_insert_rowid();
    get_collection(conn, id)?.ok_or_else(|| DbError::Failed("Collection not found.".to_owned()))
}

pub fn rename_collection(
    conn: &mut r2d2::PooledConnection<SqliteConnectionManager>,
    id: i64,
    name: &str,
) -> Result<Collection, DbError> {
    let normalized = normalize_collection_name(name);
    if normalized.is_empty() {
        return Err(DbError::Failed("Collection name is required.".to_owned()));
    }
    if get_collection(conn, id)?.is_none() {
        return Err(DbError::Failed("Collection not found.".to_owned()));
    }

    match conn.execute(
        "UPDATE collections SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![normalized, id],
    ) {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error, "collections.name") => {
            return Err(DbError::Conflict(
                "A collection with this name already exists.".to_owned(),
            ));
        }
        Err(error) => return Err(classify(error)),
    }

    get_collection(conn, id)?.ok_or_else(|| DbError::Failed("Collection not found.".to_owned()))
}

pub fn delete_collection(
    conn: &mut r2d2::PooledConnection<SqliteConnectionManager>,
    notes_images_dir: &Path,
    id: i64,
) -> Result<(), DbError> {
    if get_collection(conn, id)?.is_none() {
        return Err(DbError::Failed("Collection not found.".to_owned()));
    }

    let note_ids: Vec<i64> = {
        let mut note_ids_stmt = conn
            .prepare("SELECT id FROM banknotes WHERE collection_id = ?1 ORDER BY id ASC")
            .map_err(classify)?;
        let note_id_rows = note_ids_stmt
            .query_map(params![id], |row| row.get::<_, i64>(0))
            .map_err(classify)?;
        note_id_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(classify)?
    };

    let tx = conn.transaction().map_err(classify)?;
    tx.execute("DELETE FROM banknotes WHERE collection_id = ?1", params![id])
        .map_err(classify)?;
    tx.execute("DELETE FROM tags WHERE collection_id = ?1", params![id])
        .map_err(classify)?;
    tx.execute_batch(
        "DELETE FROM banknote_tags
         WHERE tag_id NOT IN (SELECT id FROM tags)
            OR banknote_id NOT IN (SELECT id FROM banknotes)",
    )
    .map_err(classify)?;
    tx.execute("DELETE FROM collections WHERE id = ?1", params![id])
        .map_err(classify)?;
    tx.commit().map_err(classify)?;

    for note_id in note_ids {
        let dir = notes_images_dir.join(note_id.to_string());
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|error| DbError::Failed(error.to_string()))?;
        }
    }
    Ok(())
}

pub fn reorder_collections(
    conn: &mut r2d2::PooledConnection<SqliteConnectionManager>,
    ids: &[i64],
) -> Result<Vec<Collection>, DbError> {
    const MESSAGE: &str = "Reorder request must include every collection exactly once.";
    let existing: Vec<i64> = list_collections(conn)?
        .iter()
        .map(|collection| collection.id)
        .collect();

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
            "UPDATE collections SET display_order = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![(index + 1) as i64, id],
        )
        .map_err(classify)?;
    }
    tx.commit().map_err(classify)?;
    list_collections(conn)
}

pub fn get_first_collection_id(
    conn: &mut r2d2::PooledConnection<SqliteConnectionManager>,
) -> Result<Option<i64>, DbError> {
    find_first_collection_id(conn)
}

pub fn collection_exists(
    conn: &mut r2d2::PooledConnection<SqliteConnectionManager>,
    id: i64,
) -> Result<bool, DbError> {
    Ok(get_collection(conn, id)?.is_some())
}
