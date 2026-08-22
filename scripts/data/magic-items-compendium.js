import { MAGIC_ITEMS_COMPENDIUM_LABEL, MAGIC_ITEMS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import {
  buildNamedIconLookup,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";
import { syncManagedDocumentsOnActiveGm } from "./managed-compendium-sync.js";
import {
  buildSlug,
  classifyMagicItem,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup
} from "./item-classification.js";
import { MAGIC_ITEMS } from "../../magicItem.js";
import {
  escapeFoundryHtml as escapeHtml,
  finiteNumber as toNumber
} from "../shared/foundry-values.js";

const PACK_ID = `world.${MAGIC_ITEMS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const EFFECT_MODE_CUSTOM = 0;
const EFFECT_MODE_ADD = 2;
const EFFECT_MODE_UPGRADE = 4;
const DEFAULT_MAGIC_ITEM_ICON = "systems/dnd5e/icons/svg/items/loot.svg";
const MAGIC_TEMPLATE_VERSION = 4;
const NATIVE_INSTRUMENT_SPELL_ACTIVITY_VERSION = 1;
const NATIVE_INSTRUMENT_SPELLS = {
  "бандура-фоклучан": [
    { name: "Дубинка", id: "VzgFzcmocr1X1cp4", level: 0 },
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Огонь фей", id: "nqBDWkVOfcGZt4YU", level: 1 },
    { name: "Опутывание", id: "gMrWeG8fMDPRFiVe", level: 1 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 },
    { name: "Разговор с животными", id: "aL1F8fvYLtNzUbKu", level: 1 }
  ],
  "лира-кли": [
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Изменение формы камня", id: "QvGcdRUSNRKEQJlK", level: 4 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Огненная стена", id: "X3DrXgxjwI2dvkD6", level: 4 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 },
    { name: "Стена ветров", id: "ew6GA8dJy2spQmFW", level: 3 }
  ],
  "лютня-досс": [
    { name: "Дружба с животными", id: "hDOENzjuj5WpLq7B", level: 1 },
    { name: "Защита от энергии (только огонь)", id: "j8NtLXOOJ3GAKF8I", level: 3 },
    { name: "Защита от яда", id: "MAxM77CDUu8dgIRQ", level: 2 },
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 }
  ]
};
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const MAGIC_ICON_SEARCH_PATHS = [`${MODULE_ICONS_BASE_PATH}/Magic Items`, MODULE_ICONS_BASE_PATH];
const BELLMAN_POWER_ITEM_NAME = "Жемчужина силы";
const HOARDING_POUCH_ITEM_NAME = "Сумка хранения";
const WATCHER_SHIELD_ITEM_NAME = "Щит часового";
const RING_BONUS_ITEM_PREFIX = "Кольцо характеристики";
const RING_BONUS_VARIANTS = [
  { id: "легендарное", bonus: 2, maxAbilityScore: 26 },
  { id: "необычное", bonus: 2, maxAbilityScore: 12 },
  { id: "очень редкое", bonus: 2, maxAbilityScore: 20 },
  { id: "редкое", bonus: 1, maxAbilityScore: 16 },
  { id: "обычное", bonus: 1, maxAbilityScore: 10 }
];
const RING_BONUS_VARIANTS_NORMALIZED = RING_BONUS_VARIANTS
  .map((entry) => ({ ...entry, normalizedId: normalizeMatchText(entry.id) }));

function stableHashId(seed, scope = "id") {
  const source = `${scope}:${seed}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (const char of source) {
    const code = char.codePointAt(0) ?? 0;
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB + code + ((hashB << 6) >>> 0) + (hashB >>> 2), 0x85ebca6b) >>> 0;
  }

  const token = `${hashA.toString(36)}${hashB.toString(36)}`.replace(/[^a-z0-9]/gu, "");
  return token.padEnd(16, "0").slice(0, 16);
}

function buildMagicItemEffectId(item, suffix) {
  return stableHashId(`magic-item:${String(item?.id ?? "").trim()}:${suffix}`, "magic-item-effect");
}

function resolveNativeInstrumentSpellDefinition(item) {
  return NATIVE_INSTRUMENT_SPELLS[String(item?.id ?? "").trim()] ?? null;
}

