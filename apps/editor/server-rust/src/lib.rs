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

use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde_json::json;

pub const DEFAULT_HOST: &str = "127.0.0.1";
/// Dev default: the Rust server listens on `:3002` while server-node keeps `:3001`.
pub const DEFAULT_PORT: u16 = 3002;
/// `ROOT_DIR` depth (`../../../..`) matches `server-node/src/db.js` so the same
/// relative layout resolves from either sibling directory.
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
            .join("../../../..")
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

pub fn create_app(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health_handler))
        .with_state(state)
}
