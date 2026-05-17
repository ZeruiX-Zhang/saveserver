# Implementation Plan: Handheld Warehouse App

## Overview

按 design.md 的模块结构实施手持端独立 APK 交付。整体分四条主线：

1. **共享纯逻辑层 (`app/shared/*`)** — 桌面 PWA 与手持端 Bundle 共用的纯函数模块；`fast-check` 属性测试只跑在 Node 上，必须依赖纯函数。
2. **服务端兼容补丁** — 现有 `sync.js#applyUploadsPayload` 不识别 `operations[]`，桌面端也缺 Pairing QR；这两块是手持上传真正落地的前提，可与共享层并行实施。
3. **原生平台配置 + 构建脚本** — 安装 Capacitor 插件、改 `webDir`、放开 cleartext、编写 `npm run build:handheld`。这一阶段完成后 APK 才能成形。
4. **手持端 Web Bundle (`android/app/src/main/assets/public/`)** — 基础设施 → 业务模块 → 页面三段式落地，最后用 e2e smoke 脚本（无需真机）验证 LAN 上传链路。

任务粒度：每个子任务 10–60 分钟一次性产出。任务标题中文，代码路径英文。带 `*` 后缀的子任务为可选测试任务。

## Tasks

- [ ] 1. 共享纯逻辑层与属性测试基础设施
  - [ ] 1.1 抽出位置码模块到 `app/shared/location-code.js`
    - 把 `app/src/scanner.js` 中的 `LOCATION_CODE_PATTERN` / `parseLocationCode` / `formatLocationCode` 移到新建的 `app/shared/location-code.js`，作为唯一来源
    - 让 `app/src/scanner.js` 改为 `export { parseLocationCode, formatLocationCode } from "../shared/location-code.js"` 并保留摄像头 / `BarcodeDetector` 相关原函数，桌面 PWA `app/src/app.js` 现有 import 不破坏
    - _Requirements: 17.1_

  - [ ] 1.2 创建 `app/shared/normalize-model.js`
    - 实现 `normalizeModel(input)`：去空格 → toUpperCase → 去除非字母数字非汉字字符
    - 字符集与服务端 `model_normalized` 保持一致
    - _Requirements: 3.6_

  - [ ] 1.3 创建 `app/shared/op-builders.js`
    - 实现 7 个工厂：`buildPutIn` / `buildMoveWarehouse` / `buildMoveToExternal` / `buildMoveFromExternal` / `buildShipOut` / `buildAdjustIncrease` / `buildAdjustDecrease`
    - 工厂签名接受 `({ ...input }, { now = Date.now, idGen = crypto.randomUUID } = {})`，便于属性测试注入确定性时钟与 UUID
    - 校验 `qty > 0`、按 design §Data Models 表格填充 `source_*` / `target_*` 字段，未使用字段显式 `null`
    - 校验 `move` 类型 `source_level_id !== target_level_id`、`adjust_*` 类型 `note` 长度 ≥ 1
    - _Requirements: 4.4, 4.5, 6.5, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 9.5, 16.2, 18.4_

  - [ ] 1.4 创建 `app/shared/inventory-preview.js`
    - 实现 `buildInitialPreview(masterInventoryBalances)`、`applyOp(preview, op)`、`undoOp(preview, op)`、`getLocationQty`、`listLocationsWithQty`
    - 函数式更新（每次返回新 Map），不在内部去重，调用方负责"应用一次 = 加一次"
    - locationKey 形如 `level:<levelId>` / `external:<externalId>`
    - _Requirements: 4.6, 6.8, 11.4, 18.5, 18.6, 18.9_

  - [ ] 1.5 创建 `app/shared/local-search.js`
    - 实现 `searchProducts(master, query)`，按 `model.includes(q)` ∨ `model_normalized.includes(normalizeModel(q))` ∨ `productCustomFieldValues.value_text` 命中且对应字段 `is_searchable === 1`
    - 返回结果含 `model` / `image_path` / 通过 `inventoryBalances` 求和得到的 `totalQty`
    - import `normalize-model.js`，不写 DOM
    - _Requirements: 3.2, 3.3, 10.5, 10.7_

  - [ ] 1.6 创建 `app/shared/package-builder.js`
    - 实现 `buildOperationPackage({ deviceId, deviceName, operations, baseMasterPackageId }, { now, idGen })`，输出 design §Data Models 中 `Operation_Package` 形状（含 `package_type: "operations"` / `package_version: 1` / 新生成 UUID v4 `package_id`）
    - 实现 `validatePairingQr(value)`：`{ ok: true, value }` / `{ ok: false, reason }` 形式（v === 1，apiBase 必须 http(s):// 非空，syncToken 非空）
    - _Requirements: 1.3, 12.1, 13.2, 15.4, 18.2_

  - [ ] 1.7 接入 `node --test` + `fast-check` 测试运行框架
    - 在 `package.json` 添加 `devDependencies."fast-check"` 与 `scripts.test = "node --test test/**/*.test.js"` 与 `scripts."test:property" = "node --test test/property/*.test.js"`
    - 运行 `npm install` 验证 fast-check 可解析（不引入其他测试框架）
    - 创建 `test/helpers/arbitraries.js` 占位，导出基础 `asciiAlnumArb`、`qtyArb`、`opArb`、`previewArb`、`masterArb`，供后续属性测试 import
    - _Requirements: 18.x（基础设施）_

  - [ ]* 1.8 属性测试 `test/property/location-code.test.js`
    - **Property 1: 位置码 format → parse round-trip**（`Validates: Requirements 17.2`）
    - **Property 2: 位置码 parse → format round-trip**（`Validates: Requirements 17.3`）
    - **Property 3: 非法位置码返回非空 reason**（`Validates: Requirements 17.4`）
    - import 自 `app/shared/location-code.js`
    - _Requirements: 17.2, 17.3, 17.4_

  - [ ]* 1.9 属性测试 `test/property/normalize-model.test.js`
    - **Property 4: 型号归一化幂等且字符集封闭**（`Validates: Requirements 3.6`）
    - _Requirements: 3.6_

  - [ ]* 1.10 属性测试 `test/property/op-builders.test.js`
    - **Property 5: Operation 工厂的字段形状契约**（`Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2`）
    - **Property 6: 数量正性**（`Validates: Requirements 18.4, 4.2, 4.3`）
    - 每种 `Operation_Type` 各跑一组 `fc.assert`，输入合法时验证字段表，输入 `qty ≤ 0` 时断言抛错
    - _Requirements: 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2, 18.4_

  - [ ]* 1.11 属性测试 `test/property/uuid-and-package.test.js`
    - **Property 7: ID 全局唯一且为合法 UUID v4**（`Validates: Requirements 4.5, 18.1, 18.2`）
    - **Property 8: 重发包复用 package_id**（`Validates: Requirements 12.9, 13.2, 13.4, 18.3`）—— 用 mock fetch / mock filesystem 校验，N≥2 次重发同一 `Operation_Package` 时 body / 文件名内 `package_id` 全相等
    - _Requirements: 4.5, 12.9, 13.2, 13.4, 18.1, 18.2, 18.3_

  - [ ]* 1.12 属性测试 `test/property/inventory-preview.test.js`
    - **Property 9: 单步应用增加目标位置数量**（`Validates: Requirements 4.6, 6.8, 18.5`）
    - **Property 10: apply-undo round-trip**（`Validates: Requirements 11.4`）
    - **Property 11: 本地预览的非幂等性**（`Validates: Requirements 18.6`）
    - **Property 12: 连续 `put_in` 线性累加**（`Validates: Requirements 18.9`）
    - _Requirements: 4.6, 6.8, 11.4, 18.5, 18.6, 18.9_

  - [ ]* 1.13 属性测试 `test/property/queue-serialization.test.js`
    - **Property 13: 队列 JSON 序列化 round-trip**（`Validates: Requirements 11.6, 15.1, 18.7`）
    - _Requirements: 11.6, 15.1, 18.7_

  - [ ]* 1.14 属性测试 `test/property/package-gzip.test.js`
    - **Property 14: Operation_Package gzip round-trip**（`Validates: Requirements 18.8`）—— 用 `node:zlib` `gzipSync` / `gunzipSync` 验证
    - _Requirements: 18.8_

  - [ ]* 1.15 属性测试 `test/property/local-search.test.js`
    - **Property 15: 搜索可靠性与完备性**（`Validates: Requirements 3.2, 10.5, 10.7`）
    - **Property 16: 总库存数量等于位置数量之和**（`Validates: Requirements 3.3`）
    - **Property 17: 队列展示按 operated_at 倒序**（`Validates: Requirements 11.2`）
    - _Requirements: 3.2, 3.3, 10.5, 10.7, 11.2_

  - [ ]* 1.16 属性测试 `test/property/pairing-qr.test.js`
    - **Property 24: PairingQR 校验**（`Validates: Requirements 15.4`）
    - _Requirements: 15.4_

  - [ ]* 1.17 属性测试 `test/property/ring-buffer.test.js`
    - **Property 25: 循环缓冲区上界**（`Validates: Requirements 14.4, 15.6`）
    - 由通用 `pushAll(buffer, items, capacity)` 函数支撑（如未单独抽取，则在测试文件内联实现并约束被测函数）
    - _Requirements: 14.4, 15.6_

