import { normalizeLootgenForm } from "./lootgen-generator.js?v=1.4.224-coin-stacks";

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

function createDefaultId() {
  if (typeof globalThis.randomID === "function") {
    return globalThis.randomID();
  }
  return globalThis.crypto?.randomUUID?.() ?? "lootgen-template-" + Date.now();
}

export class LootgenTemplateCatalog {
  constructor({
    get,
    set,
    now = Date.now,
    randomId = createDefaultId
  } = {}) {
    if (typeof get !== "function" || typeof set !== "function") {
      throw new TypeError("LootgenTemplateCatalog requires get and set functions.");
    }
    this.getSetting = get;
    this.setSetting = set;
    this.now = now;
    this.randomId = randomId;
  }

  #read() {
    return normalizeCatalog(this.getSetting());
  }

  async migrate() {
    const current = this.getSetting();
    const normalized = normalizeCatalog(current);
    if (JSON.stringify(current) === JSON.stringify(normalized)) {
      return false;
    }
    await this.setSetting(normalized);
    return true;
  }

  list() {
    return clone(this.#read().templates);
  }

  get(id) {
    const safeId = String(id ?? "").trim();
    return clone(this.#read().templates.find((template) => template.id === safeId) ?? null);
  }

  async save({ id = "", name, form } = {}) {
    const safeName = normalizeName(name);
    if (!safeName) {
      throw new Error("Укажите название шаблона.");
    }

    const current = this.#read();
    const safeId = String(id ?? "").trim() || String(this.randomId?.() ?? "").trim();
    if (!safeId) {
      throw new Error("Не удалось создать идентификатор шаблона.");
    }

    const duplicate = current.templates.find((template) => (
      template.id !== safeId && nameKey(template.name) === nameKey(safeName)
    ));
    if (duplicate) {
      throw new Error("Шаблон с таким названием уже существует.");
    }

    const updatedAt = normalizeTimestamp(this.now?.());
    const template = {
      id: safeId,
      name: safeName,
      form: normalizeLootgenForm(form),
      updatedAt
    };
    const templates = current.templates.filter((entry) => entry.id !== safeId);
    templates.push(template);
    await this.setSetting({ version: CATALOG_VERSION, templates });
    return clone(template);
  }

  async remove(id) {
    const safeId = String(id ?? "").trim();
    const current = this.#read();
    const templates = current.templates.filter((template) => template.id !== safeId);
    if (templates.length === current.templates.length) {
      return false;
    }
    await this.setSetting({ version: CATALOG_VERSION, templates });
    return true;
  }
}
