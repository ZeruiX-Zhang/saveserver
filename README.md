# 仓位管理系统

本地可运行的 `响应式网页 + PWA`，包含：

- `电脑端`：产品管理、仓位配置、库存可视化、操作包导入、主数据导出
- `手持端 (规划中: 安卓 App)`：现场拍照/扫码采集、相似图查询、上传新产品
- `本地数据库`：`SQLite`，由 `server.js` 通过 `better-sqlite3` 直接读写
- `运行方式`：本地静态服务 + HTTP API，支持局域网内多台 PC 共享同一份数据

## 目录

- [app/index.html](app/index.html)
- [app/src/app.js](app/src/app.js)
- [app/src/storage.js](app/src/storage.js) — 前端通过 fetch 访问 server.js
- [server.js](server.js) — HTTP 服务器（静态资源 + KV API + 同步 API）
- [database/db.js](database/db.js) — SQLite 后端
- [sync.js](sync.js) — 安卓 ↔ PC 同步逻辑（局域网 + USB 包）

## 在一台新电脑上首次部署

前置条件：装 [Node.js](https://nodejs.org/) 18 或更新版本（自带 `npm`）。Python 仅当你需要用 Excel 导入导出时才装。

```bash
# 1. 把项目目录拷过来（或 git clone）
cd <项目根目录>

# 2. 安装依赖（首次会下载 better-sqlite3 的预编译版本）
npm install

# 3. 启动
npm start
# 等价于: node server.js
```

启动成功会看到：

```
Warehouse PWA server running at http://0.0.0.0:4173
```

打开浏览器访问 `http://localhost:4173/`。首次访问会自动写入演示数据。

如不想用命令行，也可以直接双击 [start-app.cmd](start-app.cmd)（Windows）。

### 数据存哪里

- SQLite 数据库：`data/warehouse.db`（首次启动时自动创建）
- 同步 token：`data/sync-token.txt`（首次启动时自动生成）
- 这两个文件**不会**被 `.gitignore` 提交。如果想把数据从一台电脑迁到另一台，整个 `data/` 目录拷过去即可。

## 局域网内多台 PC 共用同一份数据

`server.js` 默认监听 `0.0.0.0:4173`，意味着同一个局域网（比如同一个 Wi-Fi 或办公室路由器）下的其他电脑可以直接通过浏览器访问。

**步骤**：

1. 在其中一台电脑上正常启动（`npm start`）。这台是 **中心电脑**。
2. 在中心电脑上查它的局域网 IPv4 地址：
   - Windows: `ipconfig` 找"无线局域网适配器 WLAN"或"以太网适配器"下的 `IPv4 地址`
   - macOS / Linux: `ifconfig` 或 `ip addr`
   - 例如 `192.168.1.10`
3. 其他电脑的浏览器打开 `http://192.168.1.10:4173/`，即可使用同一份数据。
4. **首次需要放行 Windows 防火墙**：第一次启动 `node server.js` 时 Windows 会弹窗询问是否允许 Node.js 通过防火墙，勾选"专用网络"并允许。如果当时没弹，去`控制面板 → Windows Defender 防火墙 → 允许应用通过防火墙` 里手动加 `node.exe` 的入站规则。

**所有 PC 都能改数据**：因为只有中心电脑这一份 SQLite，写入是顺序的，没有并发冲突。两个人同时编辑同一条记录的话，后保存的覆盖先保存的——这跟绝大多数协作工具一致。

**中心电脑必须开机且 server 在跑**，否则其他 PC 访问不到。如果想让中心电脑后台默默跑 server，用 `start-app.vbs`（隐藏窗口启动）。

## 端口和环境变量

| 变量 | 用途 | 默认 |
| --- | --- | --- |
| `PORT` | server 监听端口 | `4173` |
| `HOST` | server 监听地址 | `0.0.0.0`（所有网卡）。改成 `127.0.0.1` 可禁止外部访问 |
| `WAREHOUSE_DB_PATH` | SQLite 文件路径 | `<项目>/data/warehouse.db` |
| `WAREHOUSE_TOKEN_PATH` | 同步 token 文件路径 | `<项目>/data/sync-token.txt` |
| `WAREHOUSE_APP_PYTHON` | Python 解释器（仅 Excel 桥需要） | 自动找 `python` / `py` |
| `WAREHOUSE_APP_NODE` | 显式指定 node.exe 路径（仅 .cmd / .vbs 启动器） | 自动找 `node` |

例如限定本机访问、改用 8080 端口：

```bash
HOST=127.0.0.1 PORT=8080 npm start
```

## 手持端 Android App

手持端是一个独立的 Capacitor 8 Android App，通过 LAN HTTP 连接桌面端 Server 完成离线仓库作业。设计与需求详见 [`.kiro/specs/handheld-warehouse-app/design.md`](.kiro/specs/handheld-warehouse-app/design.md)。

### 同步 API（电脑端已就绪）

- `GET /api/sync/ping` 配对探活
- `GET /api/sync/master-data` 主数据下行
- `POST /api/sync/upload` 操作 / 产品上行
- `GET /api/sync/export-package` 导出 USB 主数据包（gzip JSON）
- `POST /api/sync/import-package` 导入 USB 上传包

所有 `/api/sync/*` 端点要求 `X-Sync-Token` 或 `Authorization: Bearer <token>`。token 存放在 `data/sync-token.txt`。

### 编译并安装到设备

前置条件：

- Android Studio + Android SDK（API 28 或更高）
- JDK 17（Capacitor 8 要求）
- 设备打开"开发者选项 → USB 调试"，并通过数据线连上电脑

```bash
# 1. 安装根项目依赖
#    （首次会拉 3 个新 Capacitor 插件：@capacitor/camera / @capacitor/filesystem / @capacitor-mlkit/barcode-scanning）
npm install

# 2. 把 app/shared/ 镜像到 android/app/src/main/assets/public/shared/，并触发 npx cap sync
npm run build:handheld

# 3. 用 Gradle 出 Debug APK
cd android
./gradlew assembleDebug

# 4. 装机（设备已连）
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

APK 输出路径：`android/app/build/outputs/apk/debug/app-debug.apk`。

> Release 签名版本不在当前交付范围内；调试机分发请使用 Debug APK。

### 首次配对

1. 在电脑端浏览器打开 `http://localhost:4173/`，进入"同步与共享"对话框。
2. 展开"手持端配对"面板，电脑会显示一个二维码（内含 `apiBase` + `syncToken`）。
3. 在手持端 App 上点"扫描二维码"对准电脑屏幕，或手输服务器地址与令牌。

> 手持端的 `apiBase` 必须填电脑的**局域网 IP**（如 `http://192.168.1.10:4173`），不能用 `localhost`——后者在手持设备上指设备本身。

详细的真机烟雾测试清单见 [`docs/handheld-smoke-test.md`](docs/handheld-smoke-test.md)。

### 离线优先

手持端假设网络不可靠：

- 主数据下载到本地存储（Capacitor Filesystem 落 JSON + Preferences 存元数据）。
- 现场录入的所有操作（入库 / 移库 / 出库 / 调整）先入本地队列。
- 网络可达时通过 LAN HTTP 上传；不可达时导出 USB 包到 `Documents/warehouse-handheld/`，用 USB 拷回电脑导入。
- 电脑端按 `package_id` + `operation_id` 双层去重，重复上传不会重复落库。

### 开发与调试

- 共享纯逻辑（位置码解析 / 操作工厂 / 库存预览 / 本地搜索 / 型号归一化 / 包构造）位于 `app/shared/`，桌面 PWA 与手持端共用。任何修改都改这里，构建脚本会物理拷贝到手持端 bundle。
- 手持端 UI 与平台桥接位于 `android/app/src/main/assets/public/`。
- 共享层有 25 条 `fast-check` 属性测试覆盖：`npm test` / `npm run test:property`。
- 端到端 LAN 链路烟雾（无设备依赖）：`node scripts/test-handheld-e2e.js`。

### 故障排除

- **明文 HTTP 被 Android 9+ 拦截**：本应用通过 `network_security_config.xml` 显式放行所有出站明文。这是 LAN-only 部署的有意权衡，依赖 `X-Sync-Token` 鉴权。
- **WebView 不支持 BarcodeDetector**：自动回退到 `@capacitor-mlkit/barcode-scanning` 插件。
- **LAN 上传后电脑端看不到数据**：检查 `data/warehouse.db` 是否被新版 `sync.js#applyUploadsPayload` 写入；老版本不消费 `operations[]` 会静默丢弃。

## 桌面应用打包（可选）

```bash
npm run setup:desktop   # 安装 electron + electron-builder（仅首次）
npm run electron        # 开发模式预览 Electron 壳
npm run build:desktop   # 生成 .exe 安装包到 dist-desktop/
```

打出来的 .exe 可以分发给没装 Node 的同事，双击安装即可使用。
