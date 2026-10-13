//! Tauri desktop shell: embedded server + window + preferences.
//!
//! Pure, testable logic lives here (Chrome CDP resolution, window-state
//! normalization, desktop prefs, bundled-data copy decision, external-URL
//! guard). The Tauri event loop, server bootstrap, and commands live
//! in `main.rs` and delegate to these helpers so `cargo test` covers the
//! parity semantics without a WebView.

pub mod chrome;
pub mod data_dir;
pub mod paths;
pub mod prefs;
pub mod server;
pub mod urls;
pub mod window_state;