function buildNativeInstrumentSpellActivities(item) {
  const spells = resolveNativeInstrumentSpellDefinition(item);
  if (!spells) {
    return null;
  }

  return Object.fromEntries(spells.map((spell) => {
    const activityId = stableHashId(
      `magic-item:${item.id}:spell:${spell.id}`,
      "magic-item-activity"
    );
    return [activityId, {
      _id: activityId,
      type: "cast",
      name: spell.name,
      activation: {
        type: "action",
        value: 1,
        condition: ""
      },
      consumption: {
        scaling: {
          allowed: false,
          max: ""
        },
        spellSlot: false,
        targets: [{
          type: "activityUses",
          value: "1"
        }]
      },
      uses: {
        spent: 0,
        max: "1",
        recovery: [{
          period: "dawn",
          type: "recoverAll",
          formula: ""
        }]
      },
      spell: {
        ability: "",
        challenge: {
          override: false
        },
        level: spell.level,
        properties: ["vocal", "somatic", "material"],
        spellbook: true,
        uuid: `Compendium.dnd5e.spells.Item.${spell.id}`
      }
    }];
  }));
}

function buildPassiveMagicItemEffect({
  id,
  name,
  description = "",
  changes = [],
  transfer = true,
  flags = {}
}) {
  return {
    _id: id,
    name,
    type: "base",
    img: DEFAULT_MAGIC_ITEM_ICON,
    system: {},
    changes,
    disabled: false,
    duration: {
      startTime: null,
      seconds: null,
      combat: null,
      rounds: null,
      turns: null,
      startRound: null,
      startTurn: null
    },
    description,
    origin: null,
    transfer,
    statuses: [],
    sort: 0,
    flags: {
      [MODULE_ID]: {
        managed: true,
        magicItemAutomation: true
      },
      ...flags
    }
  };
}

function parseItemBonusFromName(itemName) {
  const match = String(itemName ?? "").match(/\+(\d+)/u);
  return match ? Number(match[1]) : 0;
}

function resolveMagicItemAutomationDefinition(item) {
  const normalizedName = normalizeMatchText(item?.name);
  const normalizedPoweName = normalizeMatchText(BELLMAN_POWER_ITEM_NAME);
  const normalizedPouchName = normalizeMatchText(HOARDING_POUCH_ITEM_NAME);
  const normalizedWatcherShieldName = normalizeMatchText(WATCHER_SHIELD_ITEM_NAME);
  const normalizedRingPrefix = normalizeMatchText(RING_BONUS_ITEM_PREFIX);

  if (normalizedName === normalizedPouchName) {
    return {
      kind: "bagOfHolding",
      coverage: "partial",
      capacity: {
        count: null,
        volume: { value: 64, units: "ft3" },
        weight: { value: 500, units: "lb" },
        note: "В модуле контейнерная модель для мешка хранения применена через метаданные и требует ручной верификации."
      }
    };
  }

  if (normalizedName === normalizedPoweName) {
    return {
      kind: "pearlOfPower",
      coverage: "manual",
      note: "Требуется ручной выбор и восстановление ячейки заклинания после использования."
    };
  }

  if (normalizedName.startsWith(normalizedWatcherShieldName)) {
    return {
      kind: "itemAbility",
      coverage: "full",
      note: "Автоматизируется статическим эффектом в разделe `effects`."
    };
  }

  if (normalizedName.startsWith(normalizedRingPrefix)) {
    const variant = RING_BONUS_VARIANTS_NORMALIZED
      .find((entry) => normalizedName.includes(entry.normalizedId));
    if (!variant) {
      return null;
    }

    return {
      kind: "abilityRing",
      coverage: "manual-choice",
      bonus: variant.bonus,
      maxAbilityScore: variant.maxAbilityScore,
      note: `Выберите одну характеристику для повышения на ${variant.bonus} (максимум ${variant.maxAbilityScore}).`
    };
  }

  return null;
}

