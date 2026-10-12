//! External-URL guard parity with `isExternalUrl()` in `main.js`.
//!
//! Same-origin navigations stay in the WebView (this is what keeps the
//! `assignLocation` seam working: post-import redirects are same-origin
//! `window.location.assign()` calls, never hard reloads). Anything else with
//! an `http(s)`-style scheme opens in the system browser.

const LOCAL_SCHEMES: [&str; 3] = ["about", "data", "javascript"];

/// Returns true when `url` should open externally rather than navigate the
/// WebView. Relative URLs and parse failures return false (in-page).
pub fn is_external_url(url: &str, app_url: &str) -> bool {
    let parsed = match url::Url::parse(url) {
        Ok(parsed) => parsed,
        Err(_) => return false,
    };
    let app = match url::Url::parse(app_url) {
        Ok(app) => app,
        Err(_) => return false,
    };
    if parsed.origin() == app.origin() {
        return false;
    }
    !LOCAL_SCHEMES.contains(&parsed.scheme())
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: &str = "http://127.0.0.1:1234/";

    #[test]
    fn same_origin_stays_in_webview() {
        assert!(!is_external_url("http://127.0.0.1:1234/catalog", APP));
        assert!(!is_external_url("/catalog", APP));
    }

    #[test]
    fn cross_origin_http_opens_externally() {
        assert!(is_external_url("https://example.com/", APP));
        assert!(is_external_url("http://127.0.0.1:9999/", APP));
    }

    #[test]
    fn local_schemes_never_open_externally() {
        assert!(!is_external_url("about:blank", APP));
        assert!(!is_external_url("data:text/plain,hi", APP));
        assert!(!is_external_url("javascript:void(0)", APP));
    }
}
