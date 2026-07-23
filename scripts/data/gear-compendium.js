import { GEAR_COMPENDIUM_LABEL, GEAR_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { bringAppToFront } from "../ui.js";
import {
  deduplicateCompendiumFolders,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath
} from "./compendium-utils.js";
import {
  buildGearIconLookup,
  DEFAULT_GEAR_ICON,
  resolveGearItemIcon,
  resolveGearNamedIcon
} from "./gear-icon-resolver.js";
import {
  classifyGearEntry,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup
} from "./item-classification.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";
import { syncManagedDocuments } from "./managed-compendium-sync.js";
import {
  escapeFoundryHtml as escapeHtml,
  finiteNumber as toFiniteNumber
} from "../shared/foundry-values.js";

export { buildGearIconLookup };

const PACK_ID = `world.${GEAR_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const GEAR_TEMPLATE_VERSION = 18;
const GEAR_CONTAINER_CONTENT_SOURCE_TYPE = "gearContainerContent";
const FIREARM_ATTACK_ACTIVITY_ID = "lchFirearmAtk001";
const FIREARM_RELOAD_ACTIVITY_ID = "lchReloadGun0001";
const FIREARM_AUTOMATIC_FIRE_ACTIVITY_ID = "lchAutoFire00001";
const FIREARM_SEMI_AUTOMATIC_FIRE_ACTIVITY_ID = "lchSemiFire00001";
const FIREARM_CLEAR_JAM_ACTIVITY_ID = "lchClearBreech01";
const FIREARM_MAINTAIN_ACTIVITY_ID = "lchMaintainGun01";
const FIREARM_MISFIRE_PROPERTY = "lchFirearmMisfire";
const FIREARM_RUST_PROPERTY = "lchFirearmRust";

function renderValue(value, fallback = "&mdash;") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return escapeHtml(value);
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanArray(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanString(value))
    .filter(Boolean)));
}

function normalizeHandCounts(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value
      .map((entry) => Math.max(0, Math.floor(toFiniteNumber(entry, 0))))
      .filter((entry) => entry > 0)));
  }

  if (value && typeof value === "object") {
    return normalizeHandCounts(value.allowedHands ?? value.allowed ?? value.options ?? value.values);
  }

  if (typeof value === "string") {
    return normalizeHandCounts(value.match(/\d+/gu) ?? []);
  }

  const count = Math.max(0, Math.floor(toFiniteNumber(value, 0)));
  return count > 0 ? [count] : [];
}

function normalizeContainerContents(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isPlainObject(entry)) {
        return null;
      }

      const gearId = cleanString(entry.gearId ?? entry.id ?? entry.itemId);
      if (!gearId) {
        return null;
      }

      return {
        gearId,
        quantity: Math.max(1, Math.floor(toFiniteNumber(entry.quantity ?? entry.count, 1)))
      };
    })
    .filter(Boolean);
}

function cloneContainerContents(value) {
  return normalizeContainerContents(value).map((entry) => ({ ...entry }));
}

function normalizeContainerCapacity(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const count = toFiniteNumber(value.count, 0);
  const volume = toFiniteNumber(value.volume, 0);
  const weight = toFiniteNumber(value.weight, 0);
  const units = cleanString(value.units, "lb");
  const volumeUnits = cleanString(value.volumeUnits, "ft3");

  return {
    count: count > 0 ? count : null,
    volume: {
      value: volume > 0 ? volume : null,
      units: volumeUnits
    },
    weight: {
      value: weight > 0 ? weight : null,
      units
    }
  };
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function clampRank(value) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Math.round(numericValue)));
}

function resolveItemSlotGroup(item, classification) {
  const explicitSlot = normalizeHeroDollSlotGroup(item.itemSlot ?? item.foundryItemSlot ?? "", "");
  if (explicitSlot) {
    return explicitSlot;
  }

  return inferHeroDollSlotGroupFromSlots(classification.heroDollSlots, "");
}

function goldToDnd5ePrice(priceGoldEquivalent) {
  const totalCopper = Math.max(0, roundDecimal(Number(priceGoldEquivalent ?? 0) * 100));
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

function roundDecimal(value, precision = 6) {
  const scale = 10 ** precision;
  return Math.round((Number(value ?? 0) + Number.EPSILON) * scale) / scale;
}

function parseAmmunitionSourcePack(item, classification) {
  if (classification.documentType !== "consumable" || classification.systemTypeValue !== "ammo") {
    return null;
  }

  const name = cleanString(item.name);
  const match = name.match(/\s*\((\d+)\)\s*$/u);
  if (!match) {
    return null;
  }

  const quantity = Math.max(1, Math.floor(toFiniteNumber(match[1], 1)));
  const sourceWeight = Math.max(0, toFiniteNumber(item.weight, 0));
  const sourcePriceGoldEquivalent = Math.max(0, toFiniteNumber(item.priceGoldEquivalent ?? item.priceValue, 0));

  return {
    quantity,
    actorName: cleanString(name.replace(/\s*\(\d+\)\s*$/u, ""), name),
    sourceWeight,
    sourcePriceGoldEquivalent,
    actorWeight: roundDecimal(sourceWeight / quantity),
    actorPriceGoldEquivalent: roundDecimal(sourcePriceGoldEquivalent / quantity)
  };
}

function buildDnd5eItemPresentation(item, classification) {
  const sourcePack = parseAmmunitionSourcePack(item, classification);
  if (!sourcePack) {
    return {
      name: item.name,
      quantity: 1,
      weight: Math.max(0, toFiniteNumber(item.weight, 0)),
      priceGoldEquivalent: Math.max(0, toFiniteNumber(item.priceGoldEquivalent ?? item.priceValue, 0)),
      sourcePack: null
    };
  }

  return {
    name: sourcePack.actorName,
    quantity: sourcePack.quantity,
    weight: sourcePack.actorWeight,
    priceGoldEquivalent: sourcePack.actorPriceGoldEquivalent,
    sourcePack
  };
}

function buildFolderPath(classification) {
  return normalizeFolderPath(classification.folderPath);
}

function buildGearSignature(item) {
  const classification = classifyGearEntry(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const stableDocumentId = createStableGearDocumentId(item.id);
  return JSON.stringify({
    templateVersion: GEAR_TEMPLATE_VERSION,
    stableDocumentId,
    name: item.name ?? "",
    equipmentType: item.equipmentType ?? "",
    priceText: item.priceText ?? "",
    priceValue: item.priceValue ?? 0,
    priceDenomination: item.priceDenomination ?? "gp",
    priceGoldEquivalent: item.priceGoldEquivalent ?? 0,
    rank: clampRank(item.rank),
    weight: item.weight ?? 0,
    volume: item.volume ?? "",
    capacity: item.capacity ?? "",
    containerCapacity: clonePlainObject(item.containerCapacity),
    containerContents: cloneContainerContents(item.containerContents),
    description: item.description ?? "",
    predominantMaterialId: item.predominantMaterialId ?? null,
    predominantMaterialName: item.predominantMaterialName ?? "",
    linkedTool: item.linkedTool ?? "",
    value: item.value ?? "",
    source: item.source ?? "",
    foundryType: classification.documentType,
    foundrySubtype: classification.systemTypeValue,
    foundrySubtypeExtra: classification.systemTypeSubtype,
    foundryBaseItem: classification.baseItem,
    foundryToolAbility: classification.toolAbility ?? "",
    folderPath: buildFolderPath(classification),
    itemSlot,
    heroDollSlots,
    firearmClass: classification.firearmClass,
    weapon: isPlainObject(item.weapon) ? item.weapon : null,
    armor: isPlainObject(item.armor) ? item.armor : null,
    implant: isPlainObject(item.implant) ? item.implant : null
  });
}

function resolveWeaponHandRequirementSource(weapon) {
  if (!isPlainObject(weapon)) {
    return "";
  }

  const explicitSource = cleanString(
    weapon.handRequirementText
    ?? weapon.handsText
    ?? weapon.hands
    ?? weapon.handRequirementSource
    ?? weapon.handRequirement?.source
  );
  if (explicitSource) {
    return explicitSource;
  }

  const propertiesText = cleanString(weapon.propertiesText);
  return cleanString(propertiesText.split(";")[0] ?? propertiesText);
}

function buildWeaponHandRequirement({
  allowedHands,
  canUseTwoHands,
  mode,
  requiredHands,
  source,
  special = false,
  versatile = false,
  versatileDamageFormula = ""
}) {
  const safeAllowedHands = normalizeHandCounts(allowedHands);
  const safeRequiredHands = Math.max(0, Math.floor(toFiniteNumber(requiredHands, safeAllowedHands[0] ?? 1)));
  const maxHands = Math.max(safeRequiredHands, ...safeAllowedHands, 0);
  const safeSource = cleanString(source);

  return {
    requiredHands: safeRequiredHands,
    allowedHands: safeAllowedHands.length ? safeAllowedHands : [safeRequiredHands || 1],
    maxHands,
    canUseTwoHands: canUseTwoHands === true || maxHands >= 2,
    mode,
    source: safeSource || null,
    special: special === true,
    versatile: versatile === true,
    versatileDamageFormula: cleanString(versatileDamageFormula) || null
  };
}

function resolveWeaponHandRequirement(weapon) {
  if (!isPlainObject(weapon)) {
    return null;
  }

  if (isPlainObject(weapon.handRequirement)) {
    return buildWeaponHandRequirement({
      allowedHands: weapon.handRequirement.allowedHands ?? weapon.handRequirement.allowed,
      canUseTwoHands: weapon.handRequirement.canUseTwoHands,
      mode: cleanString(weapon.handRequirement.mode, "custom"),
      requiredHands: weapon.handRequirement.requiredHands ?? weapon.handRequirement.hands ?? weapon.handRequirement.min,
      source: weapon.handRequirement.source ?? resolveWeaponHandRequirementSource(weapon),
      special: weapon.handRequirement.special,
      versatile: weapon.handRequirement.versatile,
      versatileDamageFormula: weapon.handRequirement.versatileDamageFormula ?? weapon.versatileDamageFormula
    });
  }

  const source = resolveWeaponHandRequirementSource(weapon);
  const sourceKey = normalizeMatchText(source);
  const properties = cleanArray(weapon.properties);
  const hasTwoHandedProperty = properties.includes("two");
  const hasVersatileProperty = properties.includes("ver") || Boolean(cleanString(weapon.versatileDamageFormula));

  if (sourceKey.includes("универс") || hasVersatileProperty) {
    return buildWeaponHandRequirement({
      allowedHands: [1, 2],
      canUseTwoHands: true,
      mode: "versatile",
      requiredHands: 1,
      source,
      versatile: true,
      versatileDamageFormula: weapon.versatileDamageFormula
    });
  }

  if (sourceKey.includes("двуруч") || hasTwoHandedProperty) {
    return buildWeaponHandRequirement({
      allowedHands: [2],
      canUseTwoHands: true,
      mode: "twoHanded",
      requiredHands: 2,
      source
    });
  }

  if (sourceKey.includes("одноруч")) {
    return buildWeaponHandRequirement({
      allowedHands: [1],
      canUseTwoHands: false,
      mode: "oneHanded",
      requiredHands: 1,
      source
    });
  }

  if (source) {
    return buildWeaponHandRequirement({
      allowedHands: [1],
      canUseTwoHands: false,
      mode: "special",
      requiredHands: 1,
      source,
      special: true
    });
  }

  return null;
}

function buildMetadataRows(item, classification) {
  const itemSlotGroup = resolveItemSlotGroup(item, classification);
  const weapon = isPlainObject(item.weapon) ? item.weapon : {};
  const implant = isPlainObject(item.implant) ? item.implant : {};
  const handRequirement = resolveWeaponHandRequirement(weapon);
  const itemSlotLabel = {
    head: "Голова",
    neck: "Шея",
    shoulders: "Плечи",
    bracers: "Наручи",
    hand: "Рука",
    chest: "Грудь",
    belt: "Пояс",
    legs: "Ноги",
    ring: "Кольцо",
    back: "Спина"
  }[itemSlotGroup] ?? null;
  const heroDollSlotLabels = mapSlotGroupToHeroDollSlots(itemSlotGroup, classification.heroDollSlots)
    .map((slotId) => {
      const slotName = {
        head: "Голова",
        neck: "Шея",
        shoulders: "Плечи",
        chest: "Грудь",
        belt: "Пояс",
        legs: "Ноги",
        bracers: "Наручи",
        leftHand: "Рука",
        rightHand: "Рука",
        ring1: "Кольцо 1",
        ring2: "Кольцо 2",
        back1: "Спина 1",
        back2: "Спина 2",
        back3: "Спина 3",
        back4: "Спина 4",
        back5: "Спина 5"
      };
      return slotName[slotId] ?? slotId;
    });

  return [
    ["Тип снаряжения", item.equipmentType],
    ["Слот", itemSlotLabel],
    ["Тип Foundry", classification.documentType],
    ["Подтип Foundry", classification.systemTypeSubtype || classification.systemTypeValue || null],
    ["Базовый предмет", classification.baseItem || null],
    ["Папка", buildFolderPath(classification).join(" / ") || null],
    ["Слоты куклы", heroDollSlotLabels.join(", ") || null],
    ["Цена", item.priceText || null],
    ["Ранг", clampRank(item.rank)],
    ["Вес", item.weight ? `${item.weight} фнт.` : null],
    ["Объем", item.volume],
    ["Вместимость", item.capacity],
    ["Преобладающий материал", item.predominantMaterialName],
    ["Связанный инструмент", item.linkedTool],
    ["Value", item.value],
    ["Урон", weapon.damageFormula],
    ["Тип урона", weapon.damageTypeLabel],
    ["Руки", handRequirement?.source],
    ["Свойства оружия", weapon.propertiesText],
    ["Очки модификации", implant.pointsText],
    ["Тип импланта", implant.type],
    ["Требования импланта", implant.requirements],
    ["Эффект импланта", cleanString(implant.effect) !== cleanString(item.description) ? implant.effect : null]
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function buildDescriptionHtml(item, classification) {
  const metadataRows = buildMetadataRows(item, classification);
  const descriptionText = String(item.description ?? "").trim();

  return `
    <section class="rebreya-gear-item">
      ${metadataRows.length ? `
        <ul>
          ${metadataRows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${renderValue(value)}</li>`).join("")}
        </ul>
      ` : ""}
      ${descriptionText
        ? `<p>${escapeHtml(descriptionText)}</p>`
        : "<p>Описание предмета пока не заполнено.</p>"}
    </section>
  `.trim();
}

