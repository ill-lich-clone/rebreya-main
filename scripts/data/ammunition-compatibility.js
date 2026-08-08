import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const WEAPON_SUBTYPE_BY_BASE_ITEM = new Map([
  ["shortbow", "arrow"],
  ["longbow", "arrow"],
  ["lightcrossbow", "crossbowBolt"],
  ["handcrossbow", "crossbowBolt"],
  ["heavycrossbow", "crossbowBolt"],
  ["blowgun", "blowgunNeedle"],
  ["sling", "slingBullet"]
]);

const WEAPON_SUBTYPE_BY_GEAR_ID = new Map([
  ["korotkiy-luk", "arrow"],
  ["dlinnyy-luk", "arrow"],
  ["luk-vsadnika", "arrow"],
  ["kompozitnyy-luk", "arrow"],
  ["arbalet-legkiy", "crossbowBolt"],
  ["arbalet-ruchnoy", "crossbowBolt"],
  ["arbalet-tyazhelyy", "crossbowBolt"],
  ["mnogozaryadnyy-arbalet", "crossbowBolt"],
  ["dukhovaya-trubka", "blowgunNeedle"],
  ["prashcha", "slingBullet"]
]);

const AMMUNITION_SUBTYPES = new Set([
  "arrow",
  "crossbowBolt",
  "blowgunNeedle",
  "slingBullet",
  "firearmBullet"
]);

const FIREARM_AMMUNITION_GEAR_IDS = new Set([
  "toplivnyy-bak-1",
  "raketnyy-vystrel-3",
  "batareya-4",
  "zaryad-antimaterii-20",
  "teplovaya-batareya-20",
  "broneboynyy-10",
  "standartnyy-10",
  "udarnyy-10",
  "sbivayushchiy-5",
  "dymchatyy-5",
  "dymovoy-3",
  "podzhigayushchiy-10",
  "osveshchyayushchiy-10"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return clean(value).toLocaleLowerCase("ru-RU");
}

function getProperty(source, path) {
  return globalThis.foundry?.utils?.getProperty?.(source, path)
    ?? String(path ?? "").split(".").reduce((value, key) => value?.[key], source);
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return [];
}

function collectionEntries(collection) {
  if (!collection) return [];
  if (typeof collection.entries === "function") return Array.from(collection.entries());
  if (Array.isArray(collection)) {
    return collection.map((value, index) => [documentId(value) || String(index), value]);
  }
  if (typeof collection === "object") return Object.entries(collection);
  return [];
}

function moduleFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key)
    ?? getProperty(document, `flags.${MODULE_ID}.${key}`);
}

function documentId(document) {
  return clean(document?.id ?? document?._id);
}

function itemProperties(item) {
  const properties = getProperty(item, "system.properties")
    ?? getProperty(item, "weapon.properties")
    ?? [];
  if (Array.isArray(properties)) return properties;
  if (properties instanceof Set) return Array.from(properties);
  if (Array.isArray(properties?.value)) return properties.value;
  if (properties && typeof properties === "object") {
    return Object.entries(properties).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key);
  }
  return [];
}

function weaponBaseItem(item) {
  return clean(
    getProperty(item, "system.type.baseItem")
    ?? item?.foundryBaseItem
    ?? moduleFlag(item, "foundryBaseItem")
  ).toLowerCase();
}

function gearId(item) {
  return clean(
    moduleFlag(item, "gearId")
    ?? moduleFlag(item, "sourceId")
    ?? item?.gearId
    ?? item?.id
  ).toLowerCase();
}

function inferAmmunitionSubtypeFromIdentity(item) {
  const id = gearId(item);
  const name = normalized(item?.name);
  if (/strel|arrow/u.test(id) || /стрел/u.test(name)) return "arrow";
  if (/bolt/u.test(id) || /болт/u.test(name)) return "crossbowBolt";
  if (/igl.*trub|needle/u.test(id) || (/игл/u.test(name) && /труб/u.test(name))) return "blowgunNeedle";
  if (/prash|sling/u.test(id) || /пращ/u.test(name)) return "slingBullet";
  if (
    FIREARM_AMMUNITION_GEAR_IDS.has(id)
    || /patron|pul|mushket|firearm/u.test(id)
    || /патрон|пул|мушкет/u.test(name)
    || ["боеприпас", "боеприпасы"].includes(normalized(moduleFlag(item, "equipmentType") ?? item?.equipmentType))
  ) return "firearmBullet";
  return "";
}

export function inferWeaponAmmunitionSubtype(item) {
  const properties = itemProperties(item);
  if (!properties.includes("amm")) return "";
  return WEAPON_SUBTYPE_BY_BASE_ITEM.get(weaponBaseItem(item))
    ?? WEAPON_SUBTYPE_BY_GEAR_ID.get(gearId(item))
    ?? "";
}

export function isSelfAmmunitionWeapon(item) {
  return weaponBaseItem(item) === "dart" || gearId(item) === "drotik";
}

