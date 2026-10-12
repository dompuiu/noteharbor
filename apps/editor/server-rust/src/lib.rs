//! Axum port of `server-node`: serves the static React UI plus `/api/*`.
//!
//! Slices so far: skeleton (config, health, static/SPA, 404s, 503 mapping),
//! SQLite foundation (pool, migrations) with collections + operations-status
//! routes. Further resources land per the tickets in `.scratch/tauri-port/`.

pub mod archive;
pub mod db;
pub mod images;
pub mod ops;
pub mod routes;

use std::{
    env,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use serde_json::{Value, json};
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer};

pub use db::DbPool;
use ops::OperationState;

pub const DEFAULT_HOST: &str = "127.0.0.1";
/// Dev default: the Rust server listens on `:3002` while server-node keeps `:3001`.
pub const DEFAULT_PORT: u16 = 3002;
/// `ROOT_DIR` depth matches `server-node/src/db.js`: that file resolves
/// `../../../..` from `apps/editor/server-node/src/`; the crate manifest sits
/// one level higher (`apps/editor/server-rust/`), so `../../..` lands on the
/// same repo root.
pub const DEFAULT_WEB_DIST_DIR: &str = "apps/editor/ui-react/dist";
pub const DEFAULT_DATA_DIR: &str = "data";

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub web_dist_dir: PathBuf,
    pub serve_web_dist: bool,
    pub data_dir: PathBuf,
}

impl ServerConfig {
    pub fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    pub fn default_web_dist_dir() -> PathBuf {
        Self::repo_root().join(DEFAULT_WEB_DIST_DIR)
    }

    pub fn default_data_dir() -> PathBuf {
        Self::repo_root().join(DEFAULT_DATA_DIR)
    }

    /// Mirrors `parseBooleanEnv` in `server-node/src/index.js`.
    pub fn parse_bool(value: Option<&str>) -> bool {
        matches!(
            value.unwrap_or("").trim().to_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    }

    pub fn from_env() -> Self {
        let web_dist_dir = env::var("NOTE_HARBOR_WEB_DIST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| Self::default_web_dist_dir());
        let data_dir = env::var("NOTE_HARBOR_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| Self::default_data_dir());
        Self {
            host: env::var("HOST").unwrap_or_else(|_| DEFAULT_HOST.to_owned()),
            port: env::var("PORT")
                .ok()
                .and_then(|raw| raw.parse().ok())
                .unwrap_or(DEFAULT_PORT),
            serve_web_dist: Self::parse_bool(env::var("NOTE_HARBOR_SERVE_WEB_DIST").ok().as_deref()),
            web_dist_dir,
            data_dir,
        }
    }

    pub fn db_path(&self) -> PathBuf {
        db::default_db_path(&self.data_dir)
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    /// Canonical UI dist directory when static serving is active, else `None`.
    /// Resolved once at startup, mirroring the `shouldServeWebDist() &&
    /// fs.existsSync(webDistDir)` guard in `server-node/src/index.js`.
    pub static_root: Option<PathBuf>,
    /// Resolved data directory (images cleanup, DB path derivation).
    pub data_dir: PathBuf,
    pub pool: DbPool,
    pub ops: Arc<Mutex<OperationState>>,
    /// Kill-switch ANDed with the real `SELECT 1` probe: the Tauri shell can
    /// fence the database during copy/swap, and tests flip it to cover both
    /// outcomes without breaking a real database.
    pub db_available: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(static_root: Option<PathBuf>, data_dir: PathBuf, pool: DbPool) -> Self {
        Self {
            static_root,
            data_dir,
            pool,
            ops: Arc::new(Mutex::new(OperationState::default())),
            db_available: Arc::new(AtomicBool::new(true)),
        }
    }

    /// Test constructor: no static serving, default op state, live flag.
    pub fn test(pool: DbPool, data_dir: PathBuf) -> Self {
        Self::new(None, data_dir, pool)
    }

    pub fn is_db_available(&self) -> bool {
        self.db_available.load(Ordering::SeqCst)
    }
}

/// `Number(value)` for path/body ids: null → 0, booleans → 1/0, integral
/// floats and trimmed decimal strings convert, everything else is NaN (`None`).
/// Hex/octal string forms are intentionally unsupported: no client sends them.
pub fn js_number(value: &Value) -> Option<i64> {
    match value {
        Value::Null => Some(0),
        Value::Bool(flag) => Some(i64::from(*flag)),
        Value::Number(number) => number.as_f64().and_then(finite_integral),
        Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                Some(0)
            } else {
                trimmed.parse::<f64>().ok().and_then(finite_integral)
            }
        }
        _ => None,
    }
}

fn finite_integral(value: f64) -> Option<i64> {
    if value.is_finite() && value.fract() == 0.0 && value >= i64::MIN as f64 && value <= i64::MAX as f64
    {
        Some(value as i64)
    } else {
        None
    }
}

/// `String(value ?? '')` for names: missing/null → `""`, numbers and
/// booleans stringify, anything else is blank.
pub fn js_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        _ => String::new(),
    }
}

