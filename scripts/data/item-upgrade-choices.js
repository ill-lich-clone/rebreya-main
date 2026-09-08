import { UpgradeRuleError } from "./item-upgrade-rules.js?v=1.4.250";

const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const CHOICES = {
  "cheshuya-monstra": ["fire", "cold", "acid", "poison", "lightning"],
  "zacharovanie-pogloshcheniya": DAMAGE_TYPES
};

export function getUpgradeChoiceOptions(sourceId, damageTypes = Object.keys(globalThis.CONFIG?.DND5E?.damageTypes ?? Object.fromEntries(DAMAGE_TYPES.map(type => [type,true])))) {
  return (CHOICES[sourceId] ?? []).filter(type => damageTypes.includes(type));
}

/** Canonical validation shared by installation, projection and generated loot. */
export function validateUpgradeChoices(sourceId, choices, damageTypes) {
  const value = choices ?? {};
  const validObject = value && typeof value === "object" && !Array.isArray(value);
  const keys = validObject ? Object.keys(value) : [];
  if (CHOICES[sourceId]) {
    if (!validObject || keys.length !== 1 || keys[0] !== "damageType" || !getUpgradeChoiceOptions(sourceId,damageTypes).includes(value.damageType)) {
      throw new UpgradeRuleError("invalid-choice", { reason: "Требуется выбрать поддержанный тип поглощения урона." });
    }
    return { damageType: value.damageType };
  }
  if (!validObject || keys.length) throw new UpgradeRuleError("invalid-choice", { reason: "Этот профиль не допускает дополнительных параметров." });
  return {};
}
