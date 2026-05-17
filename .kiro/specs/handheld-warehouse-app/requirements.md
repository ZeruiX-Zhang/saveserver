# Requirements Document

## Introduction

本特性补齐**手持端（Handheld_App）**的离线作业能力。手持端是基于 Capacitor 包装的 Android 应用，通过 LAN HTTP（`/api/sync/*`）或 USB gzip JSON 包与电脑端 `Server` 交换数据。底层同步传输（`sync.js`）、数据模型（`docs/offline-warehouse-design.md` 11 张表 + 7 种操作类型）、扫码原语（`scanner.js`）、远程模式存储（`api-config.js`）已完成；本特性**仅实现手持端 UI 流程与离线操作生命周期**，不修改电脑端数据库结构、电脑端导入逻辑或同步包格式。

范围内：

- 首次配对（服务器地址 + 同步令牌）
- 主数据下载并落地到手持端本地存储
- 6 个核心现场操作：手工入库、扫码入库、移库、移出仓库、移回仓库、出库、盘点调整（增/减）
- 本地操作队列与全局唯一 `operation_id`
- 操作包上传（LAN 与 USB 两种通道）与结果反馈
- 手持端拍照新增产品（型号 + 主图 + 自定义字段）
- 离线按 `model` / `model_normalized` / 自定义字段值搜索本地主数据
- 设备身份（`device_id` / `device_name`）写入操作包

范围外：

- 电脑端任何 UI 或服务端代码改动
- `inventory_operations` 表结构、`operation_package` JSON schema、`/api/sync/*` 端点行为变更
- 图像相似检索（第一版仅按文本搜索）
- 多端实时双向同步（仍是导入式：包级别）

## Glossary

- **Handheld_App**：本特性交付的 Android 应用（Capacitor 壳 + Web 资产位于 `android/app/src/main/assets/public/`）。
- **Server**：电脑端 `node server.js` 进程，监听 `0.0.0.0:4173`，提供 `/api/sync/*` 端点。
- **Pairing**：手持端首次启动时完成"服务器地址 + 同步令牌 + 设备名称"配置的过程。
- **Sync_Token**：64 位十六进制字符串，由 `Server` 在 `data/sync-token.txt` 生成；手持端请求需在 `X-Sync-Token` 头携带。
- **Master_Data**：由 `Server` 通过 `GET /api/sync/master-data` 下发的 8 个 store（products、customFieldDefinitions、productCustomFieldValues、warehouses、shelves、shelfLevels、externalLocations、inventoryBalances）。
- **Local_Master_Store**：手持端本地保存的 `Master_Data` 副本（Capacitor `@capacitor/preferences` 或等价持久化）。
- **Location_Code**：仓库位置编码，格式 `<warehouse>-<shelf>-L<level>`，例如 `A01-S03-L02`，由 `scanner.js` 的 `parseLocationCode` / `formatLocationCode` 处理。
- **Operation**：一条现场动作记录，符合设计文档 §3.9 字段，并带全局唯一 `operation_id`（UUID v4）。
- **Operation_Type**：枚举集合 `{put_in, move, move_to_external, move_from_external, ship_out, adjust_increase, adjust_decrease}`。
- **Operation_Queue**：手持端本地未上传的 `Operation` 列表。
- **Operation_Package**：上传给 `Server` 的 JSON 包，遵循设计文档 §4.2 schema，含唯一 `package_id`、`device_id`、`device_name` 与 `operations` 数组。
- **Device_Id**：手持端首次启动时生成并持久化的 UUID。
- **Device_Name**：用户在 `Pairing` 阶段填入的可读名称，例如"仓管-1 号机"。
- **Upload_Result**：`Server` 对一个 `Operation_Package` 中每条 `Operation` 的处理结果，状态为 `imported` / `failed` / `duplicate`。
- **External_Location**：非仓库位置（`external_locations` 表），如 `OUTSIDE`、`CUSTOMER`。
- **Pending_Product**：手持端拍照新增、尚未上传到 `Server` 的本地 `products` 行（与 `productCustomFieldValues` 行）。

## Requirements

### Requirement 1：首次配对