/// better-sqlite3 reports failures with a SQLITE_* code. Only the
/// availability codes mean the database can't be reached — constraint
/// failures are client mistakes, not an outage. Mirrors
/// `DATABASE_UNAVAILABLE_PREFIXES` / `isDatabaseUnavailable` in
/// `server-node/src/index.js`.
pub const DATABASE_UNAVAILABLE_PREFIXES: &[&str] = &[
    "SQLITE_BUSY",
    "SQLITE_CANTOPEN",
    "SQLITE_CORRUPT",
    "SQLITE_IOERR",
    "SQLITE_LOCKED",
    "SQLITE_NOTADB",
    "SQLITE_PERM",
    "SQLITE_READONLY",
];

pub fn is_database_unavailable(code: &str) -> bool {
    DATABASE_UNAVAILABLE_PREFIXES
        .iter()
        .any(|prefix| code == *prefix || code.starts_with(&format!("{prefix}_")))
}

/// Handler error type. Route handlers return `Result<impl IntoResponse,
/// AppError>` so availability failures map to 503 exactly like
/// `databaseErrorHandler` does; everything else keeps its status.
#[derive(Debug)]
pub enum AppError {
    DatabaseUnavailable,
    Http { status: StatusCode, message: String },
}

impl AppError {
    pub fn db_unavailable_if(code: &str) -> Option<Self> {
        is_database_unavailable(code).then_some(Self::DatabaseUnavailable)
    }
}

impl axum::response::IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::DatabaseUnavailable => {
                json_error(StatusCode::SERVICE_UNAVAILABLE, "Database unavailable.")
            }
            Self::Http { status, message } => {
                let code = status.as_u16();
                let status = if (400..600).contains(&code) {
                    status
                } else {
                    StatusCode::INTERNAL_SERVER_ERROR
                };
                json_error(status, &message)
            }
        }
    }
}

/// Mirrors `checkHealth` in `server-node/src/index.js`, plus the kill-switch:
/// a cheap round-trip proving the database file is open and answering.
async fn health_handler(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    if !state.is_db_available() {
        return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false })));
    }
    let pool = state.pool.clone();
    let answering = tokio::task::spawn_blocking(move || {
        let conn = pool.get().ok()?;
        conn.query_row("SELECT 1", [], |_| Ok(())).ok()
    })
    .await
    .ok()
    .flatten()
    .is_some();
    if answering {
        (StatusCode::OK, Json(json!({ "ok": true })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false })))
    }
}

pub fn create_app(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health_handler))
        .merge(routes::archive_router())
        .merge(routes::collections_router())
        .merge(routes::images_router())
        .merge(routes::operations_router())
        .fallback(fallback_handler)
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

fn json_error(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// Unknown API routes answer JSON so fetch/XHR callers get a parseable error
/// instead of an HTML 404 page (`server-node/src/index.js`).
async fn fallback_handler(
    State(state): State<AppState>,
    uri: axum::http::Uri,
) -> axum::response::Response {
    let path = uri.path();
    if path == "/api" || path.starts_with("/api/") {
        return json_error(StatusCode::NOT_FOUND, "Not found.");
    }
    if let Some(root) = state.static_root.as_ref() {
        if let Some(response) = serve_static(root, path).await {
            return response;
        }
        // Missing entry (at startup or removed later) answers a JSON error,
        // never an HTML error page.
        if let Ok(bytes) = tokio::fs::read(root.join("index.html")).await {
            return file_response(bytes, "text/html; charset=utf-8");
        }
    }
    json_error(StatusCode::NOT_FOUND, "Not found.")
}

/// Serves one file from the UI dist directory. Returns `None` when the path
/// is not a servable file so the caller falls back to the SPA entry.
async fn serve_static(root: &Path, raw_path: &str) -> Option<axum::response::Response> {
    let decoded = percent_decode(raw_path.trim_start_matches('/'));
    if decoded.is_empty() {
        return None;
    }
    let mut candidate = root.to_path_buf();
    for segment in decoded.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return None;
        }
        candidate.push(segment);
    }
    // Lexically confined above, but symlinks could still escape: verify.
    let canonical = tokio::fs::canonicalize(&candidate).await.ok()?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return None;
    }
    let bytes = tokio::fs::read(&canonical).await.ok()?;
    let mime = mime_guess::from_path(&canonical).first_or_octet_stream();
    let content_type = if mime.type_() == mime_guess::mime::TEXT && mime.subtype() == mime_guess::mime::HTML {
        "text/html; charset=utf-8".to_owned()
    } else {
        mime.essence_str().to_owned()
    };
    Some(file_response(bytes, &content_type))
}