- [ ] 2. 服务端兼容补丁（与第 1 节并行）
  - [ ] 2.1 `sync.js#applyUploadsPayload` 增加 `operations[]` 消费分支
    - 检测 `data.operations` 数组：对每条按 `package_id + operation_id` 双层去重（沿用 `dbStore.bulkPut` 风格），写入 `inventory_operations` 并按设计文档 §3.9 / §5.2 更新 `inventory_balances`
    - 失败的 op 收集到返回值 `{ applied, operationsApplied, operationsSkippedDuplicate, operationsFailed }`，不影响其他 store 的处理
    - 在 `UPLOAD_STORES` 注释里说明 `operations` 是新增分支（不是 store 白名单成员）
    - _Requirements: 12.3, 12.4, 18.3_

  - [ ] 2.2 桌面 PWA Pairing 面板 + `GET /api/sync/server-info`
    - `server.js#handleSyncRoute` 新增 `action === "server-info"`：仅同机来源放行，返回 `{ addresses: [...本机非回环 IPv4...], token: getOrCreateToken(), port: PORT }`
    - 在 `app/index.html` 加入"手持端配对"折叠面板：拉取 `/api/sync/server-info`，让用户选 `address`，把 `{ v: 1, apiBase, syncToken }` `JSON.stringify` 后用现有 `app/vendor/qrious.js`（或同等 QR 库）画到 `<canvas>`，并显示 `apiBase` / `token` 文本作为手输回退
    - _Requirements: 1.2, 1.3_

