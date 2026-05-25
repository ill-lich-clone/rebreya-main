export const FIGHTER_SECOND_WIND_FEATURE_ID = "second-wind";
export const FIGHTER_IRON_WILL_FEATURE_ID = "iron-will";

const DOMINANCE_DAMAGE_MANEUVERS = new Set([
  "атака с выпадом",
  "атака с маневром",
  "атака с угрозой",
  "атака с финтом",
  "опрокидывающая атака",
  "ответный удар",
  "отвлекающий удар",
  "провоцирующая атака",
  "толкающая атака",
  "удар командующего",
  "широкая атака",
  "быстрый бросок",
  "готовность",
  "жестокий удар"
]);

const MANEUVER_STATUS_AUTOMATION = {
  "атака с угрозой": {
    id: "frightened",
    value: 2,
    durationRounds: 1,
    saveAbility: "wis"
  },
  "отвлекающий удар": {
    id: "rebreya-open-position",
    durationRounds: 1
  },
  "провоцирующая атака": {
    id: "rebreya-provoked",
    value: 1,
    durationRounds: 1,
    saveAbility: "wis"
  }
};

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

export function normalizeFighterAutomationKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function fighterDominanceDieFormula(classIdentifier) {
  return `@scale.${cleanText(classIdentifier, "fighter-rework-v028")}.dominance-die`;
}

export function getFighterManeuverAutomation(name, classIdentifier) {
  const key = normalizeFighterAutomationKey(name);
  const automation = {
    kind: "maneuver",
    key
  };

  if (DOMINANCE_DAMAGE_MANEUVERS.has(key)) {
    automation.extraDamage = {
      formula: fighterDominanceDieFormula(classIdentifier)
    };
  }

  const status = MANEUVER_STATUS_AUTOMATION[key];
  if (status) {
    automation.status = {
      id: status.id,
      ...(Object.hasOwn(status, "value") ? { value: status.value } : {}),
      durationRounds: status.durationRounds
    };
    if (status.saveAbility) {
      automation.saveAbility = status.saveAbility;
    }
  }

  return automation;
}

export function getFighterSecondWindAutomation() {
  return {
    kind: "secondWind",
    die: "d6",
    maxDiceAbility: "con",
    minDice: 1
  };
}

export function fighterSecondWindUsesMax(classIdentifier) {
  void classIdentifier;
  return "@details.level";
}

export function getFighterIronWillAutomation() {
  return {
    kind: "ironWill"
  };
}
