#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Tauri shell entry: embeds `server-rust` on 127.0.0.1:0 and loads it in a
// WebView.
//
// Navigation stays inside the WebView at the embedded http:// URL, so the
// UI's `assignLocation` seam (`ui-react/src/lib/navigation.js`) keeps working
// unchanged: same-origin `window.location.assign()` calls never leave the
// page and are never intercepted. Only cross-origin navigations are
// cancelled and opened in the system browser.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use editor_desktop_tauri::{chrome, data_dir, paths, prefs, server, urls, window_state};
use tauri::{Manager, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

/// JS bridge injected before any page script runs. Defines the
/// `window.noteHarborDesktop` surface the UI reads (`appMode.js`,
/// `photoSize.js`, `catalogLayout.js`, `NoteEditForm.jsx`), backed by Tauri
/// `invoke`.
/// `showNoteEditorTextMenu` is intentionally absent: without it
/// the UI keeps the WebView's native context menu (see ticket resolution).
/// A solitary Alt press is cancelled because the shell has no menu bar: on
/// Windows it would otherwise enter system-menu mode and pull keyboard focus
/// out of the WebView. Alt combinations still reach the page.
const DESKTOP_BRIDGE_JS: &str = r#"
if (window.__TAURI__ && !window.noteHarborDesktopAltGuard) {
  window.noteHarborDesktopAltGuard = true;
  const cancelLoneAlt = (event) => {
    if (event.key === 'Alt' && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      event.preventDefault();
    }
  };
  window.addEventListener('keydown', cancelLoneAlt, true);
  window.addEventListener('keyup', cancelLoneAlt, true);
}
if (window.__TAURI__ && !window.noteHarborDesktop) {
  const invoke = window.__TAURI__.core.invoke;
  window.noteHarborDesktop = {
    getScrapeBrowserStatus: () => invoke('get_scrape_browser_status'),
    openScrapeBrowser: () => invoke('open_scrape_browser'),
    getShowcasePhotoSize: () => invoke('get_showcase_photo_size'),
    setShowcasePhotoSize: (photoSize) => invoke('set_showcase_photo_size', { value: photoSize }),
    getShowcaseCatalogLayout: () => invoke('get_showcase_catalog_layout'),
    setShowcaseCatalogLayout: (catalogLayout) => invoke('set_showcase_catalog_layout', { value: catalogLayout }),
    getLastVisitedRoute: () => invoke('get_last_visited_route'),
    setLastVisitedRoute: (route) => invoke('set_last_visited_route', { value: route }),
  };
}
"#;

struct ShellState {
    scrape_launching: AtomicBool,
}

fn app_data_file(app: &tauri::AppHandle, filename: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(filename))
        .unwrap_or_else(|_| PathBuf::from(filename))
}

fn desktop_preferences_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_file(app, prefs::DESKTOP_PREFERENCES_FILENAME)
}

fn window_state_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_file(app, window_state::WINDOW_STATE_FILENAME)
}

fn current_platform() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

fn home_dir() -> Option<String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
}

/// Mirrors `resolveBundledDataDir()`: packaged resource dirs first, then the
/// repo `data/` dir used in dev.
pub fn resolve_bundled_data_dir(resource_dir: Option<&Path>) -> PathBuf {
    paths::resolve_bundled_data_dir(
        resource_dir,
        &editor_server_rust::ServerConfig::default_data_dir(),
    )
}

/// Where the embedded server's static UI comes from: explicit env first,
/// then the packaged `web-dist` resource, then the dev `ui-react/dist`.
pub fn resolve_web_dist_dir(resource_dir: Option<&Path>) -> PathBuf {
    let env_override = std::env::var("NOTE_HARBOR_WEB_DIST_DIR").ok().map(PathBuf::from);
    paths::resolve_web_dist_dir(
        env_override.as_deref(),
        resource_dir,
        &editor_server_rust::ServerConfig::default_web_dist_dir(),
    )
}

fn read_saved_window_state(app: &tauri::AppHandle) -> window_state::WindowState {
    let fallback = window_state::default_window_state();
    let raw = match std::fs::read_to_string(window_state_path(app)) {
        Ok(raw) => raw,
        Err(_) => return fallback,
    };
    // The on-any-display guard runs after the window exists (monitors are
    // queryable there); here the position restores unfiltered. A fully
    // off-screen restore after a monitor change is dropped post-build.
    window_state::parse_window_state(&raw)
        .map(window_state::trusted_normal_bounds)
        .unwrap_or(fallback)
}

