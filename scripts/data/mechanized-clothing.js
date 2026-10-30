export const MECHANIZED_CLOTHING_GEAR_ID = "mekhanizirovannaya-odezhda";

export function isMechanizedClothing(item) {
  const flags = item?.flags?.["rebreya-main"] ?? {};
  const id = flags.gearId ?? (flags.sourceType === "gear" ? flags.sourceId : null)
    ?? (item?.equipmentType === "Снаряжение" ? item.id : null);
  return id === MECHANIZED_CLOTHING_GEAR_ID;
}

export function getMechanizedClothingBonuses(actor) {
  const id = actor?.flags?.["rebreya-main"]?.heroDoll?.slots?.clothing?.itemId;
  const items = actor?.items;
  const item = id && (items?.get?.(id) ?? (Array.isArray(items) ? items : items?.contents ?? []).find(entry => (entry.id ?? entry._id) === id));
  const active = Boolean(item && isMechanizedClothing(item) && Number(item.system?.quantity ?? 1) > 0);
  return { strengthCheckBonus: active ? 1 : 0, capacityMultiplierBonus: active ? 1 : 0 };
}
