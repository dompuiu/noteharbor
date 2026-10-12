//! Packaging contract for the Tauri shell (`08-packaging`).
//!
//! Asserts the `tauri.conf.json` bundle surface that gives installer parity
//! with `desktop-electron` (electron-builder): explicit `nsis` + `appimage`
//! targets, `Utility` category, full icon set (no symlink placeholder),
//! `data` + `web-dist` resources matching the runtime layouts in
//! `paths.rs`, and per-user-or-machine NSIS installs mirroring Electron's
//! `oneClick: false` + `allowToChangeInstallationDirectory: true`.
//!
//! Source paths (`../../../../data`, `../../ui-react/dist`) are
//! intentionally NOT asserted for existence: both are gitignored build
//! inputs that only exist after a seed/dev build or `beforeBuildCommand`.

use std::path::PathBuf;

use serde_json::Value;

fn src_tauri_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn load_config() -> Value {
    let raw = std::fs::read_to_string(src_tauri_dir().join("tauri.conf.json"))
        .expect("tauri.conf.json reads");
    serde_json::from_str(&raw).expect("tauri.conf.json is valid JSON")
}

fn bundle(config: &Value) -> &Value {
    config
        .get("bundle")
        .expect("tauri.conf.json has a bundle section")
}

#[test]
fn app_identity_matches_electron_parity() {
    let config = load_config();
    assert_eq!(
        config.get("productName").and_then(Value::as_str),
        Some("Note Harbor Editor"),
    );
    assert_eq!(
        config.get("identifier").and_then(Value::as_str),
        Some("com.noteharbor.editor"),
    );
    // The shell, the npm package, and the Cargo crate ship one version.
    assert_eq!(
        config.get("version").and_then(Value::as_str),
        Some(env!("CARGO_PKG_VERSION")),
    );
}

#[test]
fn frontend_dist_and_build_hook_reuse_desktop_web_build() {
    let config = load_config();
    let build = config.get("build").expect("tauri.conf.json has a build section");
    assert_eq!(
        build.get("frontendDist").and_then(Value::as_str),
        Some("../../ui-react/dist"),
        "frontendDist is tauri.conf-relative, so it keeps the src-tauri depth",
    );
    // Hook shell commands run with the tauri invocation directory as cwd
    // (the desktop-tauri package root via pnpm scripts), NOT src-tauri, so
    // their relative paths use the package-root depth. `../../...` here
    // breaks every pnpm-scripted dev/build invocation.
    assert_eq!(
        build.get("beforeDevCommand").and_then(Value::as_str),
        Some("pnpm --dir ../ui-react dev"),
    );
    assert_eq!(
        build.get("beforeBuildCommand").and_then(Value::as_str),
        Some("pnpm --dir ../desktop-electron build:web"),
        "packaged UI must reuse desktop-electron build:web (VITE_DESKTOP_RUNTIME=true)",
    );
}

#[test]
fn bundle_targets_are_the_explicit_parity_pair() {
    let targets = bundle(&load_config())
        .get("targets")
        .expect("bundle.targets is set")
        .clone();
    let targets: Vec<String> = if let Value::String(single) = &targets {
        vec![single.clone()]
    } else {
        serde_json::from_value(targets).expect("bundle.targets is a string or list")
    };
    for expected in ["nsis", "appimage"] {
        assert!(
            targets.contains(&expected.to_owned()),
            "bundle.targets must include {expected:?} (electron nsis/portable + AppImage/dir parity), got {targets:?}",
        );
    }
}

#[test]
fn bundle_category_matches_electron_linux_category() {
    assert_eq!(
        bundle(&load_config()).get("category").and_then(Value::as_str),
        Some("Utility"),
    );
}

#[test]
fn bundle_icons_are_committed_real_files() {
    let icons = bundle(&load_config())
        .get("icon")
        .and_then(Value::as_array)
        .cloned()
        .expect("bundle.icon is a non-empty list");
    assert!(!icons.is_empty(), "bundle.icon must list the icon set");
    let dir = src_tauri_dir();
    let mut saw_ico = false;
    let mut saw_icns = false;
    for entry in &icons {
        let rel = entry.as_str().expect("bundle.icon entries are strings");
        let path = dir.join(rel);
        let meta = std::fs::symlink_metadata(&path)
            .unwrap_or_else(|_| panic!("bundle icon {rel:?} exists"));
        assert!(
            !meta.file_type().is_symlink(),
            "bundle icon {rel:?} must be a real file, not the icon-source symlink placeholder",
        );
        saw_ico |= rel.ends_with(".ico");
        saw_icns |= rel.ends_with(".icns");
    }
    assert!(saw_ico, "icon set must include a Windows .ico");
    assert!(saw_icns, "icon set must include a macOS .icns");
}

#[test]
fn bundle_resources_map_to_data_and_web_dist() {
    let resources = bundle(&load_config())
        .get("resources")
        .expect("bundle.resources is set")
        .clone();
    let map: std::collections::BTreeMap<String, String> =
        serde_json::from_value(resources).expect("bundle.resources is a source->target map");
    let targets: Vec<&str> = map.values().map(String::as_str).collect();
    assert!(
        targets.contains(&"data"),
        "resources must map a source to the \"data\" target (paths.rs data layout), got {targets:?}",
    );
    assert!(
        targets.contains(&"web-dist"),
        "resources must map the built UI to the \"web-dist\" target (paths.rs packaged layout), got {targets:?}",
    );
}

#[test]
fn nsis_install_mode_mirrors_electron_per_user_or_machine() {
    let windows = bundle(&load_config())
        .get("windows")
        .cloned()
        .expect("bundle.windows is set");
    let nsis = windows.get("nsis").expect("bundle.windows.nsis is set");
    assert_eq!(
        nsis.get("installMode").and_then(Value::as_str),
        Some("both"),
        "NSIS installMode \"both\" mirrors electron nsis oneClick:false (per-user-or-machine choice)",
    );
    let icon_rel = nsis
        .get("installerIcon")
        .and_then(Value::as_str)
        .expect("bundle.windows.nsis.installerIcon is set");
    assert!(
        src_tauri_dir().join(icon_rel).is_file(),
        "nsis installerIcon {icon_rel:?} exists",
    );
}
