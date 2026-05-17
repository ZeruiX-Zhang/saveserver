// app/handheld/src/upload-usb.js
//
// USB 包导出：把 Operation_Package gzip 后写到
// `Documents/warehouse-handheld/operations-<package_id>.warehouse.gz`。
//
// Validates: Requirements 13.1, 13.2, 13.3, 13.4

import { gzipUtf8, bytesToBase64 } from "./gzip.js";
import { writeBase64 } from "./storage-fs.js";
import { OP_STATES, markOperations } from "./operation-queue.js";
import { log } from "./logger.js";

/**
 * 把一个 Operation_Package 导出为 USB gzip 文件。
 *
 * @param {object} pkg
 * @returns {Promise<{ filePath: string, byteSize: number }>} 相对 Documents/warehouse-handheld/ 的路径
 */
export async function exportPackageToUsb(pkg) {
  if (!pkg || typeof pkg !== "object" || !Array.isArray(pkg.operations)) {
    throw new TypeError("无效的 Operation_Package");
  }
  if (!pkg.package_id) {
    throw new TypeError("Operation_Package 缺少 package_id");
  }

  const json = JSON.stringify(pkg);
  const bytes = await gzipUtf8(json);
  const base64 = bytesToBase64(bytes);
  const filePath = `operations-${pkg.package_id}.warehouse.gz`;

  await writeBase64(filePath, base64);

  // 标记所有 op 为 exported
  await markOperations(
    pkg.operations.map((op) => ({
      operationId: op.operation_id,
      state: OP_STATES.EXPORTED,
      failureReason: null,
    })),
  );

  log("info", "upload-usb", "exported", {
    packageId: pkg.package_id,
    byteSize: bytes.byteLength,
  });

  return { filePath, byteSize: bytes.byteLength };
}