function buildWeaponDamagePart(formula, damageType) {
  const safeFormula = cleanString(formula);
  const safeDamageType = cleanString(damageType);
  const simpleFormulaMatch = safeFormula.match(/^(\d+)d(\d+)(?:\s*\+\s*(.+))?$/iu);
  const damagePart = {
    types: safeDamageType ? [safeDamageType] : [],
    custom: {
      enabled: Boolean(safeFormula),
      formula: safeFormula
    }
  };

  if (simpleFormulaMatch) {
    damagePart.number = Number(simpleFormulaMatch[1]);
    damagePart.denomination = Number(simpleFormulaMatch[2]);
    damagePart.bonus = cleanString(simpleFormulaMatch[3]);
    damagePart.custom = {
      enabled: false,
      formula: ""
    };
  }

  if (!safeFormula) {
    damagePart.custom = {
      enabled: false,
      formula: ""
    };
  }

  return damagePart;
}

function normalizeWeaponRange(range) {
  if (!isPlainObject(range)) {
    return null;
  }

  const value = Number(range.value ?? 0);
  const long = Number(range.long ?? 0);
  const reach = Number(range.reach ?? 0);
  if (![value, long, reach].some((entry) => Number.isFinite(entry) && entry > 0)) {
    return null;
  }

  return {
    value: Number.isFinite(value) ? Math.max(0, value) : 0,
    long: Number.isFinite(long) ? Math.max(0, long) : 0,
    reach: Number.isFinite(reach) ? Math.max(0, reach) : 0,
    units: cleanString(range.units, "ft")
  };
}

