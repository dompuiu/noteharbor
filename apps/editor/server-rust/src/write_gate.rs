//! Cross-process write gate for the SQLite store.
//!
//! Several Editor instances (one per Git worktree, all sharing `data/`) may run
//! at once. Reads are safe, but concurrent writes are not: the database lives
//! on a network-ish mount (9p/DrvFs, Google Drive) whose advisory locks SQLite
//! cannot rely on. This gate serializes mutating HTTP requests across processes
//! using a lock file on the *local* temp directory, keyed by the canonical data
//! directory, so two instances never write at the same time.
//!
//! The lock is advisory and per machine: it cannot see an instance on another
//! computer pointed at the same synced folder.

use std::{
    env,
    fs::{File, OpenOptions, TryLockError},
    io,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

/// Shared write gate. Cloning shares the in-process mutex, so requests in one
/// instance queue instead of contending for the file lock.
#[derive(Debug, Clone)]
pub struct WriteGate {
    path: PathBuf,
    local: Arc<tokio::sync::Mutex<()>>,
}

impl WriteGate {
    /// Derives the lock path from the canonical data directory. Instances
    /// pointed at the same directory (through different symlinks or relative
    /// paths) resolve to the same lock file.
    pub fn new(data_dir: &Path) -> Self {
        let canonical = std::fs::canonicalize(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
        // A stable hash: every Editor binary, regardless of build, must map the
        // same directory to the same lock file.
        let hash = fnv1a64(canonical.as_os_str().as_encoded_bytes());
        let name = format!("noteharbor-{hash:016x}.write.lock");
        Self {
            path: env::temp_dir().join(name),
            local: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub fn lock_path(&self) -> &Path {
        &self.path
    }

    /// Waits for the write slot, giving up after `timeout`.
    pub async fn acquire(&self, timeout: Duration) -> Result<WriteGuard, WriteGateError> {
        // Serialize within this process first: same-process writes wait their
        // turn rather than reporting a cross-process conflict, but they never
        // wait past the same timeout.
        let local = match tokio::time::timeout(timeout, self.local.clone().lock_owned()).await {
            Ok(guard) => guard,
            Err(_) => return Err(WriteGateError::Busy),
        };
        let path = self.path.clone();
        let file = tokio::task::spawn_blocking(move || lock_with_timeout(&path, timeout))
            .await
            .map_err(|_| WriteGateError::Cancelled)??;
        Ok(WriteGuard {
            _local: local,
            _file: file,
        })
    }
}

/// Held for the duration of one mutating request; dropping it releases both
/// the in-process mutex and the file lock.
#[derive(Debug)]
pub struct WriteGuard {
    _local: tokio::sync::OwnedMutexGuard<()>,
    _file: File,
}

#[derive(Debug)]
pub enum WriteGateError {
    /// Another instance held the write slot for the whole timeout.
    Busy,
    Io(io::Error),
    Cancelled,
}

impl std::fmt::Display for WriteGateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy => formatter.write_str("another instance is writing"),
            Self::Io(error) => write!(formatter, "write gate I/O error: {error}"),
            Self::Cancelled => formatter.write_str("write gate task cancelled"),
        }
    }
}

impl std::error::Error for WriteGateError {}

/// FNV-1a: deterministic across binaries, unlike `DefaultHasher`.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn lock_with_timeout(path: &Path, timeout: Duration) -> Result<File, WriteGateError> {    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
        .map_err(WriteGateError::Io)?;
    let deadline = Instant::now() + timeout;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Err(WriteGateError::Busy);
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(TryLockError::Error(error)) => return Err(WriteGateError::Io(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a64_matches_known_vectors() {
        assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
    }

    #[tokio::test]
    async fn second_instance_times_out_while_first_holds_the_gate() {
        let dir = tempfile::tempdir().unwrap();
        let first = WriteGate::new(dir.path());
        let second = WriteGate::new(dir.path());
        assert_eq!(first.lock_path(), second.lock_path());

        let held = first.acquire(Duration::from_millis(50)).await.unwrap();
        let error = second
            .acquire(Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(matches!(error, WriteGateError::Busy), "{error:?}");

        drop(held);
        second
            .acquire(Duration::from_millis(250))
            .await
            .expect("gate is free after the guard drops");
    }

    #[tokio::test]
    async fn same_instance_writes_queue_instead_of_failing() {
        let dir = tempfile::tempdir().unwrap();
        let gate = WriteGate::new(dir.path());
        let held = gate.acquire(Duration::from_millis(50)).await.unwrap();
        let waiter = {
            let gate = gate.clone();
            tokio::spawn(async move { gate.acquire(Duration::from_millis(500)).await })
        };
        tokio::time::sleep(Duration::from_millis(25)).await;
        drop(held);
        waiter
            .await
            .unwrap()
            .expect("queued write proceeds once the first finishes");
    }
}
