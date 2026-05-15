PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

INSERT OR IGNORE INTO products (
    id, model, model_normalized, image_path, status, created_at, updated_at
) VALUES
    ('prd-abc-1001', 'ABC-1001', 'ABC1001', 'assets/products/abc-1001.jpg', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('prd-abc-1002', 'ABC-1002', 'ABC1002', 'assets/products/abc-1002.jpg', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('prd-mtr-2001', 'MTR-2001', 'MTR2001', 'assets/products/mtr-2001.jpg', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('prd-cab-3001', 'CAB-3001', 'CAB3001', 'assets/products/cab-3001.jpg', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('prd-sns-4001', 'SNS-4001', 'SNS4001', 'assets/products/sns-4001.jpg', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('prd-ctl-5001', 'CTL-5001', 'CTL5001', 'assets/products/ctl-5001.jpg', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00');

INSERT OR IGNORE INTO custom_field_definitions (
    id, name, field_type, options_json, is_required, is_searchable, sort_order, status, created_at, updated_at
) VALUES
    ('fld-color', 'color', 'select', '["black","blue","gray","silver","white"]', 0, 1, 1, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('fld-category', 'category', 'select', '["cable","controller","fastener","motor","sensor"]', 1, 1, 2, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('fld-spec', 'spec', 'text', NULL, 0, 1, 3, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00');

INSERT OR IGNORE INTO product_custom_field_values (
    id, product_id, field_id, value_text, created_at, updated_at
) VALUES
    ('pcfv-001', 'prd-abc-1001', 'fld-color', 'gray', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-002', 'prd-abc-1001', 'fld-category', 'fastener', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-003', 'prd-abc-1001', 'fld-spec', 'M6', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-004', 'prd-abc-1002', 'fld-color', 'silver', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-005', 'prd-abc-1002', 'fld-category', 'fastener', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-006', 'prd-abc-1002', 'fld-spec', 'M8', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-007', 'prd-mtr-2001', 'fld-color', 'black', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-008', 'prd-mtr-2001', 'fld-category', 'motor', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-009', 'prd-mtr-2001', 'fld-spec', '24V', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-010', 'prd-cab-3001', 'fld-color', 'blue', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-011', 'prd-cab-3001', 'fld-category', 'cable', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-012', 'prd-cab-3001', 'fld-spec', '2m', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-013', 'prd-sns-4001', 'fld-color', 'white', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-014', 'prd-sns-4001', 'fld-category', 'sensor', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-015', 'prd-sns-4001', 'fld-spec', 'IP67', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-016', 'prd-ctl-5001', 'fld-color', 'black', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-017', 'prd-ctl-5001', 'fld-category', 'controller', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('pcfv-018', 'prd-ctl-5001', 'fld-spec', 'RS485', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00');

INSERT OR IGNORE INTO warehouses (
    id, code, name, color_token, sort_order, status, created_at, updated_at
) VALUES
    ('wh-a01', 'A01', 'Warehouse A', 'mist-blue', 1, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('wh-b01', 'B01', 'Warehouse B', 'sage-green', 2, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('wh-c01', 'C01', 'Warehouse C', 'sand-orange', 3, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00');

INSERT OR IGNORE INTO shelves (
    id, warehouse_id, code, name, sort_order, status, created_at, updated_at
) VALUES
    ('sh-a01-s01', 'wh-a01', 'S01', 'Shelf 01', 1, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('sh-a01-s02', 'wh-a01', 'S02', 'Shelf 02', 2, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('sh-a01-s03', 'wh-a01', 'S03', 'Shelf 03', 3, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('sh-b01-s01', 'wh-b01', 'S01', 'Shelf 01', 1, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('sh-b01-s02', 'wh-b01', 'S02', 'Shelf 02', 2, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('sh-b01-s03', 'wh-b01', 'S03', 'Shelf 03', 3, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('sh-c01-s01', 'wh-c01', 'S01', 'Shelf 01', 1, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('sh-c01-s02', 'wh-c01', 'S02', 'Shelf 02', 2, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('sh-c01-s03', 'wh-c01', 'S03', 'Shelf 03', 3, 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00');

WITH RECURSIVE level_numbers(n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM level_numbers WHERE n < 4
)
INSERT OR IGNORE INTO shelf_levels (
    id, shelf_id, level_no, location_code, qr_text, sort_order, status, created_at, updated_at
)
SELECT
    'lvl-' || lower(w.code) || '-' || lower(s.code) || '-l' || printf('%02d', level_numbers.n),
    s.id,
    level_numbers.n,
    w.code || '-' || s.code || '-L' || printf('%02d', level_numbers.n),
    w.code || '-' || s.code || '-L' || printf('%02d', level_numbers.n),
    level_numbers.n,
    'active',
    '2026-04-23T09:00:00+08:00',
    '2026-04-23T09:00:00+08:00'
FROM shelves s
JOIN warehouses w ON w.id = s.warehouse_id
JOIN level_numbers;

INSERT OR IGNORE INTO external_locations (
    id, code, name, status, created_at, updated_at
) VALUES
    ('ext-outside', 'OUTSIDE', 'Outside Warehouse', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('ext-customer', 'CUSTOMER', 'Customer Side', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00'),
    ('ext-sample', 'SAMPLE', 'Sample Area', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00');

INSERT OR IGNORE INTO devices (
    id, device_code, device_name, last_exported_at, last_imported_master_at, status, created_at, updated_at
) VALUES
    ('dev-handheld-001', 'HHD-001', 'Handheld 01', '2026-04-23T15:50:00+08:00', '2026-04-23T09:05:00+08:00', 'active', '2026-04-23T09:00:00+08:00', '2026-04-23T09:00:00+08:00');

INSERT OR IGNORE INTO master_data_exports (
    id, package_id, exported_by, exported_at, note
) VALUES
    ('mexp-20260423-001', 'pkg-master-20260423-001', 'admin', '2026-04-23T09:05:00+08:00', 'Initial handheld package');

INSERT OR IGNORE INTO import_batches (
    id, batch_code, package_id, device_id, file_name, base_master_package_id,
    total_count, success_count, failed_count, imported_by, imported_at, status
) VALUES
    (
        'imp-20260423-001',
        'IMP-20260423-001',
        'pkg-ops-20260423-001',
        'dev-handheld-001',
        'handover_2026-04-23_001.json',
        'pkg-master-20260423-001',
        10,
        10,
        0,
        'admin',
        '2026-04-23T16:10:00+08:00',
        'completed'
    );

INSERT OR IGNORE INTO inventory_operations (
    id, batch_id, device_id, operation_type, product_id, qty,
    source_location_type, source_level_id, source_external_location_id,
    target_location_type, target_level_id, target_external_location_id,
    note, operator_name, operated_at, imported_at, import_status, failure_reason
) VALUES
    (
        'op-20260423-001',
        'imp-20260423-001',
        'dev-handheld-001',
        'put_in',
        'prd-abc-1001',
        12,
        'none',
        NULL,
        NULL,
        'warehouse',
        'lvl-a01-s01-l01',
        NULL,
        'Initial stock in',
        'operator-a',
        '2026-04-23T09:30:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-002',
        'imp-20260423-001',
        'dev-handheld-001',
        'put_in',
        'prd-abc-1001',
        5,
        'none',
        NULL,
        NULL,
        'warehouse',
        'lvl-a01-s02-l02',
        NULL,
        'Split stock',
        'operator-a',
        '2026-04-23T09:35:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-003',
        'imp-20260423-001',
        'dev-handheld-001',
        'put_in',
        'prd-abc-1002',
        8,
        'none',
        NULL,
        NULL,
        'warehouse',
        'lvl-b01-s01-l01',
        NULL,
        'Initial stock in',
        'operator-a',
        '2026-04-23T09:40:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-004',
        'imp-20260423-001',
        'dev-handheld-001',
        'put_in',
        'prd-mtr-2001',
        6,
        'none',
        NULL,
        NULL,
        'warehouse',
        'lvl-a01-s03-l04',
        NULL,
        'Initial stock in',
        'operator-a',
        '2026-04-23T09:50:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-005',
        'imp-20260423-001',
        'dev-handheld-001',
        'move_to_external',
        'prd-mtr-2001',
        1,
        'warehouse',
        'lvl-a01-s03-l04',
        NULL,
        'external',
        NULL,
        'ext-customer',
        'Move one unit to customer side',
        'operator-a',
        '2026-04-23T10:20:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-006',
        'imp-20260423-001',
        'dev-handheld-001',
        'put_in',
        'prd-cab-3001',
        15,
        'none',
        NULL,
        NULL,
        'warehouse',
        'lvl-c01-s02-l01',
        NULL,
        'Initial stock in',
        'operator-a',
        '2026-04-23T10:35:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-007',
        'imp-20260423-001',
        'dev-handheld-001',
        'put_in',
        'prd-sns-4001',
        9,
        'none',
        NULL,
        NULL,
        'warehouse',
        'lvl-b01-s02-l03',
        NULL,
        'Initial stock in',
        'operator-a',
        '2026-04-23T10:50:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-008',
        'imp-20260423-001',
        'dev-handheld-001',
        'put_in',
        'prd-ctl-5001',
        20,
        'none',
        NULL,
        NULL,
        'warehouse',
        'lvl-a01-s01-l03',
        NULL,
        'Initial stock in',
        'operator-a',
        '2026-04-23T11:00:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-009',
        'imp-20260423-001',
        'dev-handheld-001',
        'move',
        'prd-ctl-5001',
        4,
        'warehouse',
        'lvl-a01-s01-l03',
        NULL,
        'warehouse',
        'lvl-a01-s02-l01',
        NULL,
        'Rebalance stock',
        'operator-a',
        '2026-04-23T11:15:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    ),
    (
        'op-20260423-010',
        'imp-20260423-001',
        'dev-handheld-001',
        'ship_out',
        'prd-abc-1002',
        2,
        'warehouse',
        'lvl-b01-s01-l01',
        NULL,
        'none',
        NULL,
        NULL,
        'Customer shipment',
        'operator-a',
        '2026-04-23T11:40:00+08:00',
        '2026-04-23T16:10:00+08:00',
        'imported',
        ''
    );

INSERT OR IGNORE INTO inventory_balances (
    id, product_id, location_type, level_id, external_location_id, qty, updated_at
) VALUES
    ('bal-001', 'prd-abc-1001', 'warehouse', 'lvl-a01-s01-l01', NULL, 12, '2026-04-23T16:10:00+08:00'),
    ('bal-002', 'prd-abc-1001', 'warehouse', 'lvl-a01-s02-l02', NULL, 5, '2026-04-23T16:10:00+08:00'),
    ('bal-003', 'prd-abc-1002', 'warehouse', 'lvl-b01-s01-l01', NULL, 6, '2026-04-23T16:10:00+08:00'),
    ('bal-004', 'prd-mtr-2001', 'warehouse', 'lvl-a01-s03-l04', NULL, 5, '2026-04-23T16:10:00+08:00'),
    ('bal-005', 'prd-mtr-2001', 'external', NULL, 'ext-customer', 1, '2026-04-23T16:10:00+08:00'),
    ('bal-006', 'prd-cab-3001', 'warehouse', 'lvl-c01-s02-l01', NULL, 15, '2026-04-23T16:10:00+08:00'),
    ('bal-007', 'prd-sns-4001', 'warehouse', 'lvl-b01-s02-l03', NULL, 9, '2026-04-23T16:10:00+08:00'),
    ('bal-008', 'prd-ctl-5001', 'warehouse', 'lvl-a01-s01-l03', NULL, 16, '2026-04-23T16:10:00+08:00'),
    ('bal-009', 'prd-ctl-5001', 'warehouse', 'lvl-a01-s02-l01', NULL, 4, '2026-04-23T16:10:00+08:00');

COMMIT;
