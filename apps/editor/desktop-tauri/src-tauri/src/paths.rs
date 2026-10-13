//! Runtime path resolution for the Tauri shell.
//!
//! Both helpers take their inputs explicitly so unit tests don't touch the
//! process environment; `main.rs` passes the env-derived values.

use std::path::{Path, PathBuf};

/// Resolves the bundled data dir: the packaged
/// `bundled-data` dir first, then the `data` resource dir
/// (Tauri `resources` layout), then the dev fallback (repo `data/`).
pub fn resolve_bundled_data_dir(
    resource_dir: Option<&Path>,
    dev_fallback: &Path,
) -> PathBuf {
    if let Some(resource) = resource_dir {
        for candidate in ["bundled-data", "data"] {
            let dir = resource.join(candidate);
            if dir.join("banknotes.db").exists() {
                return dir;
            }
        }
    }
    dev_fallback.to_path_buf()
}

/// Where the embedded server's static UI comes from: explicit env override
/// (`NOTE_HARBOR_WEB_DIST_DIR`) first, then the packaged `web-dist`
/// resource, then the dev `ui-react/dist`.
pub fn resolve_web_dist_dir(
    env_override: Option<&Path>,
    resource_dir: Option<&Path>,
    dev_fallback: &Path,
) -> PathBuf {
    if let Some(dir) = env_override {
        if dir.is_dir() {
            return dir.to_path_buf();
        }
    }
    if let Some(resource) = resource_dir {
        let packaged = resource.join("web-dist");
        if packaged.is_dir() {
            return packaged;
        }
    }
    dev_fallback.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn bundled_data_prefers_packaged_dirs_then_dev_fallback() {
        let dir = tempfile::tempdir().unwrap();
        let resource = dir.path().join("resources");
        let dev = dir.path().join("dev-data");
        fs::create_dir_all(&dev).unwrap();

        assert_eq!(
            resolve_bundled_data_dir(Some(&resource), &dev),
            dev,
            "no packaged db: dev fallback"
        );

        let data = resource.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("banknotes.db"), "db").unwrap();
        assert_eq!(
            resolve_bundled_data_dir(Some(&resource), &dev),
            data,
            "tauri resources layout wins"
        );

        let bundled = resource.join("bundled-data");
        fs::create_dir_all(&bundled).unwrap();
        fs::write(bundled.join("banknotes.db"), "db").unwrap();
        assert_eq!(
            resolve_bundled_data_dir(Some(&resource), &dev),
            bundled,
            "bundled-data layout wins first"
        );

        assert_eq!(resolve_bundled_data_dir(None, &dev), dev);
    }

    #[test]
    fn web_dist_prefers_env_then_packaged_then_dev() {
        let dir = tempfile::tempdir().unwrap();
        let resource = dir.path().join("resources");
        let env_dir = dir.path().join("env-dist");
        let dev = dir.path().join("dev-dist");
        for path in [&env_dir, &dev] {
            fs::create_dir_all(path).unwrap();
        }

        assert_eq!(
            resolve_web_dist_dir(Some(&env_dir), Some(&resource), &dev),
            env_dir
        );
        // A missing env dir falls through instead of breaking the shell.
        assert_eq!(
            resolve_web_dist_dir(Some(&dir.path().join("missing")), Some(&resource), &dev),
            dev
        );

        let packaged = resource.join("web-dist");
        fs::create_dir_all(&packaged).unwrap();
        assert_eq!(
            resolve_web_dist_dir(None, Some(&resource), &dev),
            packaged
        );
        assert_eq!(resolve_web_dist_dir(None, None, &dev), dev);
    }
}
