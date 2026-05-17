// test/property/op-builders.test.js
//
// 属性测试 ── op-builders.js 工厂的字段形状契约与数量正性。
//
// 该文件仅覆盖 design.md §Correctness Properties 的 Property 5 / Property 6，
// 不重复测试其他属性。运行时仅依赖 `node:test` + `fast-check`，不触碰 DOM /
// Capacitor —— 与 design §Testing Strategy "纯逻辑导入策略"对齐。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

import {
  buildPutIn,
  buildMoveWarehouse,
  buildMoveToExternal,
  buildMoveFromExternal,
  buildShipOut,
  buildAdjustIncrease,
  buildAdjustDecrease,
  _validators,
} from "../../app/shared/op-builders.js";

import {
  productIdArb,
  qtyArb,
  levelIdArb,
  externalIdArb,
} from "../helpers/arbitraries.js";

const UUID_V4_REGEX = _validators.UUID_V4_REGEX;

/** 固定时钟：2024-05-04T16:00:00Z，确保 operated_at 可复现。 */
const FIXED_NOW = 1_714_838_400_000;

/**
 * 注入序列化的 UUID v4 生成器：返回
 * `00000000-0000-4000-8000-<12-hex 序号>`，仍然匹配 `UUID_V4_REGEX`
 * （第 3 段首字 4，第 4 段首字 8，第 5 段 12 hex），便于在测试中断言
 * `op.operation_id` 形状而不依赖 `crypto.randomUUID`。
 */
function makeIdGen() {
  let n = 0;
  return () => {
    n += 1;
    const hex = n.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  };
}

/** 每次属性迭代用一组全新的 deps，避免上一轮序号污染本轮断言。 */
function makeDeps() {
  return { now: () => FIXED_NOW, idGen: makeIdGen() };
}

/** 可选 operator_name：空 / undefined 用来覆盖"默认 \"\""分支。 */
const operatorNameArb = fc.oneof(
  fc.constant(undefined),
  fc.string({ unit: "grapheme-ascii", maxLength: 20 }),
);

/** 普通 note：可选；adjust_* 单独使用 requiredNoteArb。 */
const noteArb = fc.oneof(
  fc.constant(undefined),
  fc.string({ unit: "grapheme-ascii", maxLength: 20 }),
);

/** adjust_* 要求 note 长度 ≥ 1（R9.5）。 */
const requiredNoteArb = fc.string({
  unit: "grapheme-ascii",
  minLength: 1,
  maxLength: 20,
});

/**
 * 共有断言：所有工厂产物都必须满足 operation_id 匹配 UUID v4、operator_name
 * 是字符串（缺省回退 ""）、operated_at 是 ISO-8601 字符串。
 */
function assertCommonShape(op, { operationType, expectedQty }) {
  assert.equal(op.operation_type, operationType);
  assert.equal(op.qty, expectedQty);
  assert.match(op.operation_id, UUID_V4_REGEX);
  assert.equal(typeof op.operator_name, "string");
  assert.equal(typeof op.operated_at, "string");
  // 固定时钟下 operated_at 必须等于 FIXED_NOW 对应的 ISO 串
  assert.equal(op.operated_at, new Date(FIXED_NOW).toISOString());
}

// ──────────────────────────────────────────────────────────────────────────
// Property 5: Operation 工厂的字段形状契约
// Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2
// ──────────────────────────────────────────────────────────────────────────

test("Property 5: put_in 字段形状契约 (Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2)", () => {
  fc.assert(
    fc.property(
      fc.record({
        productId: productIdArb,
        qty: qtyArb,
        targetLevelId: levelIdArb,
        operatorName: operatorNameArb,
        note: noteArb,
      }),
      (input) => {
        const op = buildPutIn(input, makeDeps());
        assertCommonShape(op, { operationType: "put_in", expectedQty: input.qty });
        assert.equal(op.source_location_type, "none");
        assert.equal(op.source_level_id, null);
        assert.equal(op.source_external_location_id, null);
        assert.equal(op.target_location_type, "warehouse");
        assert.equal(op.target_level_id, input.targetLevelId);
        assert.notEqual(op.target_level_id, null);
        assert.equal(op.target_external_location_id, null);
      },
    ),
  );
});

