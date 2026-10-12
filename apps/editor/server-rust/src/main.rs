//! `server-rust` binary: binds the Axum app and serves it.
//!
//! `PORT=0` binds an ephemeral port (how the Tauri shell embeds the server);
//! the active port is printed so the launcher can point the WebView at it.

use std::sync::{
    Arc,
    atomic::AtomicBool,
};

use editor_server_rust::{AppState, ServerConfig, create_app};

#[tokio::main]
async fn main() {
    let config = ServerConfig::from_env();
    let static_root = if config.serve_web_dist && config.web_dist_dir.is_dir() {
        config.web_dist_dir.canonicalize().ok()
    } else {
        None
    };
    let state = AppState {
        static_root,
        db_available: Arc::new(AtomicBool::new(true)),
    };
    let app = create_app(state);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port))
        .await
        .expect("bind server socket");
    let active_port = listener
        .local_addr()
        .map(|addr| addr.port())
        .unwrap_or(config.port);
    println!("Server listening on http://{}:{active_port}", config.host);
    axum::serve(listener, app).await.expect("serve app");
}
