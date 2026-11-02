import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const SHIELD_SOURCE_UUID = "Compendium.dnd5e.spells.Item.z1mx84ONwkXKUZd7";
export const MISSILE_REACTION_CONDITION = 'typeof reaction === "undefined" || reaction === "isHit" || (reaction === "isDamaged" && workflow.item.system.identifier === "magic-missile")';

export function isManagedShield(item) {
  return item?.type === "spell" && item.flags?.[MODULE_ID]?.shieldReaction?.version === 1;
}

export function isShieldReactionItem(item) {
  return isManagedShield(item) || (item?.type === "spell" && item.system?.identifier === "shield"
    && item.flags?.["chris-premades"]?.info?.identifier === "shield");
}

export function hasShieldEffect(actor) {
  return Array.from(actor?.effects?.contents ?? actor?.effects?.values?.() ?? actor?.effects ?? [])
    .some(effect => !effect.disabled && !effect.isSuppressed && !effect.duration?.expired
      && (effect.flags?.["chris-premades"]?.info?.identifier === "shield"
        || effect.flags?.cat?.identifier === "shield"
        || effect.flags?.[MODULE_ID]?.shieldReaction?.version === 1));
}

export async function expireV13ShieldAtTurnStart(actor) {
  const effects = Array.from(actor?.effects?.contents ?? actor?.effects?.values?.() ?? []);
  const ids = effects.filter(effect => effect.flags?.[MODULE_ID]?.shieldReaction?.version === 1).map(effect => effect.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

export function buildShieldSpellItem(sourceData, { description = "" } = {}) {
  const data = globalThis.foundry?.utils?.deepClone?.(sourceData) ?? structuredClone(sourceData);
  const barrier = data?.effects?.find(effect => (effect.system?.changes ?? effect.changes)?.some(change =>
    change.key === "system.attributes.ac.bonus" && Number(change.value) === 5));
  const cast = Object.values(data?.system?.activities ?? {}).find(activity => activity.effects?.some(ref => ref._id === barrier?._id));
  if (data?.type !== "spell" || data.system?.identifier !== "shield" || !barrier || !cast) {
    throw new Error("Не найден корректный источник заклинания «Щит» (Shield).");
  }
  barrier.disabled = false;
  barrier.flags ??= {};
  barrier.flags[MODULE_ID] = { ...barrier.flags[MODULE_ID], shieldReaction: { version: 1 } };
  if (barrier.system?.changes) barrier.duration = { ...barrier.duration, value: null, expiry: "targetStart" };
  cast.useConditionText = cast.useConditionText || MISSILE_REACTION_CONDITION;
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
    if (!source) throw new Error("Не найден источник «Щита» (Shield) в dnd5e.spells.");
    return itemClass.create(buildShieldSpellItem(source.toObject()));
  });
}
