# 手持端 APK 真机烟雾测试

本文档定义了在真机上验证 `handheld-warehouse-app` 端到端可用的人工测试流程。
完成本次开发后**必须**在一台 Android 设备上跑一遍以确认上线就绪。

清单镜像 `design.md` §Testing Strategy "设备上的烟雾流程"：
配对 → 主数据同步 → 拍照新增产品 → 扫码入库/移库/出库/调整 → LAN 上传 → 离线 USB 导出。

---

## 前置条件

- 一台运行 Android 9 (API 28) 或更高的设备，剩余存储空间 ≥ 200 MB。
- 设备与电脑在同一局域网下，能互相 ping 通。
- 电脑已执行 `npm start`，控制台打印的 LAN 地址（如 `http://192.168.x.x:4173`）可在浏览器中打开。
- 电脑端防火墙允许 4173 端口入站。
- 手持端 APK 已通过下列命令构建并装机：

  ```bash
  npm run build:handheld
  cd android && ./gradlew assembleDebug
  adb install -r app/build/outputs/apk/debug/app-debug.apk
  ```

- 备好一台电脑或手机的截图工具与 `adb logcat` 抓取窗口（用于失败时收集证据）。
- 设备上的"仓储管理系统"应为全新安装（如有旧数据建议先 `adb uninstall com.local.warehouse` 再装）。

---

## 测试步骤

### 1. 首次启动 → 配对页

**步骤**

- 在设备桌面找到"仓储管理系统"图标并点击启动。

**通过判定**

- 出现"配对"页面，至少包含三个输入框（服务器地址 / Sync Token / 设备名称）和一个"扫描二维码"按钮。
- 不会闪退、不会卡白屏，30 秒内完成首屏渲染。

**失败时收集**

- `adb logcat -d *:W | grep -iE "Capacitor|MainActivity|com\.local\.warehouse"`
- 设备截图（启动后第一屏）
- `adb shell dumpsys package com.local.warehouse | findstr versionName`（确认安装的是最新 APK）

---

### 2. 扫描配对二维码 / 手动输入

**步骤**

- 在电脑端 PWA 打开"同步与共享"对话框 → 展开"手持端配对"面板。
- 点击设备上"扫描二维码"按钮，对准电脑屏幕上的 QR 码扫描。
- 如扫码失败，使用面板中的 IP 与 Token 在设备上手动输入。
- 确认设备名（如 `仓管 1 号机`），提交。

**通过判定**

- 提交后 toast 显示"配对成功"，自动跳转到"主数据同步"页。
- 服务器地址栏自动填入正确的 LAN IP（如 `http://192.168.x.x:4173`）。
- `device_id` 已生成（在 `设置` 页可见）。

**失败时收集**

- 手持端"导出日志"输出
  （`设置 → 导出日志`，再 `adb pull /sdcard/Documents/warehouse-handheld/log-export-*.txt`）
- 服务器端 `data/sync-token.txt` 的当前值（确认令牌一致）
- `adb logcat -d *:W | grep -iE "Capacitor|fetch|pairing"`
- 设备截图（错误提示）

---

### 3. 同步主数据

**步骤**

- 在主数据同步页点击"立即同步"。
- 等待进度提示完成。

**通过判定**

- banner 显示"同步完成：products N，customFieldDefinitions N，..."形式的统计。
- 自动或可手动跳转到主页。
- 主页头部显示"上次同步：刚刚"。
- 在搜索框输入主数据中的任意型号片段，能列出对应产品。

**失败时收集**

- 手持端日志（`Documents/warehouse-handheld/log.txt`，通过`导出日志`再 `adb pull`）
- 浏览器开发工具（`chrome://inspect` 调试设备 WebView）的 Network 面板：`/api/sync/master-data` 的 HTTP 状态与响应体
- 电脑端 `data/warehouse.db` 是否有产品数据（用 SQLite 工具直接读 `products` / `inventory_balances`）
- 电脑端 `npm start` 控制台的 stderr 输出

---

### 4. 拍照新增产品

**步骤**

- 在主页搜索一个不存在的型号 → 点击"新增产品"快捷按钮。
- 填入新型号 `SMOKE-TEST-001`。
- 点击"拍照 / 选图"，确认权限提示后拍一张图片。
- 填好其它必填自定义字段，提交。

**通过判定**

- toast 显示"已保存（待上传）"。
- 回到主页搜索 `SMOKE` 能找到该产品，标有"待上传"标记。
- 进入该产品的 `product-detail-page` 时可见型号与图片，总数量为 0。

**失败时收集**

- `adb logcat -d *:W | grep -iE "Camera|Filesystem"`
- 手持端日志
- 检查待上传产品文件是否落盘（任选一种方式）：
  - `adb pull /sdcard/Documents/warehouse-handheld/pending-products.json`
  - `adb pull /sdcard/Documents/warehouse-handheld/images/`

---

### 5. 五种核心操作各跑一条

按以下顺序录入；目的是覆盖所有 `Operation_Type`（`put_in` / `move` / `move_to_external` / `ship_out` / `adjust_increase` 或 `adjust_decrease`）：

1. **扫码入库（put_in）**
   主页 → 扫码入库 → 扫一个真实库位 QR 码 → 选择产品 → qty=10 → 提交。
2. **移库（move）**
   在 `product-detail-page` 上点"移库" → 选择来源/目标层数（不同位置） → qty=3 → 提交。
