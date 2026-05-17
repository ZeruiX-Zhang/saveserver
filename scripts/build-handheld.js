#!/usr/bin/env node
/**
 * scripts/build-handheld.js
 *
 * 手持端 Capacitor Web 资产的构建器：
 *
 *   app/handheld/             ← Capacitor `webDir`（手持端源 bundle）
 *      ├─ index.html
 *      ├─ styles.css
 *      ├─ src/                ← 手持端专有模块
 *      └─ shared/             ← 由本脚本镜像自 app/shared/（**不要**手动编辑）
 *
 *   android/app/src/main/assets/public/   ← cap sync 的拷贝产物（被 .gitignore）
 *
 * 流程：
 *   1. 校验 app/shared/ 与 app/handheld/ 都存在
 *   2. 清空 app/handheld/shared/，从 app/shared/ 镜像（跳过 node_modules /
 *      隐藏文件 / __tests__）
 *   3. 调用 npx cap sync android，让 Capacitor 把 app/handheld/ 整体
 *      拷贝到 android/app/src/main/assets/public/，并更新原生项目
 *
 * 任何步骤失败都以非零退出码退出。
 *
 * Validates Requirements: 1.1（可分发性基础设施）
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC_SHARED = path.join(ROOT, "app", "shared");
const HANDHELD_BUNDLE = path.join(ROOT, "app", "handheld");
const HANDHELD_SHARED = path.join(HANDHELD_BUNDLE, "shared");

const SKIP_NAMES = new Set(["node_modules", "__tests__"]);

function log(msg) {
  process.stdout.write(`[build-handheld] ${msg}\n`);
}

function err(msg) {
  process.stderr.write(`[build-handheld] ${msg}\n`);
}

function shouldSkip(srcPath) {
  const base = path.basename(srcPath);
  if (base.startsWith(".")) return true;
  if (SKIP_NAMES.has(base)) return true;
  return false;
}

function countFilesRecursively(dir) {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (shouldSkip(full)) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}

function main() {
  // 1. 校验源
  if (!fs.existsSync(SRC_SHARED) || !fs.statSync(SRC_SHARED).isDirectory()) {
    err(`源目录不存在: ${SRC_SHARED}`);
    process.exit(1);
  }
  if (
    !fs.existsSync(HANDHELD_BUNDLE) ||
    !fs.statSync(HANDHELD_BUNDLE).isDirectory()
  ) {
    err(`手持端 bundle 源目录不存在: ${HANDHELD_BUNDLE}`);
    err("请先创建 app/handheld/ 与其内的 index.html / src/ / styles.css");
    process.exit(1);
  }

  // 2. 镜像 app/shared/ → app/handheld/shared/
  try {
    fs.rmSync(HANDHELD_SHARED, { recursive: true, force: true });
  } catch (e) {
    err(`清空 ${HANDHELD_SHARED} 失败: ${e.message}`);
    process.exit(1);
  }
  try {
    fs.mkdirSync(HANDHELD_SHARED, { recursive: true });
  } catch (e) {
    err(`创建 ${HANDHELD_SHARED} 失败: ${e.message}`);
    process.exit(1);
  }
  try {
    fs.cpSync(SRC_SHARED, HANDHELD_SHARED, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
      filter: (src) => {
        if (src === SRC_SHARED) return true;
        return !shouldSkip(src);
      },
    });
  } catch (e) {
    err(`拷贝失败: ${SRC_SHARED} -> ${HANDHELD_SHARED}: ${e.message}`);
    process.exit(1);
  }
  const sharedCount = countFilesRecursively(HANDHELD_SHARED);
  log(
    `mirrored ${sharedCount} file(s) from ${path.relative(ROOT, SRC_SHARED)} → ${path.relative(ROOT, HANDHELD_SHARED)}`
  );

  // 3. 调用 npx cap sync android（Capacitor 会把 webDir 整体拷到 android assets）
  log("running: npx cap sync android");
  const result = spawnSync("npx", ["cap", "sync", "android"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });

  if (result.error) {
    err(`无法执行 npx cap sync android: ${result.error.message}`);
    process.exit(1);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    err(`npx cap sync android 退出码非零: ${result.status}`);
    process.exit(result.status);
  }
  if (result.signal) {
    err(`npx cap sync android 被信号终止: ${result.signal}`);
    process.exit(1);
  }

  log("OK");
}

try {
  main();
} catch (e) {
  err(`未捕获异常: ${e && e.stack ? e.stack : String(e)}`);
  process.exit(1);
}
