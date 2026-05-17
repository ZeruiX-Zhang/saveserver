// app/handheld/src/scanner-native.js
//
// 扫码原语：返回 `Promise<string | null>`。null 表示用户取消。
//
// 优先级：
//   1. window.BarcodeDetector + getUserMedia → 内联视频覆盖层
//   2. window.Capacitor.Plugins.BarcodeScanner（@capacitor-mlkit/barcode-scanning）
//   3. 抛错："当前环境不支持扫码，请手动输入"

import { ensureCameraPermission } from "./permissions.js";

function hasBarcodeDetector() {
  return typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
}

function hasMediaDevices() {
  return Boolean(
    typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function",
  );
}

/**
 * 启动一次扫码。返回扫到的字符串；用户取消返回 null。
 *
 * @param {{ hint?: string }} [options]
 * @returns {Promise<string | null>}
 */
export async function scanOnce(options = {}) {
  const hint = options.hint || "请将二维码 / 条码对准取景框";

  if (hasBarcodeDetector() && hasMediaDevices()) {
    const perm = await ensureCameraPermission();
    if (!perm.granted) {
      throw new Error(perm.reason || "无法访问摄像头");
    }
    return scanWithBarcodeDetector(hint);
  }

  // 回退到 Capacitor MLKit Barcode Scanner
  const BarcodeScanner = window?.Capacitor?.Plugins?.BarcodeScanner ?? null;
  if (BarcodeScanner && typeof BarcodeScanner.scan === "function") {
    const perm = await ensureCameraPermission();
    if (!perm.granted) {
      throw new Error(perm.reason || "无法访问摄像头");
    }
    try {
      const result = await BarcodeScanner.scan();
      const list = result?.barcodes;
      if (Array.isArray(list) && list.length > 0) {
        const first = list[0];
        const value =
          (typeof first.rawValue === "string" && first.rawValue) ||
          (typeof first.displayValue === "string" && first.displayValue) ||
          "";
        return value || null;
      }
      return null;
    } catch (err) {
      // 用户取消通常会抛错；我们把它视为 null 回传
      const msg = err?.message || String(err);
      if (/cancel|canceled|cancelled/i.test(msg)) {
        return null;
      }
      throw new Error(`扫码失败：${msg}`);
    }
  }

  throw new Error("当前环境不支持扫码，请手动输入");
}

/**
 * 内联 BarcodeDetector + getUserMedia 扫码实现。
 *
 * @param {string} hint
 * @returns {Promise<string | null>}
 */
function scanWithBarcodeDetector(hint) {
  return new Promise((resolve, reject) => {
    let stopped = false;
    let stream = null;
    let raf = 0;

    const overlay = document.createElement("div");
    overlay.className = "scanner-container";

    const video = document.createElement("video");
    video.className = "scanner-container__video";
    video.setAttribute("playsinline", "true");
    video.muted = true;

    const hintEl = document.createElement("div");
    hintEl.className = "scanner-container__hint";
    hintEl.textContent = hint;

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn--danger scanner-container__cancel";
    cancelBtn.textContent = "取消";

    overlay.appendChild(video);
    overlay.appendChild(hintEl);
    overlay.appendChild(cancelBtn);
    document.body.appendChild(overlay);

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      try {
        if (raf && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(raf);
        }
      } catch {
        // ignore
      }
      try {
        if (stream) {
          for (const track of stream.getTracks()) {
            try {
              track.stop();
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
      try {
        video.srcObject = null;
      } catch {
        // ignore
      }
      if (overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
    };

    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve(null);
    });

    let detector;
    try {
      detector = new window.BarcodeDetector({
        formats: ["qr_code", "code_128", "code_39", "ean_13", "data_matrix"],
      });
    } catch (err) {
      cleanup();
      reject(new Error(`初始化扫码器失败：${err?.message || err}`));
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      })
      .then(async (s) => {
        stream = s;
        if (stopped) {
          for (const track of s.getTracks()) {
            try {
              track.stop();
            } catch {
              // ignore
            }
          }
          return;
        }
        video.srcObject = s;
        try {
          await video.play();
        } catch {
          // 用户已点击按钮触发，autoplay 通常被允许
        }

        const tick = async () => {
          if (stopped) return;
          if (video.readyState < 2) {
            raf = requestAnimationFrame(tick);
            return;
          }
          try {
            const results = await detector.detect(video);
            if (results && results.length > 0) {
              const value = String(results[0].rawValue || results[0].value || "").trim();
              if (value) {
                cleanup();
                resolve(value);
                return;
              }
            }
          } catch {
            // 单帧错误可忽略
          }
          if (!stopped) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch((err) => {
        cleanup();
        reject(new Error(`无法访问摄像头：${err?.message || err}`));
      });
  });
}