/// The window's current DPI scale factor, guarding only against the
/// unreadable (`0`) case: fractional factors below 1 are legitimate.
fn window_scale(window: &tauri::WebviewWindow) -> f64 {
    match window.scale_factor() {
        Ok(scale) if scale > 0.0 => scale,
        _ => 1.0,
    }
}

fn window_position_is_visible(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    window: &tauri::WebviewWindow,
) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return false;
    };
    // Saved geometry is logical; `Monitor::position`/`size` are physical on
    // every platform, so scale the saved rect up into the physical space the
    // monitors report. This is exact on a single-DPI setup; with mixed DPI it
    // is an approximation, since the saved rect was expressed at the window's
    // then-current factor.
    let scale = window_scale(window);
    let areas: Vec<window_state::WorkArea> = monitors
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            window_state::WorkArea {
                x: position.x,
                y: position.y,
                width: size.width as i32,
                height: size.height as i32,
            }
        })
        .collect();
    window_state::is_window_visible_on_any_display(
        x * scale,
        y * scale,
        width * scale,
        height * scale,
        &areas,
    )
}

fn write_window_state(app: &tauri::AppHandle, state: &window_state::WindowState) {
    let state_path = app_data_file(app, window_state::WINDOW_STATE_FILENAME);
    if let Some(parent) = state_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(body) = serde_json::to_string(state) {
        let _ = std::fs::write(&state_path, body);
    }
}

/// Reads the window's current geometry and flags. `outer_position` and
/// `inner_size` are physical pixels; the builder and `set_position` take
/// logical ones, so scale back for a HiDPI-stable restore. Keeping the
/// fraction (instead of rounding to whole pixels) avoids a few px of drift on
/// 125%/150% displays.
fn observe_window(window: &tauri::WebviewWindow) -> Option<window_state::WindowObservation> {
    let (position, size) = (window.outer_position().ok()?, window.inner_size().ok()?);
    let scale = window_scale(window);
    Some(window_state::WindowObservation {
        x: f64::from(position.x) / scale,
        y: f64::from(position.y) / scale,
        width: f64::from(size.width) / scale,
        height: f64::from(size.height) / scale,
        is_maximized: window.is_maximized().unwrap_or(false),
        is_full_screen: window.is_fullscreen().unwrap_or(false),
        is_minimized: window.is_minimized().unwrap_or(false),
    })
}

fn save_window_state_for_window(
    window: &tauri::WebviewWindow,
    persisted: &Mutex<window_state::WindowState>,
) {
    // A window that is gone enough that either read fails keeps the last good
    // state already on disk.
    let Some(observed) = observe_window(window) else {
        return;
    };
    let mut state = persisted
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let next = window_state::state_after_observation(&state, &observed);
    *state = next;
    write_window_state(window.app_handle(), &state);
}

async fn is_scrape_browser_available() -> bool {
    let cdp_url =
        chrome::chrome_cdp_url(std::env::var("NOTE_HARBOR_BROWSER_CDP_URL").ok().as_deref());
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        editor_server_rust::scrape::probe_cdp_version(&cdp_url),
    )
    .await
    .ok()
    .is_some_and(|result| result.is_ok())
}

#[tauri::command]
async fn get_scrape_browser_status(
    state: tauri::State<'_, Arc<ShellState>>,
) -> Result<chrome::ScrapeBrowserStatus, String> {
    if !chrome::is_scrape_browser_supported(current_platform()) {
        return Ok(chrome::ScrapeBrowserStatus::unsupported());
    }
    Ok(chrome::ScrapeBrowserStatus {
        supported: true,
        available: is_scrape_browser_available().await,
        launching: state.scrape_launching.load(Ordering::SeqCst),
        error: None,
    })
}

#[tauri::command]
async fn open_scrape_browser(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<ShellState>>,
) -> Result<chrome::ScrapeBrowserStatus, String> {
    if !chrome::is_scrape_browser_supported(current_platform()) {
        return Ok(chrome::ScrapeBrowserStatus::unsupported());
    }
    if is_scrape_browser_available().await {
        return Ok(chrome::ScrapeBrowserStatus {
            supported: true,
            available: true,
            launching: false,
            error: None,
        });
    }
    if state.scrape_launching.swap(true, Ordering::SeqCst) {
        return Ok(chrome::ScrapeBrowserStatus {
            supported: true,
            available: false,
            launching: true,
            error: None,
        });
    }
    let result = launch_scrape_browser(&app).await;
    state.scrape_launching.store(false, Ordering::SeqCst);
    Ok(result)
}

