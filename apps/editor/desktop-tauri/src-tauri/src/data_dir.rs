//! Bundled-data copy parity with `ensureViewerDataDir()` in `main.js`.
//!
//! The packaged app ships a `bundled-data/banknotes.db`; on launch the shell
//! copies it over the user-data copy when the bundled file is newer (mtime),
//! so seed updates reach existing installs without wiping user edits.

use std::{fs, io, path::Path};

/// Pure decision: copy when the bundled db is newer than the target.
/// A missing target counts as infinitely old (`-1` in `main.js`).
pub fn should_copy_bundled_data(
    bundled_exists: bool,
    bundled_mtime_ms: f64,
    target_exists: bool,
    target_mtime_ms: f64,
) -> bool {
    if !bundled_exists {
        return false;
    }
    let target_mtime = if target_exists {
        target_mtime_ms
    } else {
        -1.0
    };
    target_mtime < bundled_mtime_ms
}

fn mtime_ms(path: &Path) -> Option<f64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs_f64() * 1000.0)
}

/// Mirrors `ensureViewerDataDir()`: copy `bundled_dir` → `target_dir` when
/// the bundled db is newer, then ensure the target exists. Returns the
/// target dir.
pub fn ensure_data_dir(bundled_dir: &Path, target_dir: &Path) -> io::Result<std::path::PathBuf> {
    let bundled_db = bundled_dir.join("banknotes.db");
    let target_db = target_dir.join("banknotes.db");
    let bundled_exists = bundled_db.exists();
    let copy = should_copy_bundled_data(
        bundled_exists,
        if bundled_exists {
            mtime_ms(&bundled_db).unwrap_or(0.0)
        } else {
            0.0
        },
        target_db.exists(),
        if target_db.exists() {
            mtime_ms(&target_db).unwrap_or(0.0)
        } else {
            0.0
        },
    );
    if copy {
        if let Some(parent) = target_dir.parent() {
            fs::create_dir_all(parent)?;
        }
        if target_dir.exists() {
            fs::remove_dir_all(target_dir)?;
        }
        fs::create_dir_all(target_dir)?;
        for entry in fs::read_dir(bundled_dir)? {
            let entry = entry?;
            let dest = target_dir.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                copy_dir_all(&entry.path(), &dest)?;
            } else {
                fs::copy(entry.path(), &dest)?;
            }
        }
    }
    fs::create_dir_all(target_dir)?;
    Ok(target_dir.to_path_buf())
}

fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let dest = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;

    #[test]
    fn copies_when_target_is_missing_or_older() {
        assert!(should_copy_bundled_data(true, 200.0, false, 0.0));
        assert!(should_copy_bundled_data(true, 200.0, true, 100.0));
        assert!(!should_copy_bundled_data(true, 100.0, true, 200.0));
        assert!(!should_copy_bundled_data(false, 999.0, false, 0.0));
    }

    #[test]
    fn ensure_copies_newer_bundled_db_and_keeps_newer_target() {
        let dir = tempfile::tempdir().unwrap();
        let bundled = dir.path().join("bundled");
        let target = dir.path().join("target");
        fs::create_dir_all(&bundled).unwrap();
        fs::write(bundled.join("banknotes.db"), "bundled").unwrap();
        sleep(Duration::from_millis(10));

        let out = ensure_data_dir(&bundled, &target).unwrap();
        assert_eq!(out, target);
        assert_eq!(fs::read_to_string(target.join("banknotes.db")).unwrap(), "bundled");

        // Target is now newer than bundled: a stale bundled write must not
        // clobber user data.
        sleep(Duration::from_millis(10));
        fs::write(target.join("banknotes.db"), "user").unwrap();
        let out = ensure_data_dir(&bundled, &target).unwrap();
        assert_eq!(fs::read_to_string(out.join("banknotes.db")).unwrap(), "user");
    }
}
