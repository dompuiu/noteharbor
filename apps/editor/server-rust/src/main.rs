//! `server-rust` binary: migrates the database, binds the Axum app, serves it.
//!
//! Migrations run once at boot, before serving, on a blocking thread.
//! `PORT=0` binds an ephemeral port (how the Tauri shell embeds the server);
//! the active port is printed so the launcher can point the WebView at it.

use editor_server_rust::{AppState, ServerConfig, create_app, db};

#[tokio::main]
async fn main() {
    let config = ServerConfig::from_env();
    let static_root = if config.serve_web_dist && config.web_dist_dir.is_dir() {
        config.web_dist_dir.canonicalize().ok()
    } else {
        None
    };
    let db_path = config.db_path();
    let data_dir = config.data_dir.clone();
    let pool = tokio::task::spawn_blocking(move || db::open_pool(&db_path))
        .await
        .expect("migration task joins")
        .unwrap_or_else(|error| {
            eprintln!("cannot open database: {error}");
            std::process::exit(1);
        });
    let state = AppState::new(static_root, data_dir, pool);
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
