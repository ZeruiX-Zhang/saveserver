// app/handheld/src/gzip.js
//
// 浏览器端 gzip 工具，使用 CompressionStream / DecompressionStream API。
// 现代浏览器（Chrome 80+、Android WebView 80+）原生支持，无需 vendor pako。
//
// 不可用时（例如老 WebView），抛出 Error("当前环境不支持 gzip")。

/**
 * 把 UTF-8 文本压缩为 gzip 字节。
 *
 * @param {string} text
 * @returns {Promise<Uint8Array>}
 */
export async function gzipUtf8(text) {
  if (typeof CompressionStream !== "function") {
    throw new Error("当前环境不支持 gzip");
  }
  const bytes = new TextEncoder().encode(String(text ?? ""));
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  // 写入并关闭
  await writer.write(bytes);
  await writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * 把 gzip 字节解压为 UTF-8 文本。
 *
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
export async function gunzipBytes(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("当前环境不支持 gzip");
  }
  const u8 =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : new ArrayBuffer(0));
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  await writer.write(u8);
  await writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(out);
}

/**
 * Uint8Array → base64。在 WebView 中借助 btoa；超过 ~50KB 时使用 chunk 处理
 * 以避免栈溢出（fromCharCode 的 args 上限）。
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    bytes = new Uint8Array(bytes || []);
  }
  const CHUNK = 0x8000;
  let str = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    str += String.fromCharCode.apply(null, slice);
  }
  if (typeof btoa === "function") {
    return btoa(str);
  }
  // Node fallback
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  throw new Error("无法编码 base64");
}

/**
 * base64 → Uint8Array。
 *
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function base64ToBytes(b64) {
  const s = String(b64 ?? "");
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(s, "base64"));
  }
  throw new Error("无法解码 base64");
}
