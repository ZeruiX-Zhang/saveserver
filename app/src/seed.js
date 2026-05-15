const NOW = "2026-04-23T12:00:00+08:00";

function svgDataUrl(model, hue, tag) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${hue[0]}"/>
          <stop offset="100%" stop-color="${hue[1]}"/>
        </linearGradient>
      </defs>
      <rect width="600" height="600" rx="76" fill="url(#g)"/>
      <rect x="58" y="58" width="484" height="484" rx="50" fill="rgba(255,255,255,0.84)"/>
      <rect x="94" y="96" width="412" height="252" rx="34" fill="rgba(255,255,255,0.92)"/>
      <rect x="94" y="370" width="126" height="84" rx="22" fill="rgba(0,0,0,0.08)"/>
      <rect x="238" y="370" width="126" height="84" rx="22" fill="rgba(0,0,0,0.08)"/>
      <rect x="382" y="370" width="126" height="84" rx="22" fill="rgba(0,0,0,0.08)"/>
      <text x="300" y="210" text-anchor="middle" fill="#334038" font-size="52" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${model}</text>
      <text x="300" y="286" text-anchor="middle" fill="#687268" font-size="28" font-family="Segoe UI, Arial, sans-serif">${tag}</text>
      <text x="157" y="423" text-anchor="middle" fill="#334038" font-size="26" font-family="Segoe UI, Arial, sans-serif">仓位</text>
      <text x="301" y="423" text-anchor="middle" fill="#334038" font-size="26" font-family="Segoe UI, Arial, sans-serif">数量</text>
      <text x="445" y="423" text-anchor="middle" fill="#334038" font-size="26" font-family="Segoe UI, Arial, sans-serif">状态</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function createShelfLevels(warehouses, shelvesPerWarehouse = 3, levelsPerShelf = 4) {
  const shelves = [];
  const shelfLevels = [];

  for (const warehouse of warehouses) {
    for (let shelfNo = 1; shelfNo <= shelvesPerWarehouse; shelfNo += 1) {
      const shelfCode = `S${String(shelfNo).padStart(2, "0")}`;
      const shelfId = `shelf-${warehouse.code.toLowerCase()}-${shelfCode.toLowerCase()}`;

      shelves.push({
        id: shelfId,
        warehouseId: warehouse.id,
        code: shelfCode,
        name: `${shelfCode} 货架`,
        sortOrder: shelfNo,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      });

      for (let levelNo = 1; levelNo <= levelsPerShelf; levelNo += 1) {
        const levelId = `level-${warehouse.code.toLowerCase()}-${shelfCode.toLowerCase()}-l${String(levelNo).padStart(2, "0")}`;
        const locationCode = `${warehouse.code}-${shelfCode}-L${String(levelNo).padStart(2, "0")}`;

        shelfLevels.push({
          id: levelId,
          shelfId,
          levelNo,
          locationCode,
          qrText: locationCode,
          sortOrder: levelNo,
          status: "active",
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    }
  }

  return { shelves, shelfLevels };
}

const customFieldDefinitions = [
  {
    id: "field-color",
    name: "颜色",
    fieldType: "select",
    options: ["黑色", "蓝色", "灰色", "银色", "白色"],
    isRequired: false,
    isSearchable: true,
    sortOrder: 1,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "field-category",
    name: "类别",
    fieldType: "select",
    options: ["紧固件", "电机", "线缆", "传感器", "控制器"],
    isRequired: true,
    isSearchable: true,
    sortOrder: 2,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "field-spec",
    name: "规格",
    fieldType: "text",
    options: [],
    isRequired: false,
    isSearchable: true,
    sortOrder: 3,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const products = [
  {
    id: "prd-abc-1001",
    model: "ABC-1001",
    modelNormalized: "ABC1001",
    image: svgDataUrl("ABC-1001", ["#dce9dd", "#8da98e"], "紧固件"),
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "prd-abc-1002",
    model: "ABC-1002",
    modelNormalized: "ABC1002",
    image: svgDataUrl("ABC-1002", ["#e5dfd8", "#cfb18c"], "紧固件"),
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "prd-mtr-2001",
    model: "MTR-2001",
    modelNormalized: "MTR2001",
    image: svgDataUrl("MTR-2001", ["#dbe6ea", "#8eaab8"], "电机"),
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "prd-cab-3001",
    model: "CAB-3001",
    modelNormalized: "CAB3001",
    image: svgDataUrl("CAB-3001", ["#e2eef6", "#7d9ec6"], "线缆"),
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "prd-sns-4001",
    model: "SNS-4001",
    modelNormalized: "SNS4001",
    image: svgDataUrl("SNS-4001", ["#f2efe8", "#cab8a1"], "传感器"),
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "prd-ctl-5001",
    model: "CTL-5001",
    modelNormalized: "CTL5001",
    image: svgDataUrl("CTL-5001", ["#e0ecdf", "#92ae97"], "控制器"),
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const productCustomFieldValues = [
  ["prd-abc-1001", "field-color", "灰色"],
  ["prd-abc-1001", "field-category", "紧固件"],
  ["prd-abc-1001", "field-spec", "M6"],
  ["prd-abc-1002", "field-color", "银色"],
  ["prd-abc-1002", "field-category", "紧固件"],
  ["prd-abc-1002", "field-spec", "M8"],
  ["prd-mtr-2001", "field-color", "黑色"],
  ["prd-mtr-2001", "field-category", "电机"],
  ["prd-mtr-2001", "field-spec", "24V"],
  ["prd-cab-3001", "field-color", "蓝色"],
  ["prd-cab-3001", "field-category", "线缆"],
  ["prd-cab-3001", "field-spec", "2m"],
  ["prd-sns-4001", "field-color", "白色"],
  ["prd-sns-4001", "field-category", "传感器"],
  ["prd-sns-4001", "field-spec", "IP67"],
  ["prd-ctl-5001", "field-color", "黑色"],
  ["prd-ctl-5001", "field-category", "控制器"],
  ["prd-ctl-5001", "field-spec", "RS485"],
].map(([productId, fieldId, valueText], index) => ({
  id: `pcfv-${String(index + 1).padStart(3, "0")}`,
  productId,
  fieldId,
  valueText,
  createdAt: NOW,
  updatedAt: NOW,
}));

const warehouses = [
  { id: "warehouse-a01", code: "A01", name: "A 仓", colorToken: "blue", sortOrder: 1, status: "active", createdAt: NOW, updatedAt: NOW },
  { id: "warehouse-b01", code: "B01", name: "B 仓", colorToken: "green", sortOrder: 2, status: "active", createdAt: NOW, updatedAt: NOW },
  { id: "warehouse-c01", code: "C01", name: "C 仓", colorToken: "sand", sortOrder: 3, status: "active", createdAt: NOW, updatedAt: NOW },
];

const { shelves, shelfLevels } = createShelfLevels(warehouses);

const externalLocations = [
  { id: "ext-outside", code: "OUTSIDE", name: "移出仓库", status: "active", createdAt: NOW, updatedAt: NOW },
  { id: "ext-customer", code: "CUSTOMER", name: "客户处", status: "active", createdAt: NOW, updatedAt: NOW },
  { id: "ext-sample", code: "SAMPLE", name: "样品区", status: "active", createdAt: NOW, updatedAt: NOW },
];

const inventoryBalances = [
  { id: "bal-001", productId: "prd-abc-1001", locationType: "warehouse", levelId: "level-a01-s01-l01", externalLocationId: null, qty: 12, updatedAt: NOW },
  { id: "bal-002", productId: "prd-abc-1001", locationType: "warehouse", levelId: "level-a01-s02-l02", externalLocationId: null, qty: 5, updatedAt: NOW },
  { id: "bal-003", productId: "prd-abc-1002", locationType: "warehouse", levelId: "level-b01-s01-l01", externalLocationId: null, qty: 6, updatedAt: NOW },
  { id: "bal-004", productId: "prd-mtr-2001", locationType: "warehouse", levelId: "level-a01-s03-l04", externalLocationId: null, qty: 5, updatedAt: NOW },
  { id: "bal-005", productId: "prd-mtr-2001", locationType: "external", levelId: null, externalLocationId: "ext-customer", qty: 1, updatedAt: NOW },
  { id: "bal-006", productId: "prd-cab-3001", locationType: "warehouse", levelId: "level-c01-s02-l01", externalLocationId: null, qty: 15, updatedAt: NOW },
  { id: "bal-007", productId: "prd-sns-4001", locationType: "warehouse", levelId: "level-b01-s02-l03", externalLocationId: null, qty: 9, updatedAt: NOW },
  { id: "bal-008", productId: "prd-ctl-5001", locationType: "warehouse", levelId: "level-a01-s01-l03", externalLocationId: null, qty: 16, updatedAt: NOW },
  { id: "bal-009", productId: "prd-ctl-5001", locationType: "warehouse", levelId: "level-a01-s02-l01", externalLocationId: null, qty: 4, updatedAt: NOW },
];

const inventoryOperations = [
  {
    id: "op-20260423-001",
    batchId: "batch-demo-001",
    deviceId: "device-desktop",
    operationType: "put_in",
    productId: "prd-abc-1001",
    qty: 12,
    sourceLocationType: "none",
    sourceLevelId: null,
    sourceExternalLocationId: null,
    targetLocationType: "warehouse",
    targetLevelId: "level-a01-s01-l01",
    targetExternalLocationId: null,
    note: "演示入库",
    operatorName: "系统演示",
    operatedAt: NOW,
    importedAt: NOW,
    importStatus: "imported",
    deviceStatus: "imported",
  },
  {
    id: "op-20260423-002",
    batchId: "batch-demo-001",
    deviceId: "device-desktop",
    operationType: "move",
    productId: "prd-ctl-5001",
    qty: 4,
    sourceLocationType: "warehouse",
    sourceLevelId: "level-a01-s01-l03",
    sourceExternalLocationId: null,
    targetLocationType: "warehouse",
    targetLevelId: "level-a01-s02-l01",
    targetExternalLocationId: null,
    note: "演示移库",
    operatorName: "系统演示",
    operatedAt: NOW,
    importedAt: NOW,
    importStatus: "imported",
    deviceStatus: "imported",
  },
];

const devices = [
  {
    id: "device-desktop",
    deviceCode: "DESKTOP-001",
    deviceName: "电脑主端",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "device-handheld-001",
    deviceCode: "HHD-001",
    deviceName: "手持端 01",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const masterExports = [
  {
    id: "master-export-demo",
    packageId: "pkg-master-demo-001",
    exportedBy: "系统演示",
    exportedAt: NOW,
    note: "演示主数据包",
  },
];

const importBatches = [
  {
    id: "batch-demo-001",
    batchCode: "BATCH-DEMO-001",
    packageId: "pkg-ops-demo-001",
    deviceId: "device-handheld-001",
    fileName: "demo-operations.json",
    baseMasterPackageId: "pkg-master-demo-001",
    totalCount: 2,
    successCount: 2,
    failedCount: 0,
    importedBy: "系统演示",
    importedAt: NOW,
    status: "completed",
  },
];

export function createDemoData() {
  return {
    appMeta: [
      { key: "initialized", value: true },
      { key: "demoSeedVersion", value: 1 },
      { key: "desktopColorScheme", value: "mist" },
    ],
    products,
    customFieldDefinitions,
    productCustomFieldValues,
    warehouses,
    shelves,
    shelfLevels,
    externalLocations,
    inventoryBalances,
    inventoryOperations,
    devices,
    masterExports,
    importBatches,
  };
}

export function defaultDeviceProfile() {
  return {
    id: "device-handheld-local",
    deviceCode: "HHD-LOCAL",
    deviceName: "当前设备",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
}
