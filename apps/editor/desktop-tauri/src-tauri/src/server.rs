//! Embedded `server-rust` bootstrap shared by the Tauri shell binary.
//!
//! Kept here (not in `main.rs`) so the "Rust on `127.0.0.1:0`" contract is
//! covered by an HTTP-level test without a WebView. The embedded server
//! startup (data dir + web dist + serve flag) goes through the same
//! `NOTE_HARBOR_*` env names as the former Electron shell's
//! `startEmbeddedServer()`.

use std::path::PathBuf;

pub const APP_URL_HOST: &str = "127.0.0.1";

/// The embedded server's URL, task handle, and the state the shell shares with
/// its own commands (archive export writes through the same pool and operation
/// guard the HTTP routes use). The caller owns shutdown (abort the handle).
pub struct EmbeddedServer {
    pub app_url: String,
    pub task: tokio::task::JoinHandle<()>,
    pub state: editor_server_rust::AppState,
}

/// Starts the embedded Axum server on an ephemeral port.
pub async fn start_embedded_server(
    data_dir: PathBuf,
    web_dist_dir: PathBuf,
) -> Result<EmbeddedServer, String> {
    std::env::set_var("NOTE_HARBOR_DATA_DIR", &data_dir);
    std::env::set_var("NOTE_HARBOR_WEB_DIST_DIR", &web_dist_dir);
    std::env::set_var("NOTE_HARBOR_SERVE_WEB_DIST", "true");
    let config = editor_server_rust::ServerConfig::from_env();
    let static_root = if config.serve_web_dist && config.web_dist_dir.is_dir() {
        config.web_dist_dir.canonicalize().ok()
    } else {
        None
    };
    let db_path = config.db_path();
    let pool = tokio::task::spawn_blocking(move || editor_server_rust::db::open_pool(&db_path))
        .await
        .map_err(|error| format!("migration task failed: {error}"))?
        .map_err(|error| format!("cannot open database: {error}"))?;
    let app_state = editor_server_rust::AppState::new(static_root, data_dir, pool);
    let router = editor_server_rust::create_app(app_state.clone());
    let listener = tokio::net::TcpListener::bind((APP_URL_HOST, 0))
        .await
        .map_err(|error| format!("cannot bind embedded server: {error}"))?;
    let port = listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| format!("cannot read embedded port: {error}"))?;
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Ok(EmbeddedServer {
        app_url: format!("http://{APP_URL_HOST}:{port}"),
        task: handle,
        state: app_state,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn embedded_server_boots_on_ephemeral_port_with_api() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path().join("data");
        let web_dist = dir.path().join("empty-dist");
        std::fs::create_dir_all(&web_dist).unwrap();
        let embedded = start_embedded_server(data_dir, web_dist).await.unwrap();
        let app_url = embedded.app_url.clone();
        assert!(
            app_url.starts_with("http://127.0.0.1:"),
            "unexpected url {app_url}"
        );
        // The shell's own commands export through this shared state.
        assert!(embedded.state.pool.get().is_ok());

        let client = reqwest::Client::new();
        let body = client
            .get(format!("{app_url}/api/health"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        let health: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(health, serde_json::json!({ "ok": true }));

        let not_found = client
            .get(format!("{app_url}/api/does-not-exist"))
            .send()
            .await
            .unwrap();
        assert_eq!(not_found.status().as_u16(), 404);

        embedded.task.abort();
    }
}
