import { MODULE_ID } from "../constants.js";
import {
  buildNarrativeItemCreationPatch,
  loadLootgenNarrativeCatalog
} from "../data/lootgen-narrative-catalog.js?v=1.4.316";

const registeredHookObjects = new WeakSet();

export function personalizeNarrativeItemCreation(
  item,
  creationOptions = {},
  { catalog, random = Math.random } = {}
) {
  if (item?.pack || item?.parent?.pack || creationOptions?.pack) return false;
  const source = item?.toObject?.();
  const patch = buildNarrativeItemCreationPatch(source, catalog, { random });
  if (!patch) return false;
  item.updateSource(patch);
  return true;
}

export async function registerNarrativeItemCreationHooks({
  Hooks = globalThis.Hooks,
  loadCatalog = loadLootgenNarrativeCatalog,
  random = Math.random,
  logger = console
} = {}) {
  if (!Hooks || typeof Hooks.on !== "function" || registeredHookObjects.has(Hooks)) return false;
  registeredHookObjects.add(Hooks);
  let catalog;
  try {
    catalog = await loadCatalog();
  }
  catch (error) {
    registeredHookObjects.delete(Hooks);
    throw error;
  }

  Hooks.on("preCreateItem", (item, _data, creationOptions = {}) => {
    try {
      personalizeNarrativeItemCreation(item, creationOptions, { catalog, random });
    }
    catch (error) {
      logger?.error?.(`${MODULE_ID} | Failed to personalize created Item.`, error);
    }
  });
  Hooks.on("preCreateActor", (actor, _data, creationOptions = {}) => {
    if (actor?.pack || creationOptions?.pack) return;
    const embeddedItems = actor?.items?.contents ?? actor?.items ?? [];
    for (const item of embeddedItems) {
      try {
        personalizeNarrativeItemCreation(item, creationOptions, { catalog, random });
      }
      catch (error) {
        logger?.error?.(`${MODULE_ID} | Failed to personalize embedded Item on Actor creation.`, error);
      }
    }
  });
  return true;
}
