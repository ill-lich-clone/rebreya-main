import { LOOTGEN_TEMPLATE_ITEM_TYPE, MODULE_ID } from "../constants.js";
import { normalizeLootgenForm } from "./lootgen-generator.js?v=1.4.266";

export const LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION = 1;
export const LOOTGEN_TEMPLATE_MIGRATION_VERSION = 1;
export const LOOTGEN_TEMPLATE_FOLDER_SCHEMA_VERSION = 1;
export const LOOTGEN_TEMPLATE_FOLDER_NAME = "Шаблоны Lootgen";
export const LOOTGEN_TEMPLATE_DEFAULT_IMG = "icons/svg/item-bag.svg";

function clone(value) {
  if (value == null) return value;
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeName(value) {
  return clean(value).replace(/\s+/gu, " ");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function legacyTemplateId(item) {
  return clean(item?.flags?.[MODULE_ID]?.lootgenTemplate?.legacyTemplateId
    ?? item?.getFlag?.(MODULE_ID, "lootgenTemplate")?.legacyTemplateId);
}

function isLootgenTemplateFolder(folder) {
  const marker = folder?.flags?.[MODULE_ID]?.lootgenTemplateFolder
    ?? folder?.getFlag?.(MODULE_ID, "lootgenTemplateFolder");
  return folder?.type === "Item" && marker?.version === LOOTGEN_TEMPLATE_FOLDER_SCHEMA_VERSION;
}

function itemIdentity(item) {
  return clean(item?.uuid) || (clean(item?.id) ? `Item.${clean(item.id)}` : "");
}

function normalizeMigrationState(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    version: LOOTGEN_TEMPLATE_MIGRATION_VERSION,
    completed: source.version === LOOTGEN_TEMPLATE_MIGRATION_VERSION && source.completed === true,
    migratedLegacyIds: Array.from(new Set(
      (Array.isArray(source.migratedLegacyIds) ? source.migratedLegacyIds : []).map(clean).filter(Boolean)
    )),
    errors: Array.isArray(source.errors) ? clone(source.errors) : []
  };
}

export function normalizeLootgenTemplateItemSystem(system) {
  if (!isPlainObject(system)) {
    throw new Error("Некорректная схема шаблона Lootgen.");
  }
  if (system.schemaVersion !== LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION) {
    throw new Error(`Версия шаблона Lootgen ${String(system.schemaVersion ?? "не указана")} не поддерживается.`);
  }
  if (!isPlainObject(system.form)) {
    throw new Error("Некорректная форма шаблона Lootgen.");
  }
  return {
    schemaVersion: LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION,
    form: normalizeLootgenForm(clone(system.form))
  };
}

export function isLootgenTemplateItem(item, { allowEmbedded = false } = {}) {
  const isItemDocument = item?.documentName === "Item"
    || (typeof globalThis.Item === "function" && item instanceof globalThis.Item);
  return isItemDocument
    && item?.type === LOOTGEN_TEMPLATE_ITEM_TYPE
    && (allowEmbedded || !item?.parent);
}

export function projectLootgenTemplateItem(item) {
  if (!isLootgenTemplateItem(item)) {
    throw new Error("Документ не является шаблоном Lootgen.");
  }
  const name = normalizeName(item?.name);
  const id = clean(item?.id);
  const uuid = itemIdentity(item);
  if (!name || !id || !uuid) {
    throw new Error("Шаблон Lootgen не имеет допустимого имени или UUID.");
  }
  const serializedItem = typeof item?.toObject === "function" ? item.toObject() : null;
  const system = normalizeLootgenTemplateItemSystem(serializedItem?.system ?? item.system);
  return {
    id,
    uuid,
    name,
    img: clean(item?.img) || LOOTGEN_TEMPLATE_DEFAULT_IMG,
    schemaVersion: system.schemaVersion,
    form: clone(system.form)
  };
}

export function buildLootgenTemplateSnapshot(item, { now = Date.now } = {}) {
  const projection = projectLootgenTemplateItem(item);
  const assignedAt = Math.max(0, Math.trunc(Number(now?.()) || 0));
  return {
    version: 2,
    name: projection.name,
    img: projection.img,
    form: clone(projection.form),
    sourceUuid: projection.uuid,
    assignedAt
  };
}

export class LootgenTemplateItemService {
  constructor({
    isGm = () => globalThis.game?.user?.isGM === true,
    isActiveGm = isGm,
    supportsItemType = () => Array.from(globalThis.Item?.TYPES ?? []).includes(LOOTGEN_TEMPLATE_ITEM_TYPE),
    listItems = () => Array.from(globalThis.game?.items ?? []),
    listFolders = () => Array.from(globalThis.game?.folders ?? []),
    resolveUuid = (uuid) => globalThis.fromUuid?.(uuid),
    createItem = (data) => globalThis.Item?.create?.(data),
    createFolder = (data) => globalThis.Folder?.create?.(data),
    getLegacySetting = () => globalThis.game?.settings?.get?.(MODULE_ID, "lootgenTemplates"),
    setLegacySetting = (value) => globalThis.game?.settings?.set?.(MODULE_ID, "lootgenTemplates", value),
    now = Date.now,
    logger = console
  } = {}) {
    Object.assign(this, {
      isGm,
      isActiveGm,
      supportsItemType,
      listItems,
      listFolders,
      resolveUuid,
      createItem,
      createFolder,
      getLegacySetting,
      setLegacySetting,
      now,
      logger
    });
  }

  #assertGm(action) {
    if (this.isGm?.() !== true) {
      throw new Error(`${action} шаблоны Lootgen может только мастер.`);
    }
  }

  #assertItemTypeAvailable() {
    if (this.supportsItemType?.() === true) return;
    const error = new Error(
      `Тип Item ${LOOTGEN_TEMPLATE_ITEM_TYPE} не зарегистрирован; полностью перезапустите Foundry VTT и снова откройте мир.`
    );
    error.code = "lootgen-template-item-type-unavailable";
    throw error;
  }

  #items() {
    return Array.from(this.listItems?.() ?? []).filter((item) => isLootgenTemplateItem(item));
  }

  #find(identifier) {
    const identity = clean(identifier);
    if (!identity) return null;
    return this.#items().find((item) => (
      clean(item.id) === identity
      || itemIdentity(item) === identity
      || legacyTemplateId(item) === identity
    )) ?? null;
  }

  async resolve(identifier, { editable = false } = {}) {
    const identity = clean(identifier);
    let item = this.#find(identity);
    if (!item && identity) item = await this.resolveUuid?.(identity);
    if (!isLootgenTemplateItem(item)) {
      throw new Error("Шаблон Lootgen не найден или имеет неподдерживаемый тип.");
    }
    if (editable && (item.pack || item.isOwner === false || item.canUserModify?.(globalThis.game?.user, "update") === false)) {
      throw new Error("Этот шаблон Lootgen нельзя редактировать.");
    }
    projectLootgenTemplateItem(item);
    return item;
  }

  list() {
    return this.#items()
      .map((item) => projectLootgenTemplateItem(item))
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }

  get(identifier) {
    const item = this.#find(identifier);
    return item ? projectLootgenTemplateItem(item) : null;
  }

  async getResolved(identifier) {
    return projectLootgenTemplateItem(await this.resolve(identifier));
  }

  async #ensureFolder() {
    const existing = Array.from(this.listFolders?.() ?? []).find((folder) => isLootgenTemplateFolder(folder));
    if (existing) return existing;
    const created = await this.createFolder?.({
      name: LOOTGEN_TEMPLATE_FOLDER_NAME,
      type: "Item",
      folder: null,
      flags: {
        [MODULE_ID]: {
          lootgenTemplateFolder: { version: LOOTGEN_TEMPLATE_FOLDER_SCHEMA_VERSION }
        }
      }
    });
    if (!created?.id) throw new Error("Не удалось создать папку шаблонов Lootgen.");
    return created;
  }

  async save({ itemUuid = "", id = "", name, img, form } = {}) {
    this.#assertGm("Сохранять");
    this.#assertItemTypeAvailable();
    const safeName = normalizeName(name);
    if (!safeName) throw new Error("Укажите название шаблона.");
    if (!isPlainObject(form)) throw new Error("Некорректная форма шаблона Lootgen.");
    const system = normalizeLootgenTemplateItemSystem({
      schemaVersion: LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION,
      form
    });
    const editableIdentity = clean(itemUuid) || clean(id);
    const existing = editableIdentity ? await this.resolve(editableIdentity, { editable: true }) : null;
    const duplicate = this.#items().find((item) => (
      item !== existing && normalizeName(item.name).toLocaleLowerCase("ru") === safeName.toLocaleLowerCase("ru")
    ));
    if (duplicate) throw new Error("Шаблон с таким названием уже существует.");

    let item = existing;
    if (item) {
      await item.update({ name: safeName, ...(clean(img) ? { img: clean(img) } : {}), system });
    }
    else {
      const folder = await this.#ensureFolder();
      item = await this.createItem?.({
        name: safeName,
        img: clean(img) || LOOTGEN_TEMPLATE_DEFAULT_IMG,
        type: LOOTGEN_TEMPLATE_ITEM_TYPE,
        folder: folder.id,
        system
      });
    }
    return projectLootgenTemplateItem(item);
  }

  async remove(identifier) {
    this.#assertGm("Удалять");
    const item = await this.resolve(identifier, { editable: true });
    await item.delete();
    return true;
  }

  async buildSnapshot(identifier) {
    const item = await this.resolve(identifier);
    return buildLootgenTemplateSnapshot(item, { now: this.now });
  }

  async migrateLegacyTemplates() {
    if (this.isActiveGm?.() !== true) {
      return { changed: false, completed: false, skipped: true, migratedLegacyIds: [], errors: [] };
    }
    this.#assertGm("Мигрировать");
    const legacy = clone(this.getLegacySetting?.()) ?? {};
    const previous = normalizeMigrationState(legacy.itemMigration);
    if (previous.completed) return { changed: false, ...previous };
    this.#assertItemTypeAvailable();

    const migrated = new Set(previous.migratedLegacyIds);
    const errors = [];
    const rows = Array.isArray(legacy.templates) ? legacy.templates : [];
    let folder = null;
    for (const row of rows) {
      const legacyId = clean(row?.id);
      const name = normalizeName(row?.name);
      if (!legacyId || !name || !isPlainObject(row?.form)) {
        errors.push({ legacyTemplateId: legacyId, message: "Некорректный legacy-шаблон Lootgen." });
        continue;
      }
      const matches = this.#items().filter((item) => legacyTemplateId(item) === legacyId);
      if (matches.length > 1) {
        errors.push({ legacyTemplateId: legacyId, message: "Найдено несколько Items для одного legacy-шаблона." });
        continue;
      }
      if (matches.length === 1) {
        try {
          projectLootgenTemplateItem(matches[0]);
          migrated.add(legacyId);
        }
        catch (error) {
          errors.push({ legacyTemplateId: legacyId, message: clean(error?.message) || "Item шаблона повреждён." });
        }
        continue;
      }
      try {
        folder ??= await this.#ensureFolder();
        const system = normalizeLootgenTemplateItemSystem({
          schemaVersion: LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION,
          form: row.form
        });
        const item = await this.createItem?.({
          name,
          img: clean(row?.img) || LOOTGEN_TEMPLATE_DEFAULT_IMG,
          type: LOOTGEN_TEMPLATE_ITEM_TYPE,
          folder: folder.id,
          system,
          flags: {
            [MODULE_ID]: { lootgenTemplate: { legacyTemplateId: legacyId } }
          }
        });
        projectLootgenTemplateItem(item);
        migrated.add(legacyId);
      }
      catch (error) {
        errors.push({ legacyTemplateId: legacyId, message: clean(error?.message) || "Не удалось создать Item шаблона." });
      }
    }

    const validLegacyIds = rows
      .filter((row) => clean(row?.id) && normalizeName(row?.name) && isPlainObject(row?.form))
      .map((row) => clean(row.id));
    const completed = errors.length === 0 && validLegacyIds.every((id) => migrated.has(id));
    const itemMigration = {
      version: LOOTGEN_TEMPLATE_MIGRATION_VERSION,
      completed,
      migratedLegacyIds: Array.from(migrated).sort(),
      errors
    };
    await this.setLegacySetting?.({ ...legacy, itemMigration });
    if (errors.length) this.logger?.warn?.(`${MODULE_ID} | Lootgen template Item migration incomplete.`, clone(errors));
    return { changed: true, ...clone(itemMigration) };
  }
}
