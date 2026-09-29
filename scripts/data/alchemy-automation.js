import { MODULE_ID } from "../constants.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";

const HEALING_FORMULAS = Object.freeze([
  "1d4 + 1",
  "2d4 + 2",
  "3d4 + 3",
  "4d4 + 4",
  "6d4 + 6",
  "8d4 + 8",
  "10d4 + 10",
  "15d4 + 15",
  "25d4 + 25"
]);
const DAMAGE_DICE = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 10]);
const RADII = Object.freeze([5, 5, 5, 10, 10, 10, 15, 15, 15]);
const FIRE_DECAY = Object.freeze([
  Object.freeze([2, 1]),
  Object.freeze([3, 1]),
  Object.freeze([4, 1]),
  Object.freeze([5, 2]),
  Object.freeze([6, 2]),
  Object.freeze([8, 2]),
  Object.freeze([9, 3]),
  Object.freeze([12, 3]),
  Object.freeze([15, 5])
]);
const CRYOGENIC_VALUES = Object.freeze([5, 5, 10, 10, 15, 15, 20, 20, 25]);
const FRIGHTENED_VALUES = Object.freeze([1, 1, 2, 2, 3, 3, 4, 4, 4]);
const NAUSEATED_VALUES = Object.freeze([1, 1, 1, 2, 2, 2, 3, 3, 3]);

const BOMB_FAMILIES = Object.freeze([
  Object.freeze({ first: 154, family: "alchemical-fire", ability: "dex", damageType: "fire", denomination: 6 }),
  Object.freeze({ first: 163, family: "acid", ability: "dex", damageType: "acid", denomination: 6 }),
  Object.freeze({ first: 172, family: "electrical", ability: "dex", damageType: "lightning", denomination: 4 }),
  Object.freeze({ first: 181, family: "cryogenic", ability: "con", damageType: "cold", denomination: 6 }),
  Object.freeze({ first: 190, family: "sticky", ability: "dex", damageType: "", denomination: null, persistent: true }),
  Object.freeze({ first: 199, family: "frightening", ability: "wis", damageType: "psychic", denomination: 4 }),
  Object.freeze({ first: 208, family: "stinking", ability: "con", damageType: "poison", denomination: 6 })
]);

function rankIndex(product) {
  const rank = Number(product?.rank);
  return Number.isInteger(rank) && rank >= 1 && rank <= 9 ? rank - 1 : -1;
}

function sourceNumber(product) {
  const value = Number(product?.sourceNumber);
  return Number.isInteger(value) ? value : 0;
}

function bombFamily(product) {
  if (String(product?.productType ?? "").trim() !== "Бомба") return null;
  const number = sourceNumber(product);
  return BOMB_FAMILIES.find(({ first }) => number >= first && number < first + 9) ?? null;
}

function bombFamilyEffect(family, index) {
  switch (family.family) {
    case "alchemical-fire": return { amount: FIRE_DECAY[index][0], step: FIRE_DECAY[index][1] };
    case "acid": return { breakage: index >= 6 ? 2 : 1 };
    case "electrical": return { failureWeakness: 2, successWeakness: 1 };
    case "cryogenic": return { restrained: CRYOGENIC_VALUES[index] };
    case "sticky": return { durationSeconds: 60, difficultTerrain: true };
    case "frightening": return { frightened: FRIGHTENED_VALUES[index] };
    case "stinking": return { nauseated: NAUSEATED_VALUES[index] };
    default: return {};
  }
}

function activityId(product, kind) {
  return createStableGearDocumentId(`alchemy-product:${String(product?.id ?? "").trim()}:activity:${kind}`);
}

function consumption() {
  return {
    scaling: { allowed: false, max: "" },
    spellSlot: false,
    targets: [{
      type: "itemUses",
      target: "",
      value: "1",
      scaling: { mode: "", formula: "" }
    }]
  };
}

