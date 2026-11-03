//! Axum editor backend: serves the static React UI plus `/api/*`.
//!
//! Slices so far: skeleton (config, health, static/SPA, 404s, 503 mapping),
//! SQLite foundation (pool, migrations) with collections + operations-status
//! routes. Further resources land per the tickets in `.scratch/tauri-port/`.

pub mod archive;
pub mod db;
pub mod images;
pub mod notes;
pub mod ops;
pub mod routes;
pub mod scrape;
pub mod showcases;
pub mod write_gate;

use std::{
    env,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::IntoResponse,
    routing::get,
};
use serde_json::{Value, json};
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer};

pub use db::DbPool;
use ops::OperationState;
use write_gate::WriteGate;

pub const DEFAULT_HOST: &str = "127.0.0.1";
/// Dev default: the Rust server listens on `:3002`.
pub const DEFAULT_PORT: u16 = 3002;
/// How long a mutating request waits for another Editor instance's write.
pub const DEFAULT_WRITE_GATE_TIMEOUT: Duration = Duration::from_secs(5);
/// `ROOT_DIR` depth: the crate manifest sits at `apps/editor/server-rust/`,
/// so `../../..` lands on the repo root.
pub const DEFAULT_WEB_DIST_DIR: &str = "apps/editor/ui-react/dist";
pub const DEFAULT_DATA_DIR: &str = "data";

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    /// `true` when `PORT` came from the environment. An explicit port never
    /// falls back to an ephemeral one, so pinned tooling keeps failing loudly.
    pub port_explicit: bool,
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

    /// Parses truthy boolean env values (`1`/`true`/`yes`/`on`).
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
        let port = env::var("PORT")
            .ok()
            .and_then(|raw| raw.trim().parse().ok());
        Self {
            host: env::var("HOST").unwrap_or_else(|_| DEFAULT_HOST.to_owned()),
            port: port.unwrap_or(DEFAULT_PORT),
            port_explicit: port.is_some(),
            serve_web_dist: Self::parse_bool(env::var("NOTE_HARBOR_SERVE_WEB_DIST").ok().as_deref()),
            web_dist_dir,
            data_dir,
        }
    }

    pub fn db_path(&self) -> PathBuf {
        db::default_db_path(&self.data_dir)
    }

    /// Waits for another Editor instance's write, then gives up. Zero or an
    /// unparseable value keeps the default.
    pub fn write_gate_timeout() -> Duration {
        env::var("NOTE_HARBOR_WRITE_GATE_TIMEOUT_MS")
            .ok()
            .and_then(|raw| raw.trim().parse::<u64>().ok())
            .filter(|millis| *millis > 0)
            .map(Duration::from_millis)
            .unwrap_or(DEFAULT_WRITE_GATE_TIMEOUT)
    }
}

