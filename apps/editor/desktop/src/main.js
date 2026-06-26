import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, shell } from 'electron';

app.setName('Note Harbor Editor');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..');
const preloadPath = path.join(__dirname, 'preload.cjs');
const DEFAULT_CHROME_CDP_URL = 'http://127.0.0.1:9222';
const DEFAULT_CHROME_CDP_PORT = '9222';
const DEFAULT_CHROME_CDP_ADDRESS = '0.0.0.0';
const CHROME_CANDIDATE_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

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

  for (const candidate of CHROME_CANDIDATE_PATHS) {
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
      ...CHROME_CANDIDATE_PATHS.map((candidate) => `- ${candidate}`),
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

function focusOwnedScrapeBrowserWindow() {
  const userDataDir = getChromeUserDataDir().replaceAll('\\', '\\\\');
  const script = [
    '$process = Get-CimInstance Win32_Process |',
    `  Where-Object { $_.CommandLine -and $_.CommandLine -like '*--remote-debugging-port=${getChromeCdpPort()}*' -and $_.CommandLine -like '*--user-data-dir=${userDataDir}*' } |`,
    '  Select-Object -First 1',
    'if (-not $process) { exit 1 }',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class NoteHarborUser32 {',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
    '}',
    '"@',
    '$windowProcess = Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue',
    'if (-not $windowProcess -or $windowProcess.MainWindowHandle -eq 0) { exit 1 }',
    '[NoteHarborUser32]::ShowWindowAsync($windowProcess.MainWindowHandle, 9) | Out-Null',
    'if ([NoteHarborUser32]::SetForegroundWindow($windowProcess.MainWindowHandle)) { exit 0 }',
    'exit 1'
  ].join('; ');
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ], {
    stdio: 'ignore'
  });

  return new Promise((resolve) => {
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
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
  if (process.platform !== 'win32') {
    return {
      supported: false,
      available: false,
      launching: false,
      error: 'Launching the scrape browser is currently supported only on Windows.'
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
  if (process.platform !== 'win32') {
    return {
      supported: false,
      available: false,
      launching: false,
      error: 'Launching the scrape browser is currently supported only on Windows.'
    };
  }

  if (await isScrapeBrowserAvailable()) {
    await focusOwnedScrapeBrowserWindow();
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

async function createMainWindow() {
  if (!serverHandle) {
    serverHandle = await startEmbeddedServer();
  }

  const appUrl = `http://${serverHandle.host}:${serverHandle.port}`;

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#f4efe6',
    webPreferences: {
      additionalArguments: ['--note-harbor-desktop=1'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath
    }
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

app.whenReady().then(async () => {
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
