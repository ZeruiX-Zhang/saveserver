$ErrorActionPreference = 'Stop'

$path = 'D:\UserData\Desktop\saveserver\app\src\app.js'
$content = [System.IO.File]::ReadAllText($path)

function Replace-Block {
  param(
    [string]$Pattern,
    [string]$Replacement
  )

  $regex = [regex]::new($Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $regex.IsMatch($script:content)) {
    throw "Pattern not found: $Pattern"
  }
  $script:content = $regex.Replace($script:content, $Replacement, 1)
}

Replace-Block 'const DESKTOP_TABS = \[[\s\S]*?\];' @'
const DESKTOP_TABS = [
  { id: "dashboard", label: "总览" },
  { id: "catalog", label: "产品" },
  { id: "layout", label: "库位" },
  { id: "fields", label: "自定义信息" },
  { id: "packages", label: "数据包" },
];
'@

$content = [regex]::Replace(
  $content,
  '<div class="footer-note">[\s\S]*?</div>',
  '<div class="footer-note">系统可完全离线运行。电脑端负责主数据和库存管理，手持端负责现场录入、移库、出库和操作包导出。</div>',
  1
)

Replace-Block 'function renderHeader\(ctx\) \{[\s\S]*?(?=\nfunction renderDesktop\()' @'
function renderHeader(ctx) {
  const tabsHtml = state.mode === "desktop"
    ? `<div class="segmented">
        ${DESKTOP_TABS.map((tab) => `
          <button class="segment ${state.desktopTab === tab.id ? "active" : ""}" type="button" data-action="switch-desktop-tab" data-tab="${tab.id}">
            ${escapeHtml(tab.label)}
          </button>
        `).join("")}
      </div>`
    : `<div class="tag-list">
        <span class="tag">当前设备：${escapeHtml(getCurrentDeviceName())}</span>
        <span class="tag">待导出：${getPendingOperationCount(ctx)} 条</span>
        <span class="tag">主数据版本：${escapeHtml(getMetaValue("currentMasterPackageId") || "demo")}</span>
      </div>`;

  return `
    <header class="app-header">
      <div class="app-header-top">
        <div class="brand">
          <div class="brand-mark">W</div>
          <div>
            <h1 class="brand-title">离线仓位管理系统</h1>
            <p class="brand-subtitle">极简产品卡片 + 仓位可视化 + 电脑端导入导出 + 手持端离线采集</p>
          </div>
        </div>
        <div class="mode-switch">
          <button class="segment ${state.mode === "desktop" ? "active" : ""}" type="button" data-action="switch-mode" data-mode="desktop">电脑端</button>
          <button class="segment ${state.mode === "handheld" ? "active" : ""}" type="button" data-action="switch-mode" data-mode="handheld">手持端</button>
        </div>
      </div>
      <div class="app-header-bottom">
        ${tabsHtml}
        <div class="action-row">
          ${state.mode === "desktop" ? `
            <button class="button secondary" type="button" data-action="export-master">导出主数据包</button>
            <button class="button secondary" type="button" data-action="import-operations">导入操作包</button>
            <button class="button secondary" type="button" data-action="export-backup">导出完整备份</button>
          ` : `
            <button class="button secondary" type="button" data-action="import-master">导入主数据包</button>
            <button class="button secondary" type="button" data-action="export-operations">导出待同步包</button>
            <button class="button secondary" type="button" data-action="set-device-name">设置设备名</button>
          `}
        </div>
      </div>
      ${state.notice ? `<div class="status-chip ${escapeHtml(state.notice.type)}">${escapeHtml(state.notice.text)}</div>` : ""}
    </header>
  `;
}
'@