- [ ] 3. 检查点：foundation 全部通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. 原生平台配置
  - [ ] 4.1 安装 Capacitor 插件
    - 执行 `npm install @capacitor/camera @capacitor/filesystem @capacitor-community/barcode-scanner` 并把版本固定到 `package.json#dependencies`
    - 在任务输出中记录三个插件实际安装的版本号
    - _Requirements: 5.1, 10.2_

  - [ ] 4.2 更新 `capacitor.config.json#webDir` 指向手持端 bundle
    - 把 `webDir` 从 `"app"` 改为 `"android/app/src/main/assets/public"`
    - 加入 `"server": { "androidScheme": "https" }`
    - 在 `BUILD-DESKTOP.md` 顶部加一段提示："Capacitor `webDir` 已切换到手持端 bundle；桌面 Electron 走 `package.json#build.files` 的 `app/**/*`，二者解耦"（防止后续误操作）
    - _Requirements: 1.1_

  - [ ] 4.3 更新 `AndroidManifest.xml`
    - 新增 `<uses-permission android:name="android.permission.CAMERA" />`、`<uses-feature android:name="android.hardware.camera" android:required="false" />`
    - 新增 `<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />` 与 `<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" />`
    - 在 `<application>` 加 `android:usesCleartextTraffic="true"` 与 `android:networkSecurityConfig="@xml/network_security_config"`
    - _Requirements: 5.1, 10.2, 10.4, 12.2, 13.1_

  - [ ] 4.4 创建 `android/app/src/main/res/xml/network_security_config.xml`
    - 采用 `base-config cleartextTrafficPermitted="true"`（设计 §Permissions and Native Configuration 推荐路线）
    - 在文件顶部加 XML 注释说明这是 LAN-only 部署的有意安全权衡，并要求依赖 `X-Sync-Token` 鉴权
    - _Requirements: 12.2, 13.1_

  - [ ] 4.5 编写 `scripts/build-handheld.js` + `npm run build:handheld`
    - Node 脚本：清空 `android/app/src/main/assets/public/shared/` → 递归拷贝 `app/shared/` 到该目录 → 调用 `npx cap sync android`
    - 拷贝时跳过 `node_modules` / 隐藏文件；任何失败抛非零退出码
    - 在 `package.json#scripts` 加入 `"build:handheld": "node scripts/build-handheld.js"`
    - _Requirements: 1.1（可分发性基础设施）_

