import { equipmentCollectionValues, getClassSpellcastingItemBonus } from "../data/equipment-bonuses.js?v=1.5.27";
import { getMechanizedClothingBonuses } from "../data/mechanized-clothing.js?v=1.5.27";
export { getMechanizedClothingBonuses } from "../data/mechanized-clothing.js?v=1.5.27";
export { CLASS_SPELLCASTING_ITEM_FAMILIES, getClassSpellcastingItemBonus } from "../data/equipment-bonuses.js?v=1.5.27";

const ITEM_PATCH = Symbol.for("rebreya-main.equipment-bonus-item");
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

export function applyClassSpellcastingItemBonuses(item) {
  if (item?.type !== "spell") return;
  const bonus = getClassSpellcastingItemBonus(item);
  for (const activity of equipmentCollectionValues(item.system?.activities)) {
    if (activity.type === "attack" && activity.attack) {
      addPreparedBonus(activity.attack, "bonus", activity.attack.flat ? 0 : bonus);
    }
    const dc = activity.save?.dc;
    if (dc?.calculation) {
      const hadContribution = contributions.has(dc);
      addPreparedBonus(dc, "bonus", bonus);
      // This value is derived from the actor; native final preparation caches it between calls.
      if (bonus || hadContribution) dc.value = undefined;
    }
  }
}

export function registerEquipmentBonusPatches({ CONFIG = globalThis.CONFIG, game = globalThis.game } = {}) {
  const result = { item: false, actors: [] };
  if (game?.system?.id !== "dnd5e") return result;
  const prototype = CONFIG?.Item?.documentClass?.prototype;
  if (prototype && !prototype[ITEM_PATCH] && typeof prototype.prepareFinalAttributes === "function") {
    const original = prototype.prepareFinalAttributes;
    prototype.prepareFinalAttributes = function (...args) {
      applyClassSpellcastingItemBonuses(this);
      return original.apply(this, args);
    };
    Object.defineProperty(prototype, ITEM_PATCH, { value: true });
    result.item = true;
  }
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