test("Property 5: move 字段形状契约 (Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2)", () => {
  fc.assert(
    fc.property(
      fc
        .record({
          productId: productIdArb,
          qty: qtyArb,
          sourceLevelId: levelIdArb,
          targetLevelId: levelIdArb,
          operatorName: operatorNameArb,
          note: noteArb,
        })
        .filter((r) => r.sourceLevelId !== r.targetLevelId),
      (input) => {
        const op = buildMoveWarehouse(input, makeDeps());
        assertCommonShape(op, { operationType: "move", expectedQty: input.qty });
        assert.equal(op.source_location_type, "warehouse");
        assert.equal(op.source_level_id, input.sourceLevelId);
        assert.equal(op.source_external_location_id, null);
        assert.equal(op.target_location_type, "warehouse");
        assert.equal(op.target_level_id, input.targetLevelId);
        assert.equal(op.target_external_location_id, null);
        assert.notEqual(op.source_level_id, op.target_level_id);
      },
    ),
  );
});

test("Property 5: move_to_external 字段形状契约 (Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2)", () => {
  fc.assert(
    fc.property(
      fc.record({
        productId: productIdArb,
        qty: qtyArb,
        sourceLevelId: levelIdArb,
        targetExternalId: externalIdArb,
        operatorName: operatorNameArb,
        note: noteArb,
      }),
      (input) => {
        const op = buildMoveToExternal(input, makeDeps());
        assertCommonShape(op, {
          operationType: "move_to_external",
          expectedQty: input.qty,
        });
        assert.equal(op.source_location_type, "warehouse");
        assert.equal(op.source_level_id, input.sourceLevelId);
        assert.equal(op.source_external_location_id, null);
        assert.equal(op.target_location_type, "external");
        assert.equal(op.target_level_id, null);
        assert.equal(op.target_external_location_id, input.targetExternalId);
        assert.notEqual(op.target_external_location_id, null);
      },
    ),
  );
});

test("Property 5: move_from_external 字段形状契约 (Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2)", () => {
  fc.assert(
    fc.property(
      fc.record({
        productId: productIdArb,
        qty: qtyArb,
        sourceExternalId: externalIdArb,
        targetLevelId: levelIdArb,
        operatorName: operatorNameArb,
        note: noteArb,
      }),
      (input) => {
        const op = buildMoveFromExternal(input, makeDeps());
        assertCommonShape(op, {
          operationType: "move_from_external",
          expectedQty: input.qty,
        });
        assert.equal(op.source_location_type, "external");
        assert.equal(op.source_level_id, null);
        assert.equal(op.source_external_location_id, input.sourceExternalId);
        assert.notEqual(op.source_external_location_id, null);
        assert.equal(op.target_location_type, "warehouse");
        assert.equal(op.target_level_id, input.targetLevelId);
        assert.equal(op.target_external_location_id, null);
      },
    ),
  );
});