export function inferAmmunitionItemSubtype(item) {
  if (clean(item?.type).toLowerCase() !== "consumable") return "";
  if (clean(getProperty(item, "system.type.value")).toLowerCase() !== "ammo") return "";
  const current = clean(getProperty(item, "system.type.subtype"));
  if (AMMUNITION_SUBTYPES.has(current)) return current;
  return inferAmmunitionSubtypeFromIdentity(item);
}

export function isCompatibleAmmunition(weapon, ammunition) {
  const expected = inferWeaponAmmunitionSubtype(weapon)
    || clean(getProperty(weapon, "system.ammunition.type"));
  const actual = inferAmmunitionItemSubtype(ammunition);
  const quantity = Number(getProperty(ammunition, "system.quantity"));
  return Boolean(expected && actual === expected && Number.isFinite(quantity) && quantity > 0);
}

export function hasActiveRepeatingShot(item) {
  return collectionValues(item?.effects).some((effect) => {
    if (effect?.disabled === true || effect?.isSuppressed === true) return false;
    const name = normalized(effect?.name);
    const origin = clean(effect?.origin);
    return name === normalized("Повторный выстрел")
      || name === "repeating shot"
      || origin.includes("C8pmt95CMAvPPojm");
  });
}

function actorItems(actor) {
  return collectionValues(actor?.items);
}

function actorItemById(actor, id) {
  const safeId = clean(id);
  if (!safeId) return null;
  return actor?.items?.get?.(safeId)
    ?? actorItems(actor).find((item) => documentId(item) === safeId)
    ?? null;
}

function incompatibleSelection(actor, weapon, selectedId) {
  const id = clean(selectedId);
  return Boolean(id && !isCompatibleAmmunition(weapon, actorItemById(actor, id)));
}

function weaponRepairPatch(actor, weapon, subtype) {
  const patch = {};
  if (clean(getProperty(weapon, "system.ammunition.type")) !== subtype) {
    patch["system.ammunition.type"] = subtype;
  }

  for (const [activityId, activity] of collectionEntries(getProperty(weapon, "system.activities"))) {
    if (incompatibleSelection(actor, weapon, activity?.ammunition)) {
      patch[`system.activities.${activityId}.ammunition`] = "";
    }
  }
  for (const [activityId, last] of Object.entries(getProperty(weapon, "flags.dnd5e.last") ?? {})) {
    if (incompatibleSelection(actor, weapon, last?.ammunition)) {
      patch[`flags.dnd5e.last.${activityId}.ammunition`] = "";
    }
  }
  return patch;
}

function selfAmmunitionWeaponRepairPatch(weapon) {
  const properties = itemProperties(weapon);
  if (!properties.includes("amm")) return {};
  const patch = {
    "system.properties": properties.filter((property) => property !== "amm")
  };
  for (const [activityId, activity] of collectionEntries(getProperty(weapon, "system.activities"))) {
    if (clean(activity?.ammunition)) patch[`system.activities.${activityId}.ammunition`] = "";
  }
  for (const [activityId, last] of Object.entries(getProperty(weapon, "flags.dnd5e.last") ?? {})) {
    if (clean(last?.ammunition)) patch[`flags.dnd5e.last.${activityId}.ammunition`] = "";
  }
  return patch;
}

export async function repairActorAmmunitionCompatibility(actor) {
  const items = actorItems(actor);
  let updatedAmmunition = 0;
  let updatedWeapons = 0;

  for (const ammunition of items) {
    const subtype = inferAmmunitionItemSubtype(ammunition);
    if (!subtype || clean(getProperty(ammunition, "system.type.subtype")) === subtype) continue;
    await ammunition.update?.({ "system.type.subtype": subtype }, { render: false });
    updatedAmmunition += 1;
  }

  for (const weapon of items) {
    const subtype = inferWeaponAmmunitionSubtype(weapon);
    const patch = subtype
      ? weaponRepairPatch(actor, weapon, subtype)
      : (isSelfAmmunitionWeapon(weapon) ? selfAmmunitionWeaponRepairPatch(weapon) : {});
    if (!Object.keys(patch).length) continue;
    await weapon.update?.(patch, { render: false });
    updatedWeapons += 1;
  }

  return { updatedWeapons, updatedAmmunition };
}

export async function repairWorldAmmunitionCompatibility(game = globalThis.game) {
  if (!isActiveGmClient(game)) {
    return { skipped: true, actors: 0, updatedWeapons: 0, updatedAmmunition: 0, failedActors: 0 };
  }

  const summary = { skipped: false, actors: 0, updatedWeapons: 0, updatedAmmunition: 0, failedActors: 0 };
  for (const actor of collectionValues(game?.actors)) {
    try {
      const result = await repairActorAmmunitionCompatibility(actor);
      summary.actors += 1;
      summary.updatedWeapons += result.updatedWeapons;
      summary.updatedAmmunition += result.updatedAmmunition;
    }
    catch (error) {
      summary.failedActors += 1;
      console.warn(`${MODULE_ID} | Failed to repair ammunition compatibility for actor '${clean(actor?.name ?? actor?.id)}'.`, error);
    }
  }
  return summary;
}
