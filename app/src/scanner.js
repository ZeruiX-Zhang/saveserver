export { parseLocationCode, formatLocationCode } from "../shared/location-code.js";

export function hasBarcodeDetector() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export function hasMediaDevices() {
  return typeof navigator !== "undefined"
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function";
}

export async function startCameraScanner({ video, onResult, onError, signal }) {
  if (!hasMediaDevices()) {
    onError?.(new Error("当前浏览器不支持摄像头"));
    return null;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
      },
      audio: false,
    });
  } catch (error) {
    onError?.(new Error(error?.message || "无法访问摄像头"));
    return null;
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  try {
    await video.play();
  } catch {
    // ignore autoplay rejection — user gesture should have triggered start
  }

  const stopTracks = () => {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
    }
    if (video.srcObject === stream) {
      video.srcObject = null;
    }
  };

  let stopped = false;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    stopTracks();
  };

  signal?.addEventListener("abort", stop, { once: true });

  if (!hasBarcodeDetector()) {
    onError?.(new Error("当前浏览器不支持自动扫码，请手动输入"));
    return { stop, supportsAutoDetect: false };
  }

  let detector;
  try {
    detector = new window.BarcodeDetector({
      formats: ["qr_code", "code_128", "code_39", "ean_13", "data_matrix"],
    });
  } catch (error) {
    onError?.(new Error("初始化扫码器失败"));
    return { stop, supportsAutoDetect: false };
  }

  const tick = async () => {
    if (stopped || video.readyState < 2) {
      if (!stopped) {
        requestAnimationFrame(tick);
      }
      return;
    }
    try {
      const results = await detector.detect(video);
      if (results && results.length) {
        const value = (results[0].rawValue || results[0].value || "").trim();
        if (value) {
          stop();
          onResult?.(value);
          return;
        }
      }
    } catch {
      // ignore frame errors and keep polling
    }
    if (!stopped) {
      requestAnimationFrame(tick);
    }
  };

  requestAnimationFrame(tick);

  return { stop, supportsAutoDetect: true };
}
