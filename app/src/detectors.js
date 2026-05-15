async function createBitmapFromFile(file) {
  if (!file) {
    throw new Error("未选择文件");
  }
  return createImageBitmap(file);
}

export async function detectLocationCodeFromFile(file) {
  if (!("BarcodeDetector" in window)) {
    return {
      supported: false,
      values: [],
      message: "当前浏览器不支持二维码识别，已自动回退到手工输入。",
    };
  }

  const bitmap = await createBitmapFromFile(file);

  try {
    const detector = new BarcodeDetector({
      formats: ["qr_code", "code_128", "code_39", "ean_13"],
    });
    const results = await detector.detect(bitmap);
    return {
      supported: true,
      values: results
        .map((item) => item.rawValue || item.value || "")
        .map((item) => item.trim())
        .filter(Boolean),
      message: results.length ? "已识别到二维码内容。" : "未识别到二维码，请尝试重新拍摄或手工输入。",
    };
  } finally {
    bitmap.close?.();
  }
}

export async function detectModelTextFromFile(file) {
  if (!("TextDetector" in window)) {
    return {
      supported: false,
      values: [],
      message: "当前浏览器未开放离线文字识别接口，请拍照后手工确认型号。",
    };
  }

  const bitmap = await createBitmapFromFile(file);

  try {
    const detector = new TextDetector();
    const blocks = await detector.detect(bitmap);
    const values = blocks
      .flatMap((block) => {
        if (Array.isArray(block.lines) && block.lines.length) {
          return block.lines.map((line) => line.rawValue || line.text || "");
        }
        return [block.rawValue || block.text || ""];
      })
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      supported: true,
      values,
      message: values.length ? "已识别到型号候选文本。" : "没有识别到可用文字，请重新拍摄或手工输入。",
    };
  } finally {
    bitmap.close?.();
  }
}
