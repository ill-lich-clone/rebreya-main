import { MODULE_ID } from "../constants.js";

const DEFAULT_MAGIC_TYPE_LABEL = "Магический предмет";

function cleanTypeLabel(value, fallback = "") {
  const label = String(value ?? "").trim().replace(/\s+/gu, " ");
  return label || fallback;
}

export function normalizeLootgenTypeFilterKey(value) {
  return cleanTypeLabel(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е");
}

export function buildLootgenTypeFilterOptions(values = [], selectedState = {}) {
  const byKey = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const label = cleanTypeLabel(value);
    const key = normalizeLootgenTypeFilterKey(label);
    if (!key || byKey.has(key)) {
      continue;
    }

    byKey.set(key, {
      key,
      label,
      checked: selectedState[key] !== false
    });
  }

  return Array.from(byKey.values()).sort((left, right) => left.label.localeCompare(right.label, "ru"));
}

export function isLootgenTypeAllowed(value, options = []) {
  const key = normalizeLootgenTypeFilterKey(value);
  if (!key) {
    return true;
  }

  const option = (Array.isArray(options) ? options : []).find((entry) => entry.key === key);
  return option ? option.checked !== false : true;
}

function parseMagicSignature(signatureRaw) {
  const source = String(signatureRaw ?? "").trim();
  if (!source.startsWith("{")) {
    return {};
  }

  try {
    return JSON.parse(source) ?? {};
  }
  catch (_error) {
    return {};
  }
}

export function resolveMagicLootgenTypeLabel(document = {}) {
  const flags = document?.flags?.[MODULE_ID] ?? {};
  const signature = parseMagicSignature(flags.signature);
  const label = cleanTypeLabel(
    flags.itemType
      ?? signature.itemType
      ?? document?.system?.type?.label
      ?? document?.labels?.itemType,
    DEFAULT_MAGIC_TYPE_LABEL
  );

  return label;
}
