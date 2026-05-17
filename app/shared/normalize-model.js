// app/shared/normalize-model.js
//
// 与服务端 `products.model_normalized` 列保持一致的型号归一化函数。
//
// 步骤：
//   1. 把 nullish 输入显式转换为空字符串（其它非字符串走 String(...)）
//   2. 去除两侧空白
//   3. 转大写
//   4. 移除所有不在 [A-Z0-9\u4e00-\u9fff] 字符集内的字符
//
// 该模块是纯 ES Module，不依赖 DOM / Capacitor，可同时在 Node.js（属性测试）
// 与浏览器 / Android WebView（手持端 Bundle）下运行。
//
// 字符集说明：
//   - A-Z / 0-9：基本拉丁字母与数字
//   - \u4e00-\u9fff：中日韩统一表意文字基本区（覆盖常用汉字）
// 与服务端 SQL 触发器 / 应用层归一化逻辑保持一致是 R3.6 的硬性要求。
//
// Validates: Requirements 3.6

/**
 * 把任意输入归一化为型号匹配键。
 *
 * @param {unknown} input 任意输入；nullish 与非字符串都被安全处理
 * @returns {string} 仅由 `[A-Z0-9\u4e00-\u9fff]` 构成的字符串
 */
export function normalizeModel(input) {
  if (input === null || input === undefined) {
    return "";
  }
  return String(input)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\u4e00-\u9fff]+/g, "");
}
