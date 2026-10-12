const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const APP_TITLE = 'Team Lead Dashboard';

let serverProcess;
let mainWindow;

function resourcesDir() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, 'bundle');
}

function nodeBinary() {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  return path.join(resourcesDir(), 'node', name);
}

function serverEntry() {
  return path.join(resourcesDir(), 'standalone', 'server.js');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(port, child) {
  const urlPath = '/';
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (child.exitCode != null) {
        reject(new Error(`The dashboard server stopped (${child.exitCode}).`));
        return;
      }
      if (Date.now() - started > 45000) {
        reject(new Error('The dashboard took too long to start.'));
        return;
      }
      const req = http.get({ hostname: '127.0.0.1', port, path: urlPath, timeout: 1000 }, (res) => {
        res.resume();
        if ((res.statusCode ?? 500) < 500) resolve();
        else setTimeout(tick, 250);
      });
      req.on('error', () => setTimeout(tick, 250));
      req.on('timeout', () => {
        req.destroy();
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

async function startServer() {
  const node = nodeBinary();
  const entry = serverEntry();
  if (!fs.existsSync(node) || !fs.existsSync(entry)) {
    throw new Error('The app bundle is incomplete. Download it again.');
  }
  const port = await freePort();
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const logPath = path.join(app.getPath('userData'), 'server.log');
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  const child = spawn(node, [entry], {
    cwd: path.dirname(entry),
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      APP_PORT: String(port),
      DB_CLIENT: 'sqlite',
      METRICS_DASHBOARD_DATA_DIR: dataDir,
      ELECTRON_RUN_AS_NODE: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  serverProcess = child;
  await waitForServer(port, child);
  return port;
}

function openWindow(port) {
  // A hidden Windows menu keeps keyboard focus, so text fields never receive typing.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }
  const origin = `http://127.0.0.1:${port}`;
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f4f5f7',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  void win.loadURL(origin);
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  const child = serverProcess;
  serverProcess = undefined;
  child.kill();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const port = await startServer();
      openWindow(port);
    } catch (error) {
      dialog.showErrorBox(APP_TITLE, error instanceof Error ? error.message : 'Could not start.');
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('before-quit', () => {
    stopServer();
  });
}
