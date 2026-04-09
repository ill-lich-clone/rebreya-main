import { MAGIC_ITEMS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { bringAppToFront, getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const COIN_MULTIPLIERS = {
  pp: 1000,
  gp: 100,
  sp: 10,
  cp: 1
};

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

function randomPick(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * values.length);
  return values[index] ?? null;
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
    const key = `${row.sourceType}:${row.sourceId}`;
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
      quantity: 0,
      totalValue: 0
    };

    if (existing.stackable) {
      existing.quantity += row.quantity;
      existing.totalValue += row.totalValue;
    }
    else if (existing.quantity <= 0) {
      existing.quantity = 1;
      existing.totalValue = existing.value;
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
      quantity: Math.max(1, toInteger(row.quantity, 1)),
      totalValue: Math.max(1, toInteger(row.totalValue, toInteger(row.value, 1)))
    }))
    .filter((row) => row.sourceType && row.sourceId && row.name);
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
    this.budgetValue = 5000;
    this.includeGear = true;
    this.includeMaterials = true;
    this.includeCoins = true;
    this.includeMagicItems = false;
    this.magicPercent = 25;
    this.generated = this.#createEmptyGenerated();
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
      hasResult: rows.length > 0 || coins.totalCopper > 0
    };
  }

  setSharedResult(payload = {}) {
    this.generated = this.#normalizeSharedResult(payload);
    this.render({ force: true }).catch((error) => {
      console.error(`${MODULE_ID} | Failed to refresh shared lootgen result.`, error);
    });
  }

  #toValue(rawValue, fallbackGold = 0) {
    const explicit = Math.max(0, toInteger(rawValue, 0));
    if (explicit > 0) {
      return explicit;
    }

    return Math.max(1, toInteger(Math.round(Math.max(0, toNumber(fallbackGold, 0)) * 100), 1));
  }

  #buildMundanePool(model) {
    const minRank = Math.max(0, Math.min(this.rankMin, this.rankMax));
    const maxRank = Math.max(minRank, Math.max(this.rankMin, this.rankMax));
    const pool = [];

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

        const fallbackGold = toNumber(gearItem.priceGoldEquivalent, toNumber(gearItem.priceValue, 0));
        const value = this.#toValue(gearItem.value, fallbackGold);
        pool.push({
          sourceType: "gear",
          sourceId: String(gearItem.id),
          name: String(gearItem.name ?? "Снаряжение"),
          rank,
          value,
          typeLabel: String(gearItem.equipmentType ?? "Снаряжение"),
          stackable: true
        });
      }
    }

    if (this.includeMaterials) {
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
          name: String(material.name ?? "Материал"),
          rank,
          value,
          typeLabel: String(material.type ?? "Материал"),
          stackable: true
        });
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

    const documents = await pack.getDocuments();
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
      pool.push({
        sourceType: "magicItem",
        sourceId,
        name: String(document.name ?? "Магический предмет"),
        rank,
        value,
        typeLabel: "Магический предмет",
        stackable: isConsumable
      });
    }

    return pool.sort((left, right) => left.rank - right.rank || left.value - right.value);
  }

  async #generateLoot() {
    const model = await this.moduleApi.getModel();
    const mundanePool = this.#buildMundanePool(model);
    const magicPool = this.includeMagicItems ? await this.#buildMagicPool() : [];
    if (!mundanePool.length && !magicPool.length) {
      throw new Error("Для выбранных параметров нет доступных предметов.");
    }

    const magicChance = Math.min(100, Math.max(0, toNumber(this.magicPercent, 0))) / 100;
    const forceMagicOnly = this.includeMagicItems && magicChance >= 0.999;
    const maxRows = Math.max(1, toInteger(this.itemCount, 1));
    const budgetValue = Math.max(0, toInteger(this.budgetValue, 0));
    let remainingValue = budgetValue;
    const picks = [];
    const usedUnique = new Set();

    for (let index = 0; index < maxRows; index += 1) {
      const affordableMundane = mundanePool.filter((entry) => {
        if (entry.value > remainingValue) {
          return false;
        }

        const entryKey = `${entry.sourceType}:${entry.sourceId}`;
        return !usedUnique.has(entryKey);
      });

      const affordableMagic = magicPool.filter((entry) => {
        if (entry.value > remainingValue) {
          return false;
        }

        const entryKey = `${entry.sourceType}:${entry.sourceId}`;
        return !usedUnique.has(entryKey);
      });

      if (!affordableMundane.length && !affordableMagic.length) {
        break;
      }

      let sourcePool = [];
      if (forceMagicOnly) {
        sourcePool = affordableMagic;
      }
      else {
        const wantsMagic = this.includeMagicItems
          && affordableMagic.length > 0
          && (!affordableMundane.length || Math.random() < magicChance);
        sourcePool = wantsMagic
          ? affordableMagic
          : (affordableMundane.length ? affordableMundane : affordableMagic);
      }

      if (!sourcePool.length) {
        break;
      }

      const picked = randomPick(sourcePool);
      if (!picked) {
        break;
      }

      const pickedKey = `${picked.sourceType}:${picked.sourceId}`;
      usedUnique.add(pickedKey);

      let quantity = 1;
      if (picked.stackable) {
        const maxQtyByBudget = Math.max(1, Math.floor(remainingValue / picked.value));
        const randomQtyCap = Math.min(maxQtyByBudget, 1 + Math.floor(Math.random() * 4));
        quantity = Math.max(1, randomQtyCap);
      }

      let totalValue = picked.value * quantity;
      if (totalValue > remainingValue) {
        quantity = 1;
        totalValue = picked.value;
      }

      picks.push({
        ...picked,
        quantity,
        totalValue
      });

      remainingValue = Math.max(0, remainingValue - totalValue);
      if (remainingValue <= 0) {
        break;
      }
    }

    const rows = aggregateRows(picks);
    const spentValue = rows.reduce((sum, row) => sum + row.totalValue, 0);
    const coinValue = this.includeCoins ? remainingValue : 0;
    const coins = randomCoinsFromValue(coinValue);
    this.generated = {
      rows,
      coins,
      spentValue,
      budgetValue,
      totalItems: rows.reduce((sum, row) => sum + row.quantity, 0),
      generatedAt: new Intl.DateTimeFormat("ru-RU", {
        dateStyle: "short",
        timeStyle: "medium"
      }).format(new Date()),
      hasResult: rows.length > 0 || coins.totalCopper > 0
    };
  }

  #buildSharedPayload() {
    return foundry.utils.deepClone({
      rows: this.generated.rows,
      coins: normalizeCoins(this.generated.coins ?? {}),
      spentValue: this.generated.spentValue,
      budgetValue: this.generated.budgetValue,
      totalItems: this.generated.totalItems,
      generatedAt: this.generated.generatedAt
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

    await this.moduleApi.addModelItemToInventory(row.sourceType, row.sourceId, row.quantity);
  }

  async #addCoinsToInventory() {
    const coins = normalizeCoins(this.generated.coins ?? {});
    if (coins.totalCopper <= 0) {
      return false;
    }

    const inventory = await this.moduleApi.getInventorySnapshot({ createActor: true });
    const current = inventory?.summary?.currency ?? {
      pp: 0,
      gp: 0,
      sp: 0,
      cp: 0
    };

    await this.moduleApi.updatePartyCurrency({
      pp: toInteger(current.pp, 0) + coins.pp,
      gp: toInteger(current.gp, 0) + coins.gp,
      sp: toInteger(current.sp, 0) + coins.sp,
      cp: toInteger(current.cp, 0) + coins.cp
    });

    return true;
  }

  async #takeAllToInventory() {
    for (const row of this.generated.rows) {
      await this.moduleApi.addModelItemToInventory(row.sourceType, row.sourceId, row.quantity);
    }

    await this.#addCoinsToInventory();
  }

  async _prepareContext() {
    const isGM = game.user?.isGM === true;
    const canManage = isGM && !this.viewer;
    return {
      isGM,
      viewer: this.viewer,
      canManage,
      appKey: this.appKey,
      form: {
        rankMin: this.rankMin,
        rankMax: this.rankMax,
        itemCount: this.itemCount,
        budgetValue: this.budgetValue,
        includeGear: this.includeGear,
        includeMaterials: this.includeMaterials,
        includeCoins: this.includeCoins,
        includeMagicItems: this.includeMagicItems,
        magicPercent: this.magicPercent
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

    bringAppToFront(this);

    element.querySelectorAll("[data-action='lootgen-open-entry']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          const rowIndex = toInteger(event.currentTarget.dataset.rowIndex, -1);
          await this.#openGeneratedRowEntry(rowIndex);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open generated loot entry.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть предмет лутгена.");
        }
      }, listenerOptions);
    });

    if (!this.viewer) {
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

          if (fieldName === "magicPercent") {
            this[fieldName] = Math.min(100, Math.max(0, toInteger(input.value, this[fieldName])));
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
          ui.notifications?.info("Лут сгенерирован.");
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to generate loot.`, error);
          ui.notifications?.error(error.message || "Не удалось сгенерировать лут.");
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-clear']")?.addEventListener("click", async () => {
        this.generated = this.#createEmptyGenerated();
        await this.render({ force: true });
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
            ui.notifications?.info("Строка добавлена в партийный склад.");
          }
          catch (error) {
            console.error(`${MODULE_ID} | Failed to add loot row to inventory.`, error);
            ui.notifications?.error(error.message || "Не удалось добавить строку лутгена.");
          }
        }, listenerOptions);
      });

      element.querySelector("[data-action='lootgen-take-all']")?.addEventListener("click", async () => {
        try {
          await this.#takeAllToInventory();
          ui.notifications?.info("Лут полностью перенесён в партийный склад.");
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to transfer generated loot.`, error);
          ui.notifications?.error(error.message || "Не удалось перенести лутген в партийный склад.");
        }
      }, listenerOptions);

      element.querySelector("[data-action='lootgen-take-coins']")?.addEventListener("click", async () => {
        try {
          const applied = await this.#addCoinsToInventory();
          if (applied) {
            ui.notifications?.info("Монеты из лутгена добавлены в партийный склад.");
          }
          else {
            ui.notifications?.warn("В текущем лутгене нет монет для добавления.");
          }
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to transfer generated coins.`, error);
          ui.notifications?.error(error.message || "Не удалось перенести монеты лутгена.");
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