- [ ] 5. 手持端 Web Bundle - 入口与基础设施
  - [ ] 5.1 替换 `android/app/src/main/assets/public/index.html` 与 `styles.css`
    - 用极简 HTML 替换桌面 PWA 镜像版：单 `<div id="app">` 容器、引入 `src/main.js`（`type="module"`）、加 `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`
    - **保留** `cordova.js` / `cordova_plugins.js` / `capacitor.plugins.json` / `capacitor.config.json` 不动（Capacitor 同步管理）
    - 重写 `styles.css`：单手操作（按钮 ≥ 56dp）、暗色友好、避免桌面侧边栏布局
    - 删除桌面专有 `src/api-config.js` / `src/app.js` / `src/detectors.js` / `src/scanner.js` / `src/search.js` / `src/seed.js` / `src/storage.js` / `src/themes.js` / `src/utils.js`（手持端走 `src/main.js` 全新入口）
    - _Requirements: 1.1_

  - [ ] 5.2 `assets/public/src/storage-prefs.js`
    - 用 `@capacitor/preferences` 封装 `getPref(key) / setPref(key, value) / removePref(key) / clearAllPrefs()`
    - 仅装小 KV：`apiBase` / `sync_token` / `device_id` / `device_name` / `last_master_sync_at` / `base_master_package_id`
    - _Requirements: 1.5, 1.9, 2.3, 16.1_

  - [ ] 5.3 `assets/public/src/storage-fs.js`
    - 用 `@capacitor/filesystem` 封装 `readJsonFile(relPath) / writeJsonFileAtomic(relPath, obj) / readTextFile / appendTextFile / fileExists / removeFile / writeBase64`
    - 原子写：先写 `<path>.tmp`（`Filesystem.writeFile`），再 `Filesystem.rename` 覆盖目标，rename 失败回滚删除 `.tmp`
    - 所有路径相对 `Directory.Documents/warehouse-handheld/` 根，自动 `recursive: true` 创建目录
    - _Requirements: 2.2, 11.6, 15.1, 15.3_

  - [ ] 5.4 `assets/public/src/device-identity.js`
    - 实现 `getOrCreateDeviceId()`（首次调用生成 UUID v4 写入 Preferences，后续返回同值）、`getDeviceName()` / `setDeviceName(name)` / `resetDeviceIdentity()`（清空 device_id + 同时调用 `operation-queue.js` 的清空入口）
    - import `storage-prefs.js`
    - _Requirements: 1.9, 16.1, 16.3, 16.4_

  - [ ] 5.5 `assets/public/src/logger.js`
    - 1 MB 循环日志：写到 `Documents/warehouse-handheld/log.txt`，超过 1 MB 时 rename 为 `log.txt.1`（覆盖旧 `.1`）后重置
    - 提供 `log(level, module, message, context)` 统一入口；单行 JSON
    - 提供 `exportLogs(targetSuffix)` 把 `log.txt` + `log.txt.1` 合并写到 `log-export-<timestamp>.txt`
    - _Requirements: 15.6_

  - [ ] 5.6 `assets/public/src/permissions.js`
    - `ensureCameraPermission()`：调用 `Camera.checkPermissions` / `requestPermissions`，未授予返回 false
    - `ensureStoragePermission()`：在 Android < 33 上请求 `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`；33+ 走 `READ_MEDIA_IMAGES`（如未安装相册插件，则按 `Filesystem` 直写 `Documents` 不需额外授权处理）
    - 拒绝时统一返回 `{ granted: false, reason }` 由调用方决定 UI 引导
    - _Requirements: 5.1, 10.2_

  - [ ] 5.7 `assets/public/src/scanner-native.js`
    - 实现 `scanOnce({ purpose })`：先检测 `window.BarcodeDetector`，存在则 reuse `app/shared/`（注：camera 启动逻辑已在 `app/src/scanner.js` 的 `startCameraScanner`，手持端用 `import` 该文件并注入临时 `<video>`），不存在则调用 `@capacitor-community/barcode-scanner` 的 `BarcodeScanner.scan()`
    - 解析与回调由调用方用 `parseLocationCode` 处理；`scanner-native.js` 仅返回原始字符串
    - _Requirements: 1.3, 5.1, 5.2_

  - [ ] 5.8 `assets/public/src/router.js`
    - 极简 hash 路由：`#/pairing` / `#/home` / `#/master-sync` / `#/product/:id` / `#/op/:type` / `#/scan-put-in` / `#/new-product` / `#/queue` / `#/upload-result/:packageId` / `#/settings`
    - 导出 `decideInitialRoute({ apiBase, hasMasterStore })`：无 `apiBase` → `pairing`；有 `apiBase` 但 master 为空 → `master-sync`；其余 → `home`
    - 全局守卫：进任意现场操作页前若 master 为空，重定向到 `master-sync`（R15.5）
    - _Requirements: 1.1, 2.7, 15.5_

  - [ ] 5.9 `assets/public/src/main.js`
    - 应用启动入口：`DOMContentLoaded` → 加载 `apiBase` / `device_id` / 本地 master → 由 `router.decideInitialRoute` 决定首屏 → 注册全局错误监听写到 `logger.js`
    - _Requirements: 1.1, 1.5, 15.6_

  - [ ]* 5.10 属性测试 `test/property/storage-and-identity.test.js`
    - **Property 18: 主数据保存-加载 round-trip**（`Validates: Requirements 2.2`）—— 用 `test/helpers/fake-filesystem.js` 内存适配器
    - **Property 22: 重置身份清空队列且改写 device_id**（`Validates: Requirements 16.4, 1.9`）
    - **Property 23: device_id 调用稳定性**（`Validates: Requirements 1.9`）
    - 被测代码用依赖注入接受 fake filesystem / fake preferences（与生产 `storage-fs.js` / `storage-prefs.js` 同接口）
    - _Requirements: 1.9, 2.2, 16.4_

