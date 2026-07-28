import { MODULE_ID } from "../constants.js";
import { isImplantItem } from "../data/implant-service.js";

const registeredHookSets = new WeakSet();
const DATA_MODEL_PATCH = Symbol.for("rebreya-main.implantAbilityCaps");

function collectionValues(collection) {
  if (Array.isArray(collection)) return [...collection];
  if (Array.isArray(collection?.contents)) return [...collection.contents];
  if (typeof collection?.values === "function") return [...collection.values()];
  if (collection && typeof collection[Symbol.iterator] === "function") return [...collection];
  return [];
}

function canReconcile(actor, game) {
  const user = game?.user;
  if (!user) return true;
  const activeGm = game?.users?.activeGM;
  if (user.isGM) return !activeGm || activeGm.id === user.id;
  return !activeGm && actor?.isOwner === true;
}

function moduleFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    const value = document.getFlag(MODULE_ID, key);
    if (value !== undefined) return value;
  }
  return document?.flags?.[MODULE_ID]?.[key];
}

function implantActorFlags(actor) {
  const aggregate = collectionValues(actor?.effects).find((effect) => (
    moduleFlag(effect, "implantAggregate") === true
  ));
  return moduleFlag(aggregate, "automation")?.actorFlags ?? {};
}

export function registerImplantDataModelPatch({ CONFIG = globalThis.CONFIG } = {}) {
  const patched = [];
  for (const type of ["character", "npc"]) {
    const prototype = CONFIG?.Actor?.dataModels?.[type]?.prototype;
    if (
      !prototype
      || prototype[DATA_MODEL_PATCH] === true
      || typeof prototype.prepareDerivedData !== "function"
    ) {
      continue;
    }
    const original = prototype.prepareDerivedData;
    prototype.prepareDerivedData = function rebreyaImplantPrepareDerivedData(...args) {
      const maximums = implantActorFlags(this.parent)?.abilityMaximums ?? {};
      for (const [ability, maximum] of Object.entries(maximums)) {
        const data = this.abilities?.[ability];
        const numericMaximum = Number(maximum);
        const value = Number(data?.value);
        if (data && Number.isFinite(numericMaximum) && Number.isFinite(value)) {
          data.value = Math.min(value, numericMaximum);
        }
      }
      return original.apply(this, args);
    };
    Object.defineProperty(prototype, DATA_MODEL_PATCH, {
      value: true,
      configurable: true
    });
    patched.push(type);
  }
  return patched;
}

export function registerImplantHooks(moduleApi, {
  Hooks = globalThis.Hooks,
  game = globalThis.game,
  debounceMs = 25
} = {}) {
  const service = moduleApi?.implantService;
  if (!Hooks || typeof Hooks.on !== "function" || typeof service?.reconcileActor !== "function") {
    return false;
  }
  if (registeredHookSets.has(Hooks)) return false;
  registeredHookSets.add(Hooks);

  const pending = new Map();
  const schedule = (actor, reason) => {
    if (!actor || !canReconcile(actor, game)) return;
    const previous = pending.get(actor);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(async () => {
      pending.delete(actor);
      try {
        await service.reconcileActor(actor, { reason });
      }
      catch (error) {
        console.error("rebreya-main | Failed to reconcile mechanical implants.", error);
      }
    }, Math.max(0, Number(debounceMs) || 0));
    pending.set(actor, { timer, reason });
  };

  const itemChanged = (item, _changed = {}, options = {}) => {
    if (options?.rebreyaImplantReconcile === true) return;
    const actor = item?.parent;
    if (!actor) return;
    if (isImplantItem(item) || (
      ["race", "class"].includes(item?.type)
      && service.hasImplants?.(actor)
    )) {
      schedule(actor, "itemChanged");
    }
  };

  Hooks.on("createItem", itemChanged);
  Hooks.on("updateItem", itemChanged);
  Hooks.on("deleteItem", itemChanged);
  Hooks.on("updateActor", (actor, _changed = {}, options = {}) => {
    if (options?.rebreyaImplantReconcile === true) return;
    if (service.hasImplants?.(actor)) schedule(actor, "updateActor");
  });
  const ready = () => {
    for (const actor of collectionValues(game?.actors)) {
      if (service.hasImplants?.(actor)) schedule(actor, "ready");
    }
  };
  if (typeof Hooks.once === "function") Hooks.once("ready", ready);
  else Hooks.on("ready", ready);
  return true;
}
