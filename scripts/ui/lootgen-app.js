import { MAGIC_ITEMS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { buildLootgenStatusContent } from "./lootgen-chat.js";
import { GEAR_COMPENDIUM_NAME } from "../constants.js";
import {
  buildLootgenRowIdentity,
  collectBreakableManagedGearIds,
  normalizeBrokenEquipmentChance,
  normalizeLootgenBrokenMarker
} from "../data/lootgen-durability.js?v=1.4.154-corpse-storage-broken-name";
import { getAppElement } from "../ui.js";
import {
  buildLootgenTypeFilterOptions,
  isLootgenTypeAllowed,
  resolveMagicLootgenTypeLabel
} from "./lootgen-type-filters.js";
import { generateLootgenResult, normalizeLootgenForm } from "../data/lootgen-generator.js?v=1.4.154-corpse-storage-broken-name";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const COIN_MULTIPLIERS = {
  pp: 1000,
  gp: 100,
  sp: 10,
  cp: 1
};
const MATERIAL_LOOTGEN_TYPE_LABEL = "Материал";

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function normalizeCoins(coins = {}) {
  const result = {
    pp: Math.max(0, toInteger(coins.pp, 0)),
    gp: Math.max(0, toInteger(coins.gp, 0)),
    sp: Math.max(0, toInteger(coins.sp, 0)),
    cp: Math.max(0, toInteger(coins.cp, 0))
  };

  result.totalCopper = (result.pp * COIN_MULTIPLIERS.pp)
    + (result.gp * COIN_MULTIPLIERS.gp)
    + (result.sp * COIN_MULTIPLIERS.sp)
    + result.cp;

  return result;
}

function formatCoinsLabel(coins = {}) {
  const safeCoins = normalizeCoins(coins);
  const parts = [];
  if (safeCoins.pp > 0) parts.push(`${safeCoins.pp} пм`);
  if (safeCoins.gp > 0) parts.push(`${safeCoins.gp} зм`);
  if (safeCoins.sp > 0) parts.push(`${safeCoins.sp} см`);
  if (safeCoins.cp > 0) parts.push(`${safeCoins.cp} мм`);
  return parts.length ? parts.join(" ") : "0 мм";
}

function randomCoinsFromValue(totalValue) {
  let remaining = Math.max(0, toInteger(totalValue, 0));
  const coins = {
    pp: 0,
    gp: 0,
    sp: 0,
    cp: 0
  };

  for (const key of ["pp", "gp", "sp"]) {
    const multiplier = COIN_MULTIPLIERS[key];
    const maxCount = Math.floor(remaining / multiplier);
    if (maxCount <= 0) {
      continue;
    }

    const randomCount = Math.floor(Math.random() * (maxCount + 1));
    coins[key] = randomCount;
    remaining -= randomCount * multiplier;
  }

  coins.cp = remaining;
  const normalized = normalizeCoins(coins);
  return {
    ...normalized,
    label: formatCoinsLabel(normalized)
  };
}

function parsePriceToGold(price = {}) {
  const value = Math.max(0, toNumber(price?.value, 0));
  const denomination = String(price?.denomination ?? "gp").toLowerCase();

  switch (denomination) {
    case "pp":
      return value * 10;
    case "sp":
      return value * 0.1;
    case "cp":
      return value * 0.01;
    case "gp":
    default:
      return value;
  }
}

function normalizeBargainingTag(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е");
}

function isBargainingBlocked(value) {
  const normalized = normalizeBargainingTag(value);
  if (!normalized) {
    return false;
  }

  return normalized.includes("запрещ") || normalized.includes("невозмож");
}

function aggregateRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = buildLootgenRowIdentity(row);
    const isStackable = row.stackable === undefined
      ? ["material", "gear"].includes(String(row.sourceType ?? ""))
      : Boolean(row.stackable);
    const existing = map.get(key) ?? {
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      name: row.name,
      rank: row.rank,
      value: row.value,
      typeLabel: row.typeLabel,
      stackable: isStackable,
      isBroken: normalizeLootgenBrokenMarker(row),
      quantity: 0,
      totalValue: 0
    };

    if (existing.stackable) {
      existing.quantity += row.quantity;
      existing.totalValue += row.totalValue;
    }
    else if (existing.quantity <= 0) {
      const quantity = Math.max(1, toInteger(row.quantity, 1));
      existing.quantity = quantity;
      existing.totalValue = Math.max(existing.value * quantity, toInteger(row.totalValue, existing.value * quantity));
    }

    map.set(key, existing);
  }

  return Array.from(map.values())
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name, "ru"))
    .map((row, index) => ({
      ...row,
      rowIndex: index
    }));
}

function normalizeGeneratedRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      sourceType: String(row.sourceType ?? ""),
      sourceId: String(row.sourceId ?? ""),
      name: String(row.name ?? ""),
      rank: Math.max(0, toInteger(row.rank, 0)),
      value: Math.max(1, toInteger(row.value, 1)),
      typeLabel: String(row.typeLabel ?? "Предмет"),
      stackable: row.stackable === undefined
        ? ["material", "gear"].includes(String(row.sourceType ?? ""))
        : Boolean(row.stackable),
      isBroken: normalizeLootgenBrokenMarker(row),
      directGrantId: String(row.directGrantId ?? ""),
      quantity: Math.max(1, toInteger(row.quantity, 1)),
      totalValue: Math.max(1, toInteger(row.totalValue, toInteger(row.value, 1)))
    }))
    .filter((row) => row.sourceType && row.sourceId && row.name);
}

export async function promptLootgenTemplateName(
  DialogV2 = globalThis.foundry?.applications?.api?.DialogV2
) {
  if (typeof DialogV2?.wait !== "function") {
    throw new Error("Диалог сохранения шаблона Lootgen недоступен.");
  }

  const value = await DialogV2.wait({
    window: { title: "Сохранить шаблон Lootgen" },
    content: `
      <form>
        <div class="form-group">
          <label>Название шаблона</label>
          <input type="text" name="templateName" required autofocus autocomplete="off">
        </div>
      </form>
    `,
    buttons: [
      {
        action: "save",
        label: "Сохранить",
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (_event, button) => String(
          button?.form?.elements?.templateName?.value ?? ""
        ).trim()
      },
      {
        action: "cancel",
        label: "Отмена",
        callback: () => null
      }
    ],
    rejectClose: false,
    close: () => null
  });

  return value == null ? null : String(value).trim();
}

