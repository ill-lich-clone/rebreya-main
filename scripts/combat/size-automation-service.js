import { MODULE_ID } from "../constants.js";

const EFFECT_MODE_ADD = globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;

const CHARACTER_SIZE_RULES = Object.freeze({
  tiny: Object.freeze({
    size: "tiny",
    label: "Крошечный",
    ac: 2,
    strengthChecks: -2,
    dexterityChecks: 2,
    baseReachFeet: 0
  }),
  sm: Object.freeze({
    size: "sm",
    label: "Маленький",
    ac: 1,
    strengthChecks: -1,
    dexterityChecks: 1,
    baseReachFeet: 5
  }),
  med: Object.freeze({
    size: "med",
    label: "Средний",
    ac: 0,
    strengthChecks: 0,
    dexterityChecks: 0,
    baseReachFeet: 5
  }),
  lg: Object.freeze({
    size: "lg",
    label: "Большой",
    ac: -1,
    strengthChecks: 1,
    dexterityChecks: -1,
    baseReachFeet: 10
  }),
  huge: Object.freeze({
    size: "huge",
    label: "Огромный",
    ac: -2,
    strengthChecks: 2,
    dexterityChecks: -2,
    baseReachFeet: 15
  }),
  grg: Object.freeze({
    size: "grg",
    label: "Громадный",
    ac: -3,
    strengthChecks: 3,
    dexterityChecks: -3,
    baseReachFeet: 20
  })
});

export function getCharacterSizeRule(size) {
  const normalized = String(size ?? "").trim().toLowerCase();
  return CHARACTER_SIZE_RULES[normalized] ?? CHARACTER_SIZE_RULES.med;
}

export function buildCharacterSizeEffectData(size) {
  const rule = getCharacterSizeRule(size);
  if (rule.size === "med") {
    return null;
  }

  return {
    name: `Размер существа: ${rule.label}`,
    img: "icons/svg/upgrade.svg",
    disabled: false,
    transfer: false,
    changes: [
      {
        key: "system.attributes.ac.bonus",
        mode: EFFECT_MODE_ADD,
        value: String(rule.ac),
        priority: 20
      },
      {
        key: "system.abilities.str.bonuses.check",
        mode: EFFECT_MODE_ADD,
        value: String(rule.strengthChecks),
        priority: 20
      },
      {
        key: "system.abilities.dex.bonuses.check",
        mode: EFFECT_MODE_ADD,
        value: String(rule.dexterityChecks),
        priority: 20
      }
    ],
    flags: {
      [MODULE_ID]: {
        sizeAutomation: {
          managed: true,
          size: rule.size
        }
      }
    }
  };
}
