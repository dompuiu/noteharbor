//! Exclusive-operation status. Ports `server-node/src/operationState.js`
//! read side; transitions (`begin`/`end`, conflict errors) land with the
//! archive slice that performs them.

use serde_json::{Value, json};

#[derive(Debug)]
pub struct OperationState {
    pub current_operation: String,
    pub started_at: Option<String>,
    pub details: Option<Value>,
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
}
