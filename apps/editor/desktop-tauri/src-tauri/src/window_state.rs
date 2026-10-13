//! Window-state persistence.
//!
//! Same file (`window-state.json`), same defaults (1480×960, min 1200×720),
//! same clamping, same on-any-display guard. The display list is injected so
//! tests don't need a windowing system.

use serde::{Deserialize, Serialize};

pub const WINDOW_STATE_FILENAME: &str = "window-state.json";
pub const DEFAULT_WINDOW_WIDTH: i32 = 1480;
pub const DEFAULT_WINDOW_HEIGHT: i32 = 960;
pub const MIN_WINDOW_WIDTH: i32 = 1200;
pub const MIN_WINDOW_HEIGHT: i32 = 720;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
    pub width: i32,
    pub height: i32,
    #[serde(rename = "isMaximized")]
    pub is_maximized: bool,
    #[serde(rename = "isFullScreen")]
    pub is_full_screen: bool,
}

#[derive(Debug, Deserialize)]
struct RawState {
    #[serde(default)]
    x: Option<serde_json::Value>,
    #[serde(default)]
    y: Option<serde_json::Value>,
    #[serde(default)]
    width: Option<serde_json::Value>,
    #[serde(default)]
    height: Option<serde_json::Value>,
    #[serde(default)]
    #[serde(rename = "isMaximized")]
    is_maximized: Option<serde_json::Value>,
    #[serde(default)]
    #[serde(rename = "isFullScreen")]
    is_full_screen: Option<serde_json::Value>,
}

fn as_number(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(raw) => raw.trim().parse::<f64>().ok(),
        serde_json::Value::Bool(true) => Some(1.0),
        serde_json::Value::Bool(false) => Some(0.0),
        _ => None,
    }
    .filter(|v| v.is_finite())
}

/// Mirrors `Number(...)` + `Number.isFinite` in `loadWindowState()`.
pub fn is_window_visible_on_any_display(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    areas: &[WorkArea],
) -> bool {
    areas.iter().any(|area| {
        x + width > area.x
            && x < area.x + area.width
            && y + height > area.y
            && y < area.y + area.height
    })
}

/// Parses + normalizes a `window-state.json` body: size clamped to the
/// minima, flags read with `=== true` semantics. Keeps any numeric position;
/// callers apply [`is_window_visible_on_any_display`] when monitors are
/// available. Returns `None` when the size is missing/non-numeric.
pub fn parse_window_state(raw: &str) -> Option<WindowState> {
    let parsed: RawState = serde_json::from_str(raw).ok()?;
    let width = parsed.width.as_ref().and_then(as_number)?;
    let height = parsed.height.as_ref().and_then(as_number)?;
    let mut state = WindowState {
        x: None,
        y: None,
        width: width.round() as i32,
        height: height.round() as i32,
        is_maximized: parsed
            .is_maximized
            .as_ref()
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        is_full_screen: parsed
            .is_full_screen
            .as_ref()
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    };
    state.width = state.width.max(MIN_WINDOW_WIDTH);
    state.height = state.height.max(MIN_WINDOW_HEIGHT);
    if let (Some(x), Some(y)) = (
        parsed.x.as_ref().and_then(as_number),
        parsed.y.as_ref().and_then(as_number),
    ) {
        state.x = Some(x.round() as i32);
        state.y = Some(y.round() as i32);
    }
    Some(state)
}

/// [`parse_window_state`] plus the on-any-display guard: off-screen
/// positions are dropped, mirroring `loadWindowState()`.
pub fn load_window_state(raw: &str, areas: &[WorkArea]) -> Option<WindowState> {
    let mut state = parse_window_state(raw)?;
    if let (Some(x), Some(y)) = (state.x, state.y) {
        if !is_window_visible_on_any_display(x, y, state.width, state.height, areas) {
            state.x = None;
            state.y = None;
        }
    }
    Some(state)
}

pub fn default_window_state() -> WindowState {
    WindowState {
        x: None,
        y: None,
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        is_maximized: false,
        is_full_screen: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area() -> Vec<WorkArea> {
        vec![WorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }]
    }

    #[test]
    fn rejects_non_numeric_size() {
        assert_eq!(load_window_state("{}", &area()), None);
        assert_eq!(
            load_window_state(r#"{"width":"big","height":960}"#, &area()),
            None
        );
    }

    #[test]
    fn clamps_to_minimum_size() {
        let state = load_window_state(r#"{"width":10,"height":20}"#, &area()).unwrap();
        assert_eq!(state.width, MIN_WINDOW_WIDTH);
        assert_eq!(state.height, MIN_WINDOW_HEIGHT);
    }

    #[test]
    fn keeps_on_screen_position_and_drops_off_screen() {
        let on_screen =
            load_window_state(r#"{"width":1480,"height":960,"x":100,"y":100}"#, &area())
                .unwrap();
        assert_eq!((on_screen.x, on_screen.y), (Some(100), Some(100)));
        let off_screen =
            load_window_state(r#"{"width":1480,"height":960,"x":5000,"y":5000}"#, &area())
                .unwrap();
        assert_eq!((off_screen.x, off_screen.y), (None, None));
    }

    #[test]
    fn reads_maximized_and_fullscreen_flags() {
        let state = load_window_state(
            r#"{"width":1480,"height":960,"isMaximized":true,"isFullScreen":1}"#,
            &area(),
        )
        .unwrap();
        assert!(state.is_maximized);
        // `1` is not `=== true` in JS, so fullscreen stays false.
        assert!(!state.is_full_screen);
    }
}