async fn launch_scrape_browser(app: &tauri::AppHandle) -> chrome::ScrapeBrowserStatus {
    let cdp_url =
        chrome::chrome_cdp_url(std::env::var("NOTE_HARBOR_BROWSER_CDP_URL").ok().as_deref());
    let candidates = chrome::chrome_candidate_paths(current_platform(), home_dir().as_deref());
    let configured = std::env::var("NOTE_HARBOR_CHROME_PATH").ok();
    let chrome_path = match chrome::resolve_chrome_executable_path(
        &candidates,
        configured.as_deref(),
        &|p| Path::new(p).exists(),
    ) {
        Ok(path) => path,
        Err(error) => {
            return chrome::ScrapeBrowserStatus {
                supported: true,
                available: false,
                launching: false,
                error: Some(error),
            };
        }
    };
    let user_data_dir = app
        .path()
        .temp_dir()
        .map(|dir| dir.join("noteharbor-cdp"))
        .unwrap_or_else(|_| std::env::temp_dir().join("noteharbor-cdp"));
    if let Err(error) = std::fs::create_dir_all(&user_data_dir) {
        return chrome::ScrapeBrowserStatus {
            supported: true,
            available: false,
            launching: false,
            error: Some(error.to_string()),
        };
    }
    let args = chrome::chrome_launch_args(
        chrome::chrome_cdp_port(&cdp_url),
        chrome::DEFAULT_CHROME_CDP_ADDRESS,
        &user_data_dir,
    );
    // Detached launch, mirroring `detached: true, stdio: 'ignore'` + unref().
    // CREATE_NO_WINDOW keeps helper/console children from flashing a prompt.
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new(&chrome_path);
        command.creation_flags(0x0800_0008 /* CREATE_NO_WINDOW | DETACHED_PROCESS */);
        command
    };
    #[cfg(not(windows))]
    let mut command = std::process::Command::new(&chrome_path);
    match command
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(_) => {
            // A fresh Chrome window opens behind the Editor on some systems;
            // raise it best-effort so bot checks are visible. Failures are
            // ignored: scraping still succeeds.
            focus_scrape_browser_window().await;
            chrome::ScrapeBrowserStatus {
                supported: true,
                available: is_scrape_browser_available().await,
                launching: false,
                error: None,
            }
        }
        Err(error) => chrome::ScrapeBrowserStatus {
            supported: true,
            available: false,
            launching: false,
            error: Some(error.to_string()),
        },
    }
}

/// Best-effort Chrome OS-window focus after a shell-side launch (mirrors the
/// server's `focus_scrape_browser_window` during `fetch_html`).
async fn focus_scrape_browser_window() {
    let Some((program, args)) = chrome::chrome_focus_command(current_platform()) else {
        return;
    };
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    // Hide the helper console: without CREATE_NO_WINDOW, spawning
    // powershell.exe flashes a visible prompt on every launch/focus.
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000 /* CREATE_NO_WINDOW */);
    let run = cmd.output();
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), run).await;
}

#[tauri::command]
fn get_showcase_photo_size(app: tauri::AppHandle) -> String {
    prefs::read_showcase_photo_size(&desktop_preferences_path(&app))
}

