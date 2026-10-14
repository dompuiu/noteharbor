//! Chrome CDP launcher.
//!
//! The server (`server-rust`) only *attaches* to a CDP endpoint; launching
//! the browser is shell-side and stays Win/macOS-only, with the same env
//! contract (`NOTE_HARBOR_BROWSER_CDP_URL`, `NOTE_HARBOR_CHROME_PATH`).

use std::path::Path;

pub const DEFAULT_CHROME_CDP_URL: &str = "http://127.0.0.1:9222";
pub const DEFAULT_CHROME_CDP_PORT: u16 = 9222;
pub const DEFAULT_CHROME_CDP_ADDRESS: &str = "0.0.0.0";
pub const UNSUPPORTED_PLATFORM_MESSAGE: &str =
    "Launching the scrape browser is currently supported only on Windows and macOS.";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ScrapeBrowserStatus {
    pub supported: bool,
    pub available: bool,
    pub launching: bool,
    pub error: Option<String>,
}

impl ScrapeBrowserStatus {
    pub fn unsupported() -> Self {
        Self {
            supported: false,
            available: false,
            launching: false,
            error: Some(UNSUPPORTED_PLATFORM_MESSAGE.to_owned()),
        }
    }
}

/// Resolves the CDP URL: trimmed env override or the default.
pub fn chrome_cdp_url(env_value: Option<&str>) -> String {
    match env_value.map(str::trim) {
        Some(value) if !value.is_empty() => value.to_owned(),
        _ => DEFAULT_CHROME_CDP_URL.to_owned(),
    }
}

/// Mirrors `getChromeCdpPort()`: the CDP URL's explicit port or the default
/// (`new URL().port` is empty for default ports, hence `port()`).
pub fn chrome_cdp_port(cdp_url: &str) -> u16 {
    url::Url::parse(cdp_url)
        .ok()
        .and_then(|parsed| parsed.port())
        .unwrap_or(DEFAULT_CHROME_CDP_PORT)
}

/// Platform candidates for the scrape-browser executable.
/// The platform vocabulary is `win32`/`darwin` (anything else gets no
/// candidates). `home_dir` is injected (tests) instead of read from the OS.
pub fn chrome_candidate_paths(platform: &str, home_dir: Option<&str>) -> Vec<String> {
    match platform {
        "win32" => vec![
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe".to_owned(),
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe".to_owned(),
        ],
        "darwin" => {
            let mut paths = vec![
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".to_owned(),
            ];
            if let Some(home) = home_dir {
                paths.push(format!(
                    "{home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
                ));
            }
            paths
        }
        _ => Vec::new(),
    }
}

pub fn is_scrape_browser_supported(platform: &str) -> bool {
    matches!(platform, "win32" | "darwin")
}

/// Mirrors `resolveChromeExecutablePath()`: platform candidates first, then
/// `NOTE_HARBOR_CHROME_PATH`. `exists` is injected so tests avoid the FS.
pub fn resolve_chrome_executable_path(
    candidates: &[String],
    configured_path: Option<&str>,
    exists: &dyn Fn(&str) -> bool,
) -> Result<String, String> {
    for candidate in candidates {
        if exists(candidate) {
            return Ok(candidate.clone());
        }
    }
    if let Some(configured) = configured_path.map(str::trim).filter(|v| !v.is_empty()) {
        if exists(configured) {
            return Ok(configured.to_owned());
        }
    }
    let mut lines = vec!["Chrome could not be found.".to_owned(), "Checked:".to_owned()];
    for candidate in candidates {
        lines.push(format!("- {candidate}"));
    }
    match configured_path.map(str::trim).filter(|v| !v.is_empty()) {
        Some(configured) => lines.push(format!("- {configured} (NOTE_HARBOR_CHROME_PATH)")),
        None => lines.push(
            "Set NOTE_HARBOR_CHROME_PATH to override the executable path.".to_owned(),
        ),
    }
    Err(lines.join("\n"))
}

/// Spawn args for opening the scrape browser.
pub fn chrome_launch_args(port: u16, address: &str, user_data_dir: &Path) -> Vec<String> {
    vec![
        format!("--remote-debugging-port={port}"),
        format!("--remote-debugging-address={address}"),
        format!("--user-data-dir={}", user_data_dir.display()),
    ]
}