**User Story:** 作为仓管员，我希望第一次打开手持端时能用扫码或手输的方式接入电脑端服务，从而开始离线作业。

#### Acceptance Criteria

1. WHEN `Handheld_App` 首次启动且本地未保存 `apiBase`，THE `Handheld_App` SHALL 显示 `Pairing` 页面而非主操作页。
2. THE `Pairing` 页面 SHALL 提供三个输入：服务器地址（如 `http://192.168.1.10:4173`）、`Sync_Token`、`Device_Name`。
3. WHERE 设备摄像头可用，THE `Pairing` 页面 SHALL 提供"扫码导入配置"按钮，可识别由 `Server` 生成的配对二维码（内容为 JSON `{"apiBase":"...","syncToken":"..."}`）。
4. WHEN 用户提交配对表单，THE `Handheld_App` SHALL 调用 `GET {apiBase}/api/sync/ping` 并携带 `X-Sync-Token` 头进行验证。
5. IF `/api/sync/ping` 返回 `200`，THEN THE `Handheld_App` SHALL 持久化 `apiBase`、`Sync_Token`、`Device_Name`、`Device_Id` 并跳转到主操作页。
6. IF `/api/sync/ping` 返回 `401`，THEN THE `Handheld_App` SHALL 显示"令牌无效"提示并保留输入内容供用户修正。
7. IF `/api/sync/ping` 因网络错误失败，THEN THE `Handheld_App` SHALL 显示具体错误消息并不落地配置。
8. WHEN 设置页面打开，THE `Handheld_App` SHALL 允许用户重新进入 `Pairing` 流程以更换服务器或令牌。
9. THE `Handheld_App` SHALL 在首次启动时生成一次 UUID 作为 `Device_Id` 并持久化保存。

### Requirement 2：主数据下载

**User Story:** 作为仓管员，我希望把电脑端的产品和仓位下载到手持端，从而离开 Wi-Fi 时也能扫码作业。

#### Acceptance Criteria

1. WHEN 配对成功后或用户在主页点击"同步主数据"，THE `Handheld_App` SHALL 调用 `GET {apiBase}/api/sync/master-data` 并携带 `X-Sync-Token` 头。
2. WHEN `/api/sync/master-data` 返回 `200`，THE `Handheld_App` SHALL 完整替换 `Local_Master_Store` 中的 8 个 store 数据（products、customFieldDefinitions、productCustomFieldValues、warehouses、shelves、shelfLevels、externalLocations、inventoryBalances）。
3. THE `Handheld_App` SHALL 持久化 `last_master_sync_at`（ISO-8601 时间戳）与下发包的 `package_id`（若 payload 提供）。
4. THE `Handheld_App` SHALL 在主页头部显示 `last_master_sync_at` 距今时长，例如"上次同步：3 小时前"。
5. IF 主数据下载失败，THEN THE `Handheld_App` SHALL 保留旧 `Local_Master_Store` 不变并显示错误原因。
6. WHERE 用户启用了 USB 主数据包导入（`/sdcard/Download/*.warehouse.gz`），THE `Handheld_App` SHALL 允许选择本地文件并按相同规则替换 `Local_Master_Store`。
7. THE `Handheld_App` SHALL 在 `Local_Master_Store` 为空时禁用所有现场操作录入入口，并提示用户先同步主数据。

### Requirement 3：离线搜索

**User Story:** 作为仓管员，我希望在没有信号时按型号或自定义字段查产品，从而确认要操作哪条记录。

#### Acceptance Criteria

1. THE `Handheld_App` SHALL 在主操作页提供单一搜索框，按用户输入实时过滤 `Local_Master_Store.products`。
2. WHEN 用户输入关键字 `q`，THE `Handheld_App` SHALL 返回满足以下任一条件的产品：`products.model` 包含 `q`、`products.model_normalized` 包含归一化(`q`)、或该产品在 `productCustomFieldValues` 中存在 `value_text` 包含 `q` 且对应字段定义 `is_searchable = 1`。
3. THE `Handheld_App` SHALL 在搜索结果中显示型号、主图缩略（若 `image_path` 可用）以及该产品当前在 `inventoryBalances` 中的总数量。
4. WHEN 用户点击某条搜索结果，THE `Handheld_App` SHALL 显示该产品的所有位置库存（按 `Location_Code` 升序），每行包括位置、数量、最后更新时间。
5. WHERE 搜索结果为空，THE `Handheld_App` SHALL 显示"未找到匹配产品"并提供"新增产品"快捷入口（详见 Requirement 10）。
6. THE 搜索归一化函数 SHALL 与 `Server` 端 `model_normalized` 保持一致（去空格、转大写、去除非字母数字字符），以避免本地命中而上传后型号不匹配。

