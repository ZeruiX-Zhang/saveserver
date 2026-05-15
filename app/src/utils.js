export function normalizeText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9\u4E00-\u9FFF-]/g, "");
}

export function fuzzyIncludes(source, query) {
  const normalizedSource = normalizeText(source);
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return true;
  }

  if (normalizedSource.includes(normalizedQuery)) {
    return true;
  }

  let sourceIndex = 0;
  let queryIndex = 0;
  while (sourceIndex < normalizedSource.length && queryIndex < normalizedQuery.length) {
    if (normalizedSource[sourceIndex] === normalizedQuery[queryIndex]) {
      queryIndex += 1;
    }
    sourceIndex += 1;
  }

  return queryIndex === normalizedQuery.length;
}

export function uuid(prefix = "id") {
  const random = crypto.getRandomValues(new Uint32Array(4));
  return `${prefix}-${Array.from(random).map((value) => value.toString(16).padStart(8, "0")).join("")}`;
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

export function formatQty(value) {
  const qty = Number(value || 0);
  if (Number.isInteger(qty)) {
    return String(qty);
  }
  return qty.toFixed(2);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function groupedMap(items, keyBuilder) {
  return items.reduce((map, item) => {
    const key = keyBuilder(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
    return map;
  }, new Map());
}

export function bySortOrder(items, field = "sortOrder") {
  return [...items].sort((left, right) => {
    const a = Number(left[field] ?? 0);
    const b = Number(right[field] ?? 0);
    if (a !== b) {
      return a - b;
    }
    return String(left.name || left.code || left.id).localeCompare(String(right.name || right.code || right.id), "zh-CN");
  });
}

export function uniqueBy(items, keyBuilder) {
  const result = [];
  const seen = new Set();
  for (const item of items) {
    const key = keyBuilder(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export function parseOptions(value) {
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
