import {
  ENERGY_BASE_DAYS,
  ENERGY_MIN_DAYS,
  MAGIC_ITEMS_COMPENDIUM_NAME,
  MODULE_ID,
  REBREYA_TOOLS,
  SETTINGS_KEYS
} from "../constants.js";

const DEFAULT_PARTY_ACTOR_NAME = "Инвентарь группы Rebreya";
const DEFAULT_PARTY_ACTOR_IMAGE = "icons/svg/item-bag.svg";
const FOOD_ITEM_NAME = "Еда";
const WATER_ITEM_NAME = "Галлоны воды";
const WATER_LB_PER_GALLON = 8;
const DEFAULT_CAPACITY_MULTIPLIER = 15;
const COIN_LABELS = {
  pp: "пм",
  gp: "зм",
  sp: "см",
  cp: "мм"
};

const CURRENCY_MULTIPLIERS = {
  pp: 1000,
  gp: 100,
  sp: 10,
  cp: 1
};

const REBREYA_TOOL_IDS = new Set(REBREYA_TOOLS.map((tool) => tool.id));
const REBREYA_TOOL_LABEL_BY_ID = new Map(REBREYA_TOOLS.map((tool) => [tool.id, tool.label]));
const REBREYA_TOOL_ID_BY_LABEL = new Map(REBREYA_TOOLS.map((tool) => [normalizeText(tool.label), tool.id]));
const LEGACY_REBREYA_TOOL_LABEL_ALIASES = [
  ["Воровские", "thieves"],
  ["Алхимические", "alchemy"],
  ["Кузнеца", "smith"],
  ["Каллиграфа", "calligrapher"],
  ["Поддельщика", "forgery"],
  ["Гримёра", "disguise"],
  ["Художественные", "artisan"],
  ["Исследователя", "investigator"],
  ["Жестянщика", "tinker"],
  ["Камнелома", "mason"],
  ["Каменолома", "mason"],
  ["Кожедела", "leatherworker"],
  ["Пивовара", "brewer"],
  ["Деревянщика", "woodcarver"],
  ["Повара", "cook"],
  ["Ювелира", "jeweler"]
];
REBREYA_TOOL_ID_BY_LABEL.set(normalizeText("Камнелома"), "mason");
REBREYA_TOOL_ID_BY_LABEL.set(normalizeText("Каменолома"), "mason");
for (const [legacyLabel, toolId] of LEGACY_REBREYA_TOOL_LABEL_ALIASES) {
  REBREYA_TOOL_ID_BY_LABEL.set(normalizeText(legacyLabel), toolId);
}

const PARTY_ROLE_DEFAULTS = {
  member: {
    role: "member",
    foodPerDay: 1,
    waterGalPerDay: 1
  },
  mount: {
    role: "mount",
    foodPerDay: 4,
    waterGalPerDay: 4
  },
  transport: {
    role: "transport",
    foodPerDay: 0,
    waterGalPerDay: 0
  }
};

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function normalizeInventorySourceType(value) {
  const compact = normalizeText(value).replace(/[_\-\s]+/gu, "");
  if (!compact) {
    return "";
  }

  if (["material", "materials", "материал", "материалы"].includes(compact)) {
    return "material";
  }

  if (["gear", "equipment", "loot", "снаряжение"].includes(compact)) {
    return "gear";
  }

  if (["supply", "supplies", "resource", "resources", "запасы"].includes(compact)) {
    return "supply";
  }

  if (["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"].includes(compact)) {
    return "magicItem";
  }

  if (["custom", "other", "прочее"].includes(compact)) {
    return "custom";
  }

  return "";
}

function normalizeRole(role) {
  const safeRole = String(role ?? "member").trim().toLowerCase();
  if (safeRole === "mount" || safeRole === "transport" || safeRole === "member") {
    return safeRole;
  }

  if (safeRole === "скакун") {
    return "mount";
  }

  if (safeRole === "транспорт") {
    return "transport";
  }

  return "member";
}

function getRoleLabel(role) {
  switch (normalizeRole(role)) {
    case "mount":
      return "Скакун";
    case "transport":
      return "Транспорт";
    case "member":
    default:
      return "Член группы";
  }
}

function getRawQuantity(itemData) {
  return Math.max(0, toNumber(foundry.utils.getProperty(itemData, "system.quantity"), 1));
}

function getItemWeight(itemData) {
  return Math.max(0, toNumber(foundry.utils.getProperty(itemData, "system.weight.value"), 0));
}

function getActorStrength(actor) {
  return Math.max(0, Math.floor(toNumber(foundry.utils.getProperty(actor, "system.abilities.str.value"), 0)));
}

function formatPriceLabel(price) {
  const rawValue = toNumber(price?.value, 0);
  if (rawValue <= 0) {
    return "-";
  }

  const denomination = String(price?.denomination ?? "gp").toLowerCase();
  return `${rawValue} ${COIN_LABELS[denomination] ?? denomination}`;
}

function buildCurrencyLabel(actor) {
  const currency = foundry.utils.getProperty(actor, "system.currency") ?? {};
  const parts = ["pp", "gp", "sp", "cp"]
    .map((key) => {
      const amount = Math.floor(Math.max(0, toNumber(currency[key], 0)));
      return amount > 0 ? `${amount} ${COIN_LABELS[key]}` : "";
    })
    .filter(Boolean);

  return parts.length ? parts.join(" ") : `0 ${COIN_LABELS.cp}`;
}

function buildCurrencySnapshot(actor) {
  const value = {
    pp: getCurrencyValue(actor, "pp"),
    gp: getCurrencyValue(actor, "gp"),
    sp: getCurrencyValue(actor, "sp"),
    cp: getCurrencyValue(actor, "cp")
  };
  return {
    ...value,
    totalCopper: actorCurrencyToCopper(actor),
    label: buildCurrencyLabel(actor)
  };
}

function getCurrencyValue(actor, key) {
  const currency = foundry.utils.getProperty(actor, "system.currency") ?? {};
  return Math.floor(Math.max(0, toNumber(currency?.[key], 0)));
}

function actorCurrencyToCopper(actor) {
  return Object.entries(CURRENCY_MULTIPLIERS)
    .reduce((sum, [key, multiplier]) => sum + (getCurrencyValue(actor, key) * multiplier), 0);
}

