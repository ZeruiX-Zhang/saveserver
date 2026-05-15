# 离线仓位管理系统数据设计草案

## 1. 系统定位

本方案按以下边界设计：

- `电脑端`：主系统、主数据库、查询、配置、导入、备份
- `手持端`：离线扫码/录入/移库/出库采集工具
- `数据交换方式`：文件包导入导出，不做实时联网同步

核心原则：

- 主库存只以电脑端数据库为准
- 手持端不直接改主库，只记录一条条操作
- 电脑端导入的是`操作记录`，不是整库覆盖
- 同一型号可在多个位置
- 同一位置可放多个产品
- 库存按`产品 + 位置 + 数量`管理
- 自定义字段由电脑端配置，并下发到手持端

推荐本地技术选型：

- 电脑端数据库：`SQLite`
- 手持端本地存储：`SQLite` 或 `IndexedDB`
- 图片文件：本地文件夹存储，数据库只存路径

## 2. 核心对象

系统最小对象建议如下：

- 产品
- 产品图片
- 仓库
- 货架
- 层数
- 非仓库位置
- 自定义字段定义
- 产品自定义字段值
- 当前库存汇总
- 库存操作日志
- 手持端设备
- 导入批次

## 3. 数据表设计

以下字段为建议结构，实际开发时可按 `SQLite` 调整类型。

### 3.1 产品表 `products`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| model | TEXT | 产品型号，必填，建议建索引 |
| model_normalized | TEXT | 型号归一化值，用于模糊搜索 |
| image_path | TEXT | 主图路径 |
| status | TEXT | `active` / `inactive` |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

说明：

- `model_normalized` 可用于去空格、转大写、去特殊符号后的搜索。
- 如果后续要做拍照识别型号，识别结果也落到型号搜索，不需要单独做“以图搜图”主表。

### 3.2 自定义字段定义表 `custom_field_definitions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| name | TEXT | 字段名，如“颜色”“类别” |
| field_type | TEXT | `text` / `number` / `select` |
| options_json | TEXT | 下拉候选项，JSON |
| is_required | INTEGER | 0/1 |
| is_searchable | INTEGER | 0/1，是否参与搜索 |
| sort_order | INTEGER | 排序 |
| status | TEXT | `active` / `inactive` |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3.3 产品自定义字段值表 `product_custom_field_values`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| product_id | TEXT | 产品ID |
| field_id | TEXT | 字段定义ID |
| value_text | TEXT | 统一存文本值 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

说明：

- 第一版用 `value_text` 统一存储最省事。
- 数字类字段展示时再按字段类型解释。

### 3.4 仓库表 `warehouses`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| code | TEXT | 仓库编码，如 `A01` |
| name | TEXT | 仓库名称 |
| color_token | TEXT | 配色标识，供前端高亮 |
| sort_order | INTEGER | 排序 |
| status | TEXT | `active` / `inactive` |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3.5 货架表 `shelves`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| warehouse_id | TEXT | 所属仓库 |
| code | TEXT | 货架编码，如 `S03` |
| name | TEXT | 货架名称 |
| sort_order | INTEGER | 排序 |
| status | TEXT | `active` / `inactive` |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### 3.6 层数表 `shelf_levels`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| shelf_id | TEXT | 所属货架 |
| level_no | INTEGER | 层号，如 `1`、`2`、`3` |
| location_code | TEXT | 唯一码，如 `A01-S03-L02` |
| qr_text | TEXT | 二维码内容，通常与 `location_code` 相同 |
| sort_order | INTEGER | 排序 |
| status | TEXT | `active` / `inactive` |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

说明：

- `location_code` 建议全局唯一。
- 二维码直接编码为 `A01-S03-L02`，后续扫码识别最简单。

### 3.7 非仓库位置表 `external_locations`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| code | TEXT | 编码，如 `OUTSIDE`、`CUSTOMER` |
| name | TEXT | 名称，如“移出仓库”“客户处” |
| status | TEXT | `active` / `inactive` |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

说明：

