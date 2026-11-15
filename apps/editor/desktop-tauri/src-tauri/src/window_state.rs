//! Window-state persistence.
//!
//! Same file (`window-state.json`), same defaults (1480×960, min 1200×720),
//! same clamping, same on-any-display guard. The display list is injected so
//! tests don't need a windowing system.

use serde::{Deserialize, Serialize};

pub const WINDOW_STATE_FILENAME: &str = "window-state.json";
pub const DEFAULT_WINDOW_WIDTH: f64 = 1480.0;
pub const DEFAULT_WINDOW_HEIGHT: f64 = 960.0;
pub const MIN_WINDOW_WIDTH: f64 = 1200.0;
pub const MIN_WINDOW_HEIGHT: f64 = 720.0;

/// A monitor's full bounds in physical pixels, as `Monitor::position`/`size`
/// report them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    pub width: f64,
    pub height: f64,
    #[serde(rename = "isMaximized")]
    pub is_maximized: bool,
    #[serde(rename = "isFullScreen")]
    pub is_full_screen: bool,
}

/// One live reading of the window, in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowObservation {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub is_maximized: bool,
    pub is_full_screen: bool,
    pub is_minimized: bool,
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
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    areas: &[WorkArea],
) -> bool {
    areas.iter().any(|area| {
        x + width > f64::from(area.x)
            && x < f64::from(area.x + area.width)
            && y + height > f64::from(area.y)
            && y < f64::from(area.y + area.height)
    })
}