function copperToCurrency(totalCopper, mode = "normalized") {
  let remaining = Math.max(0, Math.floor(toNumber(totalCopper, 0)));
  const result = {
    pp: 0,
    gp: 0,
    sp: 0,
    cp: 0
  };

  if (mode === "cp") {
    result.cp = remaining;
    return result;
  }

  if (mode === "sp") {
    result.sp = Math.floor(remaining / CURRENCY_MULTIPLIERS.sp);
    result.cp = remaining % CURRENCY_MULTIPLIERS.sp;
    return result;
  }

  if (mode === "gp") {
    result.gp = Math.floor(remaining / CURRENCY_MULTIPLIERS.gp);
    remaining -= result.gp * CURRENCY_MULTIPLIERS.gp;
    result.sp = Math.floor(remaining / CURRENCY_MULTIPLIERS.sp);
    result.cp = remaining % CURRENCY_MULTIPLIERS.sp;
    return result;
  }

  result.pp = Math.floor(remaining / CURRENCY_MULTIPLIERS.pp);
  remaining -= result.pp * CURRENCY_MULTIPLIERS.pp;
  result.gp = Math.floor(remaining / CURRENCY_MULTIPLIERS.gp);
  remaining -= result.gp * CURRENCY_MULTIPLIERS.gp;
  result.sp = Math.floor(remaining / CURRENCY_MULTIPLIERS.sp);
  remaining -= result.sp * CURRENCY_MULTIPLIERS.sp;
  result.cp = remaining;
  return result;
}

function buildCurrencyUpdatePatch(currency) {
  return {
    "system.currency.pp": Math.max(0, Math.floor(toNumber(currency.pp, 0))),
    "system.currency.gp": Math.max(0, Math.floor(toNumber(currency.gp, 0))),
    "system.currency.ep": 0,
    "system.currency.sp": Math.max(0, Math.floor(toNumber(currency.sp, 0))),
    "system.currency.cp": Math.max(0, Math.floor(toNumber(currency.cp, 0)))
  };
}

function normalizeToolId(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  if (REBREYA_TOOL_IDS.has(text)) {
    return text;
  }

  return REBREYA_TOOL_ID_BY_LABEL.get(text) ?? "";
}

function buildDefaultToolState() {
  return {
    owned: false,
    prof: false,
    mod: 0
  };
}

function normalizeToolState(value) {
  const mod = roundNumber(toNumber(value?.mod, 0), 2);
  return {
    owned: Boolean(value?.owned),
    prof: Boolean(value?.prof),
    mod: Number.isFinite(mod) ? mod : 0
  };
}

function normalizeToolsMap(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalizedSource = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const normalizedKey = normalizeToolId(rawKey);
    if (!normalizedKey) {
      continue;
    }

    normalizedSource[normalizedKey] = rawValue;
  }

  const result = {};
  for (const tool of REBREYA_TOOLS) {
    result[tool.id] = normalizeToolState(
      source[tool.id]
      ?? normalizedSource[tool.id]
      ?? buildDefaultToolState()
    );
  }
  return result;
}

function getActorConMod(actor) {
  const conMod = toNumber(foundry.utils.getProperty(actor, "system.abilities.con.mod"), 0);
  return Math.floor(conMod);
}

function resolveEnergyMax(memberState, actorDocument = null) {
  const conOverride = memberState.conModOverride;
  const conMod = conOverride !== null && conOverride !== undefined
    ? Math.floor(toNumber(conOverride, 0))
    : getActorConMod(actorDocument);
  return Math.max(ENERGY_MIN_DAYS, Math.floor(ENERGY_BASE_DAYS + conMod));
}

function clampEnergyCurrent(memberState, actorDocument = null) {
  const maxEnergy = resolveEnergyMax(memberState, actorDocument);
  const current = Math.floor(toNumber(memberState.energyCurrent, maxEnergy));
  return {
    current: Math.max(0, Math.min(maxEnergy, current)),
    max: maxEnergy
  };
}

function sanitizeEmbeddedItemData(itemData) {
  const source = foundry.utils.deepClone(itemData);
  delete source._id;
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  delete source._stats;
  return source;
}

function buildDefaultPartyState() {
  return {
    version: 1,
    inventoryActorId: "",
    defaultCapMod: DEFAULT_CAPACITY_MULTIPLIER,
    members: {}
  };
}

function buildDefaultMemberState(role = "member") {
  const defaults = PARTY_ROLE_DEFAULTS[normalizeRole(role)] ?? PARTY_ROLE_DEFAULTS.member;
  return {
    role: defaults.role,
    foodPerDay: defaults.foodPerDay,
    waterGalPerDay: defaults.waterGalPerDay,
    strOverride: null,
    capModOverride: null,
    capBonusLb: 0,
    conModOverride: null,
    energyCurrent: null,
    tools: normalizeToolsMap({})
  };
}

function buildSupplyItemData(resourceKey, quantity) {
  const isWater = resourceKey === "water";
  const name = isWater ? WATER_ITEM_NAME : FOOD_ITEM_NAME;
  const img = isWater
    ? "icons/consumables/water/waterskin-leather-blue.webp"
    : "icons/consumables/food/bowl-oatmeal-brown.webp";
  const weightPerUnit = isWater ? WATER_LB_PER_GALLON : 1;
  const description = isWater
    ? "<p>Общий запас воды группы. Количество считается в галлонах.</p>"
    : "<p>Общий запас еды группы. Количество считается в фунтах.</p>";

  return {
    name,
    type: "loot",
    img,
    system: {
      description: {
        value: description,
        chat: ""
      },
      unidentified: {
        description: ""
      },
      quantity: Math.max(0, roundNumber(quantity, 2)),
      price: {
        value: 0,
        denomination: "cp"
      },
      weight: {
        value: weightPerUnit,
        units: "lb"
      },
      type: {
        value: "loot",
        subtype: "Запасы"
      }
    },
    flags: {
      [MODULE_ID]: {
        managedPartySupply: true,
        resourceKey
      }
    }
  };
}