function resolveFirearmAttackAbility(item) {
  const weight = Number(item?.weight ?? item?.system?.weight?.value ?? 0);
  return Number.isFinite(weight) && weight >= 10 ? "str" : "dex";
}

function getFirearmPropertyValues(item) {
  const values = item?.weapon?.lichWeaponPropertyValues ?? item?.lichWeaponPropertyValues;
  return isPlainObject(values) ? values : {};
}

function getFirearmProperties(item) {
  return cleanArray(item?.weapon?.properties ?? item?.system?.properties ?? []);
}

function parseFirstPositiveInteger(value) {
  const match = String(value ?? "").match(/\d+/u);
  if (!match) {
    return 0;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function resolveFirearmReloadCapacity(item) {
  const values = getFirearmPropertyValues(item);
  return parseFirstPositiveInteger(values.reload);
}

function hasFirearmMisfire(item) {
  const properties = getFirearmProperties(item);
  const values = getFirearmPropertyValues(item);
  const configuredMisfire = Number(values.misfire ?? values.firearmMisfire);
  return (properties.includes(FIREARM_MISFIRE_PROPERTY) && Number.isFinite(configuredMisfire) && configuredMisfire > 0)
    || properties.includes(FIREARM_RUST_PROPERTY);
}

function resolveFirearmAreaFireMode(item) {
  const values = getFirearmPropertyValues(item);
  const properties = getFirearmProperties(item);
  const modeText = normalizeMatchText(values.fireMode);
  if (modeText.includes("полуавтомат")) {
    return {
      type: "semi",
      name: "Полуавтоматический огонь",
      automation: "firearm-semi-automatic-fire",
      activityId: FIREARM_SEMI_AUTOMATIC_FIRE_ACTIVITY_ID,
      coneFeet: 30,
      damageFormula: cleanString(values.semiAutomaticDamage ?? values.automaticDamage)
    };
  }

  if (modeText.includes("автомат")) {
    return {
      type: "automatic",
      name: "Автоматический огонь",
      automation: "firearm-automatic-fire",
      activityId: FIREARM_AUTOMATIC_FIRE_ACTIVITY_ID,
      coneFeet: 45,
      damageFormula: cleanString(values.automaticDamage)
    };
  }

  if (properties.includes("lchFirearmSemiAutomatic")) {
    return {
      type: "semi",
      name: "Полуавтоматический огонь",
      automation: "firearm-semi-automatic-fire",
      activityId: FIREARM_SEMI_AUTOMATIC_FIRE_ACTIVITY_ID,
      coneFeet: 30,
      damageFormula: cleanString(values.semiAutomaticDamage ?? values.automaticDamage)
    };
  }

  if (properties.includes("lchFirearmAutomatic")) {
    return {
      type: "automatic",
      name: "Автоматический огонь",
      automation: "firearm-automatic-fire",
      activityId: FIREARM_AUTOMATIC_FIRE_ACTIVITY_ID,
      coneFeet: 45,
      damageFormula: cleanString(values.automaticDamage)
    };
  }

  return null;
}

function isFirearmClassification(classification) {
  return ["firearmPrimitive", "firearmAdvanced"].includes(cleanString(classification?.systemTypeValue))
    || Boolean(cleanString(classification?.firearmClass));
}

function buildFirearmAttackActivity(item) {
  return {
    _id: FIREARM_ATTACK_ACTIVITY_ID,
    type: "attack",
    name: "Выстрел",
    activation: {
      type: "action",
      value: 1,
      condition: ""
    },
    attack: {
      ability: resolveFirearmAttackAbility(item),
      bonus: "",
      critical: {
        threshold: null
      },
      flat: false,
      type: {
        value: "firearm",
        classification: "weapon"
      }
    },
    damage: {
      critical: {
        bonus: ""
      },
      includeBase: true,
      parts: []
    }
  };
}

function buildSelfUtilityActivity({
  activityId,
  name,
  activationType = "action",
  chatFlavor = "",
  automation = "",
  sort = 0
}) {
  return {
    _id: activityId,
    type: "utility",
    name,
    sort,
    activation: {
      type: activationType,
      value: 1,
      condition: "",
      override: false
    },
    consumption: {
      scaling: {
        allowed: false,
        max: ""
      },
      spellSlot: false,
      targets: []
    },
    description: {
      chatFlavor
    },
    duration: {
      value: "",
      units: "inst",
      special: "",
      concentration: false,
      override: false
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        automation
      }
    },
    range: {
      value: null,
      units: "self",
      special: "",
      override: false
    },
    target: {
      template: {
        count: "",
        contiguous: false,
        type: "",
        size: "",
        width: "",
        height: "",
        units: ""
      },
      affects: {
        count: "",
        type: "self",
        choice: false,
        special: ""
      },
      prompt: false,
      override: false
    },
    uses: {
      spent: 0,
      max: "",
      recovery: []
    }
  };
}

function buildFirearmAreaFireActivity(item, mode) {
  if (!mode) {
    return null;
  }

  const damageFormula = cleanString(mode.damageFormula ?? item?.weapon?.damageFormula);
  return {
    _id: mode.activityId,
    type: "save",
    name: mode.name,
    img: "systems/dnd5e/icons/svg/activity/save.svg",
    sort: mode.type === "automatic" ? 90 : 95,
    activation: {
      type: "action",
      value: 1,
      condition: "",
      override: false
    },
    consumption: {
      scaling: {
        allowed: false,
        max: ""
      },
      spellSlot: false,
      targets: []
    },
    damage: {
      onSave: "half",
      parts: damageFormula ? [
        buildWeaponDamagePart(damageFormula, item?.weapon?.damageType)
      ] : []
    },
    description: {
      chatFlavor: `${mode.name}: конус ${mode.coneFeet} фт., урон ${damageFormula || "урон оружия"}.`
    },
    duration: {
      value: "",
      units: "inst",
      special: "",
      concentration: false,
      override: false
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        automation: mode.automation
      }
    },
    range: {
      value: null,
      units: "self",
      special: "",
      override: false
    },
    save: {
      ability: ["dex"],
      dc: {
        calculation: resolveFirearmAttackAbility(item),
        formula: ""
      }
    },
    target: {
      template: {
        count: "",
        contiguous: false,
        type: "cone",
        size: mode.coneFeet,
        width: "",
        height: "",
        units: "ft"
      },
      affects: {
        count: "",
        type: "creature",
        choice: false,
        special: ""
      },
      prompt: true,
      override: false
    },
    uses: {
      spent: 0,
      max: "",
      recovery: []
    }
  };
}