/// Binds the configured address. When `PORT` was not pinned and the default
/// port belongs to another instance (a second worktree's dev server), falls
/// back to an ephemeral port instead of refusing to start; callers learn the
/// real port from the listener. The Tauri shell binds `PORT=0` itself and is
/// unaffected.
pub async fn bind_listener(config: &ServerConfig) -> Result<tokio::net::TcpListener, String> {
    match tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await {
        Ok(listener) => Ok(listener),
        Err(error) if error.kind() == std::io::ErrorKind::AddrInUse && !config.port_explicit => {
            eprintln!(
                "port {} is busy; binding an ephemeral port instead",
                config.port
            );
            tokio::net::TcpListener::bind((config.host.as_str(), 0))
                .await
                .map_err(|error| format!("cannot bind server socket: {error}"))
        }
        Err(error) => Err(format!("cannot bind server socket: {error}")),
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    /// Canonical UI dist directory when static serving is active, else `None`.
    /// Resolved once at startup, mirroring the `shouldServeWebDist() &&
    /// fs.existsSync(webDistDir)` startup guard.
    pub static_root: Option<PathBuf>,
    /// Resolved data directory (images cleanup, DB path derivation).
    pub data_dir: PathBuf,
    pub pool: DbPool,
    pub ops: Arc<Mutex<OperationState>>,
    /// Serializes mutating requests against other Editor instances sharing the
    /// same data directory.
    pub write_gate: WriteGate,
    pub write_gate_timeout: Duration,
    /// Kill-switch ANDed with the real `SELECT 1` probe: the Tauri shell can
    /// fence the database during copy/swap, and tests flip it to cover both
    /// outcomes without breaking a real database.
    pub db_available: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(static_root: Option<PathBuf>, data_dir: PathBuf, pool: DbPool) -> Self {
        let write_gate = WriteGate::new(&data_dir);
        Self {
            static_root,
            data_dir,
            pool,
            ops: Arc::new(Mutex::new(OperationState::default())),
            write_gate,
            write_gate_timeout: ServerConfig::write_gate_timeout(),
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

/// SQLite reports failures with a SQLITE_* code. Only the
/// availability codes mean the database can't be reached — constraint
/// failures are client mistakes, not an outage. Mirrors the
/// `DATABASE_UNAVAILABLE_PREFIXES` / `isDatabaseUnavailable` behavior
/// of the former Node backend.
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

/// Health check plus the kill-switch:
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

/// Historical cap for every route except the archive import, matching the
/// long-standing global `RequestBodyLimitLayer`.
pub const NORMAL_BODY_LIMIT: usize = 10 * 1024 * 1024;
/// Import cap, derived from the handler's streaming cap plus headroom for
/// multipart framing: the handler's JSON 413 fires first for genuinely
/// oversize files, while absurd bodies still trip the layer's plain 413.
pub const IMPORT_BODY_LIMIT: usize = archive::MAX_ARCHIVE_UPLOAD_BYTES as usize + 1024 * 1024;
/// Notes cap: four image slots at `MAX_IMAGE_BYTES` each plus headroom for
/// multipart framing and text fields. Two pasted full-size photos easily
/// exceed the historical 10 MiB cap, which surfaced through Vite as
/// `ECONNABORTED` / `Failed to fetch`; the per-file 15 MB handler check
/// still fires first for genuinely oversize files.
pub const NOTES_BODY_LIMIT: usize = crate::notes::MAX_IMAGE_BYTES * 4 + 2 * 1024 * 1024;

/// POST routes that only read: scraping drives a browser and can run for
/// minutes, so it must not hold the write gate.
const UNGATED_POST_ROUTES: &[&str] = &["/api/scrape/preview"];

pub fn create_app(state: AppState) -> Router {
    // Limits are per-router: the import streams multi-gigabyte uploads to
    // disk and notes accept up to four 15 MB images, while everything else
    // keeps the historical 10 MiB cap. A single global layer would re-impose
    // the small cap on those uploads (the Vite EPIPE / ERR_CONNECTION_RESET /
    // ECONNABORTED failure).
    let normal = Router::new()
        .route("/api/health", get(health_handler))
        .merge(routes::archive_router())
        .merge(routes::collections_router())
        .merge(routes::images_router())
        .merge(notes::tags_router())
        .merge(routes::operations_router())
        .merge(scrape::scrape_router())
        .merge(showcases::categories_router())
        .merge(showcases::nodes_router())
        .merge(showcases::showcases_router())
        .layer(DefaultBodyLimit::max(NORMAL_BODY_LIMIT))
        .layer(RequestBodyLimitLayer::new(NORMAL_BODY_LIMIT));
    let notes = notes::notes_router()
        .layer(DefaultBodyLimit::max(NOTES_BODY_LIMIT))
        .layer(RequestBodyLimitLayer::new(NOTES_BODY_LIMIT));
    let import = routes::archive_import_router()
        .layer(DefaultBodyLimit::max(IMPORT_BODY_LIMIT))
        .layer(RequestBodyLimitLayer::new(IMPORT_BODY_LIMIT));
    Router::new()
        .merge(normal)
        .merge(notes)
        .merge(import)
        .fallback(fallback_handler)
        .layer(CorsLayer::permissive())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            write_gate_layer,
        ))
        .with_state(state)
}

/// Mutating requests take the cross-process write gate; reads never wait.
async fn write_gate_layer(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> axum::response::Response {
    let gated = matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) && !UNGATED_POST_ROUTES.contains(&request.uri().path());
    if !gated {
        return next.run(request).await;
    }
    match state.write_gate.acquire(state.write_gate_timeout).await {
        Ok(guard) => {
            let response = next.run(request).await;
            drop(guard);
            response
        }
        Err(error) => {
            eprintln!("write gate: {error}");
            json_error(
                StatusCode::CONFLICT,
                "Another Note Harbor instance is writing to this data directory. Retry when it finishes.",
            )
        }
    }
}

fn json_error(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// Unknown API routes answer JSON so fetch/XHR callers get a parseable error
/// instead of an HTML 404 page.
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
                port_explicit: false,
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

    fn config_for_port(port: u16, port_explicit: bool) -> ServerConfig {
        ServerConfig {
            host: DEFAULT_HOST.to_owned(),
            port,
            port_explicit,
            web_dist_dir: PathBuf::from("/x"),
            serve_web_dist: false,
            data_dir: PathBuf::from("/x"),
        }
    }

    #[tokio::test]
    async fn busy_default_port_falls_back_to_an_ephemeral_port() {
        let occupied = std::net::TcpListener::bind((DEFAULT_HOST, 0)).expect("test port binds");
        let port = occupied.local_addr().expect("test port reads").port();

        let listener = bind_listener(&config_for_port(port, false))
            .await
            .expect("falls back instead of failing");
        assert_ne!(listener.local_addr().unwrap().port(), port);
    }

    #[tokio::test]
    async fn busy_explicit_port_fails_instead_of_falling_back() {
        let occupied = std::net::TcpListener::bind((DEFAULT_HOST, 0)).expect("test port binds");
        let port = occupied.local_addr().expect("test port reads").port();

        let error = bind_listener(&config_for_port(port, true))
            .await
            .expect_err("an explicit PORT never moves");
        assert!(error.contains("cannot bind server socket"), "{error}");
    }
}