- 第一版至少保留一个 `OUTSIDE`。
- 后续可扩展为“待发货区”“售后区”“客户借出”等。

### 3.8 当前库存汇总表 `inventory_balances`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| product_id | TEXT | 产品ID |
| location_type | TEXT | `warehouse` / `external` |
| level_id | TEXT | 仓库层数ID，仓库位置时使用 |
| external_location_id | TEXT | 非仓库位置ID |
| qty | REAL | 当前数量 |
| updated_at | TEXT | 更新时间 |

唯一约束建议：

- `product_id + location_type + level_id + external_location_id`

说明：

- 这张表是“当前状态”，用于快速查询。
- 真正可追溯数据来源于操作日志表。

### 3.9 库存操作日志表 `inventory_operations`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID，操作唯一编号 |
| batch_id | TEXT | 所属导入批次或手持端批次 |
| device_id | TEXT | 来源设备 |
| operation_type | TEXT | 见下方操作类型 |
| product_id | TEXT | 产品ID |
| qty | REAL | 本次操作数量 |
| source_location_type | TEXT | `warehouse` / `external` / `none` |
| source_level_id | TEXT | 来源仓库层数 |
| source_external_location_id | TEXT | 来源非仓库位置 |
| target_location_type | TEXT | `warehouse` / `external` / `none` |
| target_level_id | TEXT | 目标仓库层数 |
| target_external_location_id | TEXT | 目标非仓库位置 |
| note | TEXT | 备注 |
| operator_name | TEXT | 操作人 |
| operated_at | TEXT | 实际操作时间 |
| imported_at | TEXT | 导入主库时间 |
| import_status | TEXT | `pending` / `imported` / `failed` |
| failure_reason | TEXT | 导入失败原因 |

建议支持的 `operation_type`：

- `put_in`：新增入库
- `move`：仓库内位置变更
- `move_to_external`：移出仓库到非仓库位置
- `move_from_external`：从非仓库位置移回仓库
- `ship_out`：出库
- `adjust_increase`：盘点加数
- `adjust_decrease`：盘点减数

### 3.10 手持端设备表 `devices`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| device_code | TEXT | 设备编号 |
| device_name | TEXT | 设备名称 |
| last_exported_at | TEXT | 最近导出时间 |
| last_imported_master_at | TEXT | 最近导入主数据时间 |
| status | TEXT | `active` / `inactive` |

### 3.11 导入批次表 `import_batches`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT | 主键，UUID |
| batch_code | TEXT | 批次号 |
| device_id | TEXT | 来源设备 |
| file_name | TEXT | 导入文件名 |
| total_count | INTEGER | 操作总数 |
| success_count | INTEGER | 成功数 |
| failed_count | INTEGER | 失败数 |
| imported_by | TEXT | 导入人 |
| imported_at | TEXT | 导入时间 |
| status | TEXT | `completed` / `partial_failed` / `failed` |

## 4. 手持端数据包设计

离线模式下建议存在两类包。

### 4.1 主数据下发包 `master_data_package`

电脑端导出，手持端导入。

用途：

- 下发最新产品列表
- 下发仓库/货架/层数
- 下发非仓库位置
- 下发自定义字段定义

建议 JSON 结构：

```json
{
  "package_type": "master_data",
  "package_id": "uuid",
  "exported_at": "2026-04-23T10:00:00+08:00",
  "products": [],
  "custom_fields": [],
  "warehouses": [],
  "shelves": [],
  "levels": [],
  "external_locations": []
}
```

### 4.2 操作上报包 `operation_package`

手持端导出，电脑端导入。

用途：

- 把现场录入、移库、出库、盘点操作带回电脑端

建议 JSON 结构：

