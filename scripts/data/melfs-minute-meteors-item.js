import { MODULE_ID } from "../constants.js";

export const MELFS_MINUTE_METEORS_ID = "melfs-minute-meteors-rebreya";
export const MELFS_MINUTE_METEORS_RECIPE = "melfs-minute-meteors";
export const MELFS_MINUTE_METEORS_VERSION = 1;
export const MELFS_MINUTE_METEORS_DOCUMENT_ID = "melfMeteorsItem1";
export const MELFS_ACTIVITY_IDS = Object.freeze({
  CAST: "melfMeteorsCast1",
  RELEASE: "melfMeteorRel001",
  BURST: "melfMeteorBurst1"
});

const UTILITY_IMAGE = "systems/dnd5e/icons/svg/activity/utility.svg";
const SAVE_IMAGE = "systems/dnd5e/icons/svg/activity/save.svg";

function declaration(action = null) {
  return {
    runtime: "instance",
    recipe: MELFS_MINUTE_METEORS_RECIPE,
    version: MELFS_MINUTE_METEORS_VERSION,
    ...(action ? { action } : {})
  };
}

function consumption({ spellSlot, scaling }) {
  return {
    scaling: { allowed: scaling, max: "" },
    spellSlot,
    targets: []
  };
}

function activity({ id, type, name, image, activation, action, spellSlot = false, scaling = false, extra = {} }) {
  return {
    _id: id,
    type,
    name,
    img: image,
    sort: 0,
    activation: { ...activation, condition: "", override: false },
    consumption: consumption({ spellSlot, scaling }),
    description: { chatFlavor: name },
    duration: { value: "", units: "inst", special: "", concentration: false, override: false },
    effects: [],
    flags: { [MODULE_ID]: { spellAutomation: declaration(action) } },
    ...extra
  };
}

export function buildMelfsMinuteMeteorsItem() {
  const cast = activity({
    id: MELFS_ACTIVITY_IDS.CAST,
    type: "utility",
    name: "Сотворение",
    image: UTILITY_IMAGE,
    activation: { type: "action", value: 1 },
    action: "cast",
    spellSlot: true,
    scaling: true,
    extra: {
      duration: { value: "10", units: "minute", special: "", concentration: true, override: false }
    }
  });
  const release = activity({
    id: MELFS_ACTIVITY_IDS.RELEASE,
    type: "utility",
    name: "Выпустить метеоры",
    image: UTILITY_IMAGE,
    activation: { type: "bonus", value: 1 },
    action: "release"
  });
  const burst = activity({
    id: MELFS_ACTIVITY_IDS.BURST,
    type: "save",
    name: "Взрыв метеора",
    image: SAVE_IMAGE,
    activation: { type: "special", value: null },
    action: "burst",
    extra: {
      save: { ability: ["dex"], dc: { calculation: "spellcasting", formula: "" } },
      damage: {
        onSave: "half",
        parts: [{
          number: 2,
          denomination: 6,
          bonus: "",
          types: ["fire"],
          custom: { enabled: false, formula: "" },
          scaling: { mode: "", number: 1, formula: "" }
        }]
      },
      target: {
        template: { type: "radius", size: "5", units: "ft" },
        prompt: true,
        override: false
      }
    }
  });

  return {
    _id: MELFS_MINUTE_METEORS_DOCUMENT_ID,
    name: "Метеоры Мельфа",
    type: "spell",
    img: "icons/magic/fire/projectile-meteor-salvo-strong-teal.webp",
    ownership: { default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2 },
    system: {
      identifier: MELFS_MINUTE_METEORS_ID,
      level: 3,
      source: { custom: "Rebreya" },
      properties: ["vocal", "somatic", "material", "concentration"],
      duration: { value: "10", units: "minute", special: "" },
      activities: { cast, release, burst }
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        spellId: MELFS_MINUTE_METEORS_ID,
        spellAutomation: declaration()
      }
    }
  };
}
