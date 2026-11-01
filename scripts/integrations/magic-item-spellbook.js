import { MODULE_ID } from "../constants.js";
import { isMagicItem } from "../shared/magic-item-classification.js?v=1.5.47";

const registeredHooks = new WeakSet();
export function filterMagicItemSpellbook(actor, context) {
  const section = context?.spellbook?.item;
  if (actor?.type !== "character" || !Array.isArray(section?.items)) return;
  const slots = actor.getFlag?.(MODULE_ID, "heroDoll")?.slots ?? actor.flags?.[MODULE_ID]?.heroDoll?.slots ?? {};
  const equipped = new Set(Object.values(slots).map(slot => slot?.itemId).filter(Boolean));
  section.items = section.items.filter(spell => {
    const cachedFor = spell.getFlag?.("dnd5e", "cachedFor") ?? spell.flags?.dnd5e?.cachedFor;
    const item = cachedFor ? spell.system?.linkedActivity?.item : null;
    return !isMagicItem(item) || equipped.has(item.id);
  });
}

export function registerMagicItemSpellbookHook(hooks = globalThis.Hooks) {
  if (!hooks?.on || registeredHooks.has(hooks)) return;
  registeredHooks.add(hooks);
  hooks.on("dnd5e.prepareSheetContext", (sheet, partId, context) => {
    if (partId === "spells") filterMagicItemSpellbook(sheet?.actor, context);
  });
}