### Requirement 4：手工入库（put_in）

**User Story:** 作为仓管员，我希望选好产品和位置直接录入新到货，从而把现货放进系统。

#### Acceptance Criteria

1. WHEN 用户在产品详情页点击"入库"，THE `Handheld_App` SHALL 显示入库表单，要求选择"仓库 → 货架 → 层数"或扫描位置码。
2. THE 入库表单 SHALL 提供数量输入框，要求严格大于 0 的实数。
3. IF 用户输入数量小于等于 0，THEN THE `Handheld_App` SHALL 阻止提交并显示"数量必须大于 0"。
4. WHEN 用户提交入库表单，THE `Handheld_App` SHALL 生成 `Operation` 记录，字段为：`operation_type=put_in`、`product_id`、`qty`、`source_location_type=none`、`target_location_type=warehouse`、`target_level_id` 来自所选层数、`operated_at` 为当前本地时间。
5. THE `Handheld_App` SHALL 为该 `Operation` 分配 UUID v4 作为 `operation_id`。
6. THE `Handheld_App` SHALL 把新生成的 `Operation` 追加到 `Operation_Queue` 并立即更新本地的 `inventoryBalances` 视图（仅本地预览，不视为已确认）。
7. WHEN 入库提交成功，THE `Handheld_App` SHALL 返回搜索页并提示"已加入待上传队列"。

### Requirement 5：扫码入库

**User Story:** 作为仓管员，我希望直接扫货架二维码就把现货放进对应位置，从而避免逐级点选。

#### Acceptance Criteria

1. WHEN 用户在主页点击"扫码入库"，THE `Handheld_App` SHALL 启动摄像头并准备识别 `Location_Code` 二维码。
2. WHEN 摄像头识别到二维码内容，THE `Handheld_App` SHALL 用 `parseLocationCode` 解析；若解析失败则显示"二维码格式应为：仓库-货架-层数"并允许重试。
3. WHEN 解析出的 `Location_Code` 在 `Local_Master_Store.shelfLevels` 中存在匹配 `location_code` 行，THE `Handheld_App` SHALL 进入"选择产品 + 输入数量"页面并锁定目标位置。
4. IF 解析出的 `Location_Code` 在 `Local_Master_Store.shelfLevels` 中不存在，THEN THE `Handheld_App` SHALL 提示"该位置未在主数据中，请先同步主数据"并阻止生成操作。
5. WHEN 用户完成产品和数量录入并提交，THE `Handheld_App` SHALL 按 Requirement 4.4 同样规则生成 `put_in` `Operation`。
6. THE `Handheld_App` SHALL 支持手动输入位置码作为扫码失败的回退路径，并对手输内容应用相同的解析与校验。

### Requirement 6：精确位置移库（move / move_to_external）

**User Story:** 作为仓管员，我希望把现有库存从一个位置挪到另一个位置，从而调整存货布局。

#### Acceptance Criteria