export async function confirmLootgenTemplateRemoval(
  template,
  DialogV2 = globalThis.foundry?.applications?.api?.DialogV2
) {
  if (typeof DialogV2?.wait !== "function") {
    throw new Error("Диалог удаления шаблона Lootgen недоступен.");
  }
  const safeName = String(template?.name ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return Boolean(await DialogV2.wait({
    window: { title: "Удалить шаблон Lootgen" },
    content: `<p>Удалить шаблон <strong>${safeName}</strong>?</p>`,
    buttons: [{
      action: "delete",
      label: "Удалить",
      icon: "fa-solid fa-trash",
      callback: () => true
    }, {
      action: "cancel",
      label: "Отмена",
      default: true,
      callback: () => false
    }],
    rejectClose: false,
    close: () => false
  }));
}

export function resolveLootgenItemValue(rawValue, fallbackGold = 0) {
  const explicit = Math.max(0, toInteger(rawValue, 0));
  if (explicit > 0) {
    return explicit;
  }

  const fallbackValue = toInteger(Math.round(Math.max(0, toNumber(fallbackGold, 0)) * 100), 0);
  return Math.max(0, fallbackValue);
}

export function buildLootgenMundaneCandidate(gearItem, {
  rank,
  value,
  typeLabel,
  breakable = false
} = {}) {
  return {
    sourceType: "gear",
    sourceId: String(gearItem?.id ?? ""),
    name: String(gearItem?.name ?? "Снаряжение"),
    rank: Math.max(0, toInteger(rank, 0)),
    value: Math.max(0, toInteger(value, 0)),
    multipleAppearance: String(gearItem?.multipleAppearance ?? "1"),
    typeLabel: String(typeLabel ?? gearItem?.equipmentType ?? "Снаряжение"),
    stackable: true,
    breakable: Boolean(breakable)
  };
}

export class LootgenApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-lootgen-app"],
    window: {
      title: "Лутген Rebreya",
      icon: "fa-solid fa-sack-dollar",
      resizable: true
    },
    position: {
      width: 820,
      height: 760
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/lootgen-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.appKey = String(options.appKey ?? randomID());
    this.viewer = Boolean(options.viewer);
    this.rankMin = 0;
    this.rankMax = 4;
    this.itemCount = 8;
    this.optimalItemQuantity = 4;
    this.budgetValue = 5000;
    this.includeGear = true;
    this.includeCoins = true;
    this.includeMagicItems = false;
    this.gearTypeFilters = {};
    this.magicTypeFilters = {};
    this.magicPercent = 25;
    this.brokenEquipmentChance = 0;
    this.selectedTemplateId = "";
    this.generated = this.#createEmptyGenerated();
    this.chatLootId = "";
    this.renderListenersAbortController = null;

    if (this.viewer) {
      this.options.window = {
        ...(this.options.window ?? {}),
        title: "Найденные сокровища",
        icon: "fa-solid fa-gem"
      };
    }

    if (options.sharedResult) {
      this.generated = this.#normalizeSharedResult(options.sharedResult);
    }
  }

  get id() {
    return `${MODULE_ID}-lootgen-${this.appKey}`;
  }

  #createEmptyGenerated() {
    const emptyCoins = randomCoinsFromValue(0);
    return {
      rows: [],
      coins: emptyCoins,
      spentValue: 0,
      budgetValue: 0,
      totalItems: 0,
      generatedAt: "",
      directCoinGrantId: "",
      hasResult: false
    };
  }

  #normalizeSharedResult(payload = {}) {
    const rows = aggregateRows(normalizeGeneratedRows(payload.rows ?? []));
    const coins = {
      ...normalizeCoins(payload.coins ?? {}),
      label: formatCoinsLabel(payload.coins ?? {})
    };
    const spentValue = Math.max(0, toInteger(payload.spentValue, 0));
    const budgetValue = Math.max(spentValue, toInteger(payload.budgetValue, spentValue + coins.totalCopper));
    const totalItems = rows.reduce((sum, row) => sum + row.quantity, 0);
    return {
      rows,
      coins,
      spentValue,
      budgetValue,
      totalItems,
      generatedAt: String(payload.generatedAt ?? ""),
      directCoinGrantId: String(payload.directCoinGrantId ?? ""),
      hasResult: rows.length > 0 || coins.totalCopper > 0
    };
  }

  #cloneGeneratedResult() {
    return foundry.utils.deepClone({
      rows: this.generated.rows ?? [],
      coins: normalizeCoins(this.generated.coins ?? {}),
      spentValue: this.generated.spentValue,
      budgetValue: this.generated.budgetValue,
      totalItems: this.generated.totalItems,
      generatedAt: this.generated.generatedAt,
      directCoinGrantId: this.generated.directCoinGrantId,
      hasResult: this.generated.hasResult
    });
  }

  #getFormSnapshot() {
    return normalizeLootgenForm({
      rankMin: this.rankMin,
      rankMax: this.rankMax,
      itemCount: this.itemCount,
      optimalItemQuantity: this.optimalItemQuantity,
      budgetValue: this.budgetValue,
      includeGear: this.includeGear,
      includeCoins: this.includeCoins,
      includeMagicItems: this.includeMagicItems,
      gearTypeFilters: this.gearTypeFilters,
      magicTypeFilters: this.magicTypeFilters,
      magicPercent: this.magicPercent,
      brokenEquipmentChance: this.brokenEquipmentChance
    });
  }

  applyLootgenTemplate(template = {}) {
    const form = normalizeLootgenForm(template?.form);
    this.rankMin = form.rankMin;
    this.rankMax = form.rankMax;
    this.itemCount = form.itemCount;
    this.optimalItemQuantity = form.optimalItemQuantity;
    this.budgetValue = form.budgetValue;
    this.includeGear = form.includeGear;
    this.includeCoins = form.includeCoins;
    this.includeMagicItems = form.includeMagicItems;
    this.gearTypeFilters = { ...form.gearTypeFilters };
    this.magicTypeFilters = { ...form.magicTypeFilters };
    this.magicPercent = form.magicPercent;
    this.brokenEquipmentChance = form.brokenEquipmentChance;
    return form;
  }

  async applyTemplateById(templateId, { render = true } = {}) {
    const id = String(templateId ?? "").trim();
    const template = await this.moduleApi.getLootgenTemplate?.(id);
    if (!template) throw new Error("Выберите шаблон Lootgen.");
    this.applyLootgenTemplate(template);
    this.selectedTemplateId = id;
    if (render) await this.render({ force: true });
    return template;
  }

  async #saveLootgenTemplate() {
    if (typeof this.moduleApi.saveLootgenTemplate !== "function") {
      throw new Error("Текущая версия модуля не поддерживает шаблоны Lootgen.");
    }

    const templateName = await promptLootgenTemplateName();
    if (templateName == null) {
      return null;
    }

    return this.saveTemplateFromName(templateName);
  }

  async saveTemplateFromName(name) {
    if (typeof this.moduleApi.saveLootgenTemplate !== "function") {
      throw new Error("Текущая версия модуля не поддерживает шаблоны Lootgen.");
    }
    return this.moduleApi.saveLootgenTemplate({
      name,
      form: this.#getFormSnapshot()
    });
  }

  async removeTemplateById(templateId, {
    confirm = confirmLootgenTemplateRemoval
  } = {}) {
    if (typeof this.moduleApi.getLootgenTemplate !== "function"
      || typeof this.moduleApi.removeLootgenTemplate !== "function") {
      throw new Error("Текущая версия модуля не поддерживает удаление шаблонов Lootgen.");
    }
    const template = this.moduleApi.getLootgenTemplate(templateId);
    if (!template) {
      throw new Error("Выберите шаблон Lootgen.");
    }
    if (!await confirm(template)) {
      return false;
    }
    return Boolean(await this.moduleApi.removeLootgenTemplate(template.id));
  }

  async generateFromForm(form = {}) {
    this.applyLootgenTemplate({ form });
    await this.#generateLoot();
    return this.#cloneGeneratedResult();
  }

  restoreGeneratedResult(payload = {}) {
    this.generated = this.#normalizeSharedResult(payload);
    this.chatLootId = "";
    this.render({ force: true }).catch((error) => {
      console.error(`${MODULE_ID} | Failed to restore lootgen result.`, error);
    });
  }

  async #postStatusToChat(type, message, options = {}) {
    const safeType = ["success", "error", "warning", "info"].includes(type) ? type : "info";
    const status = {
      type: safeType,
      message: String(message ?? "").trim(),
      appKey: this.appKey,
      action: String(options.action ?? ""),
      canUndo: Boolean(options.canUndo),
      restored: false,
      payload: foundry.utils.deepClone(options.payload ?? {})
    };
    if (!status.message) {
      return null;
    }

    return ChatMessage.create({
      user: game.user?.id,
      speaker: ChatMessage.getSpeaker(),
      content: buildLootgenStatusContent(status),
      flags: {
        [MODULE_ID]: {
          lootgenStatus: status
        }
      }
    });
  }

  setSharedResult(payload = {}) {
    this.generated = this.#normalizeSharedResult(payload);
    this.render({ force: true }).catch((error) => {
      console.error(`${MODULE_ID} | Failed to refresh shared lootgen result.`, error);
    });
  }

  #toValue(rawValue, fallbackGold = 0) {
    return resolveLootgenItemValue(rawValue, fallbackGold);
  }

  async #getBreakableGearSourceIds() {
    const pack = game.packs.get(`world.${GEAR_COMPENDIUM_NAME}`) ?? null;
    if (!pack) {
      return new Set();
    }

    const index = await pack.getIndex({
      fields: [
        "type",
        "system.rarity",
        "system.properties",
        `flags.${MODULE_ID}.managed`,
        `flags.${MODULE_ID}.sourceType`,
        `flags.${MODULE_ID}.sourceId`,
        `flags.${MODULE_ID}.gearId`,
        `flags.${MODULE_ID}.magical`,
        `flags.${MODULE_ID}.isMagical`,
        `flags.${MODULE_ID}.magic`,
        `flags.${MODULE_ID}.magicItemId`,
        `flags.${MODULE_ID}.magicId`
      ]
    });
    return collectBreakableManagedGearIds(index);
  }

  #buildGearTypeOptions(model) {
    return buildLootgenTypeFilterOptions(
      [
        ...(model?.gear ?? []).map((item) => item?.equipmentType ?? "Снаряжение"),
        ...((model?.materials ?? []).length ? [MATERIAL_LOOTGEN_TYPE_LABEL] : [])
      ],
      this.gearTypeFilters
    );
  }

  async #getMagicDocuments() {
    const pack = game.packs.get(`world.${MAGIC_ITEMS_COMPENDIUM_NAME}`) ?? null;
    if (!pack) {
      return [];
    }

    return pack.getDocuments();
  }

  #buildMagicTypeOptions(documents = []) {
    return buildLootgenTypeFilterOptions(
      (Array.isArray(documents) ? documents : []).map((document) => resolveMagicLootgenTypeLabel(document)),
      this.magicTypeFilters
    );
  }

  async #buildMundanePool(model) {
    const minRank = Math.max(0, Math.min(this.rankMin, this.rankMax));
    const maxRank = Math.max(minRank, Math.max(this.rankMin, this.rankMax));
    const pool = [];
    const gearTypeOptions = this.#buildGearTypeOptions(model);
    const breakableGearIds = this.includeGear
      ? await this.#getBreakableGearSourceIds()
      : new Set();

    if (this.includeGear) {
      for (const gearItem of model.gear ?? []) {
        const bargaining = gearItem.bargaining ?? gearItem.itemBargaining ?? "";
        if (isBargainingBlocked(bargaining)) {
          continue;
        }

        const rank = Math.max(0, toInteger(gearItem.rank, 0));
        if (rank < minRank || rank > maxRank) {
          continue;
        }

        const typeLabel = String(gearItem.equipmentType ?? "Снаряжение");
        if (!isLootgenTypeAllowed(typeLabel, gearTypeOptions)) {
          continue;
        }

        const fallbackGold = toNumber(gearItem.priceGoldEquivalent, toNumber(gearItem.priceValue, 0));
        const value = this.#toValue(gearItem.value, fallbackGold);
        pool.push(buildLootgenMundaneCandidate(gearItem, {
          rank,
          value,
          typeLabel,
          breakable: breakableGearIds.has(String(gearItem.id))
        }));
      }

      if (isLootgenTypeAllowed(MATERIAL_LOOTGEN_TYPE_LABEL, gearTypeOptions)) {
        for (const material of model.materials ?? []) {
          const bargaining = material.bargaining ?? material.itemBargaining ?? "";
          if (isBargainingBlocked(bargaining)) {
            continue;
          }

          const rank = Math.max(0, toInteger(material.rank, 0));
          if (rank < minRank || rank > maxRank) {
            continue;
          }

          const fallbackGold = toNumber(material.priceGold, 0);
          const value = this.#toValue(material.value, fallbackGold);
          pool.push({
            sourceType: "material",
            sourceId: String(material.id),
            name: String(material.name ?? MATERIAL_LOOTGEN_TYPE_LABEL),
            rank,
            value,
            multipleAppearance: "1",
            typeLabel: MATERIAL_LOOTGEN_TYPE_LABEL,
            stackable: true
          });
        }
      }
    }

    return pool.sort((left, right) => left.rank - right.rank || left.value - right.value);
  }

  async #buildMagicPool() {
    const minRank = Math.max(0, Math.min(this.rankMin, this.rankMax));
    const maxRank = Math.max(minRank, Math.max(this.rankMin, this.rankMax));
    const pack = game.packs.get(`world.${MAGIC_ITEMS_COMPENDIUM_NAME}`) ?? null;
    if (!pack) {
      return [];
    }

    const documents = await this.#getMagicDocuments();
    const magicTypeOptions = this.#buildMagicTypeOptions(documents);
    const pool = [];
    for (const document of documents) {
      const flags = foundry.utils.getProperty(document, `flags.${MODULE_ID}`) ?? {};
      let signatureBargaining = "";
      const signatureRaw = String(flags.signature ?? "").trim();
      if (signatureRaw.startsWith("{")) {
        try {
          signatureBargaining = String(JSON.parse(signatureRaw)?.bargaining ?? "");
        }
        catch (_error) {
          signatureBargaining = "";
        }
      }

      const bargaining = flags.bargaining ?? flags.itemBargaining ?? signatureBargaining;
      if (isBargainingBlocked(bargaining)) {
        continue;
      }

      const rank = Math.max(0, toInteger(
        flags.rank
        ?? flags.itemRank
        ?? foundry.utils.getProperty(document, "system.rank")
        ?? 0,
        0
      ));
      if (rank < minRank || rank > maxRank) {
        continue;
      }

      const sourceId = String(flags.magicItemId ?? document.id ?? "").trim();
      if (!sourceId) {
        continue;
      }

      const explicitValue = toNumber(flags.value, 0);
      const legacyValue = toNumber(flags.priceGold, 0);
      const fallbackPrice = parsePriceToGold(foundry.utils.getProperty(document, "system.price") ?? {});
      const value = explicitValue > 0
        ? Math.max(1, toInteger(explicitValue, 1))
        : (legacyValue > 0
          ? Math.max(1, toInteger(legacyValue, 1))
          : Math.max(1, toInteger(Math.round(fallbackPrice * 100), 1)));
      const isConsumable = document.type === "consumable"
        || Boolean(flags.isConsumable)
        || String(flags.foundryType ?? "").trim().toLowerCase() === "consumable";
      const typeLabel = resolveMagicLootgenTypeLabel(document);
      if (!isLootgenTypeAllowed(typeLabel, magicTypeOptions)) {
        continue;
      }

      pool.push({
        sourceType: "magicItem",
        sourceId,
        name: String(document.name ?? "Магический предмет"),
        rank,
        value,
        typeLabel,
        stackable: isConsumable
      });
    }

    return pool.sort((left, right) => left.rank - right.rank || left.value - right.value);
  }

  async #generateLoot() {
    const model = await this.moduleApi.getModel();
    const mundanePool = await this.#buildMundanePool(model);
    const magicPool = this.includeMagicItems ? await this.#buildMagicPool() : [];
    this.generated = generateLootgenResult({
      mundanePool,
      magicPool,
      includeMagicItems: this.includeMagicItems,
      magicPercent: this.magicPercent,
      itemCount: this.itemCount,
      optimalItemQuantity: this.optimalItemQuantity,
      budgetValue: this.budgetValue,
      includeCoins: this.includeCoins,
      brokenEquipmentChance: this.brokenEquipmentChance,
      batchId: randomID(),
      generatedAt: new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "short",
        timeStyle: "medium"
      }).format(new Date())
    });
    this.chatLootId = "";
  }

  #buildSharedPayload() {
    return foundry.utils.deepClone({
      rows: this.generated.rows,
      coins: normalizeCoins(this.generated.coins ?? {}),
      spentValue: this.generated.spentValue,
      budgetValue: this.generated.budgetValue,
      totalItems: this.generated.totalItems,
      generatedAt: this.generated.generatedAt,
      directCoinGrantId: this.generated.directCoinGrantId
    });
  }

  async #openGeneratedRowEntry(rowIndex) {
    const row = this.generated.rows.find((entry) => entry.rowIndex === rowIndex) ?? null;
    if (!row) {
      throw new Error("Строка лутгена не найдена.");
    }

    await this.moduleApi.openTradeEntry(row.sourceType, row.sourceId, row.name);
  }

  async #addRowToInventory(rowIndex) {
    const row = this.generated.rows.find((entry) => entry.rowIndex === rowIndex) ?? null;
    if (!row) {
      throw new Error("Строка лутгена не найдена.");
    }

    if (typeof this.moduleApi.addLootgenRowToInventory === "function") {
      await this.moduleApi.addLootgenRowToInventory(row);
      return;
    }
    throw new Error("Текущая версия склада не поддерживает безопасную выдачу Lootgen.");
  }

  async #addCoinsToInventory() {
    const coins = normalizeCoins(this.generated.coins ?? {});
    if (coins.totalCopper <= 0) {
      return false;
    }

    if (typeof this.moduleApi.addLootgenCoinsToInventory !== "function") {
      throw new Error("Текущая версия склада не поддерживает безопасную выдачу монет Lootgen.");
    }
    await this.moduleApi.addLootgenCoinsToInventory(coins, this.generated.directCoinGrantId);

    return true;
  }

  async #takeAllToInventory() {
    for (const row of this.generated.rows) {
      if (typeof this.moduleApi.addLootgenRowToInventory === "function") {
        await this.moduleApi.addLootgenRowToInventory(row);
      }
      else {
        throw new Error("Текущая версия склада не поддерживает безопасную выдачу Lootgen.");
      }
    }

    await this.#addCoinsToInventory();
  }

  async #sendResultToChat() {
    if (!this.generated.hasResult) {
      throw new Error("Сначала сгенерируйте добычу.");
    }

    const result = await this.moduleApi.createLootgenChatMessage(this.#buildSharedPayload(), {
      appKey: this.appKey
    });
    this.chatLootId = result.lootId;
    const rowIdByIndex = new Map((result.rows ?? []).map((row) => [row.rowIndex, row.rowId]));
    this.generated.rows = this.generated.rows.map((row) => ({
      ...row,
      chatLootId: result.lootId,
      chatRowId: rowIdByIndex.get(row.rowIndex) ?? ""
    }));
    return result;
  }

  #refreshGeneratedFlags() {
    const rows = this.generated.rows ?? [];
    this.generated.totalItems = rows.reduce((sum, row) => sum + toNumber(row.quantity, 0), 0);
    this.generated.spentValue = rows.reduce((sum, row) => sum + toNumber(row.totalValue, 0), 0);
    this.generated.hasResult = rows.length > 0 || Number(this.generated.coins?.totalCopper ?? 0) > 0;
  }

  handleLootgenChatClaim(lootId, rowId, claimType) {
    if (!this.chatLootId || String(lootId ?? "") !== this.chatLootId) {
      return false;
    }

    if (claimType === "coins") {
      this.generated.coins = randomCoinsFromValue(0);
      this.#refreshGeneratedFlags();
      this.render({ force: true }).catch((error) => {
        console.error(`${MODULE_ID} | Failed to refresh lootgen after coin claim.`, error);
      });
      return true;
    }

    const safeRowId = String(rowId ?? "");
    const beforeCount = this.generated.rows.length;
    this.generated.rows = this.generated.rows.filter((row) => String(row.chatRowId ?? "") !== safeRowId);
    if (this.generated.rows.length === beforeCount) {
      return false;
    }

    this.#refreshGeneratedFlags();
    this.render({ force: true }).catch((error) => {
      console.error(`${MODULE_ID} | Failed to refresh lootgen after row claim.`, error);
    });
    return true;
  }

  async _prepareContext() {
    const isGM = game.user?.isGM === true;
    const canManage = isGM && !this.viewer;
    let model = {};
    let magicDocuments = [];
    let lootgenTemplates = [];
    if (canManage) {
      try {
        model = await this.moduleApi.getModel();
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to prepare lootgen gear type filters.`, error);
      }

      try {
        magicDocuments = await this.#getMagicDocuments();
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to prepare lootgen magic type filters.`, error);
      }

      if (typeof this.moduleApi.listLootgenTemplates === "function") {
        try {
          lootgenTemplates = this.moduleApi.listLootgenTemplates().map((template) => ({
            ...template,
            selected: String(template?.id ?? "") === this.selectedTemplateId
          }));
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to prepare Lootgen templates.`, error);
        }
      }
    }

    const gearTypeOptions = this.#buildGearTypeOptions(model);
    const magicTypeOptions = this.#buildMagicTypeOptions(magicDocuments);
    const hasGearSource = this.includeGear && gearTypeOptions.some((option) => option.checked);
    const hasMagicSource = this.includeMagicItems && magicTypeOptions.some((option) => option.checked);
    const hasItemSources = hasGearSource || hasMagicSource;
    const generateDisabled = !hasItemSources;
    return {
      isGM,
      viewer: this.viewer,
      canManage,
      appKey: this.appKey,
      form: {
        rankMin: this.rankMin,
        rankMax: this.rankMax,
        itemCount: this.itemCount,
        optimalItemQuantity: this.optimalItemQuantity,
        budgetValue: this.budgetValue,
        includeGear: this.includeGear,
        includeCoins: this.includeCoins,
        includeMagicItems: this.includeMagicItems,
        lootgenTemplates,
        hasLootgenTemplates: lootgenTemplates.length > 0,
        gearTypeOptions,
        magicTypeOptions,
        hasGearTypeOptions: gearTypeOptions.length > 0,
        hasMagicTypeOptions: magicTypeOptions.length > 0,
        magicPercent: this.magicPercent,
        brokenEquipmentChance: this.brokenEquipmentChance,
        hasItemSources,
        generateDisabled,
        generateDisabledReason: generateDisabled
          ? "Выберите хотя бы один источник предметов: снаряжение или магические предметы."
          : ""
      },
      generated: {
        ...this.generated,
        hasRows: (this.generated.rows ?? []).length > 0,
        hasCoins: Number(this.generated.coins?.totalCopper ?? 0) > 0,
        coinsLabel: formatCoinsLabel(this.generated.coins ?? {}),
        spentGold: roundNumber(toNumber(this.generated.spentValue, 0) / 100, 2)
      }
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = new AbortController();
    const listenerOptions = { signal: this.renderListenersAbortController.signal };

    element.querySelectorAll("[data-action='lootgen-open-entry']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          const rowIndex = toInteger(event.currentTarget.dataset.rowIndex, -1);
          await this.#openGeneratedRowEntry(rowIndex);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open generated loot entry.`, error);
          await this.#postStatusToChat("error", error.message || "Не удалось открыть предмет добычи.");
        }
      }, listenerOptions);
    });

    if (!this.viewer) {
      element.querySelectorAll("[data-action='lootgen-type-filter']").forEach((field) => {
        field.addEventListener("change", (event) => {
          const input = event.currentTarget;
          const group = String(input.dataset.filterGroup ?? "");
          const typeKey = String(input.dataset.typeKey ?? "");
          if (!typeKey) {
            return;
          }

          const state = group === "magic"
            ? this.magicTypeFilters
            : (group === "gear" ? this.gearTypeFilters : null);
          if (!state) {
            return;
          }

          state[typeKey] = Boolean(input.checked);
        }, listenerOptions);
      });

      element.querySelectorAll("[data-field]").forEach((field) => {
        field.addEventListener("change", (event) => {
          const input = event.currentTarget;
          const fieldName = input.dataset.field;
          if (!fieldName) {
            return;
          }

          if (input.type === "checkbox") {
            this[fieldName] = Boolean(input.checked);
            return;
          }

          if (fieldName === "magicPercent" || fieldName === "brokenEquipmentChance") {
            this[fieldName] = fieldName === "brokenEquipmentChance"
              ? normalizeBrokenEquipmentChance(input.value)
              : Math.min(100, Math.max(0, toInteger(input.value, this[fieldName])));
            input.value = String(this[fieldName]);
            return;
          }

          if (fieldName === "optimalItemQuantity") {
            this[fieldName] = Math.min(100, Math.max(1, toInteger(input.value, this[fieldName])));
            input.value = String(this[fieldName]);
            return;
          }

          this[fieldName] = Math.max(0, toInteger(input.value, this[fieldName]));
          input.value = String(this[fieldName]);
        }, listenerOptions);
      });

      element.querySelector("[data-action='lootgen-generate']")?.addEventListener("click", async () => {
        try {
          await this.#generateLoot();
          if (game.user?.isGM && typeof this.moduleApi.shareLootgenResult === "function") {
            await this.moduleApi.shareLootgenResult(this.#buildSharedPayload());
          }
          await this.render({ force: true });
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to generate loot.`, error);
          const message = error.message || "Не удалось сгенерировать добычу.";
          await this.render({ force: true });
          await this.#postStatusToChat("error", message);
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-clear']")?.addEventListener("click", async () => {
        const previousResult = this.#cloneGeneratedResult();
        this.generated = this.#createEmptyGenerated();
        this.chatLootId = "";
        await this.render({ force: true });
        await this.#postStatusToChat("info", "Результат очищен.", {
          action: "clear",
          canUndo: Boolean(previousResult.hasResult),
          payload: previousResult
        });
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-save-template']")?.addEventListener("click", async () => {
        try {
          const saved = await this.#saveLootgenTemplate();
          if (saved) {
            await this.render({ force: true });
          }
        }
        catch (error) {
          console.error(MODULE_ID + " | Failed to save Lootgen template.", error);
          ui.notifications?.error?.(error.message || "Не удалось сохранить шаблон Lootgen.");
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-apply-template']")?.addEventListener("click", async () => {
        try {
          const templateId = String(
            element.querySelector("[data-action='lootgen-template-select']")?.value ?? ""
          );
          await this.applyTemplateById(templateId);
        }
        catch (error) {
          console.error(MODULE_ID + " | Failed to apply Lootgen template.", error);
          ui.notifications?.error?.(error.message || "Не удалось применить шаблон Lootgen.");
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-template-select']")?.addEventListener("change", async (event) => {
        const templateId = String(event.currentTarget?.value ?? "");
        if (!templateId) {
          this.selectedTemplateId = "";
          return;
        }
        try {
          await this.applyTemplateById(templateId);
        }
        catch (error) {
          console.error(MODULE_ID + " | Failed to apply selected Lootgen template.", error);
          ui.notifications?.error?.(error.message || "Не удалось применить шаблон Lootgen.");
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-delete-template']")?.addEventListener("click", async () => {
        try {
          const templateId = String(
            element.querySelector("[data-action='lootgen-template-select']")?.value ?? ""
          );
          if (await this.removeTemplateById(templateId)) {
            ui.notifications?.info?.("Шаблон Lootgen удалён.");
            await this.render({ force: true });
          }
        }
        catch (error) {
          console.error(MODULE_ID + " | Failed to delete Lootgen template.", error);
          ui.notifications?.error?.(error.message || "Не удалось удалить шаблон Lootgen.");
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-new-window']")?.addEventListener("click", async () => {
        try {
          await this.moduleApi.openLootgenApp({ newWindow: true });
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open extra lootgen window.`, error);
        }
      }, listenerOptions);

      element.querySelectorAll("[data-action='lootgen-take-row']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          try {
            const rowIndex = toInteger(event.currentTarget.dataset.rowIndex, -1);
            await this.#addRowToInventory(rowIndex);
            await this.render({ force: true });
            await this.#postStatusToChat("success", "Строка добычи добавлена в партийный склад.");
          }
          catch (error) {
            console.error(`${MODULE_ID} | Failed to add loot row to inventory.`, error);
            const message = error.message || "Не удалось добавить строку добычи.";
            await this.render({ force: true });
            await this.#postStatusToChat("error", message);
          }
        }, listenerOptions);
      });

      element.querySelector("[data-action='lootgen-take-all']")?.addEventListener("click", async () => {
        try {
          await this.#takeAllToInventory();
          await this.render({ force: true });
          await this.#postStatusToChat("success", "Добыча полностью перенесена в партийный склад.");
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to transfer generated loot.`, error);
          const message = error.message || "Не удалось перенести добычу в партийный склад.";
          await this.render({ force: true });
          await this.#postStatusToChat("error", message);
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-send-chat']")?.addEventListener("click", async () => {
        try {
          await this.#sendResultToChat();
          await this.render({ force: true });
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to send lootgen result to chat.`, error);
          const message = error.message || "Не удалось отправить добычу в чат.";
          await this.render({ force: true });
          await this.#postStatusToChat("error", message);
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-take-coins']")?.addEventListener("click", async () => {
        try {
          const applied = await this.#addCoinsToInventory();
          if (applied) {
            await this.render({ force: true });
            await this.#postStatusToChat("success", "Монеты из добычи добавлены в партийный склад.");
          }
          else {
            await this.render({ force: true });
            await this.#postStatusToChat("warning", "В текущей добыче нет монет для добавления.");
          }
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to transfer generated coins.`, error);
          const message = error.message || "Не удалось перенести монеты добычи.";
          await this.render({ force: true });
          await this.#postStatusToChat("error", message);
        }
      }, listenerOptions);
    }
  }

  async _preClose(options) {
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = null;
    this.moduleApi.unregisterLootgenApp(this.appKey);
    return super._preClose ? super._preClose(options) : undefined;
  }
}