function buildFirearmActivities(item) {
  const attackActivity = buildFirearmAttackActivity(item);
  const reloadCapacity = resolveFirearmReloadCapacity(item);
  const reloadActivity = reloadCapacity > 0 ? buildSelfUtilityActivity({
    activityId: FIREARM_RELOAD_ACTIVITY_ID,
    name: "Перезарядить",
    activationType: "action",
    chatFlavor: `Перезарядить оружие: заполнить боезапас до ${reloadCapacity}, списав подходящие боеприпасы из инвентаря.`,
    automation: "firearm-reload",
    sort: 50
  }) : null;
  const areaFireActivity = buildFirearmAreaFireActivity(item, resolveFirearmAreaFireMode(item));
  const misfireTracked = hasFirearmMisfire(item);
  const clearJamActivity = misfireTracked ? buildSelfUtilityActivity({
    activityId: FIREARM_CLEAR_JAM_ACTIVITY_ID,
    name: "Очистить затвор",
    activationType: "action",
    chatFlavor: "Очистить затворную раму: снять клин и увеличить текущий показатель осечки на 1, максимум до 10.",
    automation: "firearm-clear-jam",
    sort: 100
  }) : null;
  const maintainActivity = misfireTracked ? buildSelfUtilityActivity({
    activityId: FIREARM_MAINTAIN_ACTIVITY_ID,
    name: "Привести оружие в порядок",
    activationType: "minute",
    chatFlavor: "Проверка Ловкости или Интеллекта (инструменты жестянщика) против Сл 10 + текущий показатель осечки. При успехе осечка возвращается к базовому значению.",
    automation: "firearm-maintain",
    sort: 200
  }) : null;

  const activities = {
    [attackActivity._id]: attackActivity
  };
  if (reloadActivity) {
    activities[reloadActivity._id] = reloadActivity;
  }
  if (areaFireActivity) {
    activities[areaFireActivity._id] = areaFireActivity;
  }
  if (clearJamActivity) {
    activities[clearJamActivity._id] = clearJamActivity;
  }
  if (maintainActivity) {
    activities[maintainActivity._id] = maintainActivity;
  }
  return activities;
}

