//! Tauri shell port of `desktop-electron/src/main.js` + `preferences.js`.
//!
//! Pure, testable logic lives here (Chrome CDP resolution, window-state
//! normalization, desktop prefs, bundled-data copy decision, external-URL
//! guard). The Tauri event loop, server bootstrap, menus, and commands live
//! in `main.rs` and delegate to these helpers so `cargo test` covers the
//! parity semantics without a WebView.

pub mod chrome;
pub mod data_dir;
pub mod menu;
pub mod paths;
pub mod prefs;
pub mod server;
pub mod urls;
pub mod window_state;