1. WHEN 用户在产品详情页点击"移库"，THE `Handheld_App` SHALL 要求先选择来源位置（必须是该产品在 `inventoryBalances` 中数量大于 0 的位置之一）。
2. IF 该产品在 `inventoryBalances` 中没有任何数量大于 0 的位置，THEN THE `Handheld_App` SHALL 禁用"移库"入口并提示"无可用来源库存"。
3. THE 移库表单 SHALL 要求输入移动数量，且数量必须严格大于 0 且小于等于来源位置的本地预览数量。
4. THE 移库表单 SHALL 要求选择目标位置类型为 `warehouse`（具体层数）或 `external`（具体非仓库位置）之一。
5. WHEN 目标位置类型为 `warehouse` 且与来源位置完全一致（同一 `level_id`），THE `Handheld_App` SHALL 阻止提交并提示"来源与目标相同"。
6. WHEN 提交且目标类型为 `warehouse`，THE `Handheld_App` SHALL 生成 `operation_type=move` 的 `Operation`，同时填入 `source_location_type`、`source_level_id`、`target_location_type=warehouse`、`target_level_id`。
7. WHEN 提交且目标类型为 `external`，THE `Handheld_App` SHALL 在生成操作前弹窗"确认移出仓库到 <name>？"，用户确认后生成 `operation_type=move_to_external` 的 `Operation`，填入 `target_location_type=external`、`target_external_location_id`。
8. THE `Handheld_App` SHALL 把新 `Operation` 加入 `Operation_Queue` 并按 Requirement 4.6 更新本地预览。

### Requirement 7：从外部移回仓库（move_from_external）

**User Story:** 作为仓管员，我希望把暂存在客户处或售后区的物品移回仓库，从而恢复在库状态。

#### Acceptance Criteria

1. WHEN 用户选择来源位置类型为 `external` 且目标为 `warehouse`，THE `Handheld_App` SHALL 生成 `operation_type=move_from_external` 的 `Operation`。
2. THE `Handheld_App` SHALL 仅允许选择该产品在 `inventoryBalances` 中数量大于 0 的 `external_location_id` 作为来源。
3. THE 移回操作 SHALL 遵循 Requirement 6.3 的数量校验和 Requirement 6.5 的目标位置非空校验。

### Requirement 8：出库（ship_out）

**User Story:** 作为仓管员，我希望发货时记录"真正离库"，从而把出库与暂时移出区分开。

#### Acceptance Criteria

1. WHEN 用户在产品详情页点击"出库"，THE `Handheld_App` SHALL 要求选择来源位置（仓库层数或非仓库位置）和数量。
2. THE `Handheld_App` SHALL 在出库提交前显示二次确认弹窗"确认出库 <qty> 件 <model>？"。
3. WHEN 用户确认出库，THE `Handheld_App` SHALL 生成 `operation_type=ship_out` 的 `Operation`，`target_location_type=none`，无目标位置 ID。
4. THE 出库操作 SHALL 遵循 Requirement 4 的数量校验规则（严格大于 0 且不超过来源位置本地预览数量）。

### Requirement 9：盘点调整（adjust_increase / adjust_decrease）

**User Story:** 作为仓管员，我希望盘点时能补录差异，从而把账面与现场对齐。

#### Acceptance Criteria

1. WHEN 用户在某产品 + 某位置上点击"盘点调整"，THE `Handheld_App` SHALL 要求输入"实际数量"。
2. WHEN 实际数量大于本地预览数量，THE `Handheld_App` SHALL 生成 `operation_type=adjust_increase` 的 `Operation`，`qty` 等于差值。
3. WHEN 实际数量小于本地预览数量，THE `Handheld_App` SHALL 生成 `operation_type=adjust_decrease` 的 `Operation`，`qty` 等于差值的绝对值。
4. WHEN 实际数量等于本地预览数量，THE `Handheld_App` SHALL 不生成任何 `Operation` 并提示"无需调整"。
5. THE 调整操作 SHALL 要求填入备注字段且最少 1 个字符（避免无理由的盘点修改）。

### Requirement 10：拍照新增产品

**User Story:** 作为仓管员，我希望现场遇到主数据没有的型号时直接拍照建档，从而不打断作业。

#### Acceptance Criteria