function buildMagicItemAutomationEffects(item) {
  const normalizedName = normalizeMatchText(item?.name);
  const itemBonuses = parseItemBonusFromName(item?.name);

  if (normalizedName === normalizeMatchText("Ночные очки")) {
    return [
      buildPassiveMagicItemEffect({
        id: buildMagicItemEffectId(item, "night-goggles"),
        name: `${item?.name}: Темное зрение`,
        description: item?.description,
        changes: [{
          key: "system.attributes.senses.darkvision",
          mode: EFFECT_MODE_UPGRADE,
          value: "60",
          priority: 20
        }]
      })
    ];
  }

  if (normalizedName.startsWith(normalizeMatchText("Плащ защиты"))) {
    if (!itemBonuses) {
      return [];
    }

    return [
      buildPassiveMagicItemEffect({
        id: buildMagicItemEffectId(item, `cloak-of-protection-${itemBonuses}`),
        name: `${item?.name}: Защита`,
        description: item?.description,
        changes: [{
          key: "system.bonuses.abilities.save",
          mode: EFFECT_MODE_ADD,
          value: `+${itemBonuses}`,
          priority: 20
        }]
      })
    ];
  }

  if (normalizedName === normalizeMatchText("Щит часового")) {
    return [
      buildPassiveMagicItemEffect({
        id: buildMagicItemEffectId(item, "watcher-shield"),
        name: `${item?.name}: Боевая подготовка`,
        description: item?.description,
        changes: [
          {
            key: "flags.midi-qol.advantage.check.dex",
            mode: EFFECT_MODE_CUSTOM,
            value: "1",
            priority: 20
          },
          {
            key: "flags.midi-qol.advantage.ability.check.dex",
            mode: EFFECT_MODE_CUSTOM,
            value: "1",
            priority: 20
          },
          {
            key: "flags.midi-qol.advantage.skill.prc",
            mode: EFFECT_MODE_CUSTOM,
            value: "1",
            priority: 20
          }
        ]
      })
    ];
  }

  return [];
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function clampRank(value) {
  return Math.max(0, Math.min(10, Math.round(toNumber(value, 0))));
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "да"].includes(text);
}

function isQuestionPlaceholder(value) {
  return /^\?+(?:\s+\?+)*$/u.test(String(value ?? "").trim());
}

function normalizeOptionalMagicText(value) {
  const text = String(value ?? "").trim();
  return isQuestionPlaceholder(text) ? "" : text;
}

function normalizeMagicSourceType(value) {
  return normalizeOptionalMagicText(value) || "Магический предмет";
}

function normalizeMagicItemType(value) {
  const text = normalizeOptionalMagicText(value);
  if (normalizeMatchText(text) === normalizeMatchText("Чудестный предмет")) {
    return "Чудесный предмет";
  }

  return text;
}

function normalizeRarity(value) {
  switch (normalizeMatchText(value)) {
    case "обычный":
      return "common";
    case "необычный":
      return "uncommon";
    case "редкий":
      return "rare";
    case "очень редкий":
      return "veryRare";
    case "легендарный":
      return "legendary";
    case "артефакт":
      return "artifact";
    default:
      return "";
  }
}

function restoresBardicInspiration(item) {
  return normalizeMatchText(item?.name).startsWith(normalizeMatchText("Барабан задающего ритм"))
    && normalizeMatchText(item?.description).includes(normalizeMatchText("восстановить одну кость бардовского вдохновения"));
}

function resolveItemSlotGroup(item, classification) {
  const explicitSlot = normalizeHeroDollSlotGroup(item.itemSlot ?? "", "");
  if (explicitSlot) {
    return explicitSlot;
  }

  return inferHeroDollSlotGroupFromSlots(classification.heroDollSlots, "");
}

function goldToDnd5ePrice(priceGoldEquivalent) {
  const totalCopper = Math.max(0, Math.round(Number(priceGoldEquivalent ?? 0) * 100));
  if (totalCopper >= 100) {
    return {
      value: Math.round(((totalCopper / 100) + Number.EPSILON) * 100) / 100,
      denomination: "gp"
    };
  }

  if (totalCopper % 10 !== 0) {
    return { value: totalCopper, denomination: "cp" };
  }

  return { value: totalCopper / 10, denomination: "sp" };
}

