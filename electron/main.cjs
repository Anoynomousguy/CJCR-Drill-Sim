const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#12161b',
    title: 'CJCR Parade',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('closed', () => {
    win = null;
  });
}

function sendMenu(command) {
  if (win && !win.isDestroyed()) win.webContents.send('menu-command', command);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Programme', accelerator: 'CmdOrCtrl+N', click: () => sendMenu('new') },
        { label: 'Open Programme…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('save-as') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('plan:save', async (_event, payload) => {
  const { json, path: currentPath } = payload || {};
  let target = currentPath;
  if (!target) {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Drill Programme',
      defaultPath: path.join(app.getPath('documents'), 'cjcr-programme.json'),
      filters: [{ name: 'CJCR programme', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }
  await fs.writeFile(target, json, 'utf8');
  return { canceled: false, path: target };
});

ipcMain.handle('plan:open', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Drill Programme',
    properties: ['openFile'],
    filters: [{ name: 'CJCR programme', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  const filePath = result.filePaths[0];
  const json = await fs.readFile(filePath, 'utf8');
  return { canceled: false, path: filePath, json };
});

ipcMain.handle('app:platform', () => process.platform);

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