#[tauri::command]
fn set_showcase_photo_size(app: tauri::AppHandle, value: String) -> String {
    let path = desktop_preferences_path(&app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    prefs::write_showcase_photo_size(&path, &value).unwrap_or(value)
}

#[tauri::command]
fn get_showcase_catalog_layout(app: tauri::AppHandle) -> String {
    prefs::read_showcase_catalog_layout(&desktop_preferences_path(&app))
}

#[tauri::command]
fn set_showcase_catalog_layout(app: tauri::AppHandle, value: String) -> String {
    let path = desktop_preferences_path(&app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    prefs::write_showcase_catalog_layout(&path, &value).unwrap_or(value)
}

#[tauri::command]
fn get_last_visited_route(app: tauri::AppHandle) -> Option<String> {
    prefs::read_last_visited_route(&desktop_preferences_path(&app))
}

#[tauri::command]
fn set_last_visited_route(app: tauri::AppHandle, value: String) -> Option<String> {
    let path = desktop_preferences_path(&app);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    prefs::write_last_visited_route(&path, &value)
        .ok()
        .flatten()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_scrape_browser_status,
            open_scrape_browser,
            get_showcase_photo_size,
            set_showcase_photo_size,
            get_showcase_catalog_layout,
            set_showcase_catalog_layout,
            get_last_visited_route,
            set_last_visited_route
        ])
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let data_dir = data_dir::ensure_data_dir(
                &resolve_bundled_data_dir(resource_dir.as_deref()),
                &app
                    .path()
                    .app_data_dir()
                    .map(|dir| dir.join("data"))
                    .unwrap_or_else(|_| PathBuf::from("data")),
            )
            .map_err(|error| format!("cannot prepare data dir: {error}"))?;
            let web_dist_dir = resolve_web_dist_dir(resource_dir.as_deref());
            let (app_url, _server) =
                tauri::async_runtime::block_on(server::start_embedded_server(data_dir, web_dist_dir))
                    .map_err(|error| error.to_string())?;
            // Dev-only: in release `windows_subsystem = "windows"` detaches
            // the console, so logging here would open a cmd window on Windows.
            #[cfg(debug_assertions)]
            eprintln!("Note Harbor Editor shell serving at {app_url}");
            app.manage(Arc::new(ShellState {
                scrape_launching: AtomicBool::new(false),
            }));

            let saved = read_saved_window_state(app.handle());
            let opener = app.handle().clone();
            let navigation_app_url = app_url.clone();
            // The last visited page restores like the window position: the
            // saved route becomes the WebView's initial URL, so the next
            // launch opens where the previous session left off.
            let initial_url = prefs::initial_app_url(
                &app_url,
                prefs::read_last_visited_route(&desktop_preferences_path(app.handle())).as_deref(),
            );
            let builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(
                    initial_url
                        .parse()
                        .map_err(|e| format!("bad app url: {e:?}"))?,
                ),
            )
            .title("Note Harbor Editor")
            .inner_size(saved.width, saved.height)
            .min_inner_size(
                window_state::MIN_WINDOW_WIDTH,
                window_state::MIN_WINDOW_HEIGHT,
            )
            .visible(false)
            .initialization_script(DESKTOP_BRIDGE_JS)
            // Tauri's webview-level file-drop handler swallows dragover/drop
            // before the page sees them, which breaks the table's HTML5 row
            // reorder (stuck insertion line, drop disallowed) and the
            // import screen's archive dropzone in the desktop app. Nothing
            // in the shell consumes Tauri file-drop events — both features
            // use page-level handlers — so the handler stays off.
            .disable_drag_drop_handler()
            .on_navigation(move |url| {
                if urls::is_external_url(url.as_str(), &navigation_app_url) {
                    let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    return false;
                }
                true
            })
            .on_page_load(|window, payload| {
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                    let _ = window.show();
                }
            });
            let window = builder.build()?;
            // Restore geometry while the window is still hidden, then apply
            // maximize/fullscreen. The window is created at the stored normal
            // bounds so Windows remembers those as the un-maximize target;
            // creating it already maximized makes the restored size the new
            // "normal" bounds, which left un-maximize at full-screen size.
            let mut persisted_state = saved;
            let mut position_restored = false;
            if let (Some(x), Some(y)) = (saved.x, saved.y) {
                if window_position_is_visible(x, y, saved.width, saved.height, &window) {
                    position_restored = window
                        .set_position(tauri::Position::Logical(tauri::LogicalPosition {
                            x,
                            y,
                        }))
                        .is_ok();
                }
            }
            if !position_restored {
                // No usable saved position (first run, legacy file, or an
                // unplugged monitor): remember where the OS put the window.
                // Otherwise a later save while maximized would keep pinning a
                // position that was never restored, and the window would never
                // relearn its spot.
                if let Some(observed) = observe_window(&window) {
                    persisted_state =
                        window_state::state_after_observation(&saved, &observed);
                }
            }
            if saved.is_full_screen {
                let _ = window.set_fullscreen(true);
            } else if saved.is_maximized {
                let _ = window.maximize();
            }
            // Saves run synchronously on each event: the payload is a small
            // JSON write and correctness (state survives a crash) beats
            // write coalescing here. Attached after the restore steps so any
            // move/resize they queue is handled by the state normalized above;
            // the merge also ignores maximized/fullscreen geometry, so a late
            // event cannot clobber the normal bounds either.
            let persist_window = window.clone();
            let persisted = Mutex::new(persisted_state);
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::Moved(_)
                        | tauri::WindowEvent::CloseRequested { .. }
                ) {
                    save_window_state_for_window(&persist_window, &persisted);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Tauri shell failed to start");
}

fn main() {
    run();
}
