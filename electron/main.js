// Electron 主进程 — 桌面壳启动器
//
// 当前 (B 阶段): 这个文件不会被执行,只是为 A 阶段做骨架准备。
// 升级到 A 阶段:
//   1) 在项目根目录运行: npm run setup:desktop
//      (等价于 npm install --save-dev electron electron-builder)
//   2) 开发模式预览:    npm run electron
//   3) 生成 .exe 安装包: npm run build:desktop
//      产物在 dist-desktop/

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const { start } = require('../server.js');

const PORT = Number(process.env.PORT || 4173);
const APP_URL = `http://127.0.0.1:${PORT}/index.html`;

let mainWindow = null;
let httpServer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: '仓位管理系统',
    icon: path.join(__dirname, '..', 'app', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(APP_URL);

  // 外部链接走系统浏览器,不在应用窗口里跳走
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function waitForServer(url, timeoutMs = 15000) {
  const http = require('http');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Server did not start in time'));
          return;
        }
        setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

app.whenReady().then(async () => {
  httpServer = start(PORT);

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/`);
  } catch (err) {
    console.error('Failed to wait for server:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (httpServer) {
    try { httpServer.close(); } catch { /* ignore */ }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