fn file_response(bytes: Vec<u8>, content_type: &str) -> axum::response::Response {
    axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, content_type)
        .body(axum::body::Body::from(bytes))
        .expect("static response builds")
        .into_response()
}

/// Minimal `%XX` decoder for the traversal check; invalid sequences pass
/// through literally.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_web_dist_dir_resolves_to_sibling_ui_dist() {
        let dir = ServerConfig::default_web_dist_dir();
        assert!(
            dir.ends_with("apps/editor/ui-react/dist"),
            "unexpected default: {}",
            dir.display()
        );
    }

    #[test]
    fn default_data_dir_resolves_to_repo_data() {
        let dir = ServerConfig::default_data_dir();
        assert!(dir.ends_with("data"), "unexpected default: {}", dir.display());
        assert_eq!(
            ServerConfig {
                host: DEFAULT_HOST.to_owned(),
                port: DEFAULT_PORT,
                web_dist_dir: PathBuf::from("/x"),
                serve_web_dist: false,
                data_dir: dir.clone(),
            }
            .db_path(),
            dir.join("banknotes.db")
        );
    }

    #[test]
    fn js_number_mirrors_ecmascript_number_coercion() {
        assert_eq!(js_number(&Value::Null), Some(0));
        assert_eq!(js_number(&json!(true)), Some(1));
        assert_eq!(js_number(&json!(false)), Some(0));
        assert_eq!(js_number(&json!(3)), Some(3));
        assert_eq!(js_number(&json!("  12 ")), Some(12));
        assert_eq!(js_number(&json!("")), Some(0));
        assert_eq!(js_number(&json!("   ")), Some(0));
        assert_eq!(js_number(&json!("abc"),), None);
        assert_eq!(js_number(&json!(2.5)), None);
        assert_eq!(js_number(&json!({"a": 1})), None);
        assert_eq!(js_number(&json!([1])), None);
    }

    #[test]
    fn js_string_mirrors_ecmascript_string_coercion() {
        assert_eq!(js_string(&Value::Null), "");
        assert_eq!(js_string(&json!(true)), "true");
        assert_eq!(js_string(&json!(5)), "5");
        assert_eq!(js_string(&json!("x")), "x");
        assert_eq!(js_string(&json!([1])), "");
    }

    #[test]
    fn availability_prefixes_match_exact_and_suffixed_codes() {
        for prefix in [
            "SQLITE_BUSY",
            "SQLITE_CANTOPEN",
            "SQLITE_CORRUPT",
            "SQLITE_IOERR",
            "SQLITE_LOCKED",
            "SQLITE_NOTADB",
            "SQLITE_PERM",
            "SQLITE_READONLY",
        ] {
            assert!(is_database_unavailable(prefix), "exact {prefix}");
            assert!(
                is_database_unavailable(&format!("{prefix}_SNAPSHOT")),
                "suffixed {prefix}"
            );
        }
    }

    #[test]
    fn constraint_and_unrelated_codes_are_not_outages() {
        for code in [
            "SQLITE_CONSTRAINT_UNIQUE",
            "SQLITE_CONSTRAINT",
            "SQLITE_BUS",
            "XSQLITE_BUSY",
            "",
            "ECONNREFUSED",
        ] {
            assert!(!is_database_unavailable(code), "code {code}");
        }
    }

    #[tokio::test]
    async fn database_unavailable_maps_to_503_json() {
        use axum::response::IntoResponse;
        let response = AppError::DatabaseUnavailable.into_response();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body reads");
        let body: Value = serde_json::from_slice(&bytes).expect("body is JSON");
        assert_eq!(body, json!({ "error": "Database unavailable." }));
    }

    #[tokio::test]
    async fn http_error_maps_status_and_clamps_out_of_range() {
        use axum::response::IntoResponse;
        let response = AppError::Http {
            status: StatusCode::BAD_REQUEST,
            message: "Denomination is required.".to_owned(),
        }
        .into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body reads");
        let body: Value = serde_json::from_slice(&bytes).expect("body is JSON");
        assert_eq!(body, json!({ "error": "Denomination is required." }));

        for status in [StatusCode::OK, StatusCode::from_u16(302).unwrap()] {
            let clamped = AppError::Http {
                status,
                message: "x".to_owned(),
            }
            .into_response();
            assert_eq!(clamped.status(), StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}