function emptyTemplate() {
  return { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" };
}

function activityFlags(kind, product, extra = {}) {
  return {
    [MODULE_ID]: {
      alchemyAutomation: {
        version: 1,
        kind,
        productId: String(product?.id ?? "").trim()
      },
      ...extra
    }
  };
}

export function getAlchemyAutomationDefinition(product) {
  const index = rankIndex(product);
  const number = sourceNumber(product);
  if (index >= 0 && number >= 77 && number <= 85 && String(product?.productType ?? "").trim() === "Зелье") {
    return Object.freeze({
      kind: "healing",
      formula: HEALING_FORMULAS[index]
    });
  }

  const family = index >= 0 ? bombFamily(product) : null;
  if (!family || number !== family.first + index) return null;
  const denomination = family.denomination;
  const damage = denomination == null
    ? null
    : Object.freeze({
      formula: `${DAMAGE_DICE[index]}d${denomination}`,
      type: family.damageType
    });
  return Object.freeze({
    kind: "bomb",
    family: family.family,
    rank: index + 1,
    dc: index + 12,
    ability: family.ability,
    radius: RADII[index],
    damage,
    effect: Object.freeze(bombFamilyEffect(family, index)),
    persistent: family.persistent === true
  });
}

function buildHealingActivity(product, definition) {
  const id = activityId(product, "healing");
  return [id, {
    _id: id,
    type: "heal",
    name: "Выпить зелье",
    activation: { type: "action", value: 1, condition: "", override: false },
    consumption: consumption(),
    duration: { units: "inst", concentration: false, override: false },
    range: { units: "", special: "", override: false },
    target: {
      prompt: true,
      affects: { count: "1", type: "creature", choice: true, special: "" },
      template: emptyTemplate()
    },
    healing: {
      number: null,
      denomination: null,
      bonus: "",
      types: ["healing"],
      custom: { enabled: true, formula: definition.formula },
      scaling: { mode: "", number: 1, formula: "" }
    },
    description: { chatFlavor: "" },
    flags: activityFlags("healing", product)
  }];
}

function buildBombDamage(definition) {
  if (!definition.damage) return { onSave: "none", parts: [] };
  return {
    onSave: "half",
    parts: [{
      number: null,
      denomination: null,
      bonus: "",
      types: [definition.damage.type],
      custom: { enabled: true, formula: definition.damage.formula },
      scaling: { mode: "", number: 1, formula: "" }
    }]
  };
}

function buildBombActivity(product, definition) {
  const id = activityId(product, "throw-bomb");
  return [id, {
    _id: id,
    type: "save",
    name: "Бросить бомбу",
    activation: { type: "attack", value: 1, condition: "", override: false },
    consumption: consumption(),
    duration: {
      units: definition.persistent ? "minute" : "inst",
      value: definition.persistent ? "1" : "",
      concentration: false,
      override: false
    },
    range: { units: "spec", special: "Точка броска", override: false },
    target: {
      prompt: false,
      affects: { count: "", type: "creature", choice: false, special: "все существа в эманации" },
      template: {
        count: "1",
        contiguous: false,
        type: "radius",
        size: String(definition.radius),
        width: "",
        height: "",
        units: "ft"
      }
    },
    save: {
      ability: [definition.ability],
      dc: { calculation: "", formula: String(definition.dc) }
    },
    damage: buildBombDamage(definition),
    description: { chatFlavor: "" },
    flags: activityFlags("bomb", product, { alchemyBomb: definition })
  }];
}

export function buildAlchemyActivities(product) {
  const definition = getAlchemyAutomationDefinition(product);
  if (!definition) return {};
  const [id, activity] = definition.kind === "healing"
    ? buildHealingActivity(product, definition)
    : buildBombActivity(product, definition);
  return { [id]: activity };
}

export function buildAlchemyConsumableUses(product) {
  if (!getAlchemyAutomationDefinition(product)) return null;
  return {
    spent: 0,
    max: "1",
    recovery: [],
    autoDestroy: true
  };
}