1. WHEN 用户在搜索结果为空时点击"新增产品"，THE `Handheld_App` SHALL 进入新增产品页。
2. THE 新增产品页 SHALL 要求填写型号（必填）、主图（拍照或相册选取，必填）、所有 `is_required = 1` 的自定义字段值。
3. WHEN 用户提交，THE `Handheld_App` SHALL 在本地生成 `Pending_Product` 行（含 UUID `id`、`status=ACTIVE`、`created_at` 当前时间），并按 `customFieldDefinitions` 为已填字段生成 `productCustomFieldValues` 行。
4. THE `Handheld_App` SHALL 把图片以 `image_path` 形式存入手持端本地存储，并在上传时通过 `Server` `UPLOAD_STORES` 同步图片元数据（具体二进制传输由现有同步层处理，本特性不引入新协议）。
5. WHEN `Pending_Product` 创建成功，THE `Handheld_App` SHALL 立刻在搜索结果和后续操作中可用（视同主数据），并在视觉上标记"待上传"；该可见性与"待上传"标记 SHALL 仅在 `Pending_Product` 行成功落地本地存储后出现。
6. WHEN 上传成功，THE `Handheld_App` SHALL 把对应 `Pending_Product` 标记为已同步并去掉"待上传"标记。
7. IF 同型号已存在于 `Local_Master_Store.products`（按 `model_normalized` 比对），THEN THE `Handheld_App` SHALL 提示"已存在相同型号"并提供"使用现有产品"按钮。

### Requirement 11：本地操作队列管理

**User Story:** 作为仓管员，我希望看到所有未上传的操作，从而知道待办还剩多少。

#### Acceptance Criteria

1. THE `Handheld_App` SHALL 在主页提供"待上传操作"入口，显示 `Operation_Queue` 中操作总数。
2. THE 待上传列表 SHALL 按 `operated_at` 倒序排列，每行显示类型、产品型号、数量、来源/目标摘要、生成时间。
3. WHEN 用户点击某条未上传操作，THE `Handheld_App` SHALL 显示完整字段。
4. WHILE 一条操作未上传，THE `Handheld_App` SHALL 允许用户删除该操作并撤销其在本地预览库存上的累计影响。
5. WHEN 一条操作处于"已上传成功"或"已上传失败"状态，THE `Handheld_App` SHALL 禁止再次本地编辑或删除。
6. THE `Handheld_App` SHALL 持久化 `Operation_Queue` 至本地存储；写入成功 SHALL 视为持久化完成，可读性仅在应用重启后保证（运行期内仍以内存副本为准）。

### Requirement 12：操作上传（LAN）

**User Story:** 作为仓管员，我希望连上 Wi-Fi 时一键把今日操作上传到服务器，从而完成账实对齐。

#### Acceptance Criteria

1. WHEN 用户在"待上传操作"页点击"通过 LAN 上传"，THE `Handheld_App` SHALL 把所有 `pending` 状态操作打包为 `Operation_Package`：包含 `package_id`（新生成 UUID）、`device_id`、`device_name`、`exported_at`、`base_master_package_id`（最近一次主数据下发的 `package_id`，若有）、`operations` 数组。
2. THE `Handheld_App` SHALL 通过 `POST {apiBase}/api/sync/upload`（gzip JSON body）携带 `X-Sync-Token` 上传 `Operation_Package`。
3. WHEN 上传 HTTP 状态为 `200`，THE `Handheld_App` SHALL 解析返回的 `Upload_Result`，按 `operation_id` 把每条操作标记为 `imported` / `failed` / `duplicate`。
4. THE `Handheld_App` SHALL 把 `imported` 与 `duplicate` 操作从 `Operation_Queue` 移到"历史已上传"区，把 `failed` 操作保留在队列中并附 `failure_reason`。
5. IF 上传 HTTP 状态为 `401`，THEN THE `Handheld_App` SHALL 提示"令牌无效，请重新配对"并不修改本地队列。
6. IF 上传成功返回 HTTP `200` 但响应体为空或无法解析为合法 `Upload_Result` JSON，THEN THE `Handheld_App` SHALL 按网络失败处理：保留 `Operation_Queue` 内容（业务字段）不变并显示"服务端响应无法解析，请稍后重试"。
7. IF 上传因网络错误失败，THEN THE `Handheld_App` SHALL 保留 `Operation_Queue` 中各操作的业务字段（`operation_id`、`product_id`、`qty`、来源/目标位置等）不变；允许更新非业务的尝试元数据（例如 `last_attempt_at`、`attempt_count`、`upload_state=attempted`），并提示用户稍后重试或改用 USB 包。
8. THE `Handheld_App` SHALL 在上传过程中显示进度状态并禁止用户重复点击上传按钮，避免生成重复 `package_id`。
9. WHEN 同一个 `Operation_Package` 因网络抖动被实际重发，THE `Handheld_App` SHALL 复用相同 `package_id`，从而依靠 `Server` 的 `package_id` 去重保证幂等。

