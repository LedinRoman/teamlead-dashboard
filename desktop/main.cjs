const { app, BrowserWindow, dialog, Menu, nativeTheme, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const APP_TITLE = 'Team Lead Dashboard';

let serverProcess;
let mainWindow;
let splashWindow;

function bootFraction(elapsed) {
  if (elapsed < 18000) return 0.06 + (elapsed / 18000) * 0.82;
  return Math.min(0.96, 0.88 + (1 - Math.exp(-(elapsed - 18000) / 12000)) * 0.08);
}

function bootLabel(elapsed, phase) {
  if (phase === 'open') return 'Opening';
  if (elapsed < 700) return 'Starting';
  return 'Loading the dashboard';
}

function openSplash() {
  const background = nativeTheme.shouldUseDarkColors ? '#101216' : '#f7f8fa';
  const splash = new BrowserWindow({
    width: 440,
    height: 280,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: background,
    title: APP_TITLE,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splashWindow = splash;
  let ready = false;
  const queued = [];
  const send = (fraction, label) => {
    const script = `window.setBoot && window.setBoot(${Number(fraction)}, ${JSON.stringify(label)})`;
    if (ready && !splash.isDestroyed()) void splash.webContents.executeJavaScript(script);
    else queued.push(script);
  };
  splash.webContents.once('did-finish-load', () => {
    ready = true;
    for (const script of queued) {
      if (!splash.isDestroyed()) void splash.webContents.executeJavaScript(script);
    }
    queued.length = 0;
  });
  splash.once('ready-to-show', () => {
    if (!splash.isDestroyed()) splash.show();
  });
  void splash.loadFile(path.join(__dirname, 'splash.html'));

  const started = Date.now();
  let phase = 'boot';
  send(0.04, 'Starting');
  const timer = setInterval(() => {
    if (splash.isDestroyed() || phase === 'open') return;
    const elapsed = Date.now() - started;
    send(bootFraction(elapsed), bootLabel(elapsed, phase));
  }, 200);

  return {
    opening() {
      phase = 'open';
      send(0.94, 'Opening');
    },
    finish() {
      clearInterval(timer);
      send(1, 'Opening');
    },
    close() {
      clearInterval(timer);
      if (!splash.isDestroyed()) splash.close();
      if (splashWindow === splash) splashWindow = undefined;
    },
  };
}

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
  return new Promise((resolve, reject) => {
    win.once('ready-to-show', () => resolve(win));
    win.webContents.once('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame === false) return;
      reject(new Error(description || `Could not open the dashboard (${code}).`));
    });
    void win.loadURL(origin);
  });
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
    const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : splashWindow;
    if (!target || target.isDestroyed()) return;
    if (target.isMinimized()) target.restore();
    target.focus();
  });

  app.whenReady().then(async () => {
    const splash = openSplash();
    try {
      const port = await startServer();
      splash.opening();
      const win = await openWindow(port);
      splash.finish();
      win.show();
      await new Promise((resolve) => setTimeout(resolve, 220));
      splash.close();
      if (!win.isDestroyed()) win.focus();
    } catch (error) {
      splash.close();
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
