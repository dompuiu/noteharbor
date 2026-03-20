import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

let mainWindow = null;
let serverHandle = null;

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

  process.env.NOTESSHOW_DATA_DIR = dataDir;
  process.env.NOTESSHOW_WEB_DIST_DIR = webDistDir;
  process.env.NOTESSHOW_DISABLE_SCRAPING = 'true';
  process.env.NOTESSHOW_SERVE_WEB_DIST = 'true';

  const { startServer } = await import(pathToFileURL(serverEntry).href);
  return startServer({ host: '127.0.0.1', port: 0 });
}

async function createMainWindow() {
  if (!serverHandle) {
    serverHandle = await startEmbeddedServer();
  }

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: '#f4efe6',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await mainWindow.loadURL(`http://${serverHandle.host}:${serverHandle.port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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
