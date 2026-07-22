import { CRAFTSMAN_CLASS_IDENTIFIER, MODULE_ID } from "../constants.js";

const GADGET_ACTIVITY_IMAGE = "systems/dnd5e/icons/svg/activity/utility.svg";
const GADGET_FOLDER_PATH = Object.freeze(["Ремесленник V0.1", "Гаджеты"]);
const VALID_AVAILABILITY = new Set(["base", "mechanic"]);

export const CRAFTSMAN_GADGET_IDS = Object.freeze({
  FORCE_GLOVE: "force-glove",
  MAGNETIC_ENGINE: "magnetic-engine",
  CHARGED_BOOT: "charged-boot",
  SMOKE_DEVICE: "smoke-device",
  AFTERBURNER_INJECTOR: "afterburner-injector",
  EMERGENCY_REGULATOR: "emergency-regulator"
});

const EXPECTED_GADGET_IDS = Object.freeze(Object.values(CRAFTSMAN_GADGET_IDS));

function clone(value) {
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : JSON.parse(JSON.stringify(value));
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function stableActivityId(seed) {
  let first = 2166136261;
  let second = 2246822519;
  for (const character of String(seed)) {
    const code = character.codePointAt(0);
    first = Math.imul(first ^ code, 16777619) >>> 0;
    second = Math.imul(second ^ code, 3266489917) >>> 0;
  }
  return `${first.toString(36).padStart(8, "0")}${second.toString(36).padStart(8, "0")}`.slice(-16);
}

function normalizeGadget(raw, index) {
  const gadget = raw && typeof raw === "object" ? raw : {};
  const id = cleanString(gadget.id);
  const name = cleanString(gadget.name);
  const descriptionMarkdown = String(gadget.descriptionMarkdown ?? "").trim();
  const availability = cleanString(gadget.availability);
  const requiredLevel = Math.max(1, Math.min(20, Math.floor(Number(gadget.requiredLevel) || 1)));
  if (!id || !name || !descriptionMarkdown || !VALID_AVAILABILITY.has(availability)) {
    throw new Error(`Invalid Craftsman gadget definition at index ${index}`);
  }
  return {
    id,
    name,
    descriptionMarkdown,
    availability,
    requiredLevel,
    attachment: cleanString(gadget.attachment)
  };
}

export function normalizeCraftsmanGadgets(rawClassData) {
  const rawGadgets = rawClassData?.automation?.gadgets;
  if (!Array.isArray(rawGadgets) || rawGadgets.length !== EXPECTED_GADGET_IDS.length) {
    throw new Error("Craftsman V0.1 must define exactly six gadget templates");
  }
  const gadgets = rawGadgets.map(normalizeGadget);
  const ids = gadgets.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length || EXPECTED_GADGET_IDS.some((id) => !ids.includes(id))) {
    throw new Error("Craftsman V0.1 gadget IDs do not match the supported catalog");
  }
  return clone(gadgets);
}

function buildUtilityActivity(gadget, operation, activationType, label, sort) {
  const activityId = stableActivityId(`${gadget.id}:${operation}:${activationType}`);
  return {
    _id: activityId,
    type: "utility",
    name: label,
    img: GADGET_ACTIVITY_IMAGE,
    sort,
    activation: {
      type: activationType,
      value: activationType === "bonus" ? 1 : null,
      condition: activationType === "special" && operation === "activate" ? "Вместо одной из доступных атак" : "",
      override: false
    },
    consumption: {
      scaling: { allowed: false, max: "" },
      spellSlot: false,
      targets: []
    },
    description: { chatFlavor: gadget.descriptionMarkdown },
    duration: {
      value: operation === "activate" ? 1 : "",
      units: operation === "activate" ? "minute" : "inst",
      special: "",
      concentration: false,
      override: false
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        craftsmanGadget: {
          gadgetId: gadget.id,
          operation
        }
      }
    },
    range: { value: null, units: "self", special: "", override: false },
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
      affects: { count: "", type: "self", choice: false, special: "" },
      prompt: false,
      override: false
    },
    uses: { spent: 0, max: "", recovery: [] }
  };
}

export function buildCraftsmanGadgetAutomation(gadgetDefinition) {
  const gadget = normalizeGadget(gadgetDefinition, 0);
  const activities = [
    buildUtilityActivity(gadget, "activate", "bonus", "Активировать бонусным действием", 0),
    buildUtilityActivity(gadget, "activate", "special", "Активировать вместо атаки", 100),
    buildUtilityActivity(gadget, "action", "special", "Действие гаджета", 200)
  ];
  if (gadget.id === CRAFTSMAN_GADGET_IDS.MAGNETIC_ENGINE) {
    const action = activities[2];
    action.type = "attack";
    action.img = "systems/dnd5e/icons/svg/activity/attack.svg";
    action.attack = {
      ability: "int",
      bonus: "",
      critical: { threshold: null },
      flat: false,
      type: { value: "ranged", classification: "weapon" }
    };
    action.damage = {
      critical: { bonus: "" },
      includeBase: false,
      parts: []
    };
    action.range = { value: 30, units: "ft", special: "", override: true };
    action.target.affects = { count: "1", type: "object", choice: true, special: "металлический предмет" };
    action.target.prompt = true;
  }
  if (gadget.id === CRAFTSMAN_GADGET_IDS.SMOKE_DEVICE) {
    for (const activation of activities.filter((entry) => (
      entry.flags[MODULE_ID].craftsmanGadget.operation === "activate"
    ))) {
      activation.target.template = {
        count: "1",
        contiguous: false,
        type: "cube",
        size: "15",
        width: "",
        height: "",
        units: "ft"
      };
      activation.target.prompt = true;
    }
  }
  return {
    activities: Object.fromEntries(activities.map((activity) => [activity._id, activity])),
    effects: [],
    usesRecovery: []
  };
}

export function buildCraftsmanGadgetFeatureDefinitions(gadgets) {
  return gadgets.map((gadgetDefinition) => {
    const gadget = normalizeGadget(gadgetDefinition, 0);
    return {
      featureId: `${CRAFTSMAN_CLASS_IDENTIFIER}::gadget::${gadget.id}`,
      sourceType: "craftsmanGadget",
      classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
      className: "Ремесленник V0.1",
      subclassId: null,
      subclassName: null,
      name: gadget.name,
      description: gadget.descriptionMarkdown,
      descriptionMarkdown: gadget.descriptionMarkdown,
      levels: [gadget.requiredLevel],
      requiredLevel: gadget.requiredLevel,
      optional: true,
      identifier: `craftsman-gadget-${gadget.id}`,
      folderPath: [...GADGET_FOLDER_PATH],
      sourceLabel: "D&D Ремесленник V0.1",
      craftsmanGadget: gadget
    };
  });
}

export function isCraftsmanGadgetItem(item) {
  const flags = item?.flags?.[MODULE_ID] ?? item?.getFlag?.(MODULE_ID, "craftsmanGadgetTemplate");
  return Boolean(flags?.craftsmanGadgetTemplate ?? flags?.gadgetId);
}
