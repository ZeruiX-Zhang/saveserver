> **Capacitor webDir 切换提示**
>
> `capacitor.config.json#webDir` 已指向 `android/app/src/main/assets/public`（手持端 Bundle）。
> 桌面 Electron 打包走 `package.json#build.files` 的 `app/**/*`，与 Capacitor 配置完全解耦，请不要为了“修复”Capacitor 而把 `webDir` 改回 `"app"`。

# 桌面化路线图

本项目从"命令行 + 浏览器"演进到"桌面应用"分两步走。
B 阶段已完成,A 阶段在你需要时随时启用。

---

## B 阶段:静默启动器(已就绪,日常使用)

### 一次性安装

在项目根目录双击 [install-shortcut.cmd](install-shortcut.cmd) 一次。它会:

1. 在 `app/assets/icon.ico` 生成应用图标
2. 在桌面创建 **仓位管理系统** 快捷方式

### 日常使用

- 启动:双击桌面上的 **仓位管理系统** 图标
  - 后台静默拉起 Node 服务器(无黑框)
  - 等服务器就绪后用默认浏览器打开应用
  - 如果服务器已经在跑,直接打开新标签页,不会重复启动
- 关闭服务器:运行项目目录下的 [stop-app.cmd](stop-app.cmd)
  - 关闭浏览器**不会**自动关停服务器,需要主动跑这个脚本

### 涉及的文件

| 文件 | 作用 |
| :--- | :--- |
| [start-app.vbs](start-app.vbs)        | 静默启动器(VBS 主体逻辑) |
| [stop-app.cmd](stop-app.cmd)          | 停止后台服务器 |
| [install-shortcut.cmd](install-shortcut.cmd) | 双击调用安装脚本 |
| [install-shortcut.ps1](install-shortcut.ps1) | 生成 ICO + 创建桌面快捷方式 |
| [start-app.cmd](start-app.cmd)        | 旧的可见控制台启动器(保留备用) |

### 已知限制

- **依赖本机 Node.js**:VBS 启动器找的是项目里硬编码的 codex bundled node 或 PATH 中的 `node`。换台电脑就不能直接用,得装 Node。
- **Excel 导入/导出依赖 Python**:`scripts/excel_bridge.py` 仍然要本机有 Python,逻辑没变。
- **不能分发给别人**:这种方案是"在你电脑上隐藏了黑框",不是"打包成 .exe 安装包"。要分发,走 A 阶段。

---

## A 阶段:Electron 桌面应用(随时启用)

骨架已经放好(`electron/main.js`、`package.json`),启用只需要装依赖。

### 启用步骤

```powershell
# 1. 装 Electron 与打包工具(首次)
npm run setup:desktop

# 2. 开发模式打开,验证应用能正常工作
npm run electron

# 3. 打包成 .exe 安装包
npm run build:desktop
# 产物在 dist-desktop/ 下,带 NSIS 安装向导
```

### A 阶段相对于 B 的提升

- 不再需要本机 Node.js — Electron 自带 Node 运行时
- 装一次就行,开始菜单 / 桌面 / 关闭按钮都是原生体验
- 关闭窗口自动关停内置服务器,不会有"幽灵进程"
- 可以发给同事装(`.exe` 安装包)
- 可以考虑加托盘图标、自动更新等

### A 阶段需要解决的两个事情

1. **Excel 桥接(Python)**:打包后的应用还需要找到 Python。
   方案:
   - (a) 让用户自己装 Python(类似现在的逻辑,在 README 里说明)
   - (b) 把 Excel 桥接改写成纯 JS(用 `app/vendor/xlsx.full.min.js` 已经引入的库),取代 Python 脚本
   - (c) 用 electron-builder 的 `extraResources` 打包一个迷你 Python(体积大)
   - 推荐 **(b)**,顺便摆脱 Python 依赖。

2. **应用图标**:`build.win.icon` 指向 `app/assets/icon.ico`,B 阶段安装快捷方式时已经生成。
   如果想要更精致的图标,把 SVG 拿到外部工具(如 Figma + ICO 导出器)做一个多尺寸 ICO 替换即可。

### 当前 Electron 主进程的设计

[electron/main.js](electron/main.js):

- `app.whenReady()` 时调用现有 `server.js` 的 `start(port)`,在主进程里直接复用 HTTP 逻辑
- `BrowserWindow.loadURL('http://127.0.0.1:4173/index.html')` 加载页面
- `window-all-closed` 时关停服务器并退出

`server.js` 已经导出 `{ server, start }`,无需改造即可被 Electron 复用。

---

## 后续优化建议(可选)

按"性价比"从高到低排:

1. **把 Python Excel 桥接改成纯 JS**:摆脱外部运行时依赖,A 阶段打包体积大幅下降。
2. **把 IndexedDB 数据按时间自动备份到本地文件**:防止浏览器数据被清。
3. **加一个状态栏 / 托盘图标**:右键能看到"打开应用 / 退出 / 备份数据"。
4. **自动更新**:用 electron-updater + GitHub Release,改一次代码,所有装机端自动拉新版。
