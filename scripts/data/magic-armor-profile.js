const normalize = value => String(value ?? "").trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");

/** Resolve only a proven concrete catalog base; category templates remain unresolved. */
export function resolveMagicArmorProfile(item, gear = []) {
  const selectedId = item?.flags?.["rebreya-main"]?.magicEquipmentGearId;
  const subtype = normalize(item?.itemSubtype);
  const candidates = gear.filter(entry => entry?.armor && (selectedId
    ? entry.id === selectedId
    : subtype && normalize(entry.name) === subtype));
  if (candidates.length !== 1) return null;
  const base = candidates[0];
  if (!Number.isFinite(base.armor.value) || base.armor.value <= 0) return null;
  return {
    gearId: base.id,
    type: base.armor.type,
    baseItem: base.armor.baseItem ?? "",
    armor: { value: base.armor.value, dex: base.armor.dex ?? null },
    strength: base.armor.strength ?? 0,
    properties: [...(base.armor.properties ?? [])]
  };
}
