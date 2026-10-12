//! Axum port of `server-node`: serves the static React UI plus `/api/*`.
//!
//! Skeleton slice: environment config, shared state, and `GET /api/health`.
//! Route handlers for collections/notes/tags/showcases/nodes/categories/
//! archive/scrape/operations land in later slices against the frozen contract
//! (`.scratch/tauri-port/contract-freeze.md` on `research/contract-freeze`).

use std::{
    env,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde_json::json;
use tower_http::{cors::CorsLayer, limit::RequestBodyLimitLayer};

pub const DEFAULT_HOST: &str = "127.0.0.1";
/// Dev default: the Rust server listens on `:3002` while server-node keeps `:3001`.
pub const DEFAULT_PORT: u16 = 3002;
/// `ROOT_DIR` depth matches `server-node/src/db.js`: that file resolves
/// `../../../..` from `apps/editor/server-node/src/`; the crate manifest sits
/// one level higher (`apps/editor/server-rust/`), so `../../..` lands on the
/// same repo root.
pub const DEFAULT_WEB_DIST_DIR: &str = "apps/editor/ui-react/dist";

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub web_dist_dir: PathBuf,
    pub serve_web_dist: bool,
}

impl ServerConfig {
    pub fn default_web_dist_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join(DEFAULT_WEB_DIST_DIR)
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
        Self {
            host: env::var("HOST").unwrap_or_else(|_| DEFAULT_HOST.to_owned()),
            port: env::var("PORT")
                .ok()
                .and_then(|raw| raw.parse().ok())
                .unwrap_or(DEFAULT_PORT),
            serve_web_dist: Self::parse_bool(env::var("NOTE_HARBOR_SERVE_WEB_DIST").ok().as_deref()),
            web_dist_dir,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    /// Canonical UI dist directory when static serving is active, else `None`.
    /// Resolved once at startup, mirroring the `shouldServeWebDist() &&
    /// fs.existsSync(webDistDir)` guard in `server-node/src/index.js`.
    pub static_root: Option<PathBuf>,
    /// Skeleton stand-in for `pingDatabase()`: flipped by tests to cover both
    /// health outcomes. The DB pool slice replaces this with a real probe.
    pub db_available: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(static_root: Option<PathBuf>) -> Self {
        Self {
            static_root,
            db_available: Arc::new(AtomicBool::new(true)),
        }
    }

    pub fn is_db_available(&self) -> bool {
        self.db_available.load(Ordering::SeqCst)
    }
}

/// Mirrors `checkHealth` in `server-node/src/index.js`: the probe the client
/// uses to tell "database unreachable" apart from an empty library.
async fn health_handler(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    if state.is_db_available() {
        (StatusCode::OK, Json(json!({ "ok": true })))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "ok": false })))
    }
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// Unknown API routes answer JSON so fetch/XHR callers get a parseable error
/// instead of an HTML 404 page (`server-node/src/index.js`).
async fn fallback_handler(State(state): State<AppState>, uri: Uri) -> Response {
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
async fn serve_static(root: &std::path::Path, raw_path: &str) -> Option<Response> {
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

fn file_response(bytes: Vec<u8>, content_type: &str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(bytes))
        .expect("static response builds")
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

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
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

pub fn create_app(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health_handler))
        .fallback(fallback_handler)
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .with_state(state)
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
        let response = AppError::DatabaseUnavailable.into_response();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body reads");
        let body: serde_json::Value = serde_json::from_slice(&bytes).expect("body is JSON");
        assert_eq!(body, json!({ "error": "Database unavailable." }));
    }

    #[tokio::test]
    async fn http_error_maps_status_and_clamps_out_of_range() {
        let response = AppError::Http {
            status: StatusCode::BAD_REQUEST,
            message: "Denomination is required.".to_owned(),
        }
        .into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body reads");
        let body: serde_json::Value = serde_json::from_slice(&bytes).expect("body is JSON");
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
