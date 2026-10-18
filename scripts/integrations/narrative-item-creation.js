import { MODULE_ID } from "../constants.js";
import {
  buildNarrativeItemCreationPatch,
  buildNarrativeItemNamePatch,
  loadLootgenNarrativeCatalog
} from "../data/lootgen-narrative-catalog.js?v=1.4.395";

const registeredHookObjects = new WeakSet();
const pendingNameRepairs = new WeakMap();
const repairingSheets = new WeakSet();

export async function restoreNarrativeItemTitle(item, { catalog } = {}) {
  if (!item || item.pack || item.parent?.pack) return false;
  const patch = buildNarrativeItemNamePatch(item.toObject?.() ?? item, catalog);
  if (!patch) return false;
  if (pendingNameRepairs.has(item)) return pendingNameRepairs.get(item);
  const task = (async () => {
    const collection = item.collection ?? item.parent?.items ?? globalThis.game?.items;
    if (item.id && collection?.get?.(item.id) === item && item.isOwner === true && typeof item.update === "function") await item.update(patch);
    else if (typeof item.updateSource === "function") item.updateSource(patch);
    else return false;
    return true;
  })();
  pendingNameRepairs.set(item, task);
  try { return await task; }
  finally { pendingNameRepairs.delete(item); }
}

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
  const repairSheet = (app) => {
    const item = app?.document ?? app?.item ?? app?.object;
    if (item?.documentName !== "Item" || repairingSheets.has(app)) return;
    repairingSheets.add(app);
    void restoreNarrativeItemTitle(item, { catalog }).then(changed => {
      if (changed && app.rendered) {
        const ApplicationV2 = globalThis.foundry?.applications?.api?.ApplicationV2;
        return app.render?.(ApplicationV2 && app instanceof ApplicationV2 ? { force: false } : false);
      }
    }).catch(error => logger?.error?.(`${MODULE_ID} | Failed to restore narrative Item title.`, error))
      .finally(() => repairingSheets.delete(app));
  };
  Hooks.on("renderItemSheet", repairSheet);
  Hooks.on("renderItemSheetV2", repairSheet);
  return true;
}
