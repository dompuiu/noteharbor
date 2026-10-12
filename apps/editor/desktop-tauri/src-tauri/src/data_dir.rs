//! Bundled-data copy parity with `ensureViewerDataDir()` in `main.js`.
//!
//! The packaged app ships a `bundled-data/banknotes.db`; on launch the shell
//! copies it over the user-data copy when the bundled file is newer (mtime),
//! so seed updates reach existing installs without wiping user edits.

use std::{fs, io, path::Path, time::SystemTime};

/// Pure decision: copy when the bundled db is newer than the target.
/// A missing target counts as infinitely old (`-1` in `main.js`); an
/// unreadable bundled mtime never copies (refuses to clobber user data with
/// a seed of unknown age), while an unreadable target mtime copies (treats
/// the target as stale).
pub fn should_copy_bundled_data(
    bundled_exists: bool,
    bundled_mtime: Option<SystemTime>,
    target_exists: bool,
    target_mtime: Option<SystemTime>,
) -> bool {
    if !bundled_exists {
        return false;
    }
    let Some(bundled_mtime) = bundled_mtime else {
        return false;
    };
    if !target_exists {
        return true;
    }
    target_mtime.is_none_or(|current| current < bundled_mtime)
}

fn mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).ok()?.modified().ok()
}

/// Mirrors `ensureViewerDataDir()`: copy `bundled_dir` → `target_dir` when
/// the bundled db is newer, then ensure the target exists. Returns the
/// target dir.
pub fn ensure_data_dir(bundled_dir: &Path, target_dir: &Path) -> io::Result<std::path::PathBuf> {
    let bundled_db = bundled_dir.join("banknotes.db");
    let target_db = target_dir.join("banknotes.db");
    let copy = should_copy_bundled_data(
        bundled_db.exists(),
        mtime(&bundled_db),
        target_db.exists(),
        mtime(&target_db),
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
        use std::time::{Duration, SystemTime};
        fn t(secs: u64) -> Option<SystemTime> {
            Some(SystemTime::UNIX_EPOCH + Duration::from_secs(secs))
        }
        assert!(should_copy_bundled_data(true, t(200), false, None));
        assert!(should_copy_bundled_data(true, t(200), true, t(100)));
        assert!(!should_copy_bundled_data(true, t(100), true, t(200)));
        assert!(!should_copy_bundled_data(true, t(200), true, t(200)));
        assert!(!should_copy_bundled_data(false, t(999), false, None));
        // Unreadable bundled mtime never clobbers user data; unreadable
        // target mtime treats the target as stale.
        assert!(!should_copy_bundled_data(true, None, true, t(100)));
        assert!(should_copy_bundled_data(true, t(200), true, None));
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