test("Property 5: ship_out 字段形状契约 (Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2)", () => {
  // ship_out 来源是 warehouse XOR external 的二选一，分支 oneof 覆盖两种情形。
  const inputArb = fc.oneof(
    fc.record({
      productId: productIdArb,
      qty: qtyArb,
      sourceLocationType: fc.constant("warehouse"),
      sourceLevelId: levelIdArb,
      operatorName: operatorNameArb,
      note: noteArb,
    }),
    fc.record({
      productId: productIdArb,
      qty: qtyArb,
      sourceLocationType: fc.constant("external"),
      sourceExternalId: externalIdArb,
      operatorName: operatorNameArb,
      note: noteArb,
    }),
  );
  fc.assert(
    fc.property(inputArb, (input) => {
      const op = buildShipOut(input, makeDeps());
      assertCommonShape(op, { operationType: "ship_out", expectedQty: input.qty });
      // target 必为 none / null 三件套
      assert.equal(op.target_location_type, "none");
      assert.equal(op.target_level_id, null);
      assert.equal(op.target_external_location_id, null);
      // source warehouse XOR external
      if (input.sourceLocationType === "warehouse") {
        assert.equal(op.source_location_type, "warehouse");
        assert.equal(op.source_level_id, input.sourceLevelId);
        assert.equal(op.source_external_location_id, null);
      } else {
        assert.equal(op.source_location_type, "external");
        assert.equal(op.source_level_id, null);
        assert.equal(op.source_external_location_id, input.sourceExternalId);
      }
    }),
  );
});

test("Property 5: adjust_increase 字段形状契约 (Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2)", () => {
  // adjust_increase 目标是 warehouse XOR external 的二选一。
  const inputArb = fc.oneof(
    fc.record({
      productId: productIdArb,
      qty: qtyArb,
      targetLevelId: levelIdArb,
      operatorName: operatorNameArb,
      note: requiredNoteArb,
    }),
    fc.record({
      productId: productIdArb,
      qty: qtyArb,
      targetExternalId: externalIdArb,
      operatorName: operatorNameArb,
      note: requiredNoteArb,
    }),
  );
  fc.assert(
    fc.property(inputArb, (input) => {
      const op = buildAdjustIncrease(input, makeDeps());
      assertCommonShape(op, {
        operationType: "adjust_increase",
        expectedQty: input.qty,
      });
      // source 必为 none / null 三件套
      assert.equal(op.source_location_type, "none");
      assert.equal(op.source_level_id, null);
      assert.equal(op.source_external_location_id, null);
      // target warehouse XOR external
      if (input.targetLevelId !== undefined) {
        assert.equal(op.target_location_type, "warehouse");
        assert.equal(op.target_level_id, input.targetLevelId);
        assert.equal(op.target_external_location_id, null);
      } else {
        assert.equal(op.target_location_type, "external");
        assert.equal(op.target_level_id, null);
        assert.equal(op.target_external_location_id, input.targetExternalId);
      }
    }),
  );
});

test("Property 5: adjust_decrease 字段形状契约 (Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2)", () => {
  // adjust_decrease 来源是 warehouse XOR external 的二选一。
  const inputArb = fc.oneof(
    fc.record({
      productId: productIdArb,
      qty: qtyArb,
      sourceLevelId: levelIdArb,
      operatorName: operatorNameArb,
      note: requiredNoteArb,
    }),
    fc.record({
      productId: productIdArb,
      qty: qtyArb,
      sourceExternalId: externalIdArb,
      operatorName: operatorNameArb,
      note: requiredNoteArb,
    }),
  );
  fc.assert(
    fc.property(inputArb, (input) => {
      const op = buildAdjustDecrease(input, makeDeps());
      assertCommonShape(op, {
        operationType: "adjust_decrease",
        expectedQty: input.qty,
      });
      // target 必为 none / null 三件套
      assert.equal(op.target_location_type, "none");
      assert.equal(op.target_level_id, null);
      assert.equal(op.target_external_location_id, null);
      // source warehouse XOR external
      if (input.sourceLevelId !== undefined) {
        assert.equal(op.source_location_type, "warehouse");
        assert.equal(op.source_level_id, input.sourceLevelId);
        assert.equal(op.source_external_location_id, null);
      } else {
        assert.equal(op.source_location_type, "external");
        assert.equal(op.source_level_id, null);
        assert.equal(op.source_external_location_id, input.sourceExternalId);
      }
    }),
  );
});

