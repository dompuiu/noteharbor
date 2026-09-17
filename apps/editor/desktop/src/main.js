import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, MenuItem, dialog, ipcMain, screen, shell } from 'electron';

app.setName('Note Harbor Editor');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..');
const preloadPath = path.join(__dirname, 'preload.cjs');
const DEFAULT_CHROME_CDP_URL = 'http://127.0.0.1:9222';
const DEFAULT_CHROME_CDP_PORT = '9222';
const DEFAULT_CHROME_CDP_ADDRESS = '0.0.0.0';
const SCRAPE_BROWSER_SUPPORTED_PLATFORMS = new Set(['win32', 'darwin']);
const CHROME_CANDIDATE_PATHS_BY_PLATFORM = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(app.getPath('home'), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  ]
};

function getChromeCandidatePaths() {
  return CHROME_CANDIDATE_PATHS_BY_PLATFORM[process.platform] ?? [];
}

function isScrapeBrowserSupported() {
  return SCRAPE_BROWSER_SUPPORTED_PLATFORMS.has(process.platform);
}

let mainWindow = null;
let serverHandle = null;
let scrapeBrowserLaunchPromise = null;

function getChromeCdpUrl() {
  return process.env.NOTE_HARBOR_BROWSER_CDP_URL?.trim() || DEFAULT_CHROME_CDP_URL;
}

function getChromeCdpPort() {
  try {
    const parsed = new URL(getChromeCdpUrl());
    return parsed.port || DEFAULT_CHROME_CDP_PORT;
  } catch {
    return DEFAULT_CHROME_CDP_PORT;
  }
}

function getChromeUserDataDir() {
  return path.join(app.getPath('temp'), 'noteharbor-cdp');
}