3. **移出仓库（move_to_external）**
   在移库表单中目标类型选 external → 选 OUTSIDE 类外部位置 → 弹窗确认 → 提交。
4. **出库（ship_out）**
   在 `product-detail-page` 点"出库" → qty=2 → 二次确认 → 提交。
5. **盘点调整（adjust_increase）**
   在 `product-detail-page` 点"调整" → 实际数量 > 预览数量 → 备注必填 → 提交。

**通过判定**

- 每次提交后均显示 toast "已加入待上传队列"。
- 待上传队列入口的徽章数自上次开始递增到 5。
- 每条 op 在队列页中显示正确的 type / 数量 / 来源-目标摘要 / 时间戳。
- 数据持久：杀掉 App（`adb shell am force-stop com.local.warehouse`）再启动，队列依旧是 5 条。
- `product-detail-page` 上的本地库存预览反映了五条操作累计（put_in +10 → move 3 → move_to_external → ship_out -2 → adjust）。

**失败时收集**

- 手持端日志
- `adb pull /sdcard/Documents/warehouse-handheld/operation-queue.json`，对比 7 个字段表（design.md §Data Models）
- 队列页与产品详情页截图

---

### 6. LAN 上传

**步骤**

- 在队列页点击"通过 LAN 上传"。

**通过判定**

- 上传按钮先禁用，随后跳转到"上传结果"页。
- 显示已导入 N、重复 0、失败 0；N 应与本次队列长度一致。
- 队列页中所有上传过的 op 状态变为"已导入"。
- 在电脑端 PWA 主页，刚才录入的产品可见，库存数量正确反映 5 条 op 的累计。
- 电脑端 SQLite 中可以查到对应的 `inventory_operations` 行（用 SQLite 工具直接读 `data/warehouse.db`）。

**失败时收集**

- 上传结果页截图
- 服务器端 `npm start` 的 stdout / stderr（看是否打印了 `applyUploadsPayload` 报错或 `operations 字段未识别` 警告）
- 手持端日志
- chrome://inspect → Network 面板的 `POST /api/sync/upload` 请求体与响应
- 关闭 Wi-Fi 重试一次 → 确认会提示"网络异常，已保留待上传操作"

---

### 7. USB 包导出（离线场景）

**步骤**

- 在设备上断开 Wi-Fi（飞行模式或关闭 Wi-Fi 开关均可）。
- 在 `product-detail-page` 再录入一条 `put_in` 操作（qty=1）。
- 在队列页点击"导出 USB 包"。

**通过判定**

- toast 显示"已导出：operations-<uuid>.warehouse.gz"。
- `adb pull /sdcard/Documents/warehouse-handheld/operations-*.warehouse.gz` 能成功拿到该文件。
- 该文件可通过 `gunzip -c <file> | python -m json.tool` 解析为合法 JSON，
  且包含 `package_id` / `device_id` / `operations` 字段。
- 队列中对应 op 状态变为"已导出"。
- 在电脑端把该 `.warehouse.gz` 通过"同步与共享"中的"导入包"功能导入后，库存正确累加 1。

**失败时收集**

- `adb shell ls -la /sdcard/Documents/warehouse-handheld/`
- 手持端日志
- 电脑端导入包流程 stdout

---

## 通过判定汇总

| 步骤 | 通过 | 备注 |
| --- | :---: | --- |
| 1. 启动 → 配对 | ☐ |  |
| 2. 配对成功 | ☐ |  |
| 3. 同步主数据 | ☐ |  |
| 4. 新增产品 | ☐ |  |
| 5. 五种操作录入 | ☐ |  |
| 6. LAN 上传 | ☐ |  |
| 7. USB 包导出 | ☐ |  |

全部 ✅ 后即视为本次手持端发布通过烟雾测试。

---

## 常见问题排查

### 配对页提示"无法连接服务器"

- 检查电脑与设备是否在同一 Wi-Fi（不同 SSID 即使同名也可能隔离）。
- 电脑 `ipconfig` 确认 IPv4 地址，与配对面板显示的一致。
- 手持端浏览器（Chrome）访问 `http://<电脑 IP>:4173/`，确认 PWA 主页能否打开。
- Windows 防火墙是否放行 `node.exe` 入站（公用网络配置文件需特别开启）。
- AP 隔离 / Client Isolation：在企业 Wi-Fi 中常被启用，需要 IT 关闭或改用同一台 PC 开热点。

### 配对页提示"令牌无效"

- 在电脑端"同步与共享"对话框点"显示"再点"复制"，手动输入到设备上。
- 确认 `data/sync-token.txt` 文件未被改动；如有疑问可先在电脑端用 `curl -H "X-Sync-Token: <token>" http://localhost:4173/api/sync/ping` 自测。

### 扫码无反应

- 设备相机权限是否授予（系统设置 → 应用 → 仓储管理系统 → 权限 → 相机）。
- 屏幕亮度太低导致摄像头看不清 QR；或 QR 太小（拉近距离 / 让对方放大）。
- 切换为手动输入，验证非扫码路径是否正常。

### 上传后电脑端看不到新数据

- 用 SQLite 工具直接读 `data/warehouse.db` 的 `inventory_operations` / `inventory_balances`，看 op 是否真落库。
- 服务器 stdout 是否有错误。
- 检查 `applyUploadsPayload` 是否已支持 `operations` 数组（详见 design.md §Server-Side Considerations）；若服务端尚未补丁，HTTP 200 也不会真正落库。
