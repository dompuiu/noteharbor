use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use editor_server_rust::{AppState, DbPool, create_app, db};

fn temp_pool() -> (tempfile::TempDir, DbPool) {
    let dir = tempfile::tempdir().expect("tempdir");
    let pool = db::open_pool(&dir.path().join("banknotes.db")).expect("pool opens");
    (dir, pool)
}

fn live_state() -> (tempfile::TempDir, AppState) {
    let (dir, pool) = temp_pool();
    let state = AppState {
        static_root: None,
        data_dir: dir.path().to_path_buf(),
        pool,
        ops: Arc::new(Mutex::new(editor_server_rust::ops::OperationState::default())),
        write_gate: editor_server_rust::write_gate::WriteGate::new(dir.path()),
        write_gate_timeout: std::time::Duration::from_secs(5),
        db_available: Arc::new(AtomicBool::new(true)),
    };
    (dir, state)
}

async fn get(app: Router, path: &str) -> (StatusCode, serde_json::Value, Option<String>) {
    let request = Request::builder()
        .uri(path)
        .body(Body::from(()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|value| value.to_str().expect("content-type is ascii").to_owned());
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads");
    let json: serde_json::Value = serde_json::from_slice(&bytes).expect("body is JSON");
    (status, json, content_type)
}

#[tokio::test]
async fn health_reports_ok_when_database_answers() {
    let (_dir, state) = live_state();
    let (status, body, content_type) = get(create_app(state), "/api/health").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({ "ok": true }));
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("application/json"),
        "unexpected content-type: {content_type:?}"
    );
}

#[tokio::test]
async fn health_reports_unavailable_when_database_is_down() {
    let (_dir, state) = live_state();
    state.db_available.store(false, Ordering::SeqCst);
    let (status, body, _) = get(create_app(state), "/api/health").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, serde_json::json!({ "ok": false }));
}

#[tokio::test]
async fn health_reflects_later_database_state() {
    let (_dir, state) = live_state();
    let flag = Arc::clone(&state.db_available);
    let app = create_app(state);

    let (before, _, _) = get(app.clone(), "/api/health").await;
    flag.store(false, Ordering::SeqCst);
    let (after, body, _) = get(app, "/api/health").await;

    assert_eq!(before, StatusCode::OK);
    assert_eq!(after, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, serde_json::json!({ "ok": false }));
}

async fn raw(app: Router, method: &str, path: &str) -> (StatusCode, Vec<u8>, Option<String>) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .body(Body::from(()))
        .expect("request builds");
    let response = app.oneshot(request).await.expect("service answers");
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .map(|value| value.to_str().expect("content-type is ascii").to_owned());
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body reads");
    (status, bytes.to_vec(), content_type)
}

fn json_body(bytes: &[u8]) -> serde_json::Value {
    serde_json::from_slice(bytes).expect("body is JSON")
}

#[tokio::test]
async fn unknown_api_route_answers_json_404() {
    let (_dir, state) = live_state();
    let app = create_app(state);
    for method in ["GET", "POST", "PUT", "DELETE"] {
        let (status, bytes, content_type) =
            raw(app.clone(), method, "/api/no-such-thing").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "method {method}");
        assert_eq!(json_body(&bytes), serde_json::json!({ "error": "Not found." }));
        assert!(
            content_type.as_deref().unwrap_or("").starts_with("application/json"),
            "unexpected content-type: {content_type:?}"
        );
    }
}

#[tokio::test]
async fn bare_api_prefix_answers_json_404() {
    let (_dir, state) = live_state();
    let (status, bytes, _) = raw(create_app(state), "GET", "/api").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json_body(&bytes), serde_json::json!({ "error": "Not found." }));
}

