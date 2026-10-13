//! Capability + config contract for the Tauri shell's embedded-server window.
//!
//! The shell serves the UI from an embedded Axum server on
//! `http://127.0.0.1:<ephemeral>` (`server.rs`) and loads it via
//! `WebviewUrl::External` (`main.rs`). Tauri v2 treats that as a remote
//! URL, so the `default` capability must explicitly allow the loopback
//! origin — otherwise the window has no IPC access and every `invoke`
//! (including the `noteHarborDesktop` bridge commands) is denied.
//! Separately, `tauri.conf.json` must set `app.withGlobalTauri`; without it
//! `window.__TAURI__` is never injected and the bridge init script in
//! `main.rs` can never run, so Auto Populate skips its Chrome launch
//! straight into a CDP 500.

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

fn load_config() -> Value {
    let raw = std::fs::read_to_string(src_tauri_dir().join("tauri.conf.json"))
        .expect("tauri.conf.json reads");
    serde_json::from_str(&raw).expect("tauri.conf.json is valid JSON")
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

#[test]
fn tauri_config_injects_global_tauri_api_for_bridge() {
    let with_global = load_config()
        .get("app")
        .and_then(|app| app.get("withGlobalTauri"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    assert!(
        with_global,
        "tauri.conf.json app.withGlobalTauri must be true: the desktop bridge \
         init script (main.rs DESKTOP_BRIDGE_JS) reads window.__TAURI__.core.invoke, \
         which is never injected when the global is disabled",
    );
}

/// Maps each `permissions/*.toml` permission identifier to the app commands
/// in its `commands.allow` list. The files this repo writes keep one
/// `identifier = "..."` line per `[[permission]]` block followed by a single
/// `commands.allow = [...]` line, which is all this scan relies on.
fn app_permission_commands() -> Vec<(String, Vec<String>)> {
    let dir = src_tauri_dir().join("permissions");
    let mut entries = Vec::new();
    let mut files = std::fs::read_dir(&dir)
        .unwrap_or_else(|_| panic!("src-tauri/permissions must exist: {}", dir.display()))
        .map(|entry| entry.expect("permissions entry reads").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "toml"))
        .collect::<Vec<_>>();
    files.sort();
    assert!(
        !files.is_empty(),
        "src-tauri/permissions must define allow-permissions for the app commands",
    );
    for path in files {
        let raw = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("{} reads", path.display()));
        let mut identifier: Option<String> = None;
        for line in raw.lines() {
            let line = line.trim();
            if let Some(id) = line
                .strip_prefix("identifier")
                .and_then(|rest| rest.split('=').nth(1))
            {
                identifier = Some(id.trim().trim_matches('"').to_owned());
            } else if line.starts_with("commands.allow") {
                let allowed = line
                    .split('[')
                    .nth(1)
                    .and_then(|list| list.split(']').next())
                    .unwrap_or_default()
                    .split(',')
                    .map(|item| item.trim().trim_matches('"').to_owned())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>();
                entries.push((
                    identifier.clone().unwrap_or_else(|| {
                        panic!("commands.allow without identifier in {}", path.display())
                    }),
                    allowed,
                ));
            }
        }
    }
    entries
}

#[test]
fn app_commands_are_allowed_through_capability_permissions() {
    // Remote origins (the embedded http://127.0.0.1 server) always pass the
    // ACL gate in webview/mod.rs, and unknown app commands are rejected with
    // "<command> not allowed. Plugin not found". Every command in
    // generate_handler! therefore needs a permissions/*.toml allow-entry
    // referenced by the default capability.
    let main_rs = std::fs::read_to_string(src_tauri_dir().join("src/main.rs"))
        .expect("src/main.rs reads");
    let handler = main_rs
        .split("generate_handler![")
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .expect("main.rs has a generate_handler![...] block");
    let commands = handler
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    assert!(
        !commands.is_empty(),
        "expected commands in generate_handler![...]",
    );
    let capability = load_capability();
    let referenced = capability
        .get("permissions")
        .and_then(Value::as_array)
        .expect("default capability has permissions")
        .iter()
        .filter_map(Value::as_str)
        .filter(|entry| !entry.contains(':'))
        .collect::<Vec<_>>();
    let permission_entries = app_permission_commands();
    for command in commands {
        let holders = permission_entries
            .iter()
            .filter(|(_, allowed)| allowed.iter().any(|name| name == command))
            .map(|(identifier, _)| identifier.as_str())
            .collect::<Vec<_>>();
        assert!(
            !holders.is_empty(),
            "no permissions/*.toml allows app command {command}",
        );
        for identifier in holders {
            assert!(
                referenced.contains(&identifier),
                "default capability must reference app permission {identifier} \
                 (allows {command}) or the remote window cannot invoke it",
            );
        }
    }
}