- [ ] 6. 手持端 Web Bundle - 业务逻辑
  - [ ] 6.1 `assets/public/src/master-sync.js`
    - `syncMasterData()`：`fetch GET ${apiBase}/api/sync/master-data` 携 `X-Sync-Token`；200 → 用 `storage-fs.writeJsonFileAtomic` 整个替换 `master.json` 8 个 store；失败保留旧值
    - `loadLocalMasterStore()`：从 `master.json` 读出，文件缺失返回空骨架
    - `importUsbMasterPackage(filePath)`：`Filesystem.readFile` → `gunzip` → `JSON.parse` → 同样写盘
    - 持久化 `last_master_sync_at` / `base_master_package_id` 到 prefs
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_

  - [ ] 6.2 `assets/public/src/operation-queue.js`
    - 实现状态机 `pending → attempted → imported/duplicate/failed/exported`（design §Error Handling 的 mermaid 图）
    - `loadQueue / appendOperation / removeOperation / markOperations / pickPendingForUpload`
    - `appendOperation` 同步调用 `inventory-preview.applyOp` 更新内存预览快照（启动时 `loadQueue` 后回放整队列重建预览）
    - `removeOperation` 仅当 `state === "pending"`，并调用 `undoOp` 撤销预览
    - 主数据失效引用打标：提供 `markStaleReferences(queue, master)`（对应 P20）
    - 持久化路径 `operation-queue.json`，原子写
    - _Requirements: 4.6, 11.1, 11.4, 11.5, 11.6, 12.7, 15.1, 15.2_

  - [ ] 6.3 `assets/public/src/pending-products.js`
    - 实现 `Pending_Product` 本地 CRUD：`appendPendingProduct({ model, imageFile, customFieldValues })`
    - 图片以原始 base64 写入 `Documents/warehouse-handheld/images/<product_id>.jpg`，记录 `image_path`
    - 同型号（按 `normalizeModel` 比对 master + pending）时返回 `{ duplicate: true, existing }`
    - 同步成功后由 `upload-lan.js` 调用 `markPendingSynced(productId)`
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ] 6.4 `assets/public/src/upload-lan.js`
    - `uploadOperationPackage(pkg)`：`POST {apiBase}/api/sync/upload`（`Content-Type: application/json` body 直接传 `Operation_Package`，与现有 `sync.js` 期望一致），重发同包必须复用 `pkg.package_id`
    - 状态分发：HTTP 200 + 可解析响应 → 按 `applied` / `operationsApplied` / `operationsSkippedDuplicate` / `operationsFailed` 调用 `operation-queue.markOperations`；HTTP 200 但响应不可解析 → 视为网络错误（保留业务字段，仅更新 `attempt_count` / `upload_state="attempted"`）；HTTP 401 → 抛 `PairingError`，不修改队列；网络错误 → 同 200 不可解析处理
    - 上传期间通过模块级标志位禁止并发上传（避免双发产生不同 `package_id`）
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_

  - [ ] 6.5 `assets/public/src/upload-usb.js`
    - `exportPackageToUsb(pkg)`：`JSON.stringify` → `gzip`（使用 `pako` 或同等浏览器侧 gzip 库；如未引入则在该任务里加 `pako` 依赖）→ `Filesystem.writeFile({ directory: Documents, path: 'warehouse-handheld/operations-${pkg.package_id}.warehouse.gz', data: <base64> })`
    - 把队列中对应 op 标记为 `exported`；同 `package_id` 重导出复用文件名
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ] 6.6 `assets/public/src/pairing.js`
    - `startPairing({ apiBaseRaw, syncTokenRaw, deviceName })`：校验 URL 格式 → `fetch GET {apiBase}/api/sync/ping` 携 `X-Sync-Token` → 200 落地 prefs；401 抛 `PairingError("令牌无效")`；网络错误抛 `PairingError(原因)`
    - `scanPairingQr()`：调 `scanner-native.scanOnce`，把字符串 `JSON.parse` 后用 `app/shared/package-builder.validatePairingQr` 校验
    - 同时触发 `device-identity.getOrCreateDeviceId()` 持久化 `device_id`（首次启动）
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [ ]* 6.7 属性测试 `test/property/upload-and-queue.test.js`
    - **Property 19: 网络错误保留业务字段**（`Validates: Requirements 12.7`）
    - **Property 20: 主数据失效引用仅打标不删除**（`Validates: Requirements 15.2`）
    - **Property 21: 设置 device_name 不重写历史**（`Validates: Requirements 16.3`）
    - 被测函数从 `operation-queue.js` 中导出纯函数 `applyNetworkError`、`markStaleReferences`、`renameDeviceWithoutHistoryRewrite`，避免 import Capacitor
    - _Requirements: 12.7, 15.2, 16.3_