function applyWeaponData(baseData, weapon) {
  if (!isPlainObject(weapon)) {
    return;
  }

  const properties = cleanArray(weapon.properties);
  if (properties.length) {
    baseData.properties = properties;
  }

  const damageFormula = cleanString(weapon.damageFormula);
  const damageType = cleanString(weapon.damageType);
  const versatileDamageFormula = cleanString(weapon.versatileDamageFormula);
  if (damageFormula || damageType || versatileDamageFormula) {
    baseData.damage = {
      base: buildWeaponDamagePart(damageFormula, damageType),
      versatile: buildWeaponDamagePart(versatileDamageFormula, damageType)
    };
  }

  const range = normalizeWeaponRange(weapon.range);
  if (range) {
    baseData.range = range;
  }
}

function normalizeArmorProperties(properties) {
  return cleanArray(properties);
}

function isArmorEquipmentType(type) {
  return ["light", "medium", "heavy", "shield"].includes(cleanString(type));
}

function applyArmorData(baseData, item, classification) {
  const armor = isPlainObject(item?.armor) ? item.armor : null;
  const typeValue = cleanString(armor?.type) || classification.systemTypeValue || "wondrous";
  baseData.type = {
    value: typeValue,
    baseItem: cleanString(armor?.baseItem) || classification.baseItem || ""
  };

  if (!armor && !isArmorEquipmentType(typeValue)) {
    return;
  }

  baseData.armor = {
    value: Math.max(0, Math.floor(toFiniteNumber(armor?.value, 0))),
    magicalBonus: armor?.magicalBonus === undefined || armor?.magicalBonus === null
      ? null
      : Math.max(0, Math.floor(toFiniteNumber(armor.magicalBonus, 0))),
    dex: armor?.dex === undefined || armor?.dex === null
      ? null
      : Math.floor(toFiniteNumber(armor.dex, 0))
  };
  baseData.strength = Math.max(0, Math.floor(toFiniteNumber(armor?.strength, 0)));
  baseData.properties = normalizeArmorProperties(armor?.properties);
}

