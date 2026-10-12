//! Exclusive-operation status. Ports `server-node/src/operationState.js`
//! (status read + `begin`/`end` transitions + `withExclusiveOperation`).

use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

#[derive(Debug)]
pub struct OperationState {
    pub current_operation: String,
    pub started_at: Option<String>,
    pub details: Option<Value>,
}

/// `409` conflict when an exclusive operation is already running. Mirrors
/// `createOperationConflictError`: the message names the blocked action and
/// the running operation with `_` → space, plus the raw operation id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationConflict {
    pub message: String,
    pub current_operation: String,
}

impl OperationConflict {
    pub fn status_code(&self) -> axum::http::StatusCode {
        axum::http::StatusCode::CONFLICT
    }

    pub fn body(&self) -> Value {
        json!({ "error": self.message, "currentOperation": self.current_operation })
    }
}

impl Default for OperationState {
    fn default() -> Self {
        Self {
            current_operation: "idle".to_owned(),
            started_at: None,
            details: None,
        }
    }
}

impl OperationState {
    pub fn status(&self) -> Value {
        json!({
            "currentOperation": self.current_operation,
            "isBusy": self.current_operation != "idle",
            "startedAt": self.started_at,
            "details": self.details,
        })
    }

    pub fn conflict(&self, action_label: &str) -> OperationConflict {
        OperationConflict {
            message: format!(
                "{action_label} is unavailable while {} is in progress.",
                self.current_operation.replace('_', " ")
            ),
            current_operation: self.current_operation.clone(),
        }
    }

    /// Starts `operation`, failing with a conflict when another one runs.
    pub fn begin(&mut self, operation: &str, details: Option<Value>) -> Result<(), OperationConflict> {
        if self.current_operation != "idle" {
            return Err(self.conflict("This action"));
        }
        self.current_operation = operation.to_owned();
        self.started_at = Some(now_iso8601_utc());
        self.details = details;
        Ok(())
    }

    pub fn assert_available(&self, action_label: &str) -> Result<(), OperationConflict> {
        if self.current_operation != "idle" {
            return Err(self.conflict(action_label));
        }
        Ok(())
    }

    /// Ends `operation`. A mismatched name is a no-op, mirroring
    /// `endOperation(type)` in `operationState.js`.
    pub fn end(&mut self, operation: &str) {
        if self.current_operation != operation {
            return;
        }
        self.current_operation = "idle".to_owned();
        self.started_at = None;
        self.details = None;
    }
}

/// Runs `task` under the named exclusive operation on the shared state:
/// the begin/end pairing mirrors `withExclusiveOperation(type, details, fn)`.
/// The mutex is only held for the begin/end transitions themselves (not
/// across `await`), matching Node's single-threaded mutual exclusion for
/// export/import/clear closely enough: a second exclusive operation that
/// starts while one runs gets the 409 conflict.
pub async fn with_exclusive_operation<T>(
    ops: &Arc<Mutex<OperationState>>,
    operation: &str,
    details: Option<Value>,
    task: impl std::future::Future<Output = T>,
) -> Result<T, OperationConflict> {
    {
        let mut guard = ops.lock().map_err(|_| OperationConflict {
            message: "This action is unavailable while unknown is in progress.".to_owned(),
            current_operation: "unknown".to_owned(),
        })?;
        guard.begin(operation, details)?;
    }
    let output = task.await;
    if let Ok(mut guard) = ops.lock() {
        guard.end(operation);
    }
    Ok(output)
}

pub(crate) fn now_iso8601_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    // Civil-from-days (Howard Hinnant's algorithm), then HMS. No `chrono`
    // dependency for a single timestamp.
    let days = secs.div_euclid(86_400);
    let time = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u8;
    year += i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        time / 3_600,
        (time % 3_600) / 60,
        time % 60,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn begin_and_end_cycle_through_busy() {
        let mut state = OperationState::default();
        assert_eq!(
            state.status(),
            json!({
                "currentOperation": "idle",
                "isBusy": false,
                "startedAt": null,
                "details": null,
            })
        );
        state.begin("exporting_archive", None).expect("begin");
        assert_eq!(state.status()["isBusy"], json!(true));
        assert!(state.status()["startedAt"].is_string());
        let conflict = state.begin("importing_archive", None).expect_err("second begin conflicts");
        assert_eq!(conflict.current_operation, "exporting_archive");
        assert_eq!(
            conflict.message,
            "This action is unavailable while exporting archive is in progress."
        );
        // Mismatched end keeps the operation; matching end clears it.
        state.end("importing_archive");
        assert_eq!(state.status()["currentOperation"], json!("exporting_archive"));
        state.end("exporting_archive");
        assert_eq!(state.status()["currentOperation"], json!("idle"));
    }

    #[tokio::test]
    async fn exclusive_helper_releases_after_task() {
        let ops = Arc::new(Mutex::new(OperationState::default()));
        let ran = with_exclusive_operation(&ops, "clearing_data", None, async { 7 }).await;
        assert_eq!(ran, Ok(7));
        assert_eq!(
            ops.lock().expect("lock").status()["currentOperation"],
            json!("idle")
        );
    }

    #[tokio::test]
    async fn exclusive_helper_conflicts_while_busy() {
        let ops = Arc::new(Mutex::new(OperationState::default()));
        ops.lock().expect("lock").begin("exporting_archive", None).expect("begin");
        let conflict =
            with_exclusive_operation(&ops, "importing_archive", None, async {}).await;
        assert!(conflict.is_err());
        let conflict = conflict.expect_err("conflict");
        assert_eq!(conflict.status_code(), axum::http::StatusCode::CONFLICT);
        assert_eq!(
            conflict.body(),
            json!({
                "error": "This action is unavailable while exporting archive is in progress.",
                "currentOperation": "exporting_archive",
            })
        );
    }
}