/// A near-`/api` prefix must NOT be swallowed by the API 404: like
/// `/apiary-trails` in `spaFallback.test.js`, it is an SPA route.
#[tokio::test]
async fn api_like_prefix_is_an_spa_route() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("index.html"), "<p>spa</p>").expect("write entry");
    let (_pool_dir, pool) = temp_pool();
    let state = AppState {
        static_root: Some(dir.path().canonicalize().expect("canonical")),
        data_dir: dir.path().to_path_buf(),
        pool,
        ops: Arc::new(Mutex::new(editor_server_rust::ops::OperationState::default())),
        write_gate: editor_server_rust::write_gate::WriteGate::new(dir.path()),
        write_gate_timeout: std::time::Duration::from_secs(5),
        db_available: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true)),
    };

    let (status, bytes, content_type) =
        raw(create_app(state), "GET", "/apiary-trails").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, b"<p>spa</p>");
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("text/html"),
        "unexpected content-type: {content_type:?}"
    );
}

fn serving_state(dir: &tempfile::TempDir) -> (tempfile::TempDir, AppState) {
    let (pool_dir, pool) = temp_pool();
    let state = AppState {
        static_root: Some(dir.path().canonicalize().expect("canonical")),
        data_dir: dir.path().to_path_buf(),
        pool,
        ops: Arc::new(Mutex::new(editor_server_rust::ops::OperationState::default())),
        write_gate: editor_server_rust::write_gate::WriteGate::new(dir.path()),
        write_gate_timeout: std::time::Duration::from_secs(5),
        db_available: Arc::new(AtomicBool::new(true)),
    };
    (pool_dir, state)
}

#[tokio::test]
async fn spa_entry_serves_at_root_and_deep_routes() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("index.html"), "<p>spa</p>").expect("write entry");
    std::fs::write(dir.path().join("app.js"), "console.log(1)").expect("write asset");

    for path in ["/", "/collections/1", "/showcases/abc/notes"] {
        let (_pool_dir, state) = serving_state(&dir);
        let (status, bytes, content_type) =
            raw(create_app(state), "GET", path).await;
        assert_eq!(status, StatusCode::OK, "path {path}");
        assert_eq!(bytes, b"<p>spa</p>");
        assert!(
            content_type.as_deref().unwrap_or("").starts_with("text/html"),
            "unexpected content-type: {content_type:?}"
        );
    }

    let (_pool_dir, state) = serving_state(&dir);
    let (status, bytes, content_type) =
        raw(create_app(state), "GET", "/app.js").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, b"console.log(1)");
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("text/javascript")
            || content_type.as_deref().unwrap_or("").starts_with("application/javascript"),
        "unexpected content-type: {content_type:?}"
    );
}

#[tokio::test]
async fn missing_spa_entry_answers_json_not_html() {
    let dir = tempfile::tempdir().expect("tempdir");

    let (_pool_dir, state) = serving_state(&dir);
    let (status, bytes, content_type) =
        raw(create_app(state), "GET", "/collections").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json_body(&bytes), serde_json::json!({ "error": "Not found." }));
    assert!(
        content_type.as_deref().unwrap_or("").starts_with("application/json"),
        "unexpected content-type: {content_type:?}"
    );
}

#[tokio::test]
async fn static_serving_disabled_answers_json_404() {
    let (_dir, state) = live_state();
    let (status, bytes, _) = raw(create_app(state), "GET", "/collections").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json_body(&bytes), serde_json::json!({ "error": "Not found." }));
}

#[tokio::test]
async fn request_path_cannot_escape_static_root() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("index.html"), "<p>spa</p>").expect("write entry");
    let outside = dir.path().join("secret.txt");
    std::fs::write(&outside, "secret").expect("write outside file");

    let (_pool_dir, state) = serving_state(&dir);
    let (status, bytes, _) =
        raw(create_app(state), "GET", "/../secret.txt").await;
    // Never serve the outside file: fall back to the SPA entry or 404.
    assert_ne!(bytes, b"secret");
    assert!(status == StatusCode::OK || status == StatusCode::NOT_FOUND);
}

/// The catalog schema ships as migrations, not as a new database: fresh and
/// repeated opens must land on the same shape, and an existing presentation
/// showcase must come through untouched.
mod catalog_schema {
    use rusqlite::{Connection, params};

    fn db_path(dir: &tempfile::TempDir) -> std::path::PathBuf {
        dir.path().join("banknotes.db")
    }