export class InventoryService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
  }

  #normalizeMemberState(member, fallbackRole = "member") {
    const nextRole = normalizeRole(member?.role ?? fallbackRole);
    const defaults = PARTY_ROLE_DEFAULTS[nextRole] ?? PARTY_ROLE_DEFAULTS.member;
    const strOverride = Number.isFinite(Number(member?.strOverride))
      ? Math.max(0, Math.floor(Number(member.strOverride)))
      : null;
    const capModOverride = Number.isFinite(Number(member?.capModOverride))
      ? Math.max(1, roundNumber(Number(member.capModOverride), 2))
      : null;
    const conModOverride = Number.isFinite(Number(member?.conModOverride))
      ? Math.floor(Number(member.conModOverride))
      : null;
    const energyCurrent = member?.energyCurrent === null || member?.energyCurrent === undefined || String(member?.energyCurrent).trim() === ""
      ? null
      : Math.max(0, Math.floor(toNumber(member.energyCurrent, 0)));

    return {
      role: nextRole,
      foodPerDay: Math.max(0, roundNumber(toNumber(member?.foodPerDay, defaults.foodPerDay), 2)),
      waterGalPerDay: Math.max(0, roundNumber(toNumber(member?.waterGalPerDay, defaults.waterGalPerDay), 2)),
      strOverride,
      capModOverride,
      capBonusLb: Math.max(0, roundNumber(toNumber(member?.capBonusLb, 0), 2)),
      conModOverride,
      energyCurrent,
      tools: normalizeToolsMap(member?.tools)
    };
  }

  #getState() {
    const rawState = game.settings.get(MODULE_ID, SETTINGS_KEYS.PARTY_STATE);
    const state = foundry.utils.mergeObject(buildDefaultPartyState(), foundry.utils.deepClone(rawState ?? {}));
    state.inventoryActorId = String(state.inventoryActorId ?? "").trim();
    state.defaultCapMod = Math.max(1, roundNumber(toNumber(state.defaultCapMod, DEFAULT_CAPACITY_MULTIPLIER), 2));
    state.members = state.members && typeof state.members === "object" ? state.members : {};

    for (const [actorId, member] of Object.entries(state.members)) {
      state.members[actorId] = this.#normalizeMemberState(member);
    }

    return state;
  }

  async #setState(nextState) {
    await game.settings.set(MODULE_ID, SETTINGS_KEYS.PARTY_STATE, nextState);
    return nextState;
  }

  async #writeState(mutator) {
    if (!game.user?.isGM) {
      throw new Error("Партийные настройки может менять только ГМ.");
    }

    const state = this.#getState();
    const result = await mutator(state);
    await this.#setState(state);
    return result;
  }

  #findSupplyItem(actor, resourceKey) {
    return actor.items.contents.find((item) => {
      const itemResourceKey = item.getFlag(MODULE_ID, "resourceKey");
      if (itemResourceKey === resourceKey) {
        return true;
      }

      const itemName = normalizeText(item.name);
      return resourceKey === "food"
        ? itemName === normalizeText(FOOD_ITEM_NAME)
        : itemName === normalizeText(WATER_ITEM_NAME);
    }) ?? null;
  }

  async #ensureSupplyItem(actor, resourceKey) {
    const existing = this.#findSupplyItem(actor, resourceKey);
    if (existing) {
      return existing;
    }

    const [created] = await actor.createEmbeddedDocuments("Item", [buildSupplyItemData(resourceKey, 0)]);
    return created ?? null;
  }

  #getInventoryWeight(actor) {
    return roundNumber(actor.items.contents.reduce((sum, item) => {
      const itemData = item.toObject();
      return sum + (getRawQuantity(itemData) * getItemWeight(itemData));
    }, 0), 2);
  }

  async #upsertInventoryItem(actor, itemData, quantity = null) {
    if (!(actor instanceof Actor)) {
      throw new Error("Не удалось определить актёра партийного инвентаря.");
    }

    const source = sanitizeEmbeddedItemData(itemData);
    const sourceFlags = foundry.utils.deepClone(source.flags?.[MODULE_ID] ?? {});
    const targetQuantity = quantity === null
      ? Math.max(0, getRawQuantity(source))
      : Math.max(0, roundNumber(toNumber(quantity, 0), 2));
    if (targetQuantity <= 0) {
      return null;
    }

    const mergeCandidate = actor.items.contents.find((candidate) => {
      const candidateFlags = foundry.utils.deepClone(candidate.flags?.[MODULE_ID] ?? {});
      if (sourceFlags.sourceType && sourceFlags.sourceId) {
        return candidateFlags.sourceType === sourceFlags.sourceType && candidateFlags.sourceId === sourceFlags.sourceId;
      }

      return normalizeText(candidate.name) === normalizeText(source.name) && candidate.type === source.type;
    }) ?? null;

    if (mergeCandidate) {
      const nextQuantity = roundNumber(getRawQuantity(mergeCandidate.toObject()) + targetQuantity, 2);
      await mergeCandidate.update({
        "system.quantity": nextQuantity
      });
      return mergeCandidate;
    }

    foundry.utils.setProperty(source, "system.quantity", targetQuantity);
    const [created] = await actor.createEmbeddedDocuments("Item", [source]);
    return created ?? null;
  }

  #buildMaterialItemData(material, quantity) {
    return {
      name: material.name,
      type: "loot",
      img: "icons/commodities/materials/slime-thick-blue.webp",
      system: {
        description: {
          value: material.description ? `<p>${foundry.utils.escapeHTML(material.description)}</p>` : "",
          chat: ""
        },
        unidentified: {
          description: ""
        },
        quantity: Math.max(0.01, roundNumber(quantity, 2)),
        price: {
          value: Math.max(0, roundNumber(toNumber(material.priceGold, 0), 2)),
          denomination: "gp"
        },
        weight: {
          value: Math.max(0.01, roundNumber(toNumber(material.weight, 1), 2)),
          units: "lb"
        },
        type: {
          value: "trade",
          subtype: material.type || "Материал"
        }
      },
      flags: {
        [MODULE_ID]: {
          sourceType: "material",
          sourceId: material.id,
          materialId: material.id,
          linkedGoodId: material.linkedGoodId ?? null,
          predominantMaterialId: material.id,
          predominantMaterialName: material.name
        }
      }
    };
  }

  #buildGearItemData(gearItem, quantity) {
    return {
      name: gearItem.name,
      type: "loot",
      img: "icons/svg/item-bag.svg",
      system: {
        description: {
          value: gearItem.description ? `<p>${foundry.utils.escapeHTML(gearItem.description)}</p>` : "",
          chat: ""
        },
        unidentified: {
          description: ""
        },
        quantity: Math.max(0.01, roundNumber(quantity, 2)),
        price: {
          value: Math.max(0, roundNumber(toNumber(gearItem.priceGoldEquivalent, toNumber(gearItem.priceValue, 0)), 2)),
          denomination: "gp"
        },
        weight: {
          value: Math.max(0, roundNumber(toNumber(gearItem.weight, 0), 2)),
          units: "lb"
        },
        type: {
          value: "loot",
          subtype: gearItem.equipmentType || "Снаряжение"
        }
      },
      flags: {
        [MODULE_ID]: {
          sourceType: "gear",
          sourceId: gearItem.id,
          gearId: gearItem.id,
          linkedTool: gearItem.linkedTool ?? "",
          predominantMaterialId: gearItem.predominantMaterialId ?? null,
          predominantMaterialName: gearItem.predominantMaterialName ?? "",
          rank: gearItem.rank ?? 0
        }
      }
    };
  }

  #matchInventorySource(model, item) {
    const sourceFlags = foundry.utils.deepClone(item.flags?.[MODULE_ID] ?? {});
    const itemName = normalizeText(item.name);
    const normalizedSourceType = normalizeInventorySourceType(sourceFlags.sourceType);
    const isMagicFlag = normalizedSourceType === "magicItem"
      || Boolean(sourceFlags.magicItemId)
      || Boolean(sourceFlags.magicId)
      || normalizeInventorySourceType(sourceFlags.itemType) === "magicItem"
      || normalizeInventorySourceType(sourceFlags.magicItemType) === "magicItem"
      || Boolean(sourceFlags.magical);
    const matchedMaterial = model.materialById?.get(sourceFlags.materialId)
      ?? model.materialById?.get(sourceFlags.sourceId)
      ?? model.materialByGoodId?.get(sourceFlags.linkedGoodId)
      ?? model.materials.find((material) => normalizeText(material.name) === itemName)
      ?? null;
    const matchedGear = model.gearById?.get(sourceFlags.gearId)
      ?? model.gearById?.get(sourceFlags.sourceId)
      ?? model.gear.find((gearItem) => normalizeText(gearItem.name) === itemName)
      ?? null;
    const resourceKey = String(sourceFlags.resourceKey ?? "").trim().toLowerCase();
    let sourceType = normalizedSourceType;
    if (!sourceType) {
      if (resourceKey) {
        sourceType = "supply";
      }
      else if (isMagicFlag) {
        sourceType = "magicItem";
      }
      else if (matchedMaterial) {
        sourceType = "material";
      }
      else if (matchedGear) {
        sourceType = "gear";
      }
      else {
        sourceType = "custom";
      }
    }

    return {
      sourceFlags,
      sourceType,
      sourceId: sourceFlags.sourceId
        ?? sourceFlags.magicItemId
        ?? sourceFlags.magicId
        ?? matchedMaterial?.id
        ?? matchedGear?.id
        ?? item.id,
      matchedMaterial,
      matchedGear,
      resourceKey
    };
  }

  #buildInventoryEntry(model, item) {
    const itemData = item.toObject();
    const quantity = roundNumber(getRawQuantity(itemData), 2);
    const weightEach = roundNumber(getItemWeight(itemData), 2);
    const totalWeight = roundNumber(quantity * weightEach, 2);
    const {
      sourceFlags,
      sourceType,
      sourceId,
      matchedMaterial,
      matchedGear,
      resourceKey
    } = this.#matchInventorySource(model, item);
    const isFood = resourceKey === "food" || normalizeText(item.name) === normalizeText(FOOD_ITEM_NAME);
    const isWater = resourceKey === "water" || normalizeText(item.name) === normalizeText(WATER_ITEM_NAME);
    const itemTypeLabel = matchedMaterial?.type
      ?? matchedGear?.equipmentType
      ?? sourceFlags.itemType
      ?? sourceFlags.magicItemType
      ?? String(foundry.utils.getProperty(itemData, "system.type.subtype") || item.type || "Предмет");
    const materialLabel = matchedMaterial?.name
      ?? matchedGear?.predominantMaterialName
      ?? sourceFlags.predominantMaterialName
      ?? "";

    return {
      itemId: item.id,
      itemUuid: item.uuid,
      name: item.name,
      img: item.img,
      quantity,
      weightEach,
      totalWeight,
      priceLabel: formatPriceLabel(foundry.utils.getProperty(itemData, "system.price") ?? {}),
      sourceType,
      sourceTypeLabel: sourceType === "material"
        ? "Материал"
        : (sourceType === "gear"
          ? "Снаряжение"
          : (sourceType === "magicItem"
            ? "Магический предмет"
            : (sourceType === "supply" ? "Запасы" : "Прочее"))),
      sourceId,
      sourceName: item.name,
      canOpenEntry: sourceType === "material" || sourceType === "gear" || sourceType === "magicItem",
      itemTypeLabel,
      materialLabel,
      isFood,
      isWater
    };
  }

  async getInventoryActor({ create = false } = {}) {
    const state = this.#getState();
    const existingActor = state.inventoryActorId ? game.actors.get(state.inventoryActorId) ?? null : null;
    if (existingActor) {
      return existingActor;
    }

    if (!create || !game.user?.isGM) {
      return null;
    }

    const actor = await Actor.create({
      name: DEFAULT_PARTY_ACTOR_NAME,
      type: "npc",
      img: DEFAULT_PARTY_ACTOR_IMAGE,
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
      },
      flags: {
        [MODULE_ID]: {
          managedPartyInventory: true
        }
      }
    }, {
      renderSheet: false
    });

    await this.#writeState((nextState) => {
      nextState.inventoryActorId = actor.id;
    });

    return actor;
  }

  async openInventoryActorSheet() {
    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить актёра партийного инвентаря.");
    }

    await actor.sheet?.render?.(true);
    return actor;
  }

  async getPartySnapshot({ actor = null } = {}) {
    const state = this.#getState();
    const inventoryActor = actor ?? await this.getInventoryActor({ create: false });
    const inventoryWeight = inventoryActor ? this.#getInventoryWeight(inventoryActor) : 0;
    const model = inventoryActor ? await this.moduleApi.getModel() : null;

    const partyMembers = Object.entries(state.members)
      .map(([actorId, memberState]) => {
        const actorDocument = game.actors.get(actorId) ?? null;
        const effectiveStrength = memberState.strOverride ?? getActorStrength(actorDocument);
        const capacityMultiplier = memberState.capModOverride ?? state.defaultCapMod;
        const capacityLb = memberState.role === "transport"
          ? roundNumber(memberState.capBonusLb, 2)
          : roundNumber((effectiveStrength * capacityMultiplier) + memberState.capBonusLb, 2);
        const energyState = clampEnergyCurrent(memberState, actorDocument);
        const conModEffective = memberState.conModOverride ?? getActorConMod(actorDocument);
        const toolEntries = REBREYA_TOOLS.map((tool) => {
          const currentToolState = normalizeToolState(memberState.tools?.[tool.id]);
          return {
            toolId: tool.id,
            label: tool.label,
            owned: currentToolState.owned,
            prof: currentToolState.prof,
            mod: currentToolState.mod
          };
        });

        return {
          actorId,
          actorName: actorDocument?.name ?? actorId,
          actorImg: actorDocument?.img ?? "icons/svg/mystery-man.svg",
          isMissing: !actorDocument,
          role: memberState.role,
          roleLabel: getRoleLabel(memberState.role),
          strength: effectiveStrength,
          strengthSource: memberState.strOverride !== null ? "Ручная" : "Лист",
          capacityMultiplier,
          capacityLb,
          capBonusLb: memberState.capBonusLb,
          foodPerDay: memberState.foodPerDay,
          waterGalPerDay: memberState.waterGalPerDay,
          conMod: conModEffective,
          conModSource: memberState.conModOverride !== null ? "Ручной" : "Лист",
          conModOverride: memberState.conModOverride === null ? "" : String(memberState.conModOverride),
          energyCurrent: energyState.current,
          energyMax: energyState.max,
          energyPercent: energyState.max > 0
            ? Math.max(0, Math.min(100, roundNumber((energyState.current / energyState.max) * 100, 0)))
            : 0,
          strOverride: memberState.strOverride === null ? "" : String(memberState.strOverride),
          capModOverride: memberState.capModOverride === null ? "" : String(memberState.capModOverride),
          tools: toolEntries,
          roleOptions: ["member", "mount", "transport"].map((value) => ({
            value,
            label: getRoleLabel(value),
            selected: value === memberState.role
          }))
        };
      })
      .sort((left, right) => left.actorName.localeCompare(right.actorName, "ru"));

    const totalCapacityLb = roundNumber(partyMembers.reduce((sum, member) => sum + member.capacityLb, 0), 2);
    const totalFoodPerDay = roundNumber(partyMembers.reduce((sum, member) => sum + member.foodPerDay, 0), 2);
    const totalWaterGalPerDay = roundNumber(partyMembers.reduce((sum, member) => sum + member.waterGalPerDay, 0), 2);
    const totalEnergyCurrent = roundNumber(partyMembers.reduce((sum, member) => sum + member.energyCurrent, 0), 0);
    const totalEnergyMax = roundNumber(partyMembers.reduce((sum, member) => sum + member.energyMax, 0), 0);
    const availableActors = game.actors.contents
      .filter((actorDocument) => {
        if (!actorDocument?.isOwner) {
          return false;
        }

        if (actorDocument.id === state.inventoryActorId) {
          return false;
        }

        if (actorDocument.getFlag(MODULE_ID, "managedTrader")) {
          return false;
        }

        return !state.members[actorDocument.id];
      })
      .sort((left, right) => left.name.localeCompare(right.name, "ru"))
      .map((actorDocument) => ({
        id: actorDocument.id,
        name: actorDocument.name
      }));

    const inventoryEntries = inventoryActor && model
      ? inventoryActor.items.contents.map((item) => this.#buildInventoryEntry(model, item))
      : [];
    const foodLb = roundNumber(inventoryEntries.reduce((sum, entry) => sum + (entry.isFood ? entry.quantity : 0), 0), 2);
    const waterGal = roundNumber(inventoryEntries.reduce((sum, entry) => sum + (entry.isWater ? entry.quantity : 0), 0), 2);

    return {
      defaultCapMod: state.defaultCapMod,
      members: partyMembers,
      memberCount: partyMembers.length,
      emptyMembers: partyMembers.length === 0,
      availableActors,
      totalCapacityLb,
      totalFoodPerDay,
      totalWaterGalPerDay,
      totalEnergyCurrent,
      totalEnergyMax,
      inventoryWeight,
      freeCapacityLb: roundNumber(totalCapacityLb - inventoryWeight, 2),
      foodLb,
      waterGal,
      foodDaysLeft: totalFoodPerDay > 0 ? roundNumber(foodLb / totalFoodPerDay, 1) : null,
      waterDaysLeft: totalWaterGalPerDay > 0 ? roundNumber(waterGal / totalWaterGalPerDay, 1) : null,
      canManage: game.user?.isGM === true
    };
  }

  async getInventorySnapshot({ search = "", typeFilter = "all", createActor = true } = {}) {
    const actor = await this.getInventoryActor({ create: createActor });
    if (!actor) {
      return {
        actor: null,
        hasActor: false,
        items: [],
        allItems: [],
        emptyInventory: true,
        summary: {
          distinctCount: 0,
          totalQuantity: 0,
          totalWeight: 0,
          foodLb: 0,
          waterGal: 0,
          currencyLabel: `0 ${COIN_LABELS.cp}`
        }
      };
    }

    const model = await this.moduleApi.getModel();
    const currency = buildCurrencySnapshot(actor);
    const allItems = actor.items.contents
      .map((item) => this.#buildInventoryEntry(model, item))
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
    const normalizedSearch = normalizeText(search);
    const filteredItems = allItems.filter((entry) => {
      if (typeFilter !== "all" && entry.sourceType !== typeFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return normalizeText([
        entry.name,
        entry.itemTypeLabel,
        entry.materialLabel,
        entry.sourceTypeLabel
      ].join(" ")).includes(normalizedSearch);
    });

    const summary = {
      distinctCount: allItems.length,
      totalQuantity: roundNumber(allItems.reduce((sum, entry) => sum + entry.quantity, 0), 2),
      totalWeight: roundNumber(allItems.reduce((sum, entry) => sum + entry.totalWeight, 0), 2),
      foodLb: roundNumber(allItems.reduce((sum, entry) => sum + (entry.isFood ? entry.quantity : 0), 0), 2),
      waterGal: roundNumber(allItems.reduce((sum, entry) => sum + (entry.isWater ? entry.quantity : 0), 0), 2),
      currencyLabel: currency.label,
      currency
    };

    return {
      actor: {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        currencyLabel: currency.label,
        currency,
        canEdit: actor.isOwner
      },
      hasActor: true,
      items: filteredItems,
      allItems,
      emptyInventory: filteredItems.length === 0,
      summary
    };
  }

  async updateItemQuantity(itemId, nextQuantity) {
    const actor = await this.getInventoryActor({ create: true });
    const item = actor?.items.get(itemId) ?? null;
    if (!item) {
      throw new Error("Предмет не найден в партийном инвентаре.");
    }

    const safeQuantity = roundNumber(toNumber(nextQuantity, 0), 2);
    if (safeQuantity <= 0) {
      await item.delete();
      return null;
    }

    await item.update({
      "system.quantity": safeQuantity
    });

    return item;
  }

  async deleteItem(itemId) {
    const actor = await this.getInventoryActor({ create: true });
    const item = actor?.items.get(itemId) ?? null;
    if (!item) {
      throw new Error("Предмет не найден в партийном инвентаре.");
    }

    await item.delete();
    return itemId;
  }

  async addSupply(resourceKey, quantity) {
    if (!game.user?.isGM) {
      throw new Error("Запасы может менять только ГМ.");
    }

    const normalizedKey = resourceKey === "water" ? "water" : "food";
    const safeQuantity = Math.max(0, roundNumber(toNumber(quantity, 0), 2));
    const actor = await this.getInventoryActor({ create: true });
    const item = await this.#ensureSupplyItem(actor, normalizedKey);
    if (!item) {
      throw new Error("Не удалось подготовить предмет запасов.");
    }

    const currentQuantity = getRawQuantity(item.toObject());
    const nextQuantity = roundNumber(currentQuantity + safeQuantity, 2);
    await item.update({
      "system.quantity": nextQuantity,
      "system.weight.value": normalizedKey === "water" ? WATER_LB_PER_GALLON : 1
    });

    return item;
  }

  async updateCurrency(values = {}) {
    if (!game.user?.isGM) {
      throw new Error("Монеты может менять только ГМ.");
    }

    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const currentCurrency = buildCurrencySnapshot(actor);
    const nextCurrency = {
      pp: values.pp !== undefined ? Math.max(0, Math.floor(toNumber(values.pp, currentCurrency.pp))) : currentCurrency.pp,
      gp: values.gp !== undefined ? Math.max(0, Math.floor(toNumber(values.gp, currentCurrency.gp))) : currentCurrency.gp,
      sp: values.sp !== undefined ? Math.max(0, Math.floor(toNumber(values.sp, currentCurrency.sp))) : currentCurrency.sp,
      cp: values.cp !== undefined ? Math.max(0, Math.floor(toNumber(values.cp, currentCurrency.cp))) : currentCurrency.cp
    };
    await actor.update(buildCurrencyUpdatePatch(nextCurrency));
    return buildCurrencySnapshot(actor);
  }

  async convertCurrency(mode = "normalized") {
    if (!game.user?.isGM) {
      throw new Error("Конвертировать монеты может только ГМ.");
    }

    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const totalCopper = actorCurrencyToCopper(actor);
    const nextCurrency = copperToCurrency(totalCopper, mode);
    await actor.update(buildCurrencyUpdatePatch(nextCurrency));
    return {
      ...buildCurrencySnapshot(actor),
      totalCopper
    };
  }

  async addModelItemToInventory(sourceType, sourceId, quantity = 1) {
    if (!game.user?.isGM) {
      throw new Error("Добавлять предметы в партийный склад может только ГМ.");
    }

    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const model = await this.moduleApi.getModel();
    const safeQuantity = Math.max(0.01, roundNumber(toNumber(quantity, 1), 2));
    if (sourceType === "material") {
      const material = model.materialById?.get(sourceId) ?? null;
      if (!material) {
        throw new Error("Материал не найден в данных модуля.");
      }

      const itemData = this.#buildMaterialItemData(material, safeQuantity);
      return this.#upsertInventoryItem(actor, itemData, safeQuantity);
    }

    if (sourceType === "gear") {
      const gearItem = model.gearById?.get(sourceId) ?? null;
      if (!gearItem) {
        throw new Error("Предмет снаряжения не найден в данных модуля.");
      }

      const itemData = this.#buildGearItemData(gearItem, safeQuantity);
      return this.#upsertInventoryItem(actor, itemData, safeQuantity);
    }

    if (sourceType === "magicItem") {
      const pack = game.packs.get(`world.${MAGIC_ITEMS_COMPENDIUM_NAME}`) ?? null;
      const document = await this.moduleApi.magicItemsCompendium.getMagicItemDocument(sourceId);
      if (!pack || !document) {
        throw new Error("Магический предмет не найден в компендиуме.");
      }

      const itemData = sanitizeEmbeddedItemData(document.toObject());
      foundry.utils.setProperty(itemData, "system.quantity", safeQuantity);
      itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
      itemData.flags[MODULE_ID] = {
        ...(itemData.flags[MODULE_ID] ?? {}),
        sourceType: "magicItem",
        sourceId,
        magicItemId: sourceId,
        magical: true
      };

      return this.#upsertInventoryItem(actor, itemData, safeQuantity);
    }

    throw new Error("Неизвестный тип предмета для добавления в склад.");
  }

  async breakItemToMaterial(itemId, quantity = 1) {
    if (!game.user?.isGM) {
      throw new Error("Разбирать предметы может только ГМ.");
    }

    const actor = await this.getInventoryActor({ create: true });
    const item = actor?.items.get(itemId) ?? null;
    if (!item) {
      throw new Error("Предмет не найден в партийном инвентаре.");
    }

    const model = await this.moduleApi.getModel();
    const itemData = item.toObject();
    const currentQuantity = getRawQuantity(itemData);
    const breakQuantity = Math.max(1, Math.min(currentQuantity, Math.floor(toNumber(quantity, 1))));
    const itemWeight = getItemWeight(itemData);
    const totalWeight = itemWeight * breakQuantity;
    const materialWeight = Math.floor(Math.max(0, totalWeight * 0.5) * 100) / 100;
    if (materialWeight <= 0) {
      throw new Error("Недостаточно веса предмета для разборки на материалы.");
    }

    const sourceFlags = foundry.utils.deepClone(item.flags?.[MODULE_ID] ?? {});
    const material = model.materialById?.get(sourceFlags.materialId)
      ?? model.materialById?.get(sourceFlags.predominantMaterialId)
      ?? model.materialByGoodId?.get(sourceFlags.linkedGoodId)
      ?? model.materials.find((entry) => normalizeText(entry.name) === normalizeText(sourceFlags.predominantMaterialName))
      ?? model.materials.find((entry) => normalizeText(entry.name) === normalizeText(sourceFlags.materialLabel))
      ?? model.materials.find((entry) => normalizeText(entry.name) === normalizeText(sourceFlags.sourceName))
      ?? null;

    if (!material) {
      throw new Error("Для этого предмета не найден подходящий материал.");
    }

    const materialItemData = this.#buildMaterialItemData(material, materialWeight);
    await this.#upsertInventoryItem(actor, materialItemData, materialWeight);

    const nextQuantity = roundNumber(currentQuantity - breakQuantity, 2);
    if (nextQuantity <= 0) {
      await item.delete();
    }
    else {
      await item.update({
        "system.quantity": nextQuantity
      });
    }

    return {
      itemName: item.name,
      breakQuantity,
      materialName: material.name,
      materialWeight
    };
  }

  async addPartyMember(actorId) {
    if (!actorId) {
      throw new Error("Не выбран актёр для добавления в группу.");
    }

    return this.#writeState((state) => {
      state.members[actorId] = state.members[actorId] ?? buildDefaultMemberState("member");
      state.members[actorId] = this.#normalizeMemberState(state.members[actorId]);
      return foundry.utils.deepClone(state.members[actorId]);
    });
  }

  async removePartyMember(actorId) {
    if (!actorId) {
      return false;
    }

    return this.#writeState((state) => {
      delete state.members[actorId];
      return true;
    });
  }

  async updatePartyDefaults(patch = {}) {
    return this.#writeState((state) => {
      if (patch.defaultCapMod !== undefined) {
        const nextValue = Math.max(1, roundNumber(toNumber(patch.defaultCapMod, state.defaultCapMod), 2));
        state.defaultCapMod = nextValue;
      }

      return foundry.utils.deepClone(state);
    });
  }

  async updatePartyMember(actorId, patch = {}) {
    if (!actorId) {
      throw new Error("Не выбран участник группы.");
    }

    return this.#writeState((state) => {
      const currentState = this.#normalizeMemberState(state.members[actorId] ?? buildDefaultMemberState("member"));
      const nextRole = patch.role !== undefined ? normalizeRole(patch.role) : currentState.role;
      const roleChanged = nextRole !== currentState.role;
      const roleDefaults = PARTY_ROLE_DEFAULTS[nextRole] ?? PARTY_ROLE_DEFAULTS.member;

      const nextMember = {
        ...currentState,
        role: nextRole,
        foodPerDay: patch.foodPerDay !== undefined
          ? Math.max(0, roundNumber(toNumber(patch.foodPerDay, currentState.foodPerDay), 2))
          : (roleChanged ? roleDefaults.foodPerDay : currentState.foodPerDay),
        waterGalPerDay: patch.waterGalPerDay !== undefined
          ? Math.max(0, roundNumber(toNumber(patch.waterGalPerDay, currentState.waterGalPerDay), 2))
          : (roleChanged ? roleDefaults.waterGalPerDay : currentState.waterGalPerDay),
        strOverride: patch.strOverride !== undefined
          ? (String(patch.strOverride).trim() === "" ? null : Math.max(0, Math.floor(toNumber(patch.strOverride, 0))))
          : currentState.strOverride,
        capModOverride: patch.capModOverride !== undefined
          ? (String(patch.capModOverride).trim() === "" ? null : Math.max(1, roundNumber(toNumber(patch.capModOverride, 1), 2)))
          : currentState.capModOverride,
        capBonusLb: patch.capBonusLb !== undefined
          ? Math.max(0, roundNumber(toNumber(patch.capBonusLb, currentState.capBonusLb), 2))
          : currentState.capBonusLb,
        conModOverride: patch.conModOverride !== undefined
          ? (String(patch.conModOverride).trim() === "" ? null : Math.floor(toNumber(patch.conModOverride, 0)))
          : currentState.conModOverride,
        energyCurrent: patch.energyCurrent !== undefined
          ? (String(patch.energyCurrent).trim() === "" ? null : Math.max(0, Math.floor(toNumber(patch.energyCurrent, 0))))
          : currentState.energyCurrent,
        tools: patch.tools !== undefined
          ? normalizeToolsMap(patch.tools)
          : normalizeToolsMap(currentState.tools)
      };

      state.members[actorId] = this.#normalizeMemberState(nextMember, nextRole);
      return foundry.utils.deepClone(state.members[actorId]);
    });
  }

  async updatePartyMemberTool(actorId, toolId, patch = {}) {
    if (!actorId) {
      throw new Error("Не выбран участник группы.");
    }

    const normalizedToolId = normalizeToolId(toolId);
    if (!normalizedToolId) {
      throw new Error("Инструмент Rebreya не найден.");
    }

    return this.#writeState((state) => {
      const memberState = this.#normalizeMemberState(state.members[actorId] ?? buildDefaultMemberState("member"));
      const currentToolState = normalizeToolState(memberState.tools?.[normalizedToolId]);
      const nextToolState = normalizeToolState({
        ...currentToolState,
        ...patch
      });

      memberState.tools = normalizeToolsMap(memberState.tools);
      memberState.tools[normalizedToolId] = nextToolState;
      state.members[actorId] = this.#normalizeMemberState(memberState, memberState.role);
      return foundry.utils.deepClone(state.members[actorId].tools[normalizedToolId]);
    });
  }

  async setMemberEnergy(actorId, currentEnergy) {
    if (!actorId) {
      throw new Error("Не выбран участник группы.");
    }

    return this.#writeState((state) => {
      const memberState = this.#normalizeMemberState(state.members[actorId] ?? buildDefaultMemberState("member"));
      memberState.energyCurrent = Math.max(0, Math.floor(toNumber(currentEnergy, 0)));
      state.members[actorId] = this.#normalizeMemberState(memberState, memberState.role);
      return foundry.utils.deepClone(state.members[actorId]);
    });
  }

  async restoreMemberEnergy(actorId, days = 1) {
    if (!game.user?.isGM) {
      throw new Error("Восстанавливать энергию может только ГМ.");
    }

    if (!actorId) {
      throw new Error("Не выбран участник группы.");
    }

    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const partySnapshot = await this.getPartySnapshot({ actor });
    const member = partySnapshot.members.find((entry) => entry.actorId === actorId);
    if (!member) {
      throw new Error("Участник группы не найден.");
    }

    const restoreDays = Math.max(1, Math.floor(toNumber(days, 1)));
    const foodNeeded = roundNumber(member.foodPerDay * restoreDays, 2);
    const waterNeeded = roundNumber(member.waterGalPerDay * restoreDays, 2);
    const foodItem = this.#findSupplyItem(actor, "food");
    const waterItem = this.#findSupplyItem(actor, "water");
    const currentFood = foodItem ? getRawQuantity(foodItem.toObject()) : 0;
    const currentWater = waterItem ? getRawQuantity(waterItem.toObject()) : 0;

    if (currentFood + 1e-9 < foodNeeded || currentWater + 1e-9 < waterNeeded) {
      throw new Error("Не хватает еды или воды для восстановления энергии.");
    }

    const nextFood = roundNumber(currentFood - foodNeeded, 2);
    const nextWater = roundNumber(currentWater - waterNeeded, 2);

    if (foodItem) {
      if (nextFood <= 0) {
        await foodItem.delete();
      }
      else {
        await foodItem.update({ "system.quantity": nextFood });
      }
    }

    if (waterItem) {
      if (nextWater <= 0) {
        await waterItem.delete();
      }
      else {
        await waterItem.update({ "system.quantity": nextWater });
      }
    }

    const result = await this.#writeState((state) => {
      const memberState = this.#normalizeMemberState(state.members[actorId] ?? buildDefaultMemberState("member"));
      const actorDocument = game.actors.get(actorId) ?? null;
      const energyState = clampEnergyCurrent(memberState, actorDocument);
      memberState.energyCurrent = Math.min(energyState.max, energyState.current + restoreDays);
      state.members[actorId] = this.#normalizeMemberState(memberState, memberState.role);
      return {
        actorId,
        energyCurrent: state.members[actorId].energyCurrent
      };
    });

    return {
      ...result,
      foodSpent: foodNeeded,
      waterSpent: waterNeeded,
      nextFood,
      nextWater
    };
  }

  async consumeSuppliesOneDay({ applyEnergy = true } = {}) {
    if (!game.user?.isGM) {
      throw new Error("Списание дневных запасов доступно только ГМу.");
    }

    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const partySnapshot = await this.getPartySnapshot({ actor });
    const foodItem = this.#findSupplyItem(actor, "food");
    const waterItem = this.#findSupplyItem(actor, "water");
    const currentFood = foodItem ? getRawQuantity(foodItem.toObject()) : 0;
    const currentWater = waterItem ? getRawQuantity(waterItem.toObject()) : 0;
    const foodSpent = Math.min(currentFood, partySnapshot.totalFoodPerDay);
    const waterSpent = Math.min(currentWater, partySnapshot.totalWaterGalPerDay);
    const nextFood = roundNumber(currentFood - foodSpent, 2);
    const nextWater = roundNumber(currentWater - waterSpent, 2);

    if (foodItem) {
      if (nextFood <= 0) {
        await foodItem.delete();
      }
      else {
        await foodItem.update({ "system.quantity": nextFood });
      }
    }

    if (waterItem) {
      if (nextWater <= 0) {
        await waterItem.delete();
      }
      else {
        await waterItem.update({ "system.quantity": nextWater });
      }
    }

    let energyUpdates = [];
    if (applyEnergy && partySnapshot.memberCount > 0) {
      let availableFood = currentFood;
      let availableWater = currentWater;

      energyUpdates = await this.#writeState((state) => {
        const updates = [];
        const sortedMembers = Object.entries(state.members)
          .map(([actorId, memberState]) => ({
            actorId,
            actor: game.actors.get(actorId) ?? null,
            memberState: this.#normalizeMemberState(memberState)
          }))
          .sort((left, right) => String(left.actor?.name ?? left.actorId).localeCompare(String(right.actor?.name ?? right.actorId), "ru"));

        for (const row of sortedMembers) {
          const foodNeed = Math.max(0, roundNumber(toNumber(row.memberState.foodPerDay, 0), 2));
          const waterNeed = Math.max(0, roundNumber(toNumber(row.memberState.waterGalPerDay, 0), 2));
          const foodCovered = Math.min(availableFood, foodNeed);
          const waterCovered = Math.min(availableWater, waterNeed);
          availableFood = roundNumber(availableFood - foodCovered, 2);
          availableWater = roundNumber(availableWater - waterCovered, 2);
          const isHungry = foodCovered + 1e-9 < foodNeed || waterCovered + 1e-9 < waterNeed;

          const actorDocument = row.actor;
          const normalizedMember = this.#normalizeMemberState(row.memberState, row.memberState.role);
          const energyState = clampEnergyCurrent(normalizedMember, actorDocument);
          const nextEnergy = isHungry
            ? Math.max(0, energyState.current - 1)
            : Math.min(energyState.max, energyState.current);
          normalizedMember.energyCurrent = nextEnergy;
          state.members[row.actorId] = this.#normalizeMemberState(normalizedMember, normalizedMember.role);

          updates.push({
            actorId: row.actorId,
            actorName: actorDocument?.name ?? row.actorId,
            hungry: isHungry,
            foodNeed,
            waterNeed,
            foodCovered,
            waterCovered,
            energyCurrent: nextEnergy,
            energyMax: energyState.max
          });
        }

        return updates;
      });
    }

    return {
      memberCount: partySnapshot.memberCount,
      foodRequired: partySnapshot.totalFoodPerDay,
      waterRequired: partySnapshot.totalWaterGalPerDay,
      foodSpent,
      waterSpent,
      foodShortage: roundNumber(Math.max(0, partySnapshot.totalFoodPerDay - foodSpent), 2),
      waterShortage: roundNumber(Math.max(0, partySnapshot.totalWaterGalPerDay - waterSpent), 2),
      nextFood,
      nextWater,
      energyUpdates
    };
  }

  getRebreyaToolCatalog() {
    return REBREYA_TOOLS.map((tool) => ({
      ...tool
    }));
  }

  resolveRebreyaToolId(value) {
    return normalizeToolId(value);
  }

  getRebreyaToolLabel(toolId) {
    const normalizedToolId = normalizeToolId(toolId);
    return REBREYA_TOOL_LABEL_BY_ID.get(normalizedToolId) ?? "";
  }

  async importDroppedItem(dropData) {
    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const itemDocument = dropData?.uuid ? await fromUuid(dropData.uuid) : null;
    if (!(itemDocument instanceof Item)) {
      throw new Error("Перетащите предмет из листа персонажа или компендиума.");
    }

    if (itemDocument.parent instanceof Actor && !itemDocument.parent.isOwner) {
      throw new Error("У вас нет прав на исходный предмет.");
    }

    if (itemDocument.parent instanceof Actor && itemDocument.parent.id === actor.id) {
      return itemDocument;
    }

    const sourceItemData = itemDocument.toObject();
    const importedItemData = sanitizeEmbeddedItemData(sourceItemData);
    const importedQuantity = Math.max(0, getRawQuantity(importedItemData));
    if (importedQuantity <= 0) {
      throw new Error("У предмета нет количества для переноса.");
    }

    const sourceFlags = foundry.utils.deepClone(importedItemData.flags?.[MODULE_ID] ?? {});
    const mergeCandidate = actor.items.contents.find((candidate) => {
      const candidateFlags = foundry.utils.deepClone(candidate.flags?.[MODULE_ID] ?? {});
      if (sourceFlags.sourceType && sourceFlags.sourceId) {
        return candidateFlags.sourceType === sourceFlags.sourceType && candidateFlags.sourceId === sourceFlags.sourceId;
      }

      return normalizeText(candidate.name) === normalizeText(importedItemData.name) && candidate.type === importedItemData.type;
    }) ?? null;

    if (mergeCandidate) {
      const nextQuantity = roundNumber(getRawQuantity(mergeCandidate.toObject()) + importedQuantity, 2);
      await mergeCandidate.update({
        "system.quantity": nextQuantity
      });
    }
    else {
      await actor.createEmbeddedDocuments("Item", [importedItemData]);
    }

    if (itemDocument.parent instanceof Actor) {
      await itemDocument.delete();
    }

    return actor;
  }
}


