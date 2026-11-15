import { MODULE_ID } from "../constants.js";
import { HOLY_WEAPON_CAST_ID, HOLY_WEAPON_IDENTIFIER, supportsHolyWeaponRepair } from "../data/holy-weapon-spell-item.js?v=1.5.95";

const installed = new WeakSet();

function isHolyWeapon(activity, role) {
  return activity?.type === (role === "cast" ? "enchant" : "save")
    && activity.item?.system?.identifier === HOLY_WEAPON_IDENTIFIER
    && activity.flags?.[MODULE_ID]?.holyWeapon === role;
}

function concentrationForCast(cast, uuid, enchantments) {
  for (const effect of cast?.actor?.concentration?.effects ?? []) {
    const source = effect.flags?.dnd5e;
    if (effect.active && source?.item?.uuid === cast.item.uuid && source?.activity?.id === cast.id
      && (uuid == null || effect.uuid === uuid) && (enchantments == null || hasEnchantedWeapon(enchantments, effect))) return effect;
  }
  return null;
}

function hasEnchantedWeapon(enchantments, concentration) {
  return enchantments.some(effect => effect.active && effect.flags?.dnd5e?.dependentOn === concentration.uuid);
}

export function registerHolyWeaponHooks({ Hooks = globalThis.Hooks, game = globalThis.game,
  warn = (text) => globalThis.ui?.notifications?.warn(text), logger = console } = {}) {
  if (!Hooks?.on || !supportsHolyWeaponRepair(game) || installed.has(game)) return;
  installed.add(game);
  const dismissals = new WeakMap();
  const ending = new Set();
  const activeConcentration = (activity, uuid) => {
    const cast = activity.item.system.activities.get(HOLY_WEAPON_CAST_ID);
    return isHolyWeapon(cast, "cast") ? concentrationForCast(cast, uuid, cast.appliedEnchantments) : null;
  };

  Hooks.on("dnd5e.preBeginConcentrating", (_actor, _item, data, activity) => {
    // A timed dnd5e activity defaults to the actor's next turn-start expiry gate.
    if (isHolyWeapon(activity, "cast") && data.duration) data.duration.expiry = null;
  });

  Hooks.on("dnd5e.preApplyEnchantment", (weapon, data, { activity } = {}) => {
    if (!isHolyWeapon(activity, "cast")) return true;
    const dependency = data.flags?.dnd5e?.dependentOn;
    const concentration = dependency && concentrationForCast(activity, dependency);
    if (weapon.type === "weapon" && concentration && !hasEnchantedWeapon(activity.appliedEnchantments, concentration)) return true;
    warn("Священное оружие можно наложить на одно оружие, пока держится концентрация этого заклинания.");
    return false;
  });

  Hooks.on("dnd5e.preUseActivity", (activity, usage) => {
    if (!isHolyWeapon(activity, "dismiss")) return true;
    const concentration = activeConcentration(activity);
    if (!concentration || ending.has(concentration.uuid)) {
      warn("Для вспышки нужно оружие под действием вашего «Священного оружия».");
      return false;
    }
    dismissals.set(usage, concentration.uuid);
    return true;
  });

  Hooks.on("dnd5e.preActivityConsumption", (activity, usage) => {
    if (!isHolyWeapon(activity, "dismiss")) return true;
    const uuid = dismissals.get(usage);
    return Boolean(uuid && !ending.has(uuid) && activeConcentration(activity, uuid));
  });

  Hooks.on("dnd5e.postUseActivity", async (activity, usage) => {
    if (!isHolyWeapon(activity, "dismiss")) return;
    const uuid = dismissals.get(usage);
    if (!uuid) return;
    dismissals.delete(usage);
    const concentration = activeConcentration(activity, uuid);
    if (!concentration || ending.has(uuid)) return;
    ending.add(uuid);
    try {
      await activity.actor.endConcentration(concentration.id);
    } catch (error) {
      logger.error(`${MODULE_ID} | Failed to end Holy Weapon concentration.`, error);
    } finally {
      ending.delete(uuid);
    }
  });
}