- [ ] 7. 手持端 Web Bundle - 页面
  - [ ] 7.1 `assets/public/src/pages/pairing-page.js`
    - 表单：服务器地址 / Sync_Token / Device_Name / "扫码导入配置" 按钮
    - 提交后调用 `pairing.startPairing`；成功跳 `master-sync`，失败保留输入并显示具体原因
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8_

  - [ ] 7.2 `assets/public/src/pages/home-page.js`
    - 顶部展示 `last_master_sync_at` 距今时长（"X 小时前"）+ "同步主数据" 按钮
    - 中部搜索框（实时调 `searchProducts`），结果点击进 `product-detail`
    - 底部主入口：扫码入库 / 待上传操作（带未上传计数）/ 设置
    - 搜索结果空时展示"新增产品"快捷按钮
    - 当 master 为空：禁用所有现场操作入口并提示"先同步主数据"
    - _Requirements: 2.4, 2.7, 3.1, 3.2, 3.3, 3.5, 11.1_

  - [ ] 7.3 `assets/public/src/pages/master-sync-page.js`
    - "立即同步"按钮 → `master-sync.syncMasterData`，进度状态展示
    - "导入 USB 包"按钮 → 让用户选择 `Documents/` 下 `.warehouse.gz` 文件 → `importUsbMasterPackage`
    - _Requirements: 2.1, 2.5, 2.6_

  - [ ] 7.4 `assets/public/src/pages/product-detail-page.js`
    - 顶部：型号、主图、总数量
    - 列表：所有位置库存（按 location_code 升序）：位置 / 数量 / 最后更新时间
    - 操作按钮：入库 / 移库 / 出库 / 调整（按当前位置上下文带入参数跳 `op-form`）
    - _Requirements: 3.4, 6.1, 6.2, 8.1_

  - [ ] 7.5 `assets/public/src/pages/op-form-page.js`
    - 单一表单页面覆盖 `put_in / move / move_to_external / move_from_external / ship_out / adjust_increase / adjust_decrease`，按路由参数 `:type` 切换字段
    - 来源/目标位置选择控件：仓库 → 货架 → 层数 三级 + "扫描位置码"按钮（→ `scanner-native.scanOnce` → `parseLocationCode`）；外部位置时下拉 `external_locations`
    - 数量输入校验（>0 + 不超过来源预览数量），来源/目标相同校验
    - 出库与移出仓库二次确认弹窗
    - 调整：实际数量 vs 预览数量 → 决定 `adjust_increase` / `adjust_decrease` / "无需调整"，强制备注 ≥ 1 字符
    - 提交：调对应 `op-builders.build*` → `operation-queue.appendOperation` → 返回搜索页提示"已加入待上传队列"
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7, 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ] 7.6 `assets/public/src/pages/scan-put-in-page.js`
    - 启动摄像头扫描位置码（带手输回退） → `parseLocationCode` → 在 `Local_Master_Store.shelfLevels` 校验 `location_code` 存在
    - 命中后跳 `op-form-page` 类型 `put_in`，锁定目标位置
    - 不命中显示"该位置未在主数据中，请先同步主数据"
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 7.7 `assets/public/src/pages/new-product-page.js`
    - 表单：型号（必填） / 主图（拍照或相册） / 所有 `is_required = 1` 自定义字段
    - 提交前用 `pending-products.checkDuplicateModel` 检查同型号
    - 调 `pending-products.appendPendingProduct`，成功后立即可被搜索（本地视为主数据 + "待上传"标记）
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ] 7.8 `assets/public/src/pages/queue-page.js`
    - 列表显示 `Operation_Queue`（按 `operated_at` 倒序），每行：类型 / 型号 / 数量 / 来源-目标摘要 / 时间 / 状态徽章
    - 点击 → 操作详情；`pending` 可删除（调 `removeOperation` 触发 `undoOp`）
    - 顶部按钮："通过 LAN 上传"（→ `upload-lan.uploadOperationPackage`，进度态禁用按钮）/ "导出为 USB 包"（→ `upload-usb.exportPackageToUsb`）
    - 上传完成后跳 `upload-result-page`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.5, 12.8, 13.1_

  - [ ] 7.9 `assets/public/src/pages/upload-result-page.js`
    - 汇总：成功 X / 失败 Y / 重复 Z
    - "查看失败详情"列表：每条 `failure_reason`，点击跳对应操作详情，提供"删除并重新录入" / "保留待处理"动作
    - 把本次摘要写入 `upload-history.json`（最近 10 次循环缓冲，对应 P25）
    - _Requirements: 12.3, 12.4, 14.1, 14.2, 14.3, 14.4_

  - [ ] 7.10 `assets/public/src/pages/settings-page.js`
    - 显示 `device_id` / `device_name`（可改名，不重写历史） / `apiBase` / 上次同步时间
    - "重新配对"按钮 → 跳 `pairing-page`
    - "重置设备身份"按钮 → 二次确认 + "已知晓将丢弃 N 条待上传操作"勾选 → `device-identity.resetDeviceIdentity()`
    - "导出日志"按钮 → `logger.exportLogs()`
    - _Requirements: 1.8, 15.6, 16.3, 16.4_

