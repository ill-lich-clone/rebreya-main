const damage = (formula, type = null, condition = null) => ({ scope: "roll", operation: "damage-add", formula, type, condition });
const attack = value => ({ scope: "roll", operation: "attack-add", value });
const versus = (...types) => ({ creatureTypes: types });
export const SIMPLE_UPGRADE_ROLL_PROFILES = Object.freeze({
  "maloe-zacharovanie-ostroty": [damage("1")],
  "sukhozhilie-chudovishcha": [damage("1")],
  "zacharovanie-ostroty": [attack(1), damage("1")],
  "ognennaya-maz": [damage("1d6", "fire")],
  "ledyanaya-maz": [damage("1d6", "cold")],
  "zacharovanie-nekromantii": [damage("1d3", "necrotic")],
  "dyavolskoe-zhelezo": [damage("2", null, versus("celestial"))],
  "elfiyskaya-stal": [damage("2", null, versus("undead"))],
  "iskazhayushchaya-stal": [damage("2", null, versus("elemental"))],
  "kristally-zabytykh-titanov": [damage("2", null, versus("giant", "fiend"))],
  "korichnevaya-stal": [{ ...attack(2), condition: versus("humanoid") }],
  "kosti-mantikory": [damage("1d4", "poison", versus("humanoid"))],
  "nochnaya-stal": [{ scope: "roll", operation: "attack-advantage", condition: { passiveBelow: 12 } }],
  "oskolki-meteoritnykh-zvyozd": [damage("2", null, { resolvedAdvantage: true })]
});

function matches(condition, attack, target) {
  if (!condition) return true;
  if (condition.creatureTypes) return typeof target?.type === "string" && target.type
    ? condition.creatureTypes.includes(target.type) : null;
  if (condition.passiveBelow != null) return Number.isFinite(target?.passivePerception) ? target.passivePerception < condition.passiveBelow : null;
  if (condition.resolvedAdvantage) return typeof attack.advantage === "boolean" ? attack.advantage : null;
  return null;
}

/** Only this weapon and this primary packet; native critical processing remains responsible for extra dice. */
export function evaluateSimpleUpgradeRoll({ host, attack, target = null, contributions }) {
  const result = { attackBonus: 0, advantage: false, damageParts: [], properties: [], diagnostics: [] };
  for (const contribution of contributions) {
    if (contribution.hostItemId !== host.id || contribution.scope !== "roll") continue;
    if (contribution.operation === "damage-add" && attack.primary !== true) continue;
    const applies = matches(contribution.condition, attack, target);
    if (applies === null) {
      result.diagnostics.push({ sourceId: contribution.sourceId, reason: "Неизвестен тип/Восприятие цели или итоговое преимущество этой атаки." }); continue;
    }
    if (!applies) continue;
    if (contribution.operation === "attack-add") result.attackBonus += contribution.value;
    if (contribution.operation === "attack-advantage") result.advantage = true;
    if (contribution.operation === "damage-add") result.damageParts.push({ key: contribution.key, formula: contribution.formula, type: contribution.type });
  }
  return result;
}
