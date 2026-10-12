// Single seam for full-page navigation (post-import and post-clear redirects).
// Tests mock this module instead of redefining window.location, which shared
// test environments forbid. A future shell (e.g. Tauri) can also intercept
// here instead of letting every screen hard-navigate the WebView.
export function assignLocation(url) {
  window.location.assign(url);
}
