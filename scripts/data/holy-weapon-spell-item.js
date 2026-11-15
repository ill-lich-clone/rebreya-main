import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const HOLY_WEAPON_IDENTIFIER = "svyashennoe-oruzhie--holy-weapon";
export const HOLY_WEAPON_CAST_ID = "rebreyaHolyCast1";
const ENCHANTMENT_ID = "rebreyaHolyEnch1";

export function supportsHolyWeaponRepair(game) {
  return game?.release?.generation >= 14 && game.system?.id === "dnd5e" && /^6\./u.test(game.system.version);
}

export function buildHolyWeaponRepair(source) {
  const system = source?.system;
  if (source?.type !== "spell" || system?.identifier !== HOLY_WEAPON_IDENTIFIER || source.effects?.length) return null;
  if (system.activation?.type !== "bonus" || system.duration?.units !== "hour" || Number(system.duration.value) !== 1) return null;
  const activities = Object.entries(system.activities ?? {});
  if (activities.length !== 1) return null;
  const [[saveId, original]] = activities;
  if (saveId === HOLY_WEAPON_CAST_ID || original.type !== "save" || original.effects?.length
    || original.damage?.parts?.length !== 2) return null;
  if (!system.properties?.includes("concentration") && !system.duration.concentration && !original.duration?.concentration) return null;

  const dismiss = structuredClone(original);
  dismiss.name = "Завершить вспышкой";
  dismiss.sort = 100000;
  dismiss.activation = { ...dismiss.activation, type: "bonus", value: 1, override: true };
  dismiss.consumption = { ...dismiss.consumption, spellSlot: false };
  dismiss.duration = { units: "inst", override: true, concentration: false };
  dismiss.flags = { ...dismiss.flags, [MODULE_ID]: { ...dismiss.flags?.[MODULE_ID], holyWeapon: "dismiss" } };

  const cast = {
    _id: HOLY_WEAPON_CAST_ID, type: "enchant", name: "Освятить оружие", sort: 0,
    activation: structuredClone(system.activation), consumption: { spellSlot: true },
    duration: { ...system.duration, override: true, concentration: true },
    range: { units: "touch", override: true },
    target: { override: true, prompt: false, affects: { type: "object", count: "1" } },
    enchant: { self: false }, restrictions: { type: "weapon", allowMagical: true },
    effects: [{ _id: ENCHANTMENT_ID }], flags: { [MODULE_ID]: { holyWeapon: "cast" } }
  };
  const effect = {
    _id: ENCHANTMENT_ID, type: "enchantment", name: source.name, img: source.img,
    transfer: false, disabled: false,
    system: { magical: true, changes: [
      { key: "system.properties", type: "add", value: "mgc" },
      { key: "activities[attack].damage.parts", type: "add", value: { number: 2, denomination: 8, types: ["radiant"] } }
    ] }
  };
  return { system: { activities: { [cast._id]: cast, [saveId]: dismiss } }, effects: [effect] };
}

export async function syncHolyWeaponSpells(game, { logger = console } = {}) {
  if (!supportsHolyWeaponRepair(game) || !isActiveGmClient(game)) return;
  const repair = async (items) => {
    for (const item of items?.contents ?? []) {
      if (item.type !== "spell" || item.system?.identifier !== HOLY_WEAPON_IDENTIFIER) continue;
      if (!isActiveGmClient(game)) return;
      try {
        const patch = buildHolyWeaponRepair(item.toObject());
        if (patch) await item.update(patch);
      } catch (error) {
        logger.error(`${MODULE_ID} | Failed to repair Holy Weapon on ${item.uuid ?? item.id}.`, error);
      }
    }
  };
  await repair(game.items);
  for (const actor of game.actors?.contents ?? []) {
    if (!isActiveGmClient(game)) return;
    await repair(actor.items);
  }
}
