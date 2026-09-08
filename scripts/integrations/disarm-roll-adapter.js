import { buildDisarmAttackFormula, DisarmError } from "../combat/disarm-rules.js?v=1.4.252";

/** dnd5e 5.2.5: source ability values and WeaponData.proficiencyMultiplier; never derived attack totals. */
export function buildDisarmRollPlan({ actor, weapon, mode, context = {} }) {
  if (weapon?.type !== "weapon" || !["melee", "ranged", "thrown"].includes(mode)) throw new DisarmError("invalid-weapon-mode");
  const source = actor?.toObject?.()?.system;
  const properties = new Set(weapon.system?.properties ?? []);
  const scores = source?.abilities;
  const ability = mode === "ranged" || (properties.has("fin") && scores?.dex?.value > scores?.str?.value) ? "dex" : "str";
  const unresolvedModifiers = [];
  const baseline = context.baseline;
  const score = baseline?.abilityScore ?? scores?.[ability]?.value;
  if (!baseline && score !== actor?.system?.abilities?.[ability]?.value) unresolvedModifiers.push("ability-baseline");
  const multiplier = weapon.system?.proficiencyMultiplier ?? weapon.system?.proficient;
  const prof = actor?.system?.attributes?.prof;
  const proficiencyContribution = baseline?.proficiencyContribution ??
    (Number.isFinite(multiplier) && Number.isFinite(prof) ? Math.floor(multiplier * prof) : NaN);
  if (!Number.isSafeInteger(score) || score < 1 || score > 99) unresolvedModifiers.push("ability-baseline");
  if (!Number.isSafeInteger(proficiencyContribution) || proficiencyContribution < 0 || proficiencyContribution > 30) unresolvedModifiers.push("proficiency-baseline");
  const effects = Array.from(actor?.appliedEffects ?? actor?.effects?.contents ?? actor?.effects ?? []).filter(e => !e.disabled && !e.isSuppressed);
  if (!baseline && effects.some(e => (e.changes ?? []).some(c => /system\.attributes\.prof|system\.traits\.weaponProf/u.test(c.key)))) unresolvedModifiers.push("proficiency-baseline");
  const abilityModifier = Math.floor((score - 10) / 2);
  return { formula: unresolvedModifiers.length ? null : buildDisarmAttackFormula({ abilityModifier, proficiencyContribution }),
    ability, abilityModifier, proficiencyContribution,
    excludedModifiers: ["Качество и магический бонус оружия", "Временные бонусы атаки", "Бонусы черт и классов"],
    unresolvedModifiers: [...new Set(unresolvedModifiers)] };
}

function serialize(roll) {
  if (!Number.isFinite(roll?.total)) throw new DisarmError("ambiguous-roll", "Бросок не вернул подтверждённый результат.");
  return { total: roll.total, json: roll.toJSON() };
}
export class DisarmRollAdapter {
  constructor({ RollClass = globalThis.Roll } = {}) { this.RollClass = RollClass; }
  async attack(plan, mode) {
    if (!plan.formula || !["normal", "advantage", "disadvantage"].includes(mode)) throw new DisarmError("unresolved-roll-plan");
    const dice = mode === "advantage" ? "2d20kh" : mode === "disadvantage" ? "2d20kl" : "1d20";
    return serialize(await new this.RollClass(plan.formula.replace(/^1d20/u, dice)).evaluate());
  }
  async save(actor, ability, mode) {
    if (!["str", "dex"].includes(ability) || !["normal", "advantage", "disadvantage"].includes(mode)) throw new DisarmError("invalid-save");
    const rolls = await actor.rollSavingThrow({ ability, rolls: [{ options: { advantage: mode === "advantage", disadvantage: mode === "disadvantage" } }] },
      { configure: false }, { create: false });
    return serialize(rolls?.[0]);
  }
  async direction(count) {
    if (!Number.isInteger(count) || count < 1 || count > 32) throw new DisarmError("invalid-drop-points");
    return serialize(await new this.RollClass(`1d${count}`).evaluate());
  }
}