export function parseFixedPriceTextToGold(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/,/gu, ".")
    .replace(/\s+/gu, " ");

  if (!text || text === "—" || text === "-") {
    return null;
  }

  const match = text.match(/^(\d[\d ]*(?:\.\d+)?)\s*(пм|pp|эм|ep|зм|gp|см|sp|мм|cp)$/iu);
  if (!match) {
    return null;
  }

  const numericValue = Number(match[1].replace(/\s+/gu, ""));
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  switch (match[2].toLowerCase()) {
    case "пм":
    case "pp":
      return numericValue * 10;
    case "эм":
    case "ep":
      return numericValue * 0.5;
    case "зм":
    case "gp":
      return numericValue;
    case "см":
    case "sp":
      return numericValue * 0.1;
    case "мм":
    case "cp":
      return numericValue * 0.01;
    default:
      return null;
  }
}

function getNativeMagicItemPrice(item) {
  const parsedCostGold = parseFixedPriceTextToGold(item?.costText);
  if (parsedCostGold === null) {
    return {
      value: null,
      denomination: "gp"
    };
  }

  return goldToDnd5ePrice(parsedCostGold);
}

export function normalizeMagicItems(rawItems = MAGIC_ITEMS) {
  const usedIds = new Set();
  return (Array.isArray(rawItems) ? rawItems : [])
    .filter(Boolean)
    .map((rawItem, index) => {
      const name = String(rawItem.name ?? rawItem.Name ?? `Магический предмет ${index + 1}`).trim();
      const baseId = buildSlug(rawItem.id ?? name, "magic-item");
      let id = baseId;
      let duplicateIndex = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${duplicateIndex}`;
        duplicateIndex += 1;
      }
      usedIds.add(id);

      return {
        id,
        name,
        type: normalizeMagicSourceType(rawItem.type ?? rawItem.Type),
        rarity: normalizeOptionalMagicText(rawItem.rarity ?? rawItem.itemRarity),
        itemType: normalizeMagicItemType(rawItem.itemType ?? rawItem.ItemType),
        itemSubtype: normalizeOptionalMagicText(rawItem.itemSubtype),
        itemSlot: normalizeOptionalMagicText(rawItem.itemSlot),
        source: String(rawItem.source ?? rawItem.itemSourse ?? "").trim(),
        rank: clampRank(rawItem.rank),
        materials: normalizeOptionalMagicText(rawItem.materials ?? rawItem.item_materials),
        bargaining: normalizeOptionalMagicText(rawItem.bargaining ?? rawItem.itemBargaining),
        costText: normalizeOptionalMagicText(rawItem.costText ?? rawItem.itemCost),
        impact: normalizeOptionalMagicText(rawItem.impact ?? rawItem.item_impact),
        attunement: normalizeOptionalMagicText(rawItem.attunement ?? rawItem.itemAttunementDetails),
        isConsumable: normalizeBoolean(rawItem.isConsumable),
        description: String(rawItem.description ?? rawItem.Desc ?? "").trim(),
        priceGold: toNumber(rawItem.priceGold ?? rawItem.value, 0),
        heroDollSlots: rawItem.heroDollSlots ?? null
      };
    });
}

function buildFolderPath(classification) {
  return normalizeFolderPath(classification.folderPath);
}

function buildMagicSignature(item) {
  const classification = classifyMagicItem(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const nativeInstrumentSpellActivities = buildNativeInstrumentSpellActivities(item);
  return JSON.stringify({
    templateVersion: MAGIC_TEMPLATE_VERSION,
    id: item.id,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    itemType: item.itemType,
    itemSubtype: item.itemSubtype,
    itemSlot,
    source: item.source,
    rank: clampRank(item.rank),
    materials: item.materials,
    bargaining: item.bargaining,
    costText: item.costText,
    impact: item.impact,
    attunement: item.attunement,
    isConsumable: item.isConsumable,
    description: item.description,
    priceGold: item.priceGold,
    foundryType: classification.documentType,
    foundrySubtype: classification.systemTypeValue,
    foundrySubtypeExtra: classification.systemTypeSubtype,
    foundryBaseItem: classification.baseItem,
    folderPath: buildFolderPath(classification),
    heroDollSlots,
    firearmClass: classification.firearmClass,
    ...(nativeInstrumentSpellActivities ? {
      nativeInstrumentSpellActivities: {
        version: NATIVE_INSTRUMENT_SPELL_ACTIVITY_VERSION,
        activities: nativeInstrumentSpellActivities
      }
    } : {})
  });
}

function getMagicItemIcon(item, _classification, iconLookup = null) {
  return resolveNamedIcon(item?.name, iconLookup, DEFAULT_MAGIC_ITEM_ICON);
}

function buildMetadataRows(item, classification) {
  return [
    ["Материалы", item.materials || null],
    ["Торг", item.bargaining || null],
    ["Цена", item.costText || null],
    ["Вэлью", item.priceGold ? `${item.priceGold} зм` : null],
    ["Влиятельность", item.impact || null]
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function buildDescriptionHtml(item, classification) {
  const metadataRows = buildMetadataRows(item, classification);
  return `
    <section class="rebreya-gear-item">
      ${item.description
        ? `<p>${escapeHtml(item.description)}</p>`
        : "<p>Описание магического предмета пока не заполнено.</p>"}
      ${metadataRows.length ? `
        <ul>
          ${metadataRows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join("")}
        </ul>
      ` : ""}
    </section>
  `.trim();
}

export function buildSystemData(item, classification, descriptionHtml) {
  const price = getNativeMagicItemPrice(item);
  const baseData = {
    description: {
      value: descriptionHtml,
      chat: ""
    },
    unidentified: {
      description: ""
    },
    quantity: 1,
    price: {
      value: price.value,
      denomination: price.denomination
    },
    weight: {
      value: 0,
      units: "lb"
    },
    rarity: normalizeRarity(item.rarity),
    properties: ["mgc"]
  };

  switch (classification.documentType) {
    case "weapon":
      baseData.type = {
        value: classification.systemTypeValue || "martialM",
        baseItem: classification.baseItem || ""
      };
      break;

    case "equipment":
      baseData.type = {
        value: classification.systemTypeValue || "wondrous",
        baseItem: classification.baseItem || ""
      };
      break;

    case "tool":
      baseData.type = {
        value: classification.systemTypeValue || "art",
        baseItem: classification.baseItem || ""
      };
      break;

    case "consumable":
      baseData.type = {
        value: classification.systemTypeValue || "potion",
        subtype: classification.systemTypeSubtype || ""
      };
      break;

    case "loot":
    default:
      baseData.type = {
        value: classification.systemTypeValue || "gear",
        subtype: classification.systemTypeSubtype || ""
      };
      break;
  }

  return baseData;
}

export function createMagicItemData(item, folderIdByPath, iconLookup = null) {
  const classification = classifyMagicItem(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const rank = clampRank(item.rank);
  const folderPath = buildFolderPath(classification).join("/");
  const descriptionHtml = buildDescriptionHtml(item, classification);
  const magicItemAutomation = resolveMagicItemAutomationDefinition(item);
  const systemData = buildSystemData(item, classification, descriptionHtml);
  const nativeInstrumentSpellActivities = buildNativeInstrumentSpellActivities(item);

  if (nativeInstrumentSpellActivities) {
    systemData.activities = nativeInstrumentSpellActivities;
  }

  if (magicItemAutomation?.kind === "bagOfHolding") {
    systemData.capacity = magicItemAutomation.capacity ?? {
      count: null,
      volume: { value: 64, units: "ft3" },
      weight: { value: 500, units: "lb" }
    };
    systemData.weight = { value: 15, units: "lb" };
    systemData.properties = ["mgc", "weightlessContents"];
    systemData.type.value = "backpack";
  }
  const documentType = magicItemAutomation?.kind === "bagOfHolding"
    ? "container"
    : classification.documentType;

  return {
    name: item.name,
    type: documentType,
    img: getMagicItemIcon(item, classification, iconLookup),
    folder: folderIdByPath.get(folderPath) ?? null,
    effects: buildMagicItemAutomationEffects(item),
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: systemData,
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "magicItem",
        magicItemId: item.id,
        signature: buildMagicSignature(item),
        rarity: item.rarity,
        itemType: item.itemType,
        itemSubtype: item.itemSubtype,
        itemSlot,
        heroDollSlots,
        rank,
        foundryType: documentType,
        foundrySubtype: classification.systemTypeValue ?? "",
        foundrySubtypeExtra: classification.systemTypeSubtype ?? "",
        foundryBaseItem: classification.baseItem ?? "",
        foundryFolder: folderPath,
        firearmClass: classification.firearmClass ?? "",
        magical: true,
        magicItemAutomation,
        restoreBardicInspiration: restoresBardicInspiration(item),
        attunement: item.attunement,
        bargaining: item.bargaining,
        itemBargaining: item.bargaining,
        isConsumable: item.isConsumable,
        value: Math.max(1, Math.round(toNumber(item.priceGold, 0))),
        priceGold: item.priceGold,
        source: item.source
      }
    }
  };
}

function getDesiredPackMetadata() {
  return {
    label: MAGIC_ITEMS_COMPENDIUM_LABEL,
    type: "Item",
    name: MAGIC_ITEMS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: "Rebreya",
        types: ["loot", "weapon", "equipment", "tool", "consumable", "container"]
      }
    }
  };
}

async function ensurePack() {
  const desired = getDesiredPackMetadata();
  let pack = game.packs.get(PACK_ID);

  if (pack && pack.documentName !== desired.type) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (pack && desired.system && pack.metadata.system !== desired.system) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign magic items compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function findMagicItemDocument(pack, magicItemId, fallbackName = "") {
  const normalizedId = String(magicItemId ?? "").trim();
  const normalizedFallbackName = normalizeMatchText(fallbackName);
  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.magicItemId`]
  });
  const indexEntry = index.find((entry) => {
    const entryMagicItemId = String(foundry.utils.getProperty(entry, `flags.${MODULE_ID}.magicItemId`) ?? "").trim();
    if (normalizedId && entryMagicItemId === normalizedId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  });

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  return documents.find((entry) => {
    const entryMagicItemId = String(entry.getFlag(MODULE_ID, "magicItemId") ?? "").trim();
    if (normalizedId && entryMagicItemId === normalizedId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  }) ?? null;
}

export class MagicItemsCompendiumService {
  async sync(items = MAGIC_ITEMS) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const normalizedItems = normalizeMagicItems(items);
    const pack = await ensurePack();
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildNamedIconLookup(MAGIC_ICON_SEARCH_PATHS, { forceRefresh: true });
    let folderIdByPath = new Map();
    await syncManagedDocumentsOnActiveGm(game, {
      pack,
      entries: normalizedItems,
      documents,
      sourceIdOfEntry: (item) => item.id,
      sourceIdOfDocument: (document) => document.getFlag(MODULE_ID, "managed")
        ? document.getFlag(MODULE_ID, "magicItemId")
        : "",
      signatureOfEntry: (item) => JSON.stringify([
        buildMagicSignature(item),
        resolveNamedIcon(item.name, iconLookup, DEFAULT_MAGIC_ITEM_ICON)
      ]),
      signatureOfDocument: (document) => JSON.stringify([
        document.getFlag(MODULE_ID, "signature"),
        String(document.img ?? "").trim() || DEFAULT_MAGIC_ITEM_ICON
      ]),
      prepareFolders: async () => {
        try {
          folderIdByPath = await ensureCompendiumFolders(
            pack,
            normalizedItems.map((item) => buildFolderPath(classifyMagicItem(item)))
          );
        }
        catch (error) {
          console.warn(`${MODULE_ID} | Failed to prepare compendium folders for magic pack.`, error);
        }
      },
      createData: (item) => createMagicItemData(item, folderIdByPath, iconLookup),
      updateData: (_document, item) => {
        const data = createMagicItemData(item, folderIdByPath, iconLookup);
        delete data._id;
        return data;
      }
    });
    return game.packs.get(PACK_ID) ?? pack;
  }

  async getMagicItemDocument(magicItemId, fallbackName = "") {
    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      return null;
    }

    return findMagicItemDocument(pack, magicItemId, fallbackName);
  }

  async openMagicItem(magicItemId, fallbackName = "") {
    const document = await this.getMagicItemDocument(magicItemId, fallbackName);
    if (!document) {
      ui.notifications?.warn("Запись магического предмета не найдена в компендиуме.");
      return null;
    }

    await document.sheet?.render?.(true);
    const app = document.sheet;
    if (typeof app?.bringToFront === "function") {
      app.bringToFront();
    }
    return document;
  }
}
