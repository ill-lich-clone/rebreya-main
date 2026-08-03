import { isPortableStorageContainerItem } from "../data/storage-container-snapshot.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const registeredHookObjects = new WeakSet();
const repairTasks = new WeakMap();
const REPAIR_OPTION = "rebreyaStorageContainerCycleRepair";

function clean(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (collection?.values instanceof Function) return Array.from(collection.values());
  if (collection?.[Symbol.iterator] instanceof Function) return Array.from(collection);
  return [];
}

function actorItems(actor) {
  return collectionValues(actor?.items).filter((item) => clean(item?.id));
}

function cycleFor(item, byId) {
  const trail = [];
  const indexes = new Map();
  let current = item;
  while (current) {
    const id = clean(current.id);
    if (!id) return [];
    if (indexes.has(id)) return trail.slice(indexes.get(id));
    indexes.set(id, trail.length);
    trail.push(current);
    const parentId = clean(current?.system?.container);
    current = parentId ? byId.get(parentId) : null;
  }
  return [];
}

function cycleKey(cycle) {
  return cycle.map((item) => clean(item.id)).sort().join(":");
}

function proposedParentId(changes = {}) {
  if (Object.hasOwn(changes, "system.container")) return clean(changes["system.container"]);
  if (Object.hasOwn(changes?.system ?? {}, "container")) return clean(changes.system.container);
  return "";
}

export function planPortableContainerReparent(item, changes = {}) {
  const actor = item?.parent?.documentName === "Actor" || item?.parent?.items ? item.parent : item?.actor;
  const sourceId = clean(item?.id);
  const targetId = proposedParentId(changes);
  if (!actor || !sourceId || !targetId || sourceId === targetId) return null;

  const items = actorItems(actor);
  const byId = new Map(items.map((candidate) => [clean(candidate.id), candidate]));
  const target = byId.get(targetId);
  if (!target) return null;
  const branch = [];
  const seen = new Set();
  let current = target;
  while (current && !seen.has(clean(current.id))) {
    const currentId = clean(current.id);
    if (!currentId) return null;
    seen.add(currentId);
    branch.push(current);
    if (currentId === sourceId) break;
    current = byId.get(clean(current?.system?.container));
  }
  if (clean(branch.at(-1)?.id) !== sourceId) return null;
  if (!branch.some(isPortableStorageContainerItem)) return null;

  return {
    actor,
    sourceId,
    sourceParentId: clean(item?.system?.container) || null,
    targetId
  };
}

export function planPortableContainerCycleRepairs(actor, { updatedItemId = "" } = {}) {
  const items = actorItems(actor);
  const byId = new Map(items.map((item) => [clean(item.id), item]));
  const handled = new Set();
  const preferredSourceId = clean(updatedItemId);
  const repairs = [];

  for (const item of items) {
    const cycle = cycleFor(item, byId);
    if (!cycle.length) continue;
    const key = cycleKey(cycle);
    if (!key || handled.has(key)) continue;
    handled.add(key);

    const portable = cycle.filter(isPortableStorageContainerItem);
    if (!portable.length) continue;
    const target = portable.find((candidate) => clean(candidate.id) !== preferredSourceId) ?? portable[0];
    repairs.push({ _id: clean(target.id), "system.container": null });
  }

  return repairs;
}

export async function repairPortableContainerCycles(actor, options = {}) {
  const repairs = planPortableContainerCycleRepairs(actor, options);
  if (!repairs.length) return [];
  if (typeof actor?.updateEmbeddedDocuments !== "function") {
    throw new TypeError("Актёр не поддерживает исправление вложенности контейнеров.");
  }
  await actor.updateEmbeddedDocuments("Item", repairs, { [REPAIR_OPTION]: true });
  return repairs;
}

function containerChanged(changes = {}) {
  return Object.hasOwn(changes, "system.container")
    || Object.hasOwn(changes?.system ?? {}, "container");
}

async function rotatePortableContainerHierarchy(item, changes, plan) {
  const sourcePatch = clone(changes) ?? {};
  if (Object.hasOwn(sourcePatch?.system ?? {}, "container")) {
    delete sourcePatch.system.container;
    if (!Object.keys(sourcePatch.system).length) delete sourcePatch.system;
  }
  sourcePatch._id = plan.sourceId;
  sourcePatch["system.container"] = plan.targetId;
  await plan.actor.updateEmbeddedDocuments("Item", [
    { _id: plan.targetId, "system.container": plan.sourceParentId },
    sourcePatch
  ], { [REPAIR_OPTION]: true });
  return [{ _id: plan.targetId, "system.container": plan.sourceParentId }];
}

function defaultNotify(repairs) {
  if (!repairs.length) return;
  globalThis.ui?.notifications?.warn?.(
    "Rebreya: исправлена циклическая вложенность контейнеров. Сумка возвращена в инвентарь."
  );
}

function queueRepair(actor, updatedItemId, { notify, logger }) {
  const previous = repairTasks.get(actor) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const repairs = await repairPortableContainerCycles(actor, { updatedItemId });
    notify(repairs, actor);
    return repairs;
  });
  repairTasks.set(actor, task);
  void task.catch((error) => logger.error("Rebreya storage container hierarchy repair failed.", error));
  return task;
}

export async function registerStorageContainerHierarchyHooks({
  Hooks = globalThis.Hooks,
  gameProvider = () => globalThis.game,
  isActiveGm = isActiveGmClient,
  notify = defaultNotify,
  logger = console
} = {}) {
  if (!Hooks || typeof Hooks.on !== "function") return { registered: false, repaired: 0 };
  if (registeredHookObjects.has(Hooks)) return { registered: false, repaired: 0 };
  registeredHookObjects.add(Hooks);

  const handleChange = (item, changes = {}, options = {}) => {
    if (options?.[REPAIR_OPTION] === true) return;
    if (changes && Object.keys(changes).length && !containerChanged(changes)) return;
    const game = gameProvider();
    if (isActiveGm(game) !== true) return;
    const actor = item?.parent?.documentName === "Actor" || item?.parent?.items ? item.parent : item?.actor;
    if (!actor) return;
    void queueRepair(actor, clean(item?.id), { notify, logger });
  };

  Hooks.on("createItem", (item, options = {}) => handleChange(item, {}, options));
  Hooks.on("preUpdateItem", (item, changes = {}, options = {}) => {
    if (options?.[REPAIR_OPTION] === true || !containerChanged(changes)) return;
    const plan = planPortableContainerReparent(item, changes);
    if (!plan) return;
    void rotatePortableContainerHierarchy(item, changes, plan)
      .then((repairs) => notify(repairs, plan.actor))
      .catch((error) => logger.error("Rebreya storage container reparent failed.", error));
    return false;
  });
  Hooks.on("updateItem", handleChange);

  const game = gameProvider();
  if (isActiveGm(game) !== true) return { registered: true, repaired: 0 };
  const actors = collectionValues(game?.actors);
  const results = await Promise.allSettled(actors.map((actor) => queueRepair(actor, "", { notify, logger })));
  let repaired = 0;
  for (const result of results) {
    if (result.status === "fulfilled") repaired += result.value.length;
    else logger.error("Rebreya storage container startup repair failed.", result.reason);
  }
  return { registered: true, repaired };
}