function buildSystemData(item, classification, descriptionHtml, presentation = null) {
  const itemPresentation = presentation ?? buildDnd5eItemPresentation(item, classification);
  const weightValue = Number.isFinite(Number(itemPresentation.weight)) ? Number(itemPresentation.weight) : 0;
  const price = goldToDnd5ePrice(itemPresentation.priceGoldEquivalent);
  const baseData = {
    description: {
      value: descriptionHtml,
      chat: ""
    },
    unidentified: {
      description: ""
    },
    quantity: Math.max(1, Math.floor(toFiniteNumber(itemPresentation.quantity, 1))),
    price: {
      value: price.value,
      denomination: price.denomination
    },
    weight: {
      value: weightValue,
      units: "lb"
    }
  };

  switch (classification.documentType) {
    case "weapon":
      baseData.type = {
        value: classification.systemTypeValue || "martialM",
        baseItem: classification.baseItem || ""
      };
      applyWeaponData(baseData, item.weapon);
      if (isFirearmClassification(classification)) {
        baseData.activities = buildFirearmActivities(item);
      }
      break;

    case "equipment":
      applyArmorData(baseData, item, classification);
      break;

    case "tool":
      baseData.type = {
        value: classification.systemTypeValue || "art",
        baseItem: classification.baseItem || ""
      };
      baseData.ability = classification.toolAbility || "";
      break;

    case "consumable":
      baseData.type = {
        value: classification.systemTypeValue || "potion",
        subtype: classification.systemTypeSubtype || ""
      };
      break;

    case "container":
      baseData.type = {
        value: classification.systemTypeValue || "backpack",
        subtype: classification.systemTypeSubtype || ""
      };
      baseData.capacity = normalizeContainerCapacity(item.containerCapacity) ?? {
        count: null,
        volume: {
          value: null,
          units: "ft3"
        },
        weight: {
          value: null,
          units: "lb"
        }
      };
      baseData.properties = cleanArray(item.containerProperties ?? item.properties);
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

function clonePlainObject(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

export function createDnd5eItemData(item, folderIdByPath, iconLookup = null) {
  const classification = classifyGearEntry(item);
  const itemPresentation = buildDnd5eItemPresentation(item, classification);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const signature = buildGearSignature(item);
  const folderPath = buildFolderPath(classification).join("/");
  const descriptionHtml = buildDescriptionHtml(item, classification);
  const weapon = isPlainObject(item.weapon) ? item.weapon : {};
  const attackTraits = clonePlainObject(weapon.attackTraits);
  const lichWeaponPropertyValues = clonePlainObject(weapon.lichWeaponPropertyValues);
  const attackTraitsText = cleanString(weapon.attackTraitsText || weapon.propertiesText);
  const handRequirement = resolveWeaponHandRequirement(weapon);
  const containerContents = cloneContainerContents(item.containerContents);

  return {
    _id: createStableGearDocumentId(item.id),
    name: itemPresentation.name,
    type: classification.documentType,
    img: resolveGearItemIcon(item, { classification, iconLookup }),
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: buildSystemData(item, classification, descriptionHtml, itemPresentation),
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        gearId: item.id,
        signature,
        equipmentType: item.equipmentType ?? "",
        foundryType: classification.documentType,
        foundrySubtype: classification.systemTypeValue ?? "",
        foundrySubtypeExtra: classification.systemTypeSubtype ?? "",
        foundryBaseItem: classification.baseItem ?? "",
        foundryFolder: folderPath,
        itemSlot,
        heroDollSlots,
        rank: clampRank(item.rank),
        firearmClass: classification.firearmClass ?? "",
        predominantMaterialId: item.predominantMaterialId ?? null,
        predominantMaterialName: item.predominantMaterialName ?? "",
        linkedTool: item.linkedTool ?? "",
        value: item.value ?? "",
        priceGoldEquivalent: Number(itemPresentation.priceGoldEquivalent ?? 0),
        sourcePackQuantity: itemPresentation.sourcePack?.quantity ?? null,
        sourcePackPriceGoldEquivalent: itemPresentation.sourcePack?.sourcePriceGoldEquivalent ?? null,
        sourcePackWeight: itemPresentation.sourcePack?.sourceWeight ?? null,
        containerCapacity: clonePlainObject(item.containerCapacity),
        containerContents,
        attackTraits: attackTraits && Object.keys(attackTraits).length ? attackTraits : null,
        attackTraitsText: attackTraitsText || null,
        attackProperties: attackTraitsText || null,
        handRequirement: handRequirement ? clonePlainObject(handRequirement) : null,
        lichWeaponPropertyValues: lichWeaponPropertyValues && Object.keys(lichWeaponPropertyValues).length
          ? lichWeaponPropertyValues
          : null,
        implant: clonePlainObject(item.implant)
      }
    }
  };
}

export function createDnd5eContainerContentData(containerItem, gearById, containerDocumentId, folderIdByPath, iconLookup = null) {
  const containerId = cleanString(containerDocumentId);
  if (!containerId || !(gearById instanceof Map)) {
    return [];
  }

  return normalizeContainerContents(containerItem?.containerContents)
    .map((entry) => {
      const sourceItem = gearById.get(entry.gearId);
      if (!sourceItem) {
        return null;
      }

      const data = createDnd5eItemData(sourceItem, folderIdByPath, iconLookup);
      delete data._id;
      delete data.id;
      data.system ??= {};
      const sourcePackQuantity = Math.max(1, Math.floor(toFiniteNumber(data.flags?.[MODULE_ID]?.sourcePackQuantity, 1)));
      data.system.quantity = Math.max(1, Math.floor(toFiniteNumber(entry.quantity, 1))) * sourcePackQuantity;
      data.system.container = containerId;

      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      const moduleFlags = data.flags[MODULE_ID];
      delete moduleFlags.gearId;
      moduleFlags.sourceType = GEAR_CONTAINER_CONTENT_SOURCE_TYPE;
      moduleFlags.containerGearId = cleanString(containerItem?.id);
      moduleFlags.containerContentGearId = entry.gearId;
      moduleFlags.containerContentId = `${moduleFlags.containerGearId}::${entry.gearId}`;
      moduleFlags.containerContentQuantity = entry.quantity;
      moduleFlags.containerContentResolvedQuantity = data.system.quantity;
      moduleFlags.signature = JSON.stringify({
        templateVersion: GEAR_TEMPLATE_VERSION,
        sourceType: GEAR_CONTAINER_CONTENT_SOURCE_TYPE,
        containerContentId: moduleFlags.containerContentId,
        containerGearId: moduleFlags.containerGearId,
        containerContentGearId: entry.gearId,
        quantity: entry.quantity,
        resolvedQuantity: data.system.quantity,
        sourceSignature: buildGearSignature(sourceItem)
      });

      return data;
    })
    .filter(Boolean);
}

function getDesiredPackMetadata() {
  return {
    label: GEAR_COMPENDIUM_LABEL,
    type: "Item",
    name: GEAR_COMPENDIUM_NAME,
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

async function syncGearPackMetadata(pack, metadata) {
  if (!pack || typeof pack.configure !== "function") {
    return;
  }

  const desiredDnd5eFlags = metadata.flags?.dnd5e ?? {};
  const currentSourceBook = cleanString(foundry.utils.getProperty(pack, "metadata.flags.dnd5e.sourceBook"));
  const desiredSourceBook = cleanString(desiredDnd5eFlags.sourceBook);
  const currentTypes = foundry.utils.getProperty(pack, "metadata.flags.dnd5e.types") ?? [];
  const desiredTypes = Array.isArray(desiredDnd5eFlags.types) ? desiredDnd5eFlags.types : [];
  if (
    currentSourceBook === desiredSourceBook
    && JSON.stringify(currentTypes) === JSON.stringify(desiredTypes)
  ) {
    return;
  }

  try {
    await pack.configure({
      flags: {
        ...(pack.metadata?.flags ?? {}),
        dnd5e: {
          ...(pack.metadata?.flags?.dnd5e ?? {}),
          ...desiredDnd5eFlags
        }
      }
    });
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to update gear compendium metadata.`, error);
  }
}

async function ensureGearPack() {
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
  else {
    await syncGearPackMetadata(pack, desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign gear compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function findGearDocument(pack, gearItem) {
  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.gearId`, `flags.${MODULE_ID}.sourceType`]
  });
  const primaryEntries = Array.from(index ?? []).filter((entry) => (
    foundry.utils.getProperty(entry, `flags.${MODULE_ID}.sourceType`) !== GEAR_CONTAINER_CONTENT_SOURCE_TYPE
  ));
  const indexEntry = primaryEntries.find((entry) => {
    const gearId = foundry.utils.getProperty(entry, `flags.${MODULE_ID}.gearId`);
    return gearId === gearItem.id;
  }) ?? primaryEntries.find((entry) => normalizeMatchText(entry.name) === normalizeMatchText(gearItem.name));

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  const primaryDocuments = documents.filter((entry) => (
    entry.getFlag(MODULE_ID, "sourceType") !== GEAR_CONTAINER_CONTENT_SOURCE_TYPE
  ));
  return primaryDocuments.find((entry) => {
    const gearId = entry.getFlag(MODULE_ID, "gearId");
    return gearId === gearItem.id;
  }) ?? primaryDocuments.find((entry) => normalizeMatchText(entry.name) === normalizeMatchText(gearItem.name)) ?? null;
}

async function syncManagedDocumentIcons(pack, documents, iconLookup) {
  const updates = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const currentIcon = String(document.img ?? "").trim() || DEFAULT_GEAR_ICON;
    const nextIcon = resolveGearNamedIcon({
      name: document.name,
      equipmentType: document.getFlag(MODULE_ID, "equipmentType")
    }, iconLookup) || currentIcon;
    if (!nextIcon || nextIcon === currentIcon) {
      continue;
    }

    updates.push({
      _id: document.id,
      img: nextIcon
    });
  }

  if (!updates.length) {
    return;
  }

  await Item.implementation.updateDocuments(updates, { pack: pack.collection });
}

