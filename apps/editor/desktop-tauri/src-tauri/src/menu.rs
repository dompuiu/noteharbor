//! Window menu-bar visibility: `autoHideMenuBar: true` parity with
//! `desktop-electron/src/main.js` (Windows and Linux only — on macOS the
//! menu is app-wide and always visible).

/// Whether the menu bar starts hidden on `platform` (`"win32"`, `"darwin"`,
/// or `"linux"`, matching `current_platform()` in `main.rs`). A solitary Alt
/// press in the page toggles it back via `toggle_menu_bar`.
pub fn menu_starts_hidden(platform: &str) -> bool {
    platform != "darwin"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_starts_hidden_everywhere_but_macos() {
        assert!(menu_starts_hidden("win32"));
        assert!(menu_starts_hidden("linux"));
        assert!(!menu_starts_hidden("darwin"));
    }
}