### Requirement 13：操作上传（USB 包）

**User Story:** 作为仓管员，我希望 Wi-Fi 不通时把操作导出成文件，从而通过 U 盘带回电脑端。

#### Acceptance Criteria

1. WHEN 用户在"待上传操作"页点击"导出为 USB 包"，THE `Handheld_App` SHALL 生成与 Requirement 12.1 相同结构的 `Operation_Package`，gzip 后保存到设备存储 `/sdcard/Download/operations-<package_id>.warehouse.gz`。
2. THE 导出包 SHALL 与 LAN 上传共用同一个 `package_id` 命名空间，不区分通道；同一批操作只生成一个 `package_id`。
3. WHEN 导出成功，THE `Handheld_App` SHALL 把队列中对应操作标记为 `exported`（区别于 `imported`），保留在队列中直至下次 LAN 同步收到导入结果或用户手动确认"电脑端已导入"。
4. WHERE 用户在历史包列表点击"重新导出"，THE `Handheld_App` SHALL 复用原 `package_id`，确保 USB 双导也不会被电脑端重复入库。

### Requirement 14：上传结果反馈

**User Story:** 作为仓管员，我希望上传后能直观看到哪些成功、哪些失败，从而决定要不要重做。

#### Acceptance Criteria

1. WHEN 上传完成，THE `Handheld_App` SHALL 显示汇总弹窗：成功 X 条、失败 Y 条、重复 Z 条。
2. THE 汇总页 SHALL 提供"查看失败详情"按钮，列出每条失败操作的 `failure_reason`（来自 `Server` 返回值）。
3. WHEN 用户点击某条失败操作，THE `Handheld_App` SHALL 跳转到该操作详情，允许用户基于失败原因决定"删除并重新录入"或"保留待处理"。
4. THE `Handheld_App` SHALL 持久化最近 10 次上传摘要供用户回溯。

### Requirement 15：错误处理与边界

**User Story:** 作为仓管员，我希望在操作或网络异常时收到明确反馈，从而不丢失现场录入。

#### Acceptance Criteria

1. IF 用户在录入过程中应用被强制关闭，THEN THE `Handheld_App` SHALL 在下次启动时恢复 `Operation_Queue`，未提交的草稿允许丢弃。
2. IF `Local_Master_Store` 与待上传操作引用的 `product_id` 或 `level_id` 不再一致（例如主数据被替换），THEN THE `Handheld_App` SHALL 在操作详情中标记"主数据已变化，请确认"；THE `Handheld_App` SHALL 不自动删除任何已生成的待上传操作（由用户显式删除或上传后由 `Server` 判定失败）。
3. IF 设备存储空间不足无法写入 `Operation_Queue` 或图片，THEN THE `Handheld_App` SHALL 显示"存储空间不足"并阻止生成新 `Operation`。
4. THE `Handheld_App` SHALL 对所有外部输入（扫码值、手输位置码、`/api/sync/*` 响应）执行类型与格式校验，拒绝非预期结构。
5. IF 用户在没有主数据的情况下打开任意现场操作页，THEN THE `Handheld_App` SHALL 跳转到"请先同步主数据"提示页。
6. THE `Handheld_App` SHALL 把所有错误日志按时间戳追加到本地循环日志（最多 1 MB），用于事后排查。

### Requirement 16：设备身份

**User Story:** 作为仓管员，我希望每条上传记录都能追溯到来源设备，从而出错时知道找谁。

#### Acceptance Criteria

