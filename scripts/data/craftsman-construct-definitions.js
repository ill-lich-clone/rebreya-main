import {
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_CONSTRUCT_TOKEN_PATH,
  CRAFTSMAN_CONSTRUCT_UUID,
  MODULE_ID
} from "../constants.js";

export const CRAFTSMAN_CONSTRUCT_FEATURE_ID = "craftsman-v01::specialty::craftsman-specialty-constructor::construct-assembly";

export const CRAFTSMAN_BODY_ASSEMBLIES = Object.freeze({
  STURDY: Object.freeze({
    id: "sturdy-body",
    label: "Крепкий корпус",
    descriptionMarkdown: "**Крепкий корпус.** Хиты Конструкта увеличиваются на значение равное вашему удвоенному уровню Ремесленника."
  }),
  POWERFUL_ARMS: Object.freeze({
    id: "powerful-arms",
    label: "Мощные руки",
    descriptionMarkdown: "**Мощные руки.** Значение Силы Конструкта увеличивается на 4."
  }),
  AIMING_TUNING: Object.freeze({
    id: "aiming-tuning",
    label: "Доводка прицела",
    descriptionMarkdown: "**Доводка прицела (1/ход).** Если конструкт промахивается дальнобойной или огнестрельной атакой, то он может с преимуществом перебросить эту атаку."
  }),
  MAGIC_CONDUIT: Object.freeze({
    id: "magic-conduit",
    label: "Проводник магии",
    descriptionMarkdown: "**Проводник магии.** Каждый раз, когда вы накладываете заклинание Ремесленника или заклинание с помощью магического предмета в свой ход, вы можете наложить его таким образом, словно вы находитесь в месте, где располагается Конструкт, и используете его чувства. Более того, вы можете использовать заклинание с временем накладывания Реакция, если Триггер нацелен на Конструкта, например заклинание Щит [Shield] подействует так, что увеличит КД Конструкта."
  })
});

export const CRAFTSMAN_COMBAT_MODES = Object.freeze({
  DUELIST: Object.freeze({ id: "duelist", label: "Дуэлянт" }),
  DEFENSE: Object.freeze({ id: "defense", label: "Защита" }),
  LIGHT_ARMOR: Object.freeze({ id: "light-armor", label: "Сражение в лёгком доспехе" }),
  MASSIVE_ARMOR: Object.freeze({ id: "massive-armor", label: "Сражение в массивных доспехах" }),
  GREAT_WEAPON: Object.freeze({ id: "great-weapon", label: "Сражение большим оружием" }),
  TWO_WEAPONS: Object.freeze({ id: "two-weapons", label: "Сражение двумя оружиями" }),
  ARCHERY: Object.freeze({ id: "archery", label: "Стрельба" }),
  BLIND_FIGHTING: Object.freeze({ id: "blind-fighting", label: "Сражение вслепую" }),
  INTERCEPTION: Object.freeze({ id: "interception", label: "Перехват" }),
  BORDERING_POTENTIAL: Object.freeze({ id: "bordering-potential", label: "Граничащий потенциал" })
});

export function buildCraftsmanConstructSummonAutomation(feature = {}) {
  const activityId = "lchconstructsumm";
  const activity = {
    _id: activityId,
    type: "summon",
    name: "Собрать Конструкта",
    img: CRAFTSMAN_CONSTRUCT_TOKEN_PATH,
    sort: 0,
    activation: { type: "special", value: null, condition: "После продолжительного отдыха", override: false },
    consumption: { scaling: { allowed: false, max: "" }, spellSlot: false, targets: [] },
    description: { chatFlavor: String(feature.description ?? "") },
    duration: { value: "", units: "inst", special: "", concentration: false, override: false },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        craftsmanConstructor: { kind: "constructSummon", version: 1 }
      }
    },
    range: { value: null, units: "self", special: "", override: false },
    target: {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
      affects: { count: "", type: "self", choice: false, special: "" },
      prompt: false,
      override: false
    },
    uses: { spent: 0, max: "", recovery: [] },
    bonuses: {
      ac: "@prof",
      hd: `@classes.${CRAFTSMAN_CLASS_IDENTIFIER}.levels`,
      hp: `5 * @classes.${CRAFTSMAN_CLASS_IDENTIFIER}.levels`,
      attackDamage: "",
      saveDamage: "",
      healing: ""
    },
    creatureSizes: ["med"],
    creatureTypes: ["construct"],
    match: { ability: "", attacks: false, disposition: true, proficiency: true, saves: false },
    profiles: [{
      _id: "lchconstructprof",
      count: "1",
      cr: "",
      level: { min: 3, max: null },
      name: "Конструкт",
      types: ["construct"],
      uuid: CRAFTSMAN_CONSTRUCT_UUID
    }],
    summon: { mode: "", prompt: true },
    visibility: { identifier: CRAFTSMAN_CLASS_IDENTIFIER, level: { min: 3, max: null } }
  };
  return { activities: { [activityId]: activity }, effects: [], usesRecovery: [] };
}