```json
{
  "package_type": "operations",
  "package_id": "uuid",
  "device_id": "device-001",
  "device_name": "handheld-1",
  "exported_at": "2026-04-23T16:00:00+08:00",
  "base_master_package_id": "uuid",
  "operations": [
    {
      "operation_id": "uuid",
      "operation_type": "move",
      "product_id": "uuid",
      "qty": 3,
      "source_location_type": "warehouse",
      "source_location_code": "A01-S03-L02",
      "target_location_type": "warehouse",
      "target_location_code": "A01-S05-L01",
      "operator_name": "张三",
      "operated_at": "2026-04-23T15:30:00+08:00",
      "note": ""
    }
  ]
}
```

关键规则：

- 每条操作必须有全局唯一的 `operation_id`
- 每个操作包必须有唯一 `package_id`
- `base_master_package_id` 用来标识手持端基于哪一版主数据操作

## 5. 电脑端导入规则

### 5.1 导入前校验

电脑端导入时建议按以下顺序校验：

1. 文件格式是否合法
2. `package_id` 是否已导入过
3. 每条 `operation_id` 是否已存在
4. `product_id` 是否存在
5. 位置编码是否存在
6. 数量是否大于 0
7. 操作类型与来源/目标位置是否匹配

### 5.2 导入执行规则

建议每条操作单独事务处理：

1. 写入 `import_batches`
2. 按 `operated_at` 排序处理操作
3. 每条操作先检查是否重复导入
4. 校验源位置库存是否足够
5. 更新 `inventory_balances`
6. 写入 `inventory_operations`
7. 标记成功或失败

### 5.3 冲突处理规则

第一版建议保守处理，不自动猜测。

遇到以下情况直接记为失败：

- 来源位置库存不足
- 产品不存在
- 位置不存在
- 重复导入
- 源位置和目标位置相同但操作类型不合理

失败后：

- 当前操作记 `failed`
- 写明 `failure_reason`
- 不影响同批其他合法操作继续导入

### 5.4 防重复导入规则

必须同时做两层去重：

- `package_id` 去重：整个包不能重复导入
- `operation_id` 去重：同包拆开重导时仍能防重

## 6. 关键业务流程

### 6.1 手工入库

1. 手持端选择产品
2. 选择仓库-货架-层数
3. 输入数量
4. 生成 `put_in` 操作

### 6.2 扫码入库

1. 手持端拍照识别型号或选择产品
2. 扫描库位二维码
3. 自动带出 `A01-S03-L02`
4. 输入数量
5. 生成 `put_in` 操作

### 6.3 精确位置移库

1. 先搜索型号
2. 选择准确产品
3. 在位置列表中选择准确来源位置
4. 输入本次移动数量
5. 选择新位置
6. 生成 `move` 或 `move_to_external`

### 6.4 移出仓库

1. 选择准确产品与准确来源位置
2. 输入数量
3. 点选 `非仓库位置`
4. 弹窗确认“是否确认移出仓库”
5. 生成 `move_to_external`

### 6.5 出库

建议单独作为业务动作，不直接等同于“移出仓库”。

原因：

- “移出仓库”可能是借出、转样品区、转客户处
- “出库”通常代表真实离库

因此建议保留：

- `move_to_external`
- `ship_out`

## 7. 搜索设计建议

首页搜索建议统一一个输入框，支持：

- 型号模糊搜索
- 型号识别结果搜索
- 自定义字段搜索

第一版搜索数据来源：

- `products.model`
- `products.model_normalized`
- `product_custom_field_values.value_text`

不建议第一版做真正图像相似检索。

## 8. 第一版必须做的约束

为避免后期数据混乱，建议第一版就定死以下规则：

- 数量必须大于 0
- 所有移库和出库必须先选准确来源位置
- 每个手持端操作都要记录 `operation_id`
- 电脑端不可手动修改操作日志，只能补录调整单
- 删除库存数据时不要直接删日志，改用调整单抵消

## 9. 建议的下一步

基于这份数据设计，下一步最适合继续补：

1. 页面结构图
2. 电脑端导入界面规则
3. 手持端操作界面流程
4. SQLite 建表 SQL

如果进入开发阶段，建议优先顺序：

1. 建表
2. 电脑端导入逻辑
3. 手持端离线操作记录
4. 电脑端查询与可视化
