import { getItemHeldHands, getActorHandSlots, getActorHandReservations, isItemEquipped } from "../integrations/held-items.js?v=1.5.29";
import { isBrokenDurabilityItem } from "../integrations/durability-hooks.js?v=1.5.19";

export const CLASS_SPELLCASTING_ITEM_FAMILIES = Object.freeze({
  "универсальный-инструмент": { classes: ["artificer"], held: true, manual: "Владение выбранным инструментом и выбранный заговор остаются ручными." },
  "магический-гримуар": { classes: ["wizard"], held: true, manual: "Дополнительный уровень ячеек Магического восстановления учитывается вручную." },
  "флакон-с-кровью": { classes: ["sorcerer"], held: false, carried: true, manual: "Восстановление 5 единиц чародейства при расходе Кости Хитов остаётся ручным." },
  "амулет-благочестия": { classes: ["cleric"], held: false, manual: "Actor-resource Божественного канала изменяется вручную." },
  "барабан-задающего-ритм": { classes: ["bard"], held: true, manual: "Игра на барабане остаётся ручной; восстановление вдохновения обрабатывает прежний compatibility-service." },
  "лунный-серп": { classes: ["druid", "ranger"], held: true, manual: "Дополнительное лечение заклинаниями остаётся ручным." },
  "жезл-хранителя-договора": { classes: ["warlock"], held: true, manual: "Выбор восстанавливаемой ячейки остаётся ручным." }
});

export function equipmentCollectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return [...collection.values()];
  return Object.values(collection ?? {});
}

export function getClassSpellcastingItemDefinition(id) {
  const match = String(id ?? "").match(/^(.*)-([123])$/u);
  const definition = CLASS_SPELLCASTING_ITEM_FAMILIES[match?.[1]];
  return definition ? { ...definition, family: match[1], bonus: Number(match[2]) } : null;
}

/** Class identity comes from the linked class document, never from the casting ability. */
export function getClassSpellcastingItemBonus(spell) {
  if (spell?.type !== "spell") return 0;
  const actor = spell.actor ?? spell.parent;
  const sourceClass = spell.system?.sourceClass;
  if (!sourceClass || !actor) return 0;
  const linkedClass = actor.spellcastingClasses?.[sourceClass]
    ?? equipmentCollectionValues(actor.items).find(item => item.type === "class" && item.system?.identifier === sourceClass);
  const identifier = linkedClass?.system?.identifier ?? linkedClass?.identifier;
  const cls = identifier === "sorcerer-rework-v011" ? "sorcerer" : identifier;
  if (!cls) return 0;
  const validHands = new Set(getActorHandSlots(actor));
  const reserved = new Set(getActorHandReservations(actor).map(entry => entry.handSlot));
  const bonuses = new Map();
  for (const item of equipmentCollectionValues(actor.items)) {
    const flags = item?.flags?.["rebreya-main"] ?? {};
    const id = flags.magicItemId ?? (flags.sourceType === "magicItem" ? flags.sourceId : "");
    const definition = getClassSpellcastingItemDefinition(id);
    if (!definition?.classes.includes(cls) || (!definition.carried && !isItemEquipped(item))
      || item.system?.attuned !== true || isBrokenDurabilityItem(item)) continue;
    if (definition.held && !getItemHeldHands(item).some(hand => validHands.has(hand) && !reserved.has(hand))) continue;
    bonuses.set(definition.family, Math.max(bonuses.get(definition.family) ?? 0, definition.bonus));
  }
  return [...bonuses.values()].reduce((sum, bonus) => sum + bonus, 0);
}
