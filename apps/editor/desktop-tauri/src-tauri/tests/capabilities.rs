//! Capability contract for the Tauri shell's embedded-server window.
//!
//! The shell serves the UI from an embedded Axum server on
//! `http://127.0.0.1:<ephemeral>` (`server.rs`) and loads it via
//! `WebviewUrl::External` (`main.rs`). Tauri v2 treats that as a remote
//! URL, so the `default` capability must explicitly allow the loopback
//! origin — otherwise `window.__TAURI__` is never injected, the
//! `noteHarborDesktop` bridge never appears, and Auto Populate skips its
//! Chrome launch straight into a CDP 500.

use std::path::PathBuf;

use serde_json::Value;

fn src_tauri_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn load_capability() -> Value {
    let raw = std::fs::read_to_string(src_tauri_dir().join("capabilities/default.json"))
        .expect("capabilities/default.json reads");
    serde_json::from_str(&raw).expect("capabilities/default.json is valid JSON")
}

#[test]
fn default_capability_covers_main_window_with_core_ipc() {
    let capability = load_capability();
    let windows = capability
        .get("windows")
        .and_then(Value::as_array)
        .expect("default capability targets windows");
    assert!(
        windows.iter().any(|w| w.as_str() == Some("main")),
        "default capability must cover the \"main\" window, got {windows:?}",
    );
    let permissions = capability
        .get("permissions")
        .and_then(Value::as_array)
        .expect("default capability has permissions");
    assert!(
        permissions.iter().any(|p| p.as_str() == Some("core:default")),
        "default capability must keep core:default (includes webview internal-toggle-devtools), got {permissions:?}",
    );
}

#[test]
fn default_capability_allows_embedded_loopback_origin() {
    let capability = load_capability();
    let urls = capability
        .get("remote")
        .and_then(|remote| remote.get("urls"))
        .and_then(Value::as_array)
        .expect("default capability must set remote.urls for the embedded http://127.0.0.1 server");
    assert!(
        urls.iter().any(|entry| {
            entry.as_str().is_some_and(|pattern| {
                pattern.contains("127.0.0.1") && pattern.contains('*')
            })
        }),
        "remote.urls must cover the ephemeral embedded origin (e.g. \"http://127.0.0.1:*\"), got {urls:?}",
    );
}
