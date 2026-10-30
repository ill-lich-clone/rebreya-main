import { getMechanizedClothingBonuses } from "../data/mechanized-clothing.js?v=1.5.29";
export { getMechanizedClothingBonuses } from "../data/mechanized-clothing.js?v=1.5.29";

const ACTOR_PATCH = Symbol.for("rebreya-main.equipment-bonus-actor");
const contributions = new WeakMap();
function setPreparedContribution(target, key, active, format) {
  if (!target) return;
  const previous = contributions.get(target);
  if (previous && target[key] === previous.after) target[key] = previous.before;
  contributions.delete(target);
  if (!active) return;
  const before = target[key];
  const after = format(before);
  target[key] = after;
  contributions.set(target, { before, after });
}
function addPreparedBonus(target, key, bonus) {
  setPreparedContribution(target, key, bonus, before => before ? `(${before}) + ${bonus}` : String(bonus));
}

export function registerEquipmentBonusPatches({ CONFIG = globalThis.CONFIG, game = globalThis.game } = {}) {
  const result = { item: false, actors: [] };
  if (game?.system?.id !== "dnd5e") return result;
  for (const type of ["character", "npc"]) {
    const model = CONFIG?.Actor?.dataModels?.[type]?.prototype;
    if (!model || model[ACTOR_PATCH] || typeof model.prepareDerivedData !== "function") continue;
    const original = model.prepareDerivedData;
    model.prepareDerivedData = function (...args) {
      const bonus = getMechanizedClothingBonuses(this.parent);
      addPreparedBonus(this.abilities?.str?.bonuses, "check", bonus.strengthCheckBonus);
      setPreparedContribution(this.attributes?.encumbrance?.multipliers, "maximum", bonus.capacityMultiplierBonus,
        before => `(${before || "1"}) + (1 / 15)`);
      return original.apply(this, args);
    };
    Object.defineProperty(model, ACTOR_PATCH, { value: true });
    result.actors.push(type);
  }
  return result;
}