test("Property 5: operator_name 缺省回退为空串 (Validates: Requirements 4.4, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 16.2)", () => {
  // 当 operatorName 为 undefined / null 时，所有工厂应该把 operator_name 写成 ""。
  fc.assert(
    fc.property(
      fc.record({
        productId: productIdArb,
        qty: qtyArb,
        targetLevelId: levelIdArb,
        // 不传 operatorName / note → 走默认分支
      }),
      (input) => {
        const op = buildPutIn(input, makeDeps());
        assert.equal(op.operator_name, "");
        assert.equal(op.note, "");
      },
    ),
  );
});

// ──────────────────────────────────────────────────────────────────────────
// Property 6: 数量正性
// Validates: Requirements 18.4, 4.2, 4.3
// ──────────────────────────────────────────────────────────────────────────

/**
 * 把 qty 套入 7 个工厂各自的合法输入；其他字段固定，仅 qty 变化。
 * 用于 Property 6 的"qty > 0 → output.qty === input.qty"与
 * "qty 非法 → 抛错"两侧测试。
 */
function callAllFactoriesWithQty(qty) {
  return [
    {
      name: "buildPutIn",
      run: () =>
        buildPutIn(
          { productId: "PROD0001", qty, targetLevelId: "LVL0001" },
          makeDeps(),
        ),
    },
    {
      name: "buildMoveWarehouse",
      run: () =>
        buildMoveWarehouse(
          {
            productId: "PROD0001",
            qty,
            sourceLevelId: "LVL0001",
            targetLevelId: "LVL0002",
          },
          makeDeps(),
        ),
    },
    {
      name: "buildMoveToExternal",
      run: () =>
        buildMoveToExternal(
          {
            productId: "PROD0001",
            qty,
            sourceLevelId: "LVL0001",
            targetExternalId: "EXT0001",
          },
          makeDeps(),
        ),
    },
    {
      name: "buildMoveFromExternal",
      run: () =>
        buildMoveFromExternal(
          {
            productId: "PROD0001",
            qty,
            sourceExternalId: "EXT0001",
            targetLevelId: "LVL0001",
          },
          makeDeps(),
        ),
    },
    {
      name: "buildShipOut",
      run: () =>
        buildShipOut(
          {
            productId: "PROD0001",
            qty,
            sourceLocationType: "warehouse",
            sourceLevelId: "LVL0001",
          },
          makeDeps(),
        ),
    },
    {
      name: "buildAdjustIncrease",
      run: () =>
        buildAdjustIncrease(
          {
            productId: "PROD0001",
            qty,
            targetLevelId: "LVL0001",
            note: "scheduled count",
          },
          makeDeps(),
        ),
    },
    {
      name: "buildAdjustDecrease",
      run: () =>
        buildAdjustDecrease(
          {
            productId: "PROD0001",
            qty,
            sourceLevelId: "LVL0001",
            note: "scheduled count",
          },
          makeDeps(),
        ),
    },
  ];
}

test("Property 6: qty > 0 时 7 个工厂保留输入数量 (Validates: Requirements 18.4, 4.2, 4.3)", () => {
  fc.assert(
    fc.property(qtyArb, (qty) => {
      for (const { name, run } of callAllFactoriesWithQty(qty)) {
        const op = run();
        assert.equal(op.qty, qty, `${name} 应当保留 qty === input.qty`);
      }
    }),
  );
});

test("Property 6: qty ∈ {0, -1, NaN, \"abc\"} 时 7 个工厂全部抛错 (Validates: Requirements 18.4, 4.2, 4.3)", () => {
  const badQtyValues = [0, -1, Number.NaN, "abc"];
  for (const badQty of badQtyValues) {
    for (const { name, run } of callAllFactoriesWithQty(badQty)) {
      assert.throws(
        run,
        (err) => err instanceof TypeError && /qty must be a positive/.test(err.message),
        `${name}(qty=${String(badQty)}) 应当抛 TypeError`,
      );
    }
  }
});