function resolveChromeExecutablePath() {
  const configuredPath = process.env.NOTE_HARBOR_CHROME_PATH?.trim();
  const candidatePaths = getChromeCandidatePaths();

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  throw new Error(
    [
      'Chrome could not be found.',
      'Checked:',
      ...candidatePaths.map((candidate) => `- ${candidate}`),
      configuredPath ? `- ${configuredPath} (NOTE_HARBOR_CHROME_PATH)` : 'Set NOTE_HARBOR_CHROME_PATH to override the executable path.'
    ].join('\n')
  );
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`CDP endpoint responded with HTTP ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(1000, () => {
      req.destroy(new Error('Timed out while checking the CDP endpoint.'));
    });
  });
}

async function isScrapeBrowserAvailable() {
  try {
    const jsonVersionUrl = new URL('/json/version', getChromeCdpUrl()).toString();
    await requestJson(jsonVersionUrl);
    return true;
  } catch {
    return false;
  }
}

async function getScrapeBrowserStatus() {
  if (!isScrapeBrowserSupported()) {
    return {
      supported: false,
      available: false,
      launching: false,
      error: 'Launching the scrape browser is currently supported only on Windows and macOS.'
    };
  }

  return {
    supported: true,
    available: await isScrapeBrowserAvailable(),
    launching: Boolean(scrapeBrowserLaunchPromise),
    error: null
  };
}

async function openScrapeBrowser() {
  if (!isScrapeBrowserSupported()) {
    return {
      supported: false,
      available: false,
      launching: false,
      error: 'Launching the scrape browser is currently supported only on Windows and macOS.'
    };
  }

  if (await isScrapeBrowserAvailable()) {
    return {
      supported: true,
      available: true,
      launching: false,
      error: null
    };
  }

  if (scrapeBrowserLaunchPromise) {
    return scrapeBrowserLaunchPromise;
  }

  scrapeBrowserLaunchPromise = (async () => {
    const chromePath = resolveChromeExecutablePath();
    const userDataDir = getChromeUserDataDir();

    fs.mkdirSync(userDataDir, { recursive: true });

    const child = await new Promise((resolve, reject) => {
      const proc = spawn(
        chromePath,
        [
          `--remote-debugging-port=${getChromeCdpPort()}`,
          `--remote-debugging-address=${DEFAULT_CHROME_CDP_ADDRESS}`,
          `--user-data-dir=${userDataDir}`
        ],
        {
          detached: true,
          stdio: 'ignore'
        }
      );

      proc.once('error', reject);
      proc.once('spawn', () => resolve(proc));
    });

    child.unref();

    return {
      supported: true,
      available: await isScrapeBrowserAvailable(),
      launching: false,
      error: null
    };
  })()
    .catch((error) => ({
      supported: true,
      available: false,
      launching: false,
      error: error.message
    }))
    .finally(() => {
      scrapeBrowserLaunchPromise = null;
    });

  return scrapeBrowserLaunchPromise;
}

function isExternalUrl(url, appUrl) {
  try {
    const parsedUrl = new URL(url);
    const parsedAppUrl = new URL(appUrl);

    if (parsedUrl.origin === parsedAppUrl.origin) {
      return false;
    }

    return !['about:', 'data:', 'javascript:'].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

function openExternalUrl(url, appUrl) {
  if (!isExternalUrl(url, appUrl)) {
    return false;
  }

  void shell.openExternal(url).catch((error) => {
    console.error(error);
  });

  return true;
}

function showNoteEditorTextMenu(window, options = {}) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Cut',
      role: 'cut',
      enabled: Boolean(options.hasSelection)
    },
    {
      label: 'Copy',
      role: 'copy',
      enabled: Boolean(options.hasSelection)
    },
    {
      label: 'Paste',
      role: 'paste'
    },
    {
      type: 'separator'
    },
    {
      label: 'Select All',
      role: 'selectAll'
    }
  ]);

  menu.popup({ window });
}

function resolveBundledDataDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bundled-data');
  }

  return path.join(WORKSPACE_ROOT, 'data');
}

function ensureViewerDataDir() {
  const bundledDataDir = resolveBundledDataDir();
  const targetDataDir = path.join(app.getPath('userData'), 'data');
  const bundledDbPath = path.join(bundledDataDir, 'banknotes.db');
  const targetDbPath = path.join(targetDataDir, 'banknotes.db');

  if (fs.existsSync(bundledDataDir) && fs.existsSync(bundledDbPath)) {
    const bundledDbMtime = fs.statSync(bundledDbPath).mtimeMs;
    const targetDbMtime = fs.existsSync(targetDbPath)
      ? fs.statSync(targetDbPath).mtimeMs
      : -1;

    if (targetDbMtime < bundledDbMtime) {
      fs.mkdirSync(path.dirname(targetDataDir), { recursive: true });
      fs.rmSync(targetDataDir, { recursive: true, force: true });
      fs.cpSync(bundledDataDir, targetDataDir, { recursive: true });
    }
  }

  fs.mkdirSync(targetDataDir, { recursive: true });
  return targetDataDir;
}

async function startEmbeddedServer() {
  const appRoot = app.getAppPath();
  const serverEntry = path.join(appRoot, '.build', 'server', 'src', 'index.js');
  const webDistDir = path.join(appRoot, '.build', 'web-dist');
  const dataDir = ensureViewerDataDir();

  process.env.NOTE_HARBOR_DATA_DIR = dataDir;
  process.env.NOTE_HARBOR_WEB_DIST_DIR = webDistDir;
  process.env.NOTE_HARBOR_SERVE_WEB_DIST = 'true';

  const { startServer } = await import(pathToFileURL(serverEntry).href);
  return startServer({ host: '127.0.0.1', port: 0 });
}

const WINDOW_STATE_FILENAME = 'window-state.json';
const DEFAULT_WINDOW_WIDTH = 1480;
const DEFAULT_WINDOW_HEIGHT = 960;
const MIN_WINDOW_WIDTH = 1100;
const MIN_WINDOW_HEIGHT = 720;

function getWindowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILENAME);
}

function isWindowVisibleOnAnyDisplay(bounds) {
  const { x, y, width, height } = bounds;

  return screen.getAllDisplays().some(({ workArea }) => (
    x + width > workArea.x
    && x < workArea.x + workArea.width
    && y + height > workArea.y
    && y < workArea.y + workArea.height
  ));
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    const parsed = JSON.parse(raw);

    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }

    const state = {
      width: Math.max(Math.round(width), MIN_WINDOW_WIDTH),
      height: Math.max(Math.round(height), MIN_WINDOW_HEIGHT),
      isMaximized: parsed.isMaximized === true,
      isFullScreen: parsed.isFullScreen === true
    };

    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const bounds = { x: Math.round(x), y: Math.round(y), width: state.width, height: state.height };
      if (isWindowVisibleOnAnyDisplay(bounds)) {
        state.x = bounds.x;
        state.y = bounds.y;
      }
    }

    return state;
  } catch {
    return null;
  }
}

function saveWindowState(window) {
  if (window.isDestroyed()) {
    return;
  }

  try {
    const isMaximized = window.isMaximized();
    const isFullScreen = window.isFullScreen();
    const bounds = (isMaximized || isFullScreen) && typeof window.getNormalBounds === 'function'
      ? window.getNormalBounds()
      : window.getBounds();

    fs.writeFileSync(
      getWindowStatePath(),
      JSON.stringify({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        isMaximized,
        isFullScreen
      })
    );
  } catch (error) {
    console.error(error);
  }
}

function trackWindowState(window) {
  let saveTimeout = null;
  const scheduleSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveTimeout = null;
      saveWindowState(window);
    }, 300);
  };

  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    window.on(event, scheduleSave);
  }
  window.on('close', () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    saveWindowState(window);
  });
}

async function createMainWindow() {
  if (!serverHandle) {
    serverHandle = await startEmbeddedServer();
  }

  const appUrl = `http://${serverHandle.host}:${serverHandle.port}`;
  const savedState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: savedState?.width ?? DEFAULT_WINDOW_WIDTH,
    height: savedState?.height ?? DEFAULT_WINDOW_HEIGHT,
    ...(savedState?.x !== undefined && savedState?.y !== undefined ? { x: savedState.x, y: savedState.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    autoHideMenuBar: true,
    backgroundColor: '#f4efe6',
    show: false,
    webPreferences: {
      additionalArguments: ['--note-harbor-desktop=1'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath
    }
  });

  trackWindowState(mainWindow);

  if (savedState?.isFullScreen) {
    mainWindow.setFullScreen(true);
  } else if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalUrl(url, appUrl)) {
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (openExternalUrl(url, appUrl)) {
      event.preventDefault();
    }
  });

  await mainWindow.loadURL(appUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('note-harbor:get-scrape-browser-status', async () => getScrapeBrowserStatus());
ipcMain.handle('note-harbor:open-scrape-browser', async () => openScrapeBrowser());
ipcMain.on('note-harbor:show-note-editor-text-menu', (event, options) => {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    return;
  }

  showNoteEditorTextMenu(window, options);
});

function resolveAboutIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.icns')
    : path.resolve(__dirname, '../build/icon.icns');
}

function showAboutWindow() {
  if (process.platform === 'darwin') {
    app.showAboutPanel();
    return;
  }

  const parentWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
  const messageBoxOptions = {
    type: 'info',
    title: 'About Note Harbor Editor',
    message: 'Note Harbor Editor',
    detail: `Version ${app.getVersion()}`,
    buttons: ['OK']
  };

  if (parentWindow) {
    void dialog.showMessageBox(parentWindow, messageBoxOptions);
    return;
  }

  void dialog.showMessageBox(messageBoxOptions);
}

function addHelpAboutMenuItem() {
  const appMenu = Menu.getApplicationMenu();
  const aboutItemOptions = {
    id: 'about-note-harbor-editor',
    label: 'About Note Harbor Editor',
    click: () => showAboutWindow()
  };

  if (!appMenu) {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'help', submenu: [aboutItemOptions] }]));
    return;
  }

  let helpMenu = appMenu.items.find((item) => item.role === 'help' || item.label === 'Help');

  if (!helpMenu) {
    helpMenu = new MenuItem({ role: 'help', submenu: [] });
    appMenu.append(helpMenu);
  }

  const helpSubmenu = helpMenu.submenu;
  if (!helpSubmenu || helpSubmenu.items.some((item) => item.id === 'about-note-harbor-editor')) {
    return;
  }

  helpSubmenu.append(new MenuItem(aboutItemOptions));
  Menu.setApplicationMenu(appMenu);
}

app.whenReady().then(async () => {
  app.setAboutPanelOptions({
    applicationName: 'Note Harbor Editor',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    iconPath: resolveAboutIconPath()
  });
  addHelpAboutMenuItem();

  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (serverHandle?.server) {
    await new Promise((resolve, reject) => {
      serverHandle.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }).catch((error) => {
      console.error(error);
    });

    serverHandle = null;
  }
});
