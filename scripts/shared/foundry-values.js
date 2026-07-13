export function collectionValues(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value.contents)) {
    return value.contents;
  }
  if (typeof value.values === "function") {
    return Array.from(value.values());
  }
  if (typeof value === "object") {
    return Object.values(value);
  }
  return [];
}

export function cloneFoundryValue(value) {
  if (value == null) {
    return value;
  }
  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function escapeFoundryHtml(value) {
  const text = String(value ?? "");
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") {
    return globalThis.foundry.utils.escapeHTML(text);
  }
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

export function finiteNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}
