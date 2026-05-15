PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    model_normalized TEXT NOT NULL,
    image_path TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    field_type TEXT NOT NULL
        CHECK (field_type IN ('text', 'number', 'select')),
    options_json TEXT,
    is_required INTEGER NOT NULL DEFAULT 0
        CHECK (is_required IN (0, 1)),
    is_searchable INTEGER NOT NULL DEFAULT 0
        CHECK (is_searchable IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_custom_field_values (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    field_id TEXT NOT NULL,
    value_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    FOREIGN KEY (field_id) REFERENCES custom_field_definitions(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    color_token TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shelves (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (warehouse_id, code),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS shelf_levels (
    id TEXT PRIMARY KEY,
    shelf_id TEXT NOT NULL,
    level_no INTEGER NOT NULL CHECK (level_no > 0),
    location_code TEXT NOT NULL UNIQUE,
    qr_text TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (shelf_id, level_no),
    FOREIGN KEY (shelf_id) REFERENCES shelves(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS external_locations (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    device_code TEXT NOT NULL UNIQUE,
    device_name TEXT NOT NULL,
    last_exported_at TEXT,
    last_imported_master_at TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS master_data_exports (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL UNIQUE,
    exported_by TEXT NOT NULL DEFAULT '',
    exported_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    batch_code TEXT NOT NULL UNIQUE,
    package_id TEXT NOT NULL UNIQUE,
    device_id TEXT,
    file_name TEXT NOT NULL,
    base_master_package_id TEXT,
    total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
    success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    imported_by TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('completed', 'partial_failed', 'failed')),
    FOREIGN KEY (device_id) REFERENCES devices(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_balances (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    location_type TEXT NOT NULL
        CHECK (location_type IN ('warehouse', 'external')),
    level_id TEXT,
    external_location_id TEXT,
    qty REAL NOT NULL CHECK (qty >= 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (
        (location_type = 'warehouse' AND level_id IS NOT NULL AND external_location_id IS NULL) OR
        (location_type = 'external' AND level_id IS NULL AND external_location_id IS NOT NULL)
    ),
    FOREIGN KEY (product_id) REFERENCES products(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    FOREIGN KEY (level_id) REFERENCES shelf_levels(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    FOREIGN KEY (external_location_id) REFERENCES external_locations(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inventory_operations (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    device_id TEXT,
    operation_type TEXT NOT NULL
        CHECK (
            operation_type IN (
                'put_in',
                'move',
                'move_to_external',
                'move_from_external',
                'ship_out',
                'adjust_increase',
                'adjust_decrease'
            )
        ),
    product_id TEXT NOT NULL,
    qty REAL NOT NULL CHECK (qty > 0),
    source_location_type TEXT NOT NULL
        CHECK (source_location_type IN ('warehouse', 'external', 'none')),
    source_level_id TEXT,
    source_external_location_id TEXT,
    target_location_type TEXT NOT NULL
        CHECK (target_location_type IN ('warehouse', 'external', 'none')),
    target_level_id TEXT,
    target_external_location_id TEXT,
    note TEXT NOT NULL DEFAULT '',
    operator_name TEXT NOT NULL DEFAULT '',
    operated_at TEXT NOT NULL,
    imported_at TEXT,
    import_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (import_status IN ('pending', 'imported', 'failed')),
    failure_reason TEXT NOT NULL DEFAULT '',
    CHECK (
        (source_location_type = 'none' AND source_level_id IS NULL AND source_external_location_id IS NULL) OR
        (source_location_type = 'warehouse' AND source_level_id IS NOT NULL AND source_external_location_id IS NULL) OR
        (source_location_type = 'external' AND source_level_id IS NULL AND source_external_location_id IS NOT NULL)
    ),
    CHECK (
        (target_location_type = 'none' AND target_level_id IS NULL AND target_external_location_id IS NULL) OR
        (target_location_type = 'warehouse' AND target_level_id IS NOT NULL AND target_external_location_id IS NULL) OR
        (target_location_type = 'external' AND target_level_id IS NULL AND target_external_location_id IS NOT NULL)
    ),
    FOREIGN KEY (batch_id) REFERENCES import_batches(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES products(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    FOREIGN KEY (source_level_id) REFERENCES shelf_levels(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    FOREIGN KEY (source_external_location_id) REFERENCES external_locations(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    FOREIGN KEY (target_level_id) REFERENCES shelf_levels(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    FOREIGN KEY (target_external_location_id) REFERENCES external_locations(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_custom_field_unique
    ON product_custom_field_values (product_id, field_id);

CREATE INDEX IF NOT EXISTS idx_products_model
    ON products (model);

CREATE INDEX IF NOT EXISTS idx_products_model_normalized
    ON products (model_normalized);

CREATE INDEX IF NOT EXISTS idx_custom_field_searchable
    ON custom_field_definitions (is_searchable, status);

CREATE INDEX IF NOT EXISTS idx_product_custom_field_value_text
    ON product_custom_field_values (value_text);

CREATE INDEX IF NOT EXISTS idx_shelves_warehouse_id
    ON shelves (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_shelf_levels_shelf_id
    ON shelf_levels (shelf_id);

CREATE INDEX IF NOT EXISTS idx_devices_status
    ON devices (status);

CREATE INDEX IF NOT EXISTS idx_import_batches_device_id
    ON import_batches (device_id);

CREATE INDEX IF NOT EXISTS idx_import_batches_imported_at
    ON import_batches (imported_at);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_product_id
    ON inventory_balances (product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_level_id
    ON inventory_balances (level_id);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_external_location_id
    ON inventory_balances (external_location_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_balances_warehouse_unique
    ON inventory_balances (product_id, level_id)
    WHERE location_type = 'warehouse' AND level_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_balances_external_unique
    ON inventory_balances (product_id, external_location_id)
    WHERE location_type = 'external' AND external_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_operations_batch_id
    ON inventory_operations (batch_id);

CREATE INDEX IF NOT EXISTS idx_inventory_operations_device_id
    ON inventory_operations (device_id);

CREATE INDEX IF NOT EXISTS idx_inventory_operations_product_id
    ON inventory_operations (product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_operations_operated_at
    ON inventory_operations (operated_at);

CREATE INDEX IF NOT EXISTS idx_inventory_operations_import_status
    ON inventory_operations (import_status);

CREATE INDEX IF NOT EXISTS idx_inventory_operations_source_level_id
    ON inventory_operations (source_level_id);

CREATE INDEX IF NOT EXISTS idx_inventory_operations_target_level_id
    ON inventory_operations (target_level_id);

COMMIT;