export function getPrimaryGearDocumentCreateOptions(pack) {
  return {
    pack: pack.collection,
    keepId: true
  };
}

export class GearCompendiumService {
  async sync(gear = []) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const safeGear = Array.isArray(gear) ? gear : [];
    const pack = await ensureGearPack();
    await deduplicateCompendiumFolders(pack, ["Обвес", "Обвесы", "Огнестрельное оружие", "Примитивное", "Продвинутое"]);
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildGearIconLookup({ forceRefresh: true });
    let folderIdByPath = new Map();
    try {
      folderIdByPath = await ensureCompendiumFolders(
        pack,
        safeGear.map((item) => buildFolderPath(classifyGearEntry(item)))
      );
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to prepare compendium folders for gear pack.`, error);
    }

    const gearById = new Map(safeGear.map((item) => [cleanString(item?.id), item]).filter(([gearId]) => gearId));
    const gearIdByName = new Map(
      safeGear
        .map((item) => [normalizeMatchText(item?.name), cleanString(item?.id)])
        .filter(([name, gearId]) => name && gearId)
    );
    await syncManagedDocuments({
      pack,
      entries: safeGear,
      documents,
      sourceIdOfEntry: (item) => item?.id,
      sourceIdOfDocument: (document) => {
        if (document?.getFlag?.(MODULE_ID, "sourceType") === GEAR_CONTAINER_CONTENT_SOURCE_TYPE) {
          return "";
        }

        const gearId = cleanString(document?.getFlag?.(MODULE_ID, "gearId"));
        if (document?.getFlag?.(MODULE_ID, "managed")) {
          return gearId || `managed-primary:${cleanString(document?.id ?? document?._id)}`;
        }
        if (gearId && gearById.has(gearId)) {
          return gearId;
        }
        return gearIdByName.get(normalizeMatchText(document?.name)) ?? "";
      },
      signatureOfEntry: (item) => buildGearSignature(item),
      signatureOfDocument: (document) => document?.getFlag?.(MODULE_ID, "signature"),
      documentIdOfEntry: (item) => createStableGearDocumentId(item?.id),
      createData: (item) => createDnd5eItemData(item, folderIdByPath, iconLookup),
      updateData: (_document, item) => {
        const data = createDnd5eItemData(item, folderIdByPath, iconLookup);
        delete data._id;
        delete data.id;
        return data;
      }
    });

    const primarySyncedDocuments = await getPackDocuments(pack);
    const containedEntries = safeGear.flatMap((item) => (
      createDnd5eContainerContentData(
        item,
        gearById,
        createStableGearDocumentId(item?.id),
        folderIdByPath,
        iconLookup
      ).map((data) => ({
        sourceId: data.flags?.[MODULE_ID]?.containerContentId,
        signature: data.flags?.[MODULE_ID]?.signature,
        data
      }))
    ));
    await syncManagedDocuments({
      pack,
      entries: containedEntries,
      documents: primarySyncedDocuments,
      sourceIdOfEntry: (entry) => entry.sourceId,
      sourceIdOfDocument: (document) => {
        if (document?.getFlag?.(MODULE_ID, "sourceType") !== GEAR_CONTAINER_CONTENT_SOURCE_TYPE) {
          return "";
        }

        const explicitId = cleanString(document.getFlag(MODULE_ID, "containerContentId"));
        if (explicitId) {
          return explicitId;
        }
        const containerGearId = cleanString(document.getFlag(MODULE_ID, "containerGearId"));
        const contentGearId = cleanString(document.getFlag(MODULE_ID, "containerContentGearId"));
        return containerGearId && contentGearId
          ? `${containerGearId}::${contentGearId}`
          : `managed-content:${cleanString(document?.id ?? document?._id)}`;
      },
      signatureOfEntry: (entry) => entry.signature,
      signatureOfDocument: (document) => document?.getFlag?.(MODULE_ID, "signature"),
      createData: (entry) => entry.data,
      updateData: (_document, entry) => entry.data
    });

    const syncedDocuments = await getPackDocuments(pack);
    await syncManagedDocumentIcons(pack, syncedDocuments, iconLookup);

    return game.packs.get(PACK_ID) ?? pack;
  }

  async openGear(gearItem) {
    if (!gearItem) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.GearEntryNotFound"));
      return null;
    }

    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.GearEntryNotFound"));
      return null;
    }

    const document = await findGearDocument(pack, gearItem);

    if (!document) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.GearEntryNotFound"));
      return null;
    }

    await document.sheet?.render?.(true);
    bringAppToFront(document.sheet);
    window.setTimeout(() => bringAppToFront(document.sheet), 40);
    window.setTimeout(() => bringAppToFront(document.sheet), 140);
    return document;
  }
}