    fn open(db_path: &std::path::Path) -> Connection {
        let conn = Connection::open(db_path).expect("raw connection");
        conn.execute_batch("PRAGMA foreign_keys = ON;").expect("foreign keys on");
        conn
    }

    /// Runs the migrations, then hands back a raw connection to inspect them.
    fn initialized(dir: &tempfile::TempDir) -> Connection {
        let path = db_path(dir);
        let pool = editor_server_rust::db::open_pool(&path).expect("pool opens");
        drop(pool);
        open(&path)
    }

    fn rows<T, P: rusqlite::Params>(
        conn: &Connection,
        sql: &str,
        params: P,
        map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> Vec<T> {
        let mut stmt = conn.prepare(sql).expect("prepare query");
        stmt.query_map(params, map)
            .expect("query rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect rows")
    }

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        rows(conn, "SELECT name FROM pragma_table_info(?1)", params![table], |row| {
            row.get(0)
        })
    }

    fn objects(conn: &Connection, kind: &str) -> Vec<String> {
        rows(
            conn,
            "SELECT name FROM sqlite_master WHERE type = ?1 ORDER BY name",
            params![kind],
            |row| row.get(0),
        )
    }

    fn table_sql(conn: &Connection, table: &str) -> String {
        conn.query_row(
            "SELECT COALESCE(sql, '') FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get::<_, String>(0),
        )
        .expect("table sql")
        .to_uppercase()
    }