1. THE `Handheld_App` SHALL 在每个 `Operation_Package` 中写入 `device_id` 和 `device_name`。
2. THE `Handheld_App` SHALL 在每条 `Operation` 中写入 `operator_name`（来自当前登录用户输入，默认等于 `Device_Name`，每次操作可在底部覆盖）。
3. WHEN 用户在设置页修改 `Device_Name`，THE `Handheld_App` SHALL 立即应用到后续生成的 `Operation` 和 `Operation_Package`，但不重写已存在队列项的 `operator_name` 历史值。
4. THE `Device_Id` SHALL 一经生成永不变更（除非用户在设置中明确点击"重置设备身份"，此时同时清空 `Operation_Queue` 防止跨身份混淆）。

### Requirement 17：位置码解析与格式化（互逆性）

**User Story:** 作为开发者，我希望位置码格式化和解析始终一致，从而避免扫码和显示对不上。

#### Acceptance Criteria

1. THE `Handheld_App` SHALL 复用 `app/src/scanner.js` 的 `parseLocationCode` 与 `formatLocationCode`，不新建第二套实现。
2. FOR ALL 合法 `(warehouse, shelf, levelNo)` 三元组（`warehouse` 与 `shelf` 为非空 ASCII 字母数字字符串，`levelNo` 为正整数 1..999），`parseLocationCode(formatLocationCode(warehouse, shelf, levelNo))` SHALL 返回 `{ ok: true, warehouse: warehouse.toUpperCase(), shelf: shelf.toUpperCase(), levelNo }`（round-trip 属性）。
3. FOR ALL 由 `formatLocationCode` 输出的字符串 `s`，`formatLocationCode(parseLocationCode(s).warehouse, parseLocationCode(s).shelf, parseLocationCode(s).levelNo)` SHALL 等于 `s`（双向 round-trip）。
4. IF 输入字符串不符合 `LOCATION_CODE_PATTERN`，THEN `parseLocationCode` SHALL 返回 `{ ok: false, reason: <非空字符串> }`。

### Requirement 18：操作正确性属性（PBT 视角）

**User Story:** 作为开发者，我希望操作生命周期满足若干不变量，从而对随机输入也能保证数据完整性。

#### Acceptance Criteria

1. FOR ALL `Operation` 加入 `Operation_Queue`，THE `Handheld_App` SHALL 保证 `operation_id` 为合法 UUID v4 且在该设备的全部历史 + 当前队列中唯一（唯一性属性）。
2. FOR ALL `Operation_Package` 生成事件，THE `Handheld_App` SHALL 保证 `package_id` 为合法 UUID v4 且在该设备的历史包中唯一（包级唯一性）。
3. FOR ALL `Operation_Package`，把同一个 `Operation_Package` 通过 LAN 重复上传 N 次（N≥2），`Server` 端 `inventory_balances` 与 `inventory_operations` 的最终状态 SHALL 与上传 1 次完全一致（幂等性属性，由 `package_id` 与 `operation_id` 双层去重保证）。
4. FOR ALL 生成的 `put_in` / `move` / `move_to_external` / `move_from_external` / `ship_out` / `adjust_increase` / `adjust_decrease` `Operation`，`qty` SHALL 严格大于 0（数量正性属性）。
5. FOR ALL 生成 `move` 或 `move_to_external` `Operation` 的事件，本地预览的来源位置数量 SHALL 减少 `qty`，目标位置数量 SHALL 增加 `qty`，所有其他位置数量保持不变（守恒属性，仅在这两类操作生成时强制成立）。
6. FOR ALL `Operation`，对 `Operation` 应用本地预览更新两次 SHALL 与应用一次的结果不同（除非用户主动撤销之间的那次）—— 即操作不应被静默重放（非幂等的本地预览，避免双扣）。
7. FOR ALL `Operation_Queue` 状态，把队列序列化为 JSON 后再反序列化 SHALL 得到等价队列（持久化 round-trip 属性）。
8. FOR ALL `Operation_Package`，gzip 压缩后 gunzip 解压再 `JSON.parse` SHALL 得到与原始 JSON 对象语义等价的结构（传输层 round-trip 属性）。
9. FOR ALL 用户连续生成的 `put_in` 操作序列 `[op1, op2, ..., opN]` 针对同一 `(product_id, level_id)`，本地预览数量 SHALL 等于初始数量加上 `sum(opi.qty)`（线性累加属性）。