Replace-Block 'function renderDesktopDashboard\(ctx, selectedProduct\) \{[\s\S]*?(?=\nfunction renderDesktopCatalog\()' @'
function renderDesktopDashboard(ctx, selectedProduct) {
  const results = getSearchResults(ctx);
  const selectedBalances = selectedProduct ? getProductBalanceDetails(selectedProduct.id, ctx) : [];
  const totalQty = selectedBalances.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const customFieldMap = selectedProduct ? getFieldValueMap(selectedProduct.id, ctx) : new Map();

  return `
    <div class="main-grid">
      <div class="single-column">
        <section class="banner">
          <div class="banner-copy">
            <h2>首页保持极简，只显示图片和型号</h2>
            <p>顶部搜索支持型号和自定义信息模糊匹配；右侧详情可切换图形模式和表格模式。</p>
          </div>
          <div class="action-row">
            <button class="button primary" type="button" data-action="open-product-dialog">新增产品</button>
            <button class="button secondary" type="button" data-action="open-putin-dialog">手工录入</button>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">产品搜索</h3>
              <p class="panel-note">支持型号和自定义字段模糊搜索，电脑端默认按卡片方式浏览。</p>
            </div>
          </div>
          <div class="search-shell panel-body">
            <div class="search-bar">
              <span>搜索</span>
              <input type="text" placeholder="输入型号、颜色、类别、规格..." data-role="global-search" value="${escapeHtml(state.query)}">
            </div>
            <div class="hint-row">
              ${ctx.customFieldDefinitions.filter((item) => item.isSearchable).map((field) => `<span class="hint-pill">${escapeHtml(field.name)} 可搜索</span>`).join("")}
            </div>
          </div>
          <div class="product-grid">
            ${results.length ? results.map((product) => renderProductCard(product, product.id === selectedProduct?.id)).join("") : `<div class="empty-state">没有匹配的产品，可以直接新增。</div>`}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">快捷操作</h3>
              <p class="panel-note">优先处理入库、移库、移出仓库、出库，以及操作包导入导出。</p>
            </div>
          </div>
          <div class="panel-body action-card-grid">
            <div class="action-card">
              <h4>手工录入</h4>
              <p>输入型号、仓库、货架、层数和数量。不存在的内容会自动创建。</p>
              <button class="button secondary" type="button" data-action="open-putin-dialog">打开录入</button>
            </div>
            <div class="action-card">
              <h4>导入操作包</h4>
              <p>读取手持端导出的 JSON 操作包，自动更新主库存和操作日志。</p>
              <button class="button secondary" type="button" data-action="import-operations">导入操作包</button>
            </div>
            <div class="action-card">
              <h4>导出主数据包</h4>
              <p>导出产品、库位、库存和自定义字段，供手持端离线使用。</p>
              <button class="button secondary" type="button" data-action="export-master">导出主数据包</button>
            </div>
          </div>
        </section>
      </div>
      <div class="single-column">
        ${selectedProduct ? `
          <section class="panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">${escapeHtml(selectedProduct.model)}</h3>
                <p class="panel-note">已定位 ${selectedBalances.length} 个位置，总数量 ${formatQty(totalQty)}</p>
              </div>
              <div class="detail-tabs">
                <button class="detail-tab ${state.detailView === "visual" ? "active" : ""}" type="button" data-action="switch-detail-view" data-view="visual">图形模式</button>
                <button class="detail-tab ${state.detailView === "table" ? "active" : ""}" type="button" data-action="switch-detail-view" data-view="table">表格模式</button>
              </div>
            </div>
            <div class="panel-body">
              <div class="split-view">
                <div class="product-image-wrap"><img src="${escapeHtml(selectedProduct.image)}" alt="${escapeHtml(selectedProduct.model)}"></div>
                <div class="form-grid">
                  ${Array.from(customFieldMap.entries()).map(([fieldId, value]) => `
                    <div class="camera-result">${escapeHtml(ctx.customFieldDefinitionsById.get(fieldId)?.name || fieldId)}：${escapeHtml(value)}</div>
                  `).join("") || `<div class="camera-result">暂无自定义信息</div>`}
                  <button class="button secondary" type="button" data-action="open-putin-dialog" data-product-id="${selectedProduct.id}">补录数量</button>
                  <button class="button secondary" type="button" data-action="open-product-dialog" data-product-id="${selectedProduct.id}">编辑产品</button>
                </div>
              </div>
              <div style="margin-top: 18px;">
                ${state.detailView === "visual" ? renderVisualDetail(selectedProduct, ctx) : renderTableDetail(selectedProduct, ctx, "desktop")}
              </div>
            </div>
          </section>
        ` : renderEmptyPanel("先从左侧搜索并选中一个产品，再查看位置详情。")}
      </div>
    </div>
  `;
}
'@

