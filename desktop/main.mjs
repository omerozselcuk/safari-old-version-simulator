import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSafariConfig, resolveConfig } from '../scripts/safari.mjs';
import { getTargetCompatibility } from '../scripts/platform.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const desktopRoot = fileURLToPath(new URL('./', import.meta.url));
const catalog = JSON.parse(await readFile(join(projectRoot, 'webkit-versions.json'), 'utf8'));
const projectConfig = JSON.parse(await readFile(join(projectRoot, 'safari.config.json'), 'utf8'));

let window;
let settings;
let browser;
let opening = false;
let openingComplete;
let quitting = false;
let status = { phase: 'idle', message: 'Choose a Safari version and URL, then open the browser.' };

function setStatus(phase, message) {
  status = { phase, message };
  if (window && !window.isDestroyed()) window.webContents.send('browser-status', status);
}

function bundledPath(relativePath) {
  const base = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath();
  return join(base, relativePath);
}

function configureRuntime() {
  process.env.SAFARI_INSTALL_NODE = bundledPath('node_modules/node/bin/node');
  process.env.SAFARI_NPM_CLI = bundledPath('node_modules/npm/bin/npm-cli.js');
  if (app.isPackaged)
    process.env.SAFARI_RUNTIME_DIR = join(app.getPath('userData'), 'runtimes');
}

async function loadSettings() {
  const fallback = {
    safariVersion: projectConfig.safariVersion,
    url: projectConfig.url ?? 'about:blank',
    allowApproximateVersion: projectConfig.allowApproximateVersion === true,
  };
  try {
    const saved = JSON.parse(await readFile(join(app.getPath('userData'), 'settings.json'), 'utf8'));
    resolveConfig({ ...projectConfig, ...saved, headless: false }, catalog);
    return {
      safariVersion: saved.safariVersion,
      url: saved.url,
      allowApproximateVersion: saved.allowApproximateVersion === true,
    };
  } catch {
    return fallback;
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 580,
    height: 740,
    minWidth: 480,
    minHeight: 660,
    title: 'Safari Old Version Simulator',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: join(desktopRoot, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  void window.loadFile(join(desktopRoot, 'index.html'));
}

ipcMain.handle('get-state', () => ({
  versions: Object.entries(catalog).map(([version, entry]) => ({
    version,
    webkitVersion: entry.webkitVersion,
    approximate: entry.approximate === true,
    minimumMacOS: entry.minimumMacOS,
    ...getTargetCompatibility(entry),
  })),
  settings,
  status,
}));

ipcMain.handle('launch-browser', async (_event, request) => {
  if (quitting || opening || browser?.isConnected())
    throw new Error('A browser is already open or starting.');
  if (!request || typeof request !== 'object' ||
      typeof request.safariVersion !== 'string' || typeof request.url !== 'string')
    throw new Error('Invalid Safari version or URL.');

  const input = {
    safariVersion: request.safariVersion,
    url: request.url.trim() || 'about:blank',
    allowApproximateVersion: request.allowApproximateVersion === true,
    headless: false,
    viewport: projectConfig.viewport,
    ignoreHTTPSErrors: projectConfig.ignoreHTTPSErrors ?? false,
  };
  const selected = resolveConfig(input, catalog);
  opening = true;
  let finishOpening;
  openingComplete = new Promise(resolve => { finishOpening = resolve; });
  setStatus('preparing', 'Preparing WebKit ' + selected.webkitVersion + '…');
  try {
    const launched = await openSafariConfig(input, {
      onStatus: message => setStatus('preparing', message),
    });
    if (quitting) {
      await launched.browser.close();
      return status;
    }
    browser = launched.browser;
    browser.once('disconnected', () => {
      browser = undefined;
      setStatus('idle', 'Browser closed. You can choose another version.');
    });
    launched.page.once('close', () => { void launched.browser.close(); });
    settings = {
      safariVersion: input.safariVersion,
      url: input.url,
      allowApproximateVersion: input.allowApproximateVersion,
    };
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(join(app.getPath('userData'), 'settings.json'),
      JSON.stringify(settings, null, 2) + '\n', 'utf8');
    setStatus('running', 'Safari ' + selected.safariVersion +
      ' target is open · WebKit ' + selected.webkitVersion);
    return status;
  } catch (error) {
    if (browser?.isConnected()) await browser.close();
    setStatus('error', error.message);
    throw error;
  } finally {
    opening = false;
    finishOpening();
    openingComplete = undefined;
  }
});

ipcMain.handle('close-browser', async () => {
  if (browser?.isConnected()) {
    setStatus('closing', 'Closing browser…');
    await browser.close();
  }
  return status;
});

app.whenReady().then(async () => {
  configureRuntime();
  settings = await loadSettings();
  createWindow();
});

async function quitApp() {
  if (quitting) return;
  quitting = true;
  try {
    if (openingComplete) await openingComplete;
    if (browser?.isConnected()) await browser.close();
  } finally {
    app.quit();
  }
}

app.on('window-all-closed', () => { void quitApp(); });
app.on('before-quit', event => {
  if (!quitting && (opening || browser?.isConnected())) {
    event.preventDefault();
    void quitApp();
  }
});
process.once('SIGINT', () => { void quitApp(); });
process.once('SIGTERM', () => { void quitApp(); });