    fn sorted_columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut names = columns(conn, table);
        names.sort();
        names
    }

    const SHOWCASE_NODE_COLUMNS: [&str; 15] = [
        "catalog_number",
        "category_id",
        "cover_note_id",
        "created_at",
        "denomination",
        "id",
        "issue_date",
        "name",
        "node_type",
        "note_id",
        "parent_node_id",
        "position",
        "showcase_id",
        "source",
        "updated_at",
    ];

    fn seed_note(conn: &Connection, collection_id: i64, catalog_number: &str) -> i64 {
        conn.execute(
            "INSERT INTO banknotes (collection_id, catalog_number) VALUES (?1, ?2)",
            params![collection_id, catalog_number],
        )
        .expect("insert note");
        conn.last_insert_rowid()
    }

    fn seed_entry(conn: &Connection) -> (i64, i64) {
        conn.execute("INSERT INTO collections (name) VALUES ('Holder')", [])
            .expect("insert collection");
        let collection_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO showcases (name) VALUES ('Catalog')", [])
            .expect("insert showcase");
        let showcase_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO showcase_nodes (showcase_id, node_type, name, position)
             VALUES (?1, 'grouping', 'Group', 1)",
            params![showcase_id],
        )
        .expect("insert grouping");
        let parent_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO showcase_nodes
               (showcase_id, parent_node_id, node_type, catalog_number, denomination, position)
             VALUES (?1, ?2, 'catalog_entry', '22a', '1 dollar', 1)",
            params![showcase_id, parent_id],
        )
        .expect("insert catalog entry");
        (collection_id, conn.last_insert_rowid())
    }

    fn specimen(conn: &Connection, node_id: i64, note_id: i64, position: i64, primary: bool) {
        conn.execute(
            "INSERT INTO showcase_catalog_notes (node_id, note_id, position, is_primary)
             VALUES (?1, ?2, ?3, ?4)",
            params![node_id, note_id, position, primary],
        )
        .expect("insert specimen");
    }

    fn primary_note(conn: &Connection, node_id: i64) -> Option<i64> {
        conn.query_row(
            "SELECT note_id FROM showcase_catalog_notes
             WHERE node_id = ?1 AND is_primary = 1",
            params![node_id],
            |row| row.get(0),
        )
        .ok()
    }

    fn read_owned(conn: &Connection, id: i64) -> i64 {
        conn.query_row("SELECT owned FROM banknotes WHERE id = ?1", params![id], |row| row.get(0))
            .expect("read owned")
    }

    #[test]
    fn adding_owned_to_a_legacy_database_leaves_existing_notes_unowned() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = initialized(&dir);
        let collection_id = {
            conn.execute("INSERT INTO collections (name) VALUES ('Legacy')", [])
                .expect("insert collection");
            conn.last_insert_rowid()
        };
        let legacy = seed_note(&conn, collection_id, "1");
        conn.execute("ALTER TABLE banknotes DROP COLUMN owned", [])
            .expect("column drops");
        drop(conn);

        let conn = initialized(&dir);
        assert_eq!(
            read_owned(&conn, legacy),
            0,
            "the rows that predate ownership are unowned"
        );

        let fresh = seed_note(&conn, collection_id, "2");
        assert_eq!(read_owned(&conn, fresh), 0, "the column default stays unowned");
    }

    #[test]
    fn fresh_database_has_the_catalog_schema() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = initialized(&dir);

        assert!(columns(&conn, "banknotes").iter().any(|value| value == "owned"));

        assert!(
            table_sql(&conn, "showcase_nodes").contains("CATALOG_ENTRY"),
            "showcase_nodes must accept catalog_entry"
        );
        assert_eq!(
            sorted_columns(&conn, "showcase_nodes"),
            SHOWCASE_NODE_COLUMNS,
            "the fresh tree shape"
        );

        let indexes = objects(&conn, "index");
        for index in [
            "idx_showcase_nodes_category_once",
            "idx_showcase_nodes_parent",
            "idx_showcase_catalog_notes_primary",
            "idx_showcase_catalog_notes_position",
        ] {
            assert!(
                indexes.iter().any(|value| value == index),
                "missing index {index}"
            );
        }

        let triggers = objects(&conn, "trigger");
        for trigger in [
            "trg_showcase_catalog_notes_demote_insert",
            "trg_showcase_catalog_notes_demote_update",
            "trg_showcase_catalog_notes_first_primary",
            "trg_showcase_catalog_notes_promote_primary",
        ] {
            assert!(
                triggers.iter().any(|value| value == trigger),
                "missing trigger {trigger}"
            );
        }

        let key_columns = rows(
            &conn,
            "SELECT name, pk FROM pragma_table_info('showcase_catalog_notes')
             WHERE pk > 0 ORDER BY pk",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        assert_eq!(
            key_columns,
            vec![("node_id".to_owned(), 1), ("note_id".to_owned(), 2)],
            "the specimen key must be (node_id, note_id)"
        );
    }

    #[test]
    fn owned_defaults_to_zero_and_keeps_the_flag_across_reopens() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = initialized(&dir);
        let collection_id = {
            conn.execute("INSERT INTO collections (name) VALUES ('Owned')", [])
                .expect("insert collection");
            conn.last_insert_rowid()
        };
        let unowned = seed_note(&conn, collection_id, "1");
        let owned = seed_note(&conn, collection_id, "2");
        conn.execute("UPDATE banknotes SET owned = 1 WHERE id = ?1", params![owned])
            .expect("mark owned");

        assert_eq!(read_owned(&conn, unowned), 0, "a new note is unowned by default");
        assert_eq!(read_owned(&conn, owned), 1);
        drop(conn);

        let conn = initialized(&dir);
        assert_eq!(read_owned(&conn, unowned), 0);
        assert_eq!(read_owned(&conn, owned), 1);
    }

    #[test]
    fn specimen_triggers_keep_exactly_one_primary() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = initialized(&dir);

        let (collection_id, entry_id) = seed_entry(&conn);
        let first = seed_note(&conn, collection_id, "22a1");
        let second = seed_note(&conn, collection_id, "22a2");
        let third = seed_note(&conn, collection_id, "22a3");
        let fourth = seed_note(&conn, collection_id, "22a4");

        // An explicit primary inserted first wins; the following row keeps it.
        specimen(&conn, entry_id, second, 2, true);
        specimen(&conn, entry_id, first, 1, false);
        assert_eq!(
            primary_note(&conn, entry_id),
            Some(second),
            "an explicit primary survives later inserts"
        );

        // A later explicit primary takes over instead of colliding with the
        // partial unique index: the schema demotes the old one.
        specimen(&conn, entry_id, third, 3, true);
        assert_eq!(primary_note(&conn, entry_id), Some(third), "an explicit primary takes over");
        let primaries = rows(
            &conn,
            "SELECT note_id FROM showcase_catalog_notes WHERE node_id = ?1 AND is_primary = 1",
            params![entry_id],
            |row| row.get::<_, i64>(0),
        );
        assert_eq!(primaries, vec![third], "at most one primary");

        let invalid_primary = conn.execute(
            "INSERT INTO showcase_catalog_notes (node_id, note_id, position, is_primary)
             VALUES (?1, ?2, 4, 2)",
            params![entry_id, fourth],
        );
        assert!(invalid_primary.is_err(), "is_primary is a 0/1 flag");

        // Promoting by update moves primacy the same way.
        conn.execute(
            "UPDATE showcase_catalog_notes SET is_primary = 1
             WHERE node_id = ?1 AND note_id = ?2",
            params![entry_id, first],
        )
        .expect("promote by update");
        assert_eq!(primary_note(&conn, entry_id), Some(first), "update promotes");

        // Removing the primary promotes the lowest-position specimen.
        conn.execute(
            "DELETE FROM showcase_catalog_notes WHERE node_id = ?1 AND note_id = ?2",
            params![entry_id, first],
        )
        .expect("delete primary");
        assert_eq!(primary_note(&conn, entry_id), Some(second), "promotion by position");

        // Deleting the Note from the library cascades and promotes as well.
        conn.execute("DELETE FROM banknotes WHERE id = ?1", params![second])
            .expect("delete note");
        let remaining = rows(
            &conn,
            "SELECT note_id FROM showcase_catalog_notes WHERE node_id = ?1",
            params![entry_id],
            |row| row.get::<_, i64>(0),
        );
        assert_eq!(remaining, vec![third], "only the other specimen survives");
        assert_eq!(primary_note(&conn, entry_id), Some(third), "cascade promotes");

        // The entry outlives its specimens: unseen, not deleted.
        conn.execute(
            "DELETE FROM showcase_catalog_notes WHERE node_id = ?1",
            params![entry_id],
        )
        .expect("delete specimens");
        assert_eq!(primary_note(&conn, entry_id), None);
        let entry_type: String = conn
            .query_row(
                "SELECT node_type FROM showcase_nodes WHERE id = ?1",
                params![entry_id],
                |row| row.get(0),
            )
            .expect("entry survives");
        assert_eq!(entry_type, "catalog_entry");

        // Deleting the entry takes its specimens with it.
        specimen(&conn, entry_id, third, 1, false);
        conn.execute("DELETE FROM showcase_nodes WHERE id = ?1", params![entry_id])
            .expect("delete entry");
        let joins = rows(&conn, "SELECT note_id FROM showcase_catalog_notes", [], |row| {
            row.get::<_, i64>(0)
        });
        assert!(joins.is_empty(), "node delete cascades the joins");
    }

    /// A database written before catalog entries keeps its showcase tree, its
    /// indexes, and its notes when it is opened by this build.
    #[test]
    fn existing_presentation_showcase_survives_the_migration() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = db_path(&dir);
        {
            let conn = open(&path);
            conn.execute_batch(
                "CREATE TABLE collections (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   name TEXT NOT NULL,
                   display_order INTEGER,
                   created_at TEXT DEFAULT (datetime('now')),
                   updated_at TEXT DEFAULT (datetime('now'))
                 );
                 CREATE UNIQUE INDEX idx_collections_name_nocase
                   ON collections(name COLLATE NOCASE);

                 CREATE TABLE banknotes (
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

                 CREATE TABLE categories (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   name TEXT NOT NULL,
                   created_at TEXT DEFAULT (datetime('now')),
                   updated_at TEXT DEFAULT (datetime('now'))
                 );

                 CREATE TABLE showcases (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   name TEXT NOT NULL,
                   display_order INTEGER,
                   created_at TEXT DEFAULT (datetime('now')),
                   updated_at TEXT DEFAULT (datetime('now'))
                 );

                 CREATE TABLE showcase_nodes (
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

                 CREATE UNIQUE INDEX idx_showcase_nodes_category_once
                   ON showcase_nodes(showcase_id, category_id) WHERE node_type = 'category';
                 CREATE INDEX idx_showcase_nodes_parent
                   ON showcase_nodes(parent_node_id, position, id);

                 INSERT INTO collections (id, name, display_order) VALUES (1, 'Archive', 1);
                 INSERT INTO banknotes (id, collection_id, display_order, catalog_number)
                   VALUES (7, 1, 1, '22a');
                 INSERT INTO categories (id, name) VALUES (3, 'Issue');
                 INSERT INTO showcases (id, name, display_order) VALUES (2, 'Presentation', 1);
                 INSERT INTO showcase_nodes (id, showcase_id, node_type, category_id, position)
                   VALUES (10, 2, 'category', 3, 1);
                 INSERT INTO showcase_nodes (id, showcase_id, parent_node_id, node_type, name, position)
                   VALUES (11, 2, 10, 'grouping', 'Types', 1);
                 INSERT INTO showcase_nodes (id, showcase_id, parent_node_id, node_type, note_id, cover_note_id, position)
                   VALUES (12, 2, 11, 'note', 7, 7, 1);",
            )
            .expect("legacy schema");
        }

        // First open runs the migration; the second proves it is repeatable.
        for _ in 0..2 {
            drop(initialized(&dir));
        }

        let conn = initialized(&dir);
        let nodes: Vec<(i64, String, Option<i64>, Option<i64>)> = rows(
            &conn,
            "SELECT id, node_type, parent_node_id, note_id
             FROM showcase_nodes ORDER BY id ASC",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        );
        assert_eq!(
            nodes,
            vec![
                (10, "category".to_owned(), None, None),
                (11, "grouping".to_owned(), Some(10), None),
                (12, "note".to_owned(), Some(11), Some(7)),
            ]
        );
        assert_eq!(
            conn.query_row("SELECT cover_note_id FROM showcase_nodes WHERE id = 12", [], |row| {
                row.get::<_, Option<i64>>(0)
            })
            .expect("cover survives"),
            Some(7)
        );
        assert_eq!(read_owned(&conn, 7), 0, "an old note is left unowned");
        assert_eq!(
            sorted_columns(&conn, "showcase_nodes"),
            SHOWCASE_NODE_COLUMNS,
            "the rebuilt tree shape matches a fresh one"
        );

        let indexes = objects(&conn, "index");
        for index in ["idx_showcase_nodes_category_once", "idx_showcase_nodes_parent"] {
            assert!(
                indexes.iter().any(|value| value == index),
                "missing index {index}"
            );
        }

        let mut foreign_keys: Vec<(String, String)> = rows(
            &conn,
            "SELECT \"table\", \"from\" FROM pragma_foreign_key_list('showcase_nodes')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        foreign_keys.sort();
        for pair in [
            ("banknotes".to_owned(), "cover_note_id".to_owned()),
            ("banknotes".to_owned(), "note_id".to_owned()),
            ("showcase_nodes".to_owned(), "parent_node_id".to_owned()),
        ] {
            assert!(
                foreign_keys.contains(&pair),
                "the rebuild must keep the {pair:?} foreign key"
            );
        }

        // The rebuilt CHECK accepts a catalog entry under the grouping.
        conn.execute(
            "INSERT INTO showcase_nodes
               (showcase_id, parent_node_id, node_type, catalog_number, position)
             VALUES (2, 11, 'catalog_entry', '22b', 2)",
            [],
        )
        .expect("catalog entries fit the new CHECK");

        // The unique category index still holds.
        assert!(
            conn.execute(
                "INSERT INTO showcase_nodes (showcase_id, node_type, category_id, position)
                 VALUES (2, 'category', 3, 2)",
                [],
            )
            .is_err(),
            "a Category still appears once per Showcase"
        );
    }

    /// A database from an intermediate build already accepts `catalog_entry`
    /// but misses a metadata column; the migration adds it without a rebuild.
    #[test]
    fn a_partial_catalog_table_gains_its_missing_columns() {
        let dir = tempfile::tempdir().expect("tempdir");
        {
            let conn = open(&db_path(&dir));
            conn.execute_batch(
                "CREATE TABLE showcases (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   name TEXT NOT NULL,
                   display_order INTEGER,
                   created_at TEXT DEFAULT (datetime('now')),
                   updated_at TEXT DEFAULT (datetime('now'))
                 );

                 CREATE TABLE categories (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   name TEXT NOT NULL,
                   created_at TEXT DEFAULT (datetime('now')),
                   updated_at TEXT DEFAULT (datetime('now'))
                 );

                 CREATE TABLE showcase_nodes (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   showcase_id INTEGER NOT NULL REFERENCES showcases(id) ON DELETE CASCADE,
                   parent_node_id INTEGER REFERENCES showcase_nodes(id) ON DELETE CASCADE,
                   node_type TEXT NOT NULL CHECK (node_type IN ('category','grouping','note','catalog_entry')),
                   category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
                   name TEXT,
                   note_id INTEGER,
                   cover_note_id INTEGER,
                   catalog_number TEXT,
                   denomination TEXT,
                   issue_date TEXT,
                   position INTEGER,
                   created_at TEXT DEFAULT (datetime('now')),
                   updated_at TEXT DEFAULT (datetime('now'))
                 );

                 INSERT INTO showcases (id, name) VALUES (1, 'Partial');
                 INSERT INTO showcase_nodes
                   (id, showcase_id, node_type, catalog_number, denomination, position)
                 VALUES (5, 1, 'catalog_entry', '22a', '1 dollar', 1);",
            )
            .expect("partial schema");
        }

        let conn = initialized(&dir);
        assert_eq!(
            sorted_columns(&conn, "showcase_nodes"),
            SHOWCASE_NODE_COLUMNS,
            "the partial table gains the missing columns"
        );
        let entry: (String, Option<String>) = conn
            .query_row(
                "SELECT catalog_number, source FROM showcase_nodes WHERE id = 5",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("the entry survives");
        assert_eq!(entry, ("22a".to_owned(), None));
    }

    /// The one-time rebuild for a pre-collection database must keep an
    /// `owned` flag rather than silently resetting every note to owned.
    #[test]
    fn owned_survives_the_legacy_banknotes_rebuild() {
        let dir = tempfile::tempdir().expect("tempdir");
        {
            let conn = open(&db_path(&dir));
            conn.execute_batch(
                "CREATE TABLE collections (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   name TEXT NOT NULL,
                   display_order INTEGER,
                   created_at TEXT DEFAULT (datetime('now')),
                   updated_at TEXT DEFAULT (datetime('now'))
                 );

                 CREATE TABLE banknotes (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                   display_order INTEGER,
                   catalog_number TEXT,
                   serial TEXT,
                   owned INTEGER NOT NULL DEFAULT 1,
                   UNIQUE(catalog_number,serial)
                 );

                 INSERT INTO collections (id, name, display_order) VALUES (1, 'Old', 1);
                 INSERT INTO banknotes (id, collection_id, display_order, catalog_number, owned)
                 VALUES (1, 1, 1, '22a', 0), (2, 1, 2, '22b', 1);",
            )
            .expect("legacy schema");
        }

        let conn = initialized(&dir);
        assert_eq!(read_owned(&conn, 1), 0, "a seen note stays not owned");
        assert_eq!(read_owned(&conn, 2), 1);
        let foreign_keys = rows(&conn, "PRAGMA foreign_key_list(banknotes)", [], |row| {
            let table: String = row.get("table")?;
            let from: String = row.get("from")?;
            Ok((table, from))
        });
        assert!(
            foreign_keys
                .iter()
                .any(|(table, from)| table == "collections" && from == "collection_id"),
            "the rebuild restores the collection foreign key"
        );
    }
}