fn clamp_to_min(width: f64, height: f64) -> (f64, f64) {
    (
        width.max(MIN_WINDOW_WIDTH),
        height.max(MIN_WINDOW_HEIGHT),
    )
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
        width,
        height,
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
    (state.width, state.height) = clamp_to_min(state.width, state.height);
    if let (Some(x), Some(y)) = (
        parsed.x.as_ref().and_then(as_number),
        parsed.y.as_ref().and_then(as_number),
    ) {
        state.x = Some(x);
        state.y = Some(y);
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

/// Folds a live observation into the persisted state.
///
/// The flags always follow the window, but the geometry only does while the
/// window is normal. A maximized/fullscreen window reports the maximized rect,
/// and writing that over the normal bounds is what made un-maximize (and the
/// next launch) restore a full-screen-sized window. Minimized windows report a
/// degenerate rect and drop their maximized flag, so they are ignored
/// entirely.
pub fn state_after_observation(
    previous: &WindowState,
    observed: &WindowObservation,
) -> WindowState {
    if observed.is_minimized {
        return *previous;
    }
    let mut next = WindowState {
        x: Some(observed.x),
        y: Some(observed.y),
        width: observed.width,
        height: observed.height,
        is_maximized: observed.is_maximized,
        is_full_screen: observed.is_full_screen,
    };
    if observed.is_maximized || observed.is_full_screen {
        next.x = previous.x;
        next.y = previous.y;
        next.width = previous.width;
        next.height = previous.height;
    }
    (next.width, next.height) = clamp_to_min(next.width, next.height);
    next
}

/// Pre-2.13.2 files never stored a position, so a file saved while maximized
/// also recorded the maximized size as the normal size. Those bounds are not a
/// real un-maximize target, so fall back to the defaults. Files that carry a
/// position (written since 2.13.2) keep their geometry.
pub fn trusted_normal_bounds(state: WindowState) -> WindowState {
    if (state.is_maximized || state.is_full_screen) && state.x.is_none() {
        WindowState {
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
            ..state
        }
    } else {
        state
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
    fn keeps_fractional_position_and_size() {
        let raw = r#"{"width":1480.5,"height":960.25,"x":100.75,"y":-40.5}"#;
        let state = load_window_state(raw, &area()).unwrap();
        assert_eq!((state.x, state.y), (Some(100.75), Some(-40.5)));
        assert_eq!((state.width, state.height), (1480.5, 960.25));
    }

    #[test]
    fn legacy_state_without_position_parses() {
        let state = load_window_state(r#"{"width":1557,"height":897}"#, &area()).unwrap();
        assert_eq!((state.x, state.y), (None, None));
        assert_eq!((state.width, state.height), (1557.0, 897.0));
        assert!(!state.is_maximized);
        assert!(!state.is_full_screen);
    }

    #[test]
    fn keeps_on_screen_position_and_drops_off_screen() {
        let on_screen =
            load_window_state(r#"{"width":1480,"height":960,"x":100,"y":100}"#, &area())
                .unwrap();
        assert_eq!((on_screen.x, on_screen.y), (Some(100.0), Some(100.0)));
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

    #[test]
    fn trusted_normal_bounds_drops_legacy_maximized_size() {
        let legacy = WindowState {
            x: None,
            y: None,
            width: 2560.0,
            height: 1440.0,
            is_maximized: true,
            is_full_screen: false,
        };
        let state = trusted_normal_bounds(legacy);
        assert_eq!((state.width, state.height), (DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));
        assert!(state.is_maximized);
    }

    #[test]
    fn trusted_normal_bounds_keeps_positioned_geometry() {
        let state = trusted_normal_bounds(WindowState {
            is_maximized: true,
            ..normal_state()
        });
        assert_eq!((state.x, state.y), (Some(120.0), Some(80.0)));
        assert_eq!((state.width, state.height), (1400.0, 900.0));
    }

    #[test]
    fn trusted_normal_bounds_keeps_legacy_plain_size() {
        let legacy = WindowState {
            x: None,
            y: None,
            width: 1557.0,
            height: 897.0,
            is_maximized: false,
            is_full_screen: false,
        };
        assert_eq!(trusted_normal_bounds(legacy), legacy);
    }

    fn observation(x: f64, y: f64, width: f64, height: f64) -> WindowObservation {
        WindowObservation {
            x,
            y,
            width,
            height,
            is_maximized: false,
            is_full_screen: false,
            is_minimized: false,
        }
    }

    fn normal_state() -> WindowState {
        WindowState {
            x: Some(120.0),
            y: Some(80.0),
            width: 1400.0,
            height: 900.0,
            is_maximized: false,
            is_full_screen: false,
        }
    }

    #[test]
    fn normal_observation_replaces_geometry() {
        let next = state_after_observation(&normal_state(), &observation(300.5, 210.5, 1300.0, 800.0));
        assert_eq!((next.x, next.y), (Some(300.5), Some(210.5)));
        assert_eq!((next.width, next.height), (1300.0, 800.0));
    }

    #[test]
    fn maximized_observation_keeps_normal_geometry() {
        let next = state_after_observation(
            &normal_state(),
            &WindowObservation {
                is_maximized: true,
                ..observation(0.0, 0.0, 1920.0, 1040.0)
            },
        );
        assert!(next.is_maximized);
        assert_eq!((next.x, next.y), (Some(120.0), Some(80.0)));
        assert_eq!((next.width, next.height), (1400.0, 900.0));
    }

    #[test]
    fn fullscreen_observation_keeps_normal_geometry() {
        let next = state_after_observation(
            &normal_state(),
            &WindowObservation {
                is_full_screen: true,
                ..observation(0.0, 0.0, 1920.0, 1080.0)
            },
        );
        assert!(next.is_full_screen);
        assert!(!next.is_maximized);
        assert_eq!((next.x, next.y), (Some(120.0), (Some(80.0))));
        assert_eq!((next.width, next.height), (1400.0, 900.0));
    }

    #[test]
    fn minimized_observation_is_ignored() {
        let previous = WindowState {
            is_maximized: true,
            ..normal_state()
        };
        let next = state_after_observation(
            &previous,
            &WindowObservation {
                is_minimized: true,
                ..observation(0.0, 0.0, 160.0, 28.0)
            },
        );
        assert_eq!(next, previous);
    }

    #[test]
    fn state_after_observation_clamps_geometry_to_minimum() {
        let next = state_after_observation(&normal_state(), &observation(10.0, 10.0, 100.0, 50.0));
        assert_eq!(next.width, MIN_WINDOW_WIDTH);
        assert_eq!(next.height, MIN_WINDOW_HEIGHT);
    }
}