/// Best-effort OS command that raises the scrape browser window (scoped to
/// the `noteharbor-cdp` Chrome profile so the user's normal Chrome windows
/// stay put). Single implementation in `editor_server_rust::scrape`, shared
/// by the embedded server's fetch flow and the shell's post-launch focus.
pub use editor_server_rust::scrape::scrape_browser_focus_command as chrome_focus_command;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn exists_set<'a>(paths: &'a [&str]) -> impl Fn(&str) -> bool + 'a {
        let set: HashSet<String> = paths.iter().map(|p| p.to_string()).collect();
        move |p: &str| set.contains(p)
    }

    #[test]
    fn cdp_url_defaults_and_trims() {
        assert_eq!(chrome_cdp_url(None), DEFAULT_CHROME_CDP_URL);
        assert_eq!(chrome_cdp_url(Some("   ")), DEFAULT_CHROME_CDP_URL);
        assert_eq!(
            chrome_cdp_url(Some("  http://localhost:9333  ")),
            "http://localhost:9333"
        );
    }

    #[test]
    fn cdp_port_parses_or_defaults() {
        assert_eq!(chrome_cdp_port("http://127.0.0.1:9222"), 9222);
        assert_eq!(chrome_cdp_port("http://localhost:9333"), 9333);
        assert_eq!(chrome_cdp_port("http://localhost"), DEFAULT_CHROME_CDP_PORT);
        assert_eq!(chrome_cdp_port("not a url"), DEFAULT_CHROME_CDP_PORT);
    }

    #[test]
    fn platform_support_matches_win_mac_gate() {
        // Exact `process.platform` vocabulary: no `windows`/`macos` aliases.
        assert!(is_scrape_browser_supported("win32"));
        assert!(is_scrape_browser_supported("darwin"));
        assert!(!is_scrape_browser_supported("windows"));
        assert!(!is_scrape_browser_supported("macos"));
        assert!(!is_scrape_browser_supported("linux"));
        assert_eq!(
            ScrapeBrowserStatus::unsupported().error.as_deref(),
            Some(UNSUPPORTED_PLATFORM_MESSAGE)
        );
    }

    #[test]
    fn candidate_paths_mirror_main_js() {
        assert_eq!(chrome_candidate_paths("linux", None), Vec::<String>::new());
        let win = chrome_candidate_paths("win32", None);
        assert!(win.iter().any(|p| p.contains("Program Files (x86)")));
        let mac = chrome_candidate_paths("darwin", Some("/Users/a"));
        assert_eq!(mac.len(), 2);
        assert!(mac[1].starts_with("/Users/a/Applications"));
    }

    #[test]
    fn resolve_prefers_candidates_then_configured() {
        let candidates = vec!["/a/chrome".to_owned(), "/b/chrome".to_owned()];
        let exists = exists_set(&["/b/chrome", "/custom/chrome"]);
        assert_eq!(
            resolve_chrome_executable_path(&candidates, Some("/custom/chrome"), &exists),
            Ok("/b/chrome".to_owned())
        );
        let exists = exists_set(&["/custom/chrome"]);
        assert_eq!(
            resolve_chrome_executable_path(&candidates, Some("/custom/chrome"), &exists),
            Ok("/custom/chrome".to_owned())
        );
    }

    #[test]
    fn resolve_error_lists_checked_and_hint() {
        let candidates = vec!["/a/chrome".to_owned()];
        let exists = exists_set(&[]);
        let error =
            resolve_chrome_executable_path(&candidates, None, &exists).expect_err("missing");
        assert!(error.contains("Chrome could not be found."));
        assert!(error.contains("- /a/chrome"));
        assert!(error.contains("NOTE_HARBOR_CHROME_PATH"));
    }

    #[test]
    fn launch_args_mirror_detached_chrome_flags() {
        let args = chrome_launch_args(9222, DEFAULT_CHROME_CDP_ADDRESS, Path::new("/tmp/x"));
        assert_eq!(
            args,
            vec![
                "--remote-debugging-port=9222".to_owned(),
                "--remote-debugging-address=0.0.0.0".to_owned(),
                "--user-data-dir=/tmp/x".to_owned(),
            ]
        );
    }

    #[test]
    fn focus_command_targets_only_the_scrape_browser_profile() {
        let (program, args) = chrome_focus_command("win32").expect("windows focus");
        assert_eq!(program, "powershell");
        let script = args.last().expect("script arg");
        assert!(script.contains("noteharbor-cdp"), "{script}");
        let (program, args) = chrome_focus_command("darwin").expect("mac focus");
        assert_eq!(program, "sh");
        assert!(args.iter().any(|arg| arg.contains("noteharbor-cdp")));
        assert_eq!(chrome_focus_command("linux"), None);
    }
}