- [ ] 8. 检查点：构建产物可装机
  - 运行 `npm run build:handheld` → `cd android && ./gradlew assembleDebug` 必须无错；APK 路径 `android/app/build/outputs/apk/debug/app-debug.apk`。Ensure all tests pass, ask the user if questions arise.

- [ ] 9. 端到端验证与文档
  - [ ] 9.1 编写 `scripts/test-handheld-e2e.js`
    - Node 脚本，无设备依赖：随机端口启动 `server.js`（`require("./server")` 或 `child_process.spawn`），创建临时数据目录与 sync token
    - 用 `node:fetch` 模拟手持端：`GET /api/sync/ping` → `GET /api/sync/master-data` → 用 `app/shared/package-builder.buildOperationPackage` 构造一条 `put_in` `Operation_Package` → `POST /api/sync/upload`
    - 校验：HTTP 状态全为 200；`better-sqlite3` 直接读 SQLite，确认 `inventory_operations` 多了一行、`inventory_balances` 已增加；同包再上传一次校验幂等
    - 退出码 0/1；输出每步耗时
    - _Requirements: 12.1, 12.2, 12.3, 18.3_

  - [ ] 9.2 编写 `docs/handheld-smoke-test.md`
    - 镜像 design.md §Testing Strategy "设备上的烟雾流程"的 7 步清单
    - 每步附"通过判定"与"失败时收集的日志路径"
    - _Requirements: 1.1, 2.1, 5.1, 10.1, 12.1, 13.1（手动验收）_

  - [ ] 9.3 更新 `README.md`
    - 在"快速开始"节后追加"手持端 APK 构建"分节：`npm install`（提示会拉 3 个新插件）/ `npm run build:handheld` / `cd android && ./gradlew assembleDebug` / `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
    - 链接到 `docs/handheld-smoke-test.md` 与 design.md
    - _Requirements: 文档化交付_

- [ ] 10. 最终检查点：全链路通过
  - 运行 `npm test`（所有属性测试通过）+ `node scripts/test-handheld-e2e.js`（HTTP 链路通过）+ 手动核对 `docs/handheld-smoke-test.md`。Ensure all tests pass, ask the user if questions arise.

## Notes

- 标 `*` 的子任务为可选属性测试；按设计约定每条属性独占一个 `Property N` 标题与 `Validates: Requirements X.Y` 标签。
- `app/shared/*` 是桌面 PWA 与手持 Bundle 的**唯一逻辑源头**，`scripts/build-handheld.js` 通过物理拷贝把它分发到 `android/app/src/main/assets/public/shared/`；任何修改改源不改副本。
- 服务端兼容补丁（任务 2.1 / 2.2）独立于手持端 Bundle，可与第 1 节并行实施；它是 LAN 上传真正落地的前提（否则上传会被现有 `applyUploadsPayload` 静默丢弃）。
- 手持端业务模块（第 6 节）按"基础设施 → 业务 → 页面"严格分层；属性测试只跑在第 1、5、6 节的纯函数子集上。
- 任务 7.5 `op-form-page.js` 是 7 种 `Operation_Type` 的统一表单页（路由参数 `:type` 切换字段集），与设计 §Components 中 "通用操作表单"对齐，不会拆成 7 个文件。
- 检查点（任务 3、8、10）不算编码任务，不计入依赖图。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.6", "2.2"] },
    { "id": 2, "tasks": ["1.7"] },
    { "id": 3, "tasks": ["1.8", "1.9", "1.10", "1.11", "1.12", "1.13", "1.14", "1.15", "1.16", "1.17"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 6, "tasks": ["4.5"] },
    { "id": 7, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9"] },
    { "id": 8, "tasks": ["5.10", "6.1", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 9, "tasks": ["6.7", "7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "7.9", "7.10"] },
    { "id": 10, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```
