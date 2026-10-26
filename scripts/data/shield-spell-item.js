import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const SHIELD_SOURCE_UUID = "Compendium.chris-premades.CPRSpells.Item.RpVLINL74RjPDkC4";
const DESCRIPTION_UUID = "Compendium.dnd5e.spells.Item.z1mx84ONwkXKUZd7";

export function isManagedShield(item) {
  return item?.type === "spell" && item.flags?.[MODULE_ID]?.shieldReaction?.version === 1;
}

export function hasShieldEffect(actor) {
  return Array.from(actor?.effects?.contents ?? actor?.effects?.values?.() ?? actor?.effects ?? [])
    .some(effect => !effect.disabled && !effect.isSuppressed && !effect.duration?.expired
      && (effect.flags?.["chris-premades"]?.info?.identifier === "shield"
        || effect.flags?.[MODULE_ID]?.shieldReaction?.version === 1));
}

export function buildShieldSpellItem(sourceData, { description = "" } = {}) {
  if (sourceData?.type !== "spell" || sourceData.system?.identifier !== "shield"
    || !Object.values(sourceData.system?.activities ?? {}).some(activity => activity.effects?.some(ref =>
      sourceData.effects?.some(effect => effect._id === ref._id && effect.changes?.some(change =>
        change.key === "system.attributes.ac.bonus" && Number(change.value) === 5))))) {
    throw new Error("Не найден корректный источник заклинания «Щит» (Shield).");
  }
  const data = globalThis.foundry?.utils?.deepClone?.(sourceData) ?? structuredClone(sourceData);
  delete data._id;
  delete data.folder;
  data.name = "Щит";
  data.flags ??= {};
  data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], shieldReaction: { version: 1 } };
  if (!data.system.description?.value) {
    data.system.description = { ...data.system.description, value: description };
  }
  return data;
}

export async function ensureWorldShieldSpell({ game, coordinator, resolveUuid, itemClass }) {
  if (!isActiveGmClient(game)) throw new Error("Импорт «Щита» доступен только активному ведущему (GM).");
  return coordinator.run("shield-world-item", async () => {
    const existing = Array.from(game.items?.contents ?? game.items?.values?.() ?? game.items ?? []).find(isManagedShield);
    if (existing) return existing;
    const source = await resolveUuid(SHIELD_SOURCE_UUID);
    if (!source) throw new Error("Не найден источник «Щита» (Shield) в CPRSpells.");
    const sourceData = source.toObject();
    const fallback = sourceData.system?.description?.value ? null : await resolveUuid(DESCRIPTION_UUID);
    return itemClass.create(buildShieldSpellItem(sourceData, {
      description: fallback?.system?.description?.value || fallback?.toObject?.()?.system?.description?.value || ""
    }));
  });
}
