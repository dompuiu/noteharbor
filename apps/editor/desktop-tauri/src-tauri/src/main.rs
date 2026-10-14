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
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use editor_desktop_tauri::{chrome, data_dir, paths, prefs, server, urls, window_state};
use tauri::{Manager, WebviewUrl};
use tauri_plugin_opener::OpenerExt;

/// JS bridge injected before any page script runs. Defines the
/// `window.noteHarborDesktop` surface the UI reads (`appMode.js`,
/// `photoSize.js`, `NoteEditForm.jsx`), backed by Tauri `invoke`.
/// `showNoteEditorTextMenu` is intentionally absent: without it
/// the UI keeps the WebView's native context menu (see ticket resolution).
const DESKTOP_BRIDGE_JS: &str = r#"
if (window.__TAURI__ && !window.noteHarborDesktop) {
  const invoke = window.__TAURI__.core.invoke;
  window.noteHarborDesktop = {
    getScrapeBrowserStatus: () => invoke('get_scrape_browser_status'),
    openScrapeBrowser: () => invoke('open_scrape_browser'),
    getShowcasePhotoSize: () => invoke('get_showcase_photo_size'),
    setShowcasePhotoSize: (photoSize) => invoke('set_showcase_photo_size', { value: photoSize }),
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
    window_state::parse_window_state(&raw).unwrap_or(fallback)
}

fn window_position_is_visible(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    window: &tauri::WebviewWindow,
) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return false;
    };
    let areas: Vec<window_state::WorkArea> = monitors
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor().max(1.0);
            let position = monitor.position();
            let size = monitor.size();
            window_state::WorkArea {
                x: (f64::from(position.x) / scale).round() as i32,
                y: (f64::from(position.y) / scale).round() as i32,
                width: (f64::from(size.width) / scale).round() as i32,
                height: (f64::from(size.height) / scale).round() as i32,
            }
        })
        .collect();
    window_state::is_window_visible_on_any_display(x, y, width, height, &areas)
}

fn save_window_state_for_window(window: &tauri::WebviewWindow) {
    let state_path = app_data_file(
        window.app_handle(),
        window_state::WINDOW_STATE_FILENAME,
    );
    // `inner_size` is physical pixels; the builder takes logical ones, so
    // scale back for a HiDPI-stable restore. Tauri exposes no normal-bounds
    // API, so a maximized save restores as a large plain window (recorded gap).
    let scale = window.scale_factor().unwrap_or(1.0).max(1.0);
    let (width, height) = window
        .inner_size()
        .map(|size| {
            (
                (f64::from(size.width) / scale).round() as i32,
                (f64::from(size.height) / scale).round() as i32,
            )
        })
        .unwrap_or((
            window_state::DEFAULT_WINDOW_WIDTH,
            window_state::DEFAULT_WINDOW_HEIGHT,
        ));
    let state = window_state::WindowState {
        x: None,
        y: None,
        width: width.max(window_state::MIN_WINDOW_WIDTH),
        height: height.max(window_state::MIN_WINDOW_HEIGHT),
        is_maximized: window.is_maximized().unwrap_or(false),
        is_full_screen: window.is_fullscreen().unwrap_or(false),
    };
    if let Some(parent) = state_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(body) = serde_json::to_string(&state) {
        let _ = std::fs::write(&state_path, body);
    }
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
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new(&chrome_path);
        command.creation_flags(0x00000008 /* DETACHED_PROCESS */);
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
    let run = tokio::process::Command::new(program).args(args).output();
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_scrape_browser_status,
            open_scrape_browser,
            get_showcase_photo_size,
            set_showcase_photo_size
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
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(app_url.parse().map_err(|e| format!("bad app url: {e:?}"))?),
            )
            .title("Note Harbor Editor")
            .inner_size(f64::from(saved.width), f64::from(saved.height))
            .min_inner_size(
                f64::from(window_state::MIN_WINDOW_WIDTH),
                f64::from(window_state::MIN_WINDOW_HEIGHT),
            )
            .visible(false)
            .initialization_script(DESKTOP_BRIDGE_JS)
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
            if saved.is_full_screen {
                builder = builder.fullscreen(true);
            } else if saved.is_maximized {
                builder = builder.maximized(true);
            }
            let window = builder.build()?;
            // Saved positions restore only when visible on a current monitor,
            // mirroring `isWindowVisibleOnAnyDisplay()` in `main.js`.
            if let (Some(x), Some(y)) = (saved.x, saved.y) {
                if window_position_is_visible(x, y, saved.width, saved.height, &window) {
                    let _ = window.set_position(tauri::Position::Logical(
                        tauri::LogicalPosition {
                            x: f64::from(x),
                            y: f64::from(y),
                        },
                    ));
                }
            }
            // Saves run synchronously on each event: the payload is a small
            // JSON write and correctness (state survives a crash) beats
            // write coalescing here.
            let persist_window = window.clone();
            window.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::Moved(_)
                        | tauri::WindowEvent::CloseRequested { .. }
                ) {
                    save_window_state_for_window(&persist_window);
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