Replace-Block 'function renderDesktopCatalog\(ctx\) \{[\s\S]*?(?=\nfunction renderDesktopLayout\()' @'
function renderDesktopCatalog(ctx) {
  return `
    <div class="single-column">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">产品与图片</h3>
            <p class="panel-note">可以新增产品、上传图片，并为每个产品补充自定义信息。</p>
          </div>
          <button class="button primary" type="button" data-action="open-product-dialog">新增产品</button>
        </div>
        <div class="panel-body card-list">
          ${ctx.products.map((product) => {
            const fieldMap = getFieldValueMap(product.id, ctx);
            return `
              <div class="list-card">
                <div class="list-card-head">
                  <div>
                    <h4 class="list-card-title">${escapeHtml(product.model)}</h4>
                    <p class="list-card-subtitle">${escapeHtml([...fieldMap.values()].join(" / ") || "暂无自定义信息")}</p>
                  </div>
                  <div class="inline-actions">
                    <button class="button secondary" type="button" data-action="select-product" data-product-id="${product.id}">查看</button>
                    <button class="button secondary" type="button" data-action="open-product-dialog" data-product-id="${product.id}">编辑</button>
                  </div>
                </div>
                <div class="split-view">
                  <div class="product-image-wrap"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.model)}"></div>
                  <div class="table-wrap">
                    <table>
                      <thead><tr><th>字段</th><th>值</th></tr></thead>
                      <tbody>
                        ${ctx.customFieldDefinitions.map((field) => `
                          <tr><td>${escapeHtml(field.name)}</td><td>${escapeHtml(fieldMap.get(field.id) || "-")}</td></tr>
                        `).join("")}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    </div>
  `;
}
'@

Replace-Block 'function renderDesktopLayout\(ctx\) \{[\s\S]*?(?=\nfunction renderDesktopFields\()' @'
function renderDesktopLayout(ctx) {
  const warehouse = ctx.warehousesById.get(state.layoutWarehouseId) || ctx.warehouses[0];
  const shelves = ctx.shelvesByWarehouseId.get(warehouse?.id) || [];
  const shelf = shelves.find((item) => item.id === state.layoutShelfId) || shelves[0];
  const levels = ctx.levelsByShelfId.get(shelf?.id) || [];

  return `
    <div class="main-grid">
      <div class="single-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">仓库配置</h3>
              <p class="panel-note">支持维护仓库、货架、层数，以及非仓库位置。</p>
            </div>
            <div class="inline-actions">
              <button class="button primary" type="button" data-action="open-warehouse-dialog">新增仓库</button>
              <button class="button secondary" type="button" data-action="open-external-location-dialog">新增非仓库位置</button>
            </div>
          </div>
          <div class="panel-body card-list">
            ${ctx.warehouses.map((item) => `
              <button class="list-card ${item.id === warehouse?.id ? "active" : ""}" type="button" data-action="select-layout-warehouse" data-warehouse-id="${item.id}">
                <div class="list-card-head">
                  <div>
                    <h4 class="list-card-title">${escapeHtml(item.name)}</h4>
                    <p class="list-card-subtitle">${escapeHtml(item.code)} · ${ctx.shelvesByWarehouseId.get(item.id)?.length || 0} 个货架</p>
                  </div>
                  <span class="tag">${escapeHtml(item.colorToken || "默认")}</span>
                </div>
              </button>
            `).join("")}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">非仓库位置</h3>
              <p class="panel-note">用于“移出仓库”“客户处”“样品区”等场景。</p>
            </div>
          </div>
          <div class="panel-body card-list">
            ${ctx.externalLocations.map((location) => `
              <div class="list-card">
                <div class="list-card-head">
                  <div>
                    <h4 class="list-card-title">${escapeHtml(location.name)}</h4>
                    <p class="list-card-subtitle">${escapeHtml(location.code)}</p>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </section>
      </div>
      <div class="single-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">${escapeHtml(warehouse?.name || "未选择仓库")} 的货架</h3>
              <p class="panel-note">选中仓库后，可以继续新增货架和层数。</p>
            </div>
            <div class="inline-actions">
              <button class="button secondary" type="button" data-action="open-shelf-dialog" ${warehouse ? `data-warehouse-id="${warehouse.id}"` : "disabled"}>新增货架</button>
              <button class="button secondary" type="button" data-action="open-levels-dialog" ${shelf ? `data-shelf-id="${shelf.id}"` : "disabled"}>批量新增层数</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="location-grid">
              ${shelves.length ? shelves.map((item) => `
                <button class="location-tile ${item.id === shelf?.id ? "active highlight-green" : ""}" type="button" data-action="select-layout-shelf" data-shelf-id="${item.id}">
                  <div class="location-name">${escapeHtml(item.code)}</div>
                  <div class="location-subtext">${ctx.levelsByShelfId.get(item.id)?.length || 0} 层</div>
                </button>
              `).join("") : `<div class="empty-state">当前仓库还没有货架，先新增一个。</div>`}
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">${escapeHtml(shelf?.code || "未选择货架")} 的层数</h3>
              <p class="panel-note">二维码内容统一采用 仓库-货架-层数 格式。</p>
            </div>
          </div>
          <div class="panel-body">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>层数</th><th>库位编码</th><th>二维码内容</th></tr>
                </thead>
                <tbody>
                  ${levels.length ? levels.map((item) => `
                    <tr>
                      <td>${item.levelNo} 层</td>
                      <td>${escapeHtml(item.locationCode)}</td>
                      <td>${escapeHtml(item.qrText)}</td>
                    </tr>
                  `).join("") : `<tr><td colspan="3">当前货架还没有层数。</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}
'@

Replace-Block 'function renderDesktopFields\(ctx\) \{[\s\S]*?(?=\nfunction renderDesktopPackages\()' @'
function renderDesktopFields(ctx) {
  return `
    <div class="single-column">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">自定义信息设置</h3>
            <p class="panel-note">支持字段名、字段类型、可选项，以及是否参与搜索。</p>
          </div>
          <button class="button primary" type="button" data-action="open-field-dialog">新增字段</button>
        </div>
        <div class="panel-body card-list">
          ${ctx.customFieldDefinitions.map((field) => `
            <div class="list-card">
              <div class="list-card-head">
                <div>
                  <h4 class="list-card-title">${escapeHtml(field.name)}</h4>
                  <p class="list-card-subtitle">${escapeHtml(field.fieldType)} · ${field.isSearchable ? "参与搜索" : "仅展示"}</p>
                </div>
                <div class="tag-list">
                  ${(field.options || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}
'@

Replace-Block 'function renderDesktopPackages\(ctx\) \{[\s\S]*?(?=\nfunction renderHandheld\()' @'
function renderDesktopPackages(ctx) {
  return `
    <div class="main-grid">
      <div class="single-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">主数据包与备份</h3>
              <p class="panel-note">电脑端负责导出主数据给手持端，也可以导出完整备份做本地归档。</p>
            </div>
            <div class="inline-actions">
              <button class="button primary" type="button" data-action="export-master">导出主数据包</button>
              <button class="button secondary" type="button" data-action="export-backup">导出完整备份</button>
              <button class="button secondary" type="button" data-action="import-backup">导入完整备份</button>
            </div>
          </div>
          <div class="panel-body card-list">
            ${ctx.masterExports.length ? ctx.masterExports.map((item) => `
              <div class="list-card">
                <div class="list-card-head">
                  <div>
                    <h4 class="list-card-title">${escapeHtml(item.packageId)}</h4>
                    <p class="list-card-subtitle">${formatDateTime(item.exportedAt)} · ${escapeHtml(item.note || "主数据导出")}</p>
                  </div>
                </div>
              </div>
            `).join("") : `<div class="empty-state">还没有导出过主数据包。</div>`}
          </div>
        </section>
      </div>
      <div class="single-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">导入批次</h3>
              <p class="panel-note">读取手持端操作包后，会在这里保留导入批次和成功失败数量。</p>
            </div>
            <button class="button primary" type="button" data-action="import-operations">导入操作包</button>
          </div>
          <div class="panel-body">
            ${ctx.importBatches.length ? renderImportBatchTable(ctx.importBatches, ctx) : `<div class="empty-state">当前还没有操作包导入记录。</div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}
'@

Replace-Block 'function renderHandheld\(ctx, selectedProduct\) \{[\s\S]*?(?=\nfunction renderProductCard\()' @'
function renderHandheld(ctx, selectedProduct) {
  const results = getSearchResults(ctx);
  const selectedBalances = selectedProduct ? getProductBalanceDetails(selectedProduct.id, ctx) : [];
  const pendingOperations = getPendingOperations(ctx);

  return `
    <div class="main-grid">
      <div class="single-column">
        <section class="banner">
          <div class="banner-copy">
            <h2>手持端离线采集</h2>
            <p>适合安卓端扫码、拍照识别型号、手工录入、移库和出库。所有操作先本地保存，再导出 JSON 给电脑端导入。</p>
          </div>
          <div class="action-row">
            <button class="button primary" type="button" data-action="detect-model">拍照识别型号</button>
            <button class="button secondary" type="button" data-action="open-putin-dialog">手工录入</button>
            <button class="button secondary" type="button" data-action="export-operations">导出待同步包</button>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">产品搜索</h3>
              <p class="panel-note">支持型号和自定义信息模糊搜索；拍照识别失败后仍可手工输入。</p>
            </div>
          </div>
          <div class="panel-body search-shell">
            <div class="search-bar">
              <span>搜索</span>
              <input type="text" placeholder="输入型号、颜色、类别、规格..." data-role="global-search" value="${escapeHtml(state.query)}">
            </div>
            <div class="action-card-grid">
              <div class="action-card">
                <h4>拍照识别型号</h4>
                <p>对着产品型号牌拍照，识别到的文字会自动带入搜索框。</p>
                <button class="button secondary" type="button" data-action="detect-model">开始识别</button>
              </div>
              <div class="action-card">
                <h4>导入主数据包</h4>
                <p>如果电脑端更新了产品、库位或库存，先在这里导入主数据。</p>
                <button class="button secondary" type="button" data-action="import-master">导入主数据包</button>
              </div>
              <div class="action-card">
                <h4>扫码填库位</h4>
                <p>录入或移库时，可以用二维码自动带出 仓库-货架-层数。</p>
                <button class="button secondary" type="button" data-action="open-putin-dialog">打开录入</button>
              </div>
            </div>
          </div>
          <div class="product-grid">
            ${results.length ? results.map((product) => renderProductCard(product, product.id === selectedProduct?.id)).join("") : `<div class="empty-state">没有找到匹配产品。</div>`}
          </div>
        </section>
      </div>
      <div class="single-column">
        ${selectedProduct ? `
          <section class="panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">${escapeHtml(selectedProduct.model)}</h3>
                <p class="panel-note">请先选择准确位置，再执行移库或出库。</p>
              </div>
            </div>
            <div class="panel-body">
              <div class="split-view">
                <div class="product-image-wrap"><img src="${escapeHtml(selectedProduct.image)}" alt="${escapeHtml(selectedProduct.model)}"></div>
                <div class="form-grid">
                  <div class="inline-actions">
                    <button class="button primary" type="button" data-action="open-putin-dialog" data-product-id="${selectedProduct.id}">新增入库</button>
                  </div>
                  <div class="camera-result">当前设备：${escapeHtml(getCurrentDeviceName())}</div>
                  <div class="camera-result">待导出操作：${pendingOperations.length} 条</div>
                  <div class="camera-result">当前共有位置：${selectedBalances.length} 个</div>
                </div>
              </div>
              <div style="margin-top: 18px;">
                ${renderTableDetail(selectedProduct, ctx, "handheld")}
              </div>
            </div>
          </section>
        ` : renderEmptyPanel("先从左侧搜索并选中一个产品，再进行录入或移库。")}
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">待导出操作</h3>
              <p class="panel-note">这些记录会在导出操作包后带回电脑端导入。</p>
            </div>
          </div>
          <div class="panel-body">
            ${renderOperationsList(pendingOperations.slice(0, 12), ctx, true)}
          </div>
        </section>
      </div>
    </div>
  `;
}
'@

Replace-Block 'function renderVisualDetail\(product, ctx\) \{[\s\S]*?(?=\nfunction renderTableDetail\()' @'
function renderVisualDetail(product, ctx) {
  const balances = getProductBalanceDetails(product.id, ctx);
  const selection = getVisualSelection(balances, ctx);
  const warehouseId = selection.warehouseId;
  const shelfId = selection.shelfId;
  const shelves = ctx.shelvesByWarehouseId.get(warehouseId) || [];
  const levels = ctx.levelsByShelfId.get(shelfId) || [];
  const shelfBalanceIds = new Set(balances.filter((item) => item.locationType === "warehouse" && item.warehouseId === warehouseId).map((item) => item.shelfId));
  const levelBalanceIds = new Set(balances.filter((item) => item.locationType === "warehouse" && item.shelfId === shelfId).map((item) => item.levelId));

  return `
    <div class="step-shell">
      <div class="step-labels">
        <span class="step-pill active">1. 仓库</span>
        <span class="step-pill ${warehouseId ? "active" : ""}">2. 货架</span>
        <span class="step-pill ${shelfId ? "active" : ""}">3. 层数</span>
      </div>
      <div>
        <div class="panel-note">步骤 1：所在仓库会柔和高亮。</div>
        <div class="location-grid" style="margin-top: 10px;">
          ${ctx.warehouses.map((warehouse) => {
            const hasProduct = balances.some((item) => item.locationType === "warehouse" && item.warehouseId === warehouse.id);
            const tokenClass = warehouse.colorToken === "green" ? "highlight-green" : warehouse.colorToken === "sand" ? "highlight-sand" : "highlight-blue";
            return `
              <button class="location-tile ${hasProduct ? tokenClass : "dimmed"} ${warehouse.id === warehouseId ? "active" : ""}" type="button" data-action="select-warehouse" data-warehouse-id="${warehouse.id}">
                <div class="location-name">${escapeHtml(warehouse.name)}</div>
                <div class="location-subtext">${hasProduct ? "有该产品" : "未放置该产品"}</div>
              </button>
            `;
          }).join("")}
        </div>
      </div>
      <div>
        <div class="panel-note">步骤 2：点击仓库后，有库存的货架会高亮显示。</div>
        <div class="location-grid" style="margin-top: 10px;">
          ${shelves.length ? shelves.map((shelf) => `
            <button class="location-tile ${shelfBalanceIds.has(shelf.id) ? "highlight-green" : "dimmed"} ${shelf.id === shelfId ? "active" : ""}" type="button" data-action="select-shelf" data-shelf-id="${shelf.id}">
              <div class="location-name">${escapeHtml(shelf.code)}</div>
              <div class="location-subtext">${shelfBalanceIds.has(shelf.id) ? "有库存" : "无库存"}</div>
            </button>
          `).join("") : `<div class="empty-state">当前仓库还没有货架。</div>`}
        </div>
      </div>
      <div>
        <div class="panel-note">步骤 3：点击货架后，对应层数会高亮显示。</div>
        <div class="location-grid" style="margin-top: 10px;">
          ${levels.length ? levels.map((level) => `
            <div class="location-tile ${levelBalanceIds.has(level.id) ? "highlight-sand" : "dimmed"}">
              <div class="location-name">${level.levelNo} 层</div>
              <div class="location-subtext">${escapeHtml(level.locationCode)}</div>
            </div>
          `).join("") : `<div class="empty-state">当前货架还没有层数。</div>`}
        </div>
      </div>
    </div>
  `;
}
'@

Replace-Block 'function renderTableDetail\(product, ctx, mode\) \{[\s\S]*?(?=\nfunction renderOperationsList\()' @'
function renderTableDetail(product, ctx, mode) {
  const balances = getProductBalanceDetails(product.id, ctx);
  const fieldMap = getFieldValueMap(product.id, ctx);

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>仓库</th>
            <th>货架</th>
            <th>层数 / 外部</th>
            <th>数量</th>
            <th>自定义信息</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${balances.length ? balances.map((balance) => `
            <tr>
              <td>${escapeHtml(balance.locationType === "warehouse" ? balance.warehouseName : "-")}</td>
              <td>${escapeHtml(balance.locationType === "warehouse" ? balance.shelfCode : "-")}</td>
              <td>${escapeHtml(balance.locationType === "warehouse" ? `${balance.levelNo} 层` : balance.externalName || balance.label)}</td>
              <td>${formatQty(balance.qty)}</td>
              <td>${escapeHtml(Array.from(fieldMap.values()).join(" / ") || "-")}</td>
              <td>
                <div class="inline-actions">
                  <button class="button secondary" type="button" data-action="open-move-dialog" data-balance-id="${balance.id}" data-mode="${mode}">移库 / 出库</button>
                </div>
              </td>
            </tr>
          `).join("") : `<tr><td colspan="6">当前没有库存位置。</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}
'@

Replace-Block 'function renderOperationsList\(operations, ctx, handheld = false\) \{[\s\S]*?(?=\nfunction renderImportBatchTable\()' @'
function renderOperationsList(operations, ctx, handheld = false) {
  if (!operations.length) {
    return `<div class="empty-state">还没有操作记录。</div>`;
  }

  return `
    <div class="card-list">
      ${operations.map((operation) => {
        const product = ctx.productsById.get(operation.productId);
        const status = operation.deviceStatus === "pending" ? "pending" : operation.importStatus === "failed" ? "failed" : "ready";
        return `
          <div class="list-card">
            <div class="list-card-head">
              <div>
                <h4 class="list-card-title">${escapeHtml(product?.model || operation.productId)}</h4>
                <p class="list-card-subtitle">${escapeHtml(operationLabel(operation, ctx))}</p>
              </div>
              <span class="status-chip ${status}">${handheld ? (operation.deviceStatus === "pending" ? "待导出" : "已导出") : escapeHtml(operation.importStatus || "已记录")}</span>
            </div>
            <div class="tag-list">
              <span class="tag">数量 ${formatQty(operation.qty)}</span>
              <span class="tag">${formatDateTime(operation.operatedAt)}</span>
              <span class="tag">${escapeHtml(operation.operatorName || "-")}</span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}
'@

Replace-Block 'function renderImportBatchTable\(batches, ctx\) \{[\s\S]*?(?=\nfunction renderEmptyPanel\()' @'
function renderImportBatchTable(batches, ctx) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>批次号</th><th>来源设备</th><th>总数</th><th>成功</th><th>失败</th><th>导入时间</th></tr></thead>
        <tbody>
          ${batches.map((batch) => `
            <tr>
              <td>${escapeHtml(batch.batchCode)}</td>
              <td>${escapeHtml(ctx.devicesById.get(batch.deviceId)?.deviceName || "-")}</td>
              <td>${batch.totalCount}</td>
              <td>${batch.successCount}</td>
              <td>${batch.failedCount}</td>
              <td>${formatDateTime(batch.importedAt)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
'@

Replace-Block 'function operationLabel\(operation, ctx\) \{[\s\S]*?(?=\nfunction describeOperationLocation\()' @'
function operationLabel(operation, ctx) {
  const source = describeOperationLocation(operation.sourceLocationType, operation.sourceLevelId, operation.sourceExternalLocationId, ctx);
  const target = describeOperationLocation(operation.targetLocationType, operation.targetLevelId, operation.targetExternalLocationId, ctx);
  const typeLabelMap = {
    put_in: "入库",
    move: "移库",
    move_to_external: "移出仓库",
    move_from_external: "移回仓库",
    ship_out: "出库",
    adjust_increase: "盘点增加",
    adjust_decrease: "盘点减少",
  };
  return `${typeLabelMap[operation.operationType] || operation.operationType} · ${source} -> ${target}`;
}
'@

Replace-Block 'function describeOperationLocation\(type, levelId, externalLocationId, ctx\) \{[\s\S]*?(?=\nfunction getPendingOperations\()' @'
function describeOperationLocation(type, levelId, externalLocationId, ctx) {
  if (type === "none") {
    return "无";
  }
  if (type === "warehouse") {
    const path = ctx.levelPathById.get(levelId);
    return path ? `${path.warehouse.name}/${path.shelf.code}/${path.level.levelNo}层` : "未知仓位";
  }
  const external = ctx.externalLocationsById.get(externalLocationId);
  return external?.name || "非仓库位置";
}
'@

Replace-Block 'function getCurrentDeviceName\(\) \{[\s\S]*?(?=\nfunction bindEvents\()' @'
function getCurrentDeviceName() {
  const current = state.snapshot.devices.find((item) => item.id === state.currentDeviceId);
  return current?.deviceName || "当前设备";
}
'@

[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
