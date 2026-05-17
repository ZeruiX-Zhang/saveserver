// app/handheld/src/ui.js
//
// 共享 DOM 辅助：HTML 转义、挂载与事件绑定、toast。
//
// 该模块不假设任何上下文：在浏览器 / Android WebView 中均可运行。
// 不引入框架；保持函数颗粒度极小。

const APP_ROOT_ID = "app";
const TOAST_HOST_ID = "toast-host";

const HTML_ESCAPE_REGEX = /[&<>"']/g;
const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * 转义任意值用于嵌入 HTML 文本节点 / 属性值。
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(HTML_ESCAPE_REGEX, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * 将 HTML 字符串挂载到 #app 容器，并执行可选的事件附着函数。
 *
 * @param {string} html
 * @param {(root: HTMLElement) => void} [attach]
 * @returns {HTMLElement | null}
 */
export function mount(html, attach) {
  if (typeof document === "undefined") return null;
  const root = document.getElementById(APP_ROOT_ID);
  if (!root) return null;
  root.innerHTML = html;
  if (typeof attach === "function") {
    try {
      attach(root);
    } catch (err) {
      // 让上层错误监听器处理；不要静默
      throw err;
    }
  }
  return root;
}

/**
 * 给容器内所有 `[data-action]` 元素绑定 click 事件。
 * 用 event delegation 简化页面级代码。
 *
 * @param {HTMLElement} root
 * @param {Record<string, (event: Event, el: HTMLElement) => void>} map
 */
export function bindClicks(root, map) {
  if (!root || !map) return;
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const el = target.closest("[data-action]");
    if (!el || !root.contains(el)) return;
    const action = el.getAttribute("data-action");
    if (action && Object.prototype.hasOwnProperty.call(map, action)) {
      map[action](event, /** @type {HTMLElement} */ (el));
    }
  });
}

/**
 * 给容器内 form 元素绑定 submit 事件。
 *
 * @param {HTMLElement} root
 * @param {string} formSelector
 * @param {(event: SubmitEvent, form: HTMLFormElement) => void} handler
 */
export function bindSubmit(root, formSelector, handler) {
  if (!root) return;
  const form = root.querySelector(formSelector);
  if (!(form instanceof HTMLFormElement)) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handler(event, form);
  });
}

/**
 * 显示一个 toast。kind ∈ { "info", "success", "error", "warning" }。
 *
 * @param {string} message
 * @param {string} [kind="info"]
 * @param {number} [durationMs=2200]
 */
export function toast(message, kind = "info", durationMs = 2200) {
  if (typeof document === "undefined") return;
  let host = document.getElementById(TOAST_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = TOAST_HOST_ID;
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = String(message ?? "");
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 200ms ease";
    setTimeout(() => {
      if (el.parentElement) el.parentElement.removeChild(el);
    }, 220);
  }, durationMs);
}

/**
 * 简易日期格式化为 `YYYY-MM-DD HH:mm`，本地时区。
 *
 * @param {string | number | Date | null | undefined} value
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * 将一个 ISO timestamp 距今的人类可读时长，例如 "5 分钟前"。
 *
 * @param {string | number | Date | null | undefined} value
 * @returns {string}
 */
export function formatTimeSince(value) {
  if (!value) return "从未";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "从未";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return formatDateTime(d);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return formatDateTime(d);
}

/**
 * 将一个 button 在执行 async 操作期间禁用。
 *
 * @template T
 * @param {HTMLButtonElement} btn
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withButtonBusy(btn, fn) {
  if (!btn) return fn();
  const prevDisabled = btn.disabled;
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  try {
    return await fn();
  } finally {
    btn.disabled = prevDisabled;
    btn.removeAttribute("aria-busy");
    if (prevText !== null && btn.textContent !== prevText) {
      // 调用方可能修改了文字；不强制还原
    }
  }
}
