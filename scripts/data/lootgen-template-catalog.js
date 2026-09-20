import { normalizeLootgenForm } from "./lootgen-generator.js?v=1.4.314";

const CATALOG_VERSION = 2;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

function nameKey(value) {
  return normalizeName(value).toLocaleLowerCase("ru");
}

function normalizeTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.trunc(numeric) : 0;
}

function normalizeTemplate(value) {
  const id = String(value?.id ?? "").trim();
  const name = normalizeName(value?.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    form: normalizeLootgenForm(value.form),
    updatedAt: normalizeTimestamp(value.updatedAt)
  };
}

function normalizeCatalog(value) {
  const source = value && typeof value === "object" ? value : {};
  const usedIds = new Set();
  const usedNames = new Set();
  const templates = [];

  for (const entry of Array.isArray(source.templates) ? source.templates : []) {
    const template = normalizeTemplate(entry);
    if (!template || usedIds.has(template.id) || usedNames.has(nameKey(template.name))) {
      continue;
    }
    usedIds.add(template.id);
    usedNames.add(nameKey(template.name));
    templates.push(template);
  }

  return { version: CATALOG_VERSION, templates };
}

export class LootgenTemplateCatalog {
  constructor({
    get
  } = {}) {
    if (typeof get !== "function") {
      throw new TypeError("LootgenTemplateCatalog requires a get function.");
    }
    this.getSetting = get;
  }

  #read() {
    return normalizeCatalog(this.getSetting());
  }

  list() {
    return clone(this.#read().templates);
  }

  get(id) {
    const safeId = String(id ?? "").trim();
    return clone(this.#read().templates.find((template) => template.id === safeId) ?? null);
  }

}
