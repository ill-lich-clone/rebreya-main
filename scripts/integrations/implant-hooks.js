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

function implantAutomation(actor) {
  const aggregate = collectionValues(actor?.effects).find((effect) => (
    moduleFlag(effect, "implantAggregate") === true
  ));
  const automation = moduleFlag(aggregate, "automation");
  return automation && typeof automation === "object"
    ? automation
    : {};
}

function implantActorFlags(actor) {
  return implantAutomation(actor).actorFlags ?? {};
}

function implantCapabilities(actor) {
  const capabilities = implantAutomation(actor).capabilities;
  return Array.isArray(capabilities) ? capabilities : [];
}

function applySpellCondenser(model, capabilities) {
  const capability = capabilities.find(({ type }) => type === "spellCondenser");
  const spentPoints = Math.max(1, Math.min(5, Math.floor(Number(capability?.spentPoints))));
  if (!capability || !Number.isFinite(spentPoints)) return;

  let highestAvailableLevel = 0;
  for (let level = 1; level <= 9; level += 1) {
    const maximum = Number(model?.spells?.[`spell${level}`]?.max);
    if (Number.isFinite(maximum) && maximum > 0) {
      highestAvailableLevel = level;
    }
  }
  if (highestAvailableLevel <= 0) return;

  const level = Math.min(spentPoints, highestAvailableLevel);
  const slot = model?.spells?.[`spell${level}`];
  const maximum = Number(slot?.max);
  if (slot && Number.isFinite(maximum)) {
    slot.max = maximum + 1;
  }
}

function applyTelepathyLanguage(model, capabilities) {
  if (!capabilities.some(({ type }) => type === "telepathy")) return;
  const languages = model?.traits?.languages;
  if (!languages) return;

  const label = "Телепатия (60 фт.)";
  const current = String(languages.custom ?? "").trim();
  const entries = current
    .split(/\s*;\s*/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.includes(label)) entries.push(label);
  languages.custom = entries.join("; ");
}

function applyRocketThrust(model, capabilities) {
  if (!capabilities.some(({ type }) => type === "rocketThrust")) return;
  const movement = model?.attributes?.movement;
  if (!movement) return;
  const walk = Number(movement.walk);
  const fly = Number(movement.fly);
  if (!Number.isFinite(walk)) return;
  movement.fly = Math.max(walk, Number.isFinite(fly) ? fly : 0);
}

function applyCarryingStrengthBonus(model, actorFlags) {
  const bonus = Number(actorFlags?.carryingStrengthBonus);
  const strength = Number(model?.abilities?.str?.value);
  const encumbrance = model?.attributes?.encumbrance;
  if (
    !Number.isFinite(bonus)
    || bonus <= 0
    || !Number.isFinite(strength)
    || strength <= 0
    || !encumbrance?.thresholds
  ) {
    return;
  }

  const ratio = (strength + bonus) / strength;
  for (const key of ["encumbered", "heavilyEncumbered", "maximum"]) {
    const current = Number(encumbrance.thresholds[key]);
    if (Number.isFinite(current)) {
      encumbrance.thresholds[key] = Math.round(current * ratio * 10) / 10;
    }
  }
  encumbrance.max = encumbrance.thresholds.maximum;
  if (Number.isFinite(Number(encumbrance.value)) && Number.isFinite(Number(encumbrance.max))) {
    encumbrance.pct = Math.min(100, Math.max(0, Number(encumbrance.value) * 100 / Number(encumbrance.max)));
  }
  encumbrance.stops ??= {};
  for (const key of ["encumbered", "heavilyEncumbered"]) {
    const threshold = Number(encumbrance.thresholds[key]);
    const maximum = Number(encumbrance.max);
    if (Number.isFinite(threshold) && Number.isFinite(maximum) && maximum > 0) {
      encumbrance.stops[key] = Math.min(100, Math.max(0, threshold * 100 / maximum));
    }
  }
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
      const actorFlags = implantActorFlags(this.parent);
      const capabilities = implantCapabilities(this.parent);
      const maximums = actorFlags?.abilityMaximums ?? {};
      for (const [ability, maximum] of Object.entries(maximums)) {
        const data = this.abilities?.[ability];
        const numericMaximum = Number(maximum);
        const value = Number(data?.value);
        if (data && Number.isFinite(numericMaximum) && Number.isFinite(value)) {
          data.value = Math.min(value, numericMaximum);
        }
      }
      const result = original.apply(this, args);
      applyCarryingStrengthBonus(this, actorFlags);
      applySpellCondenser(this, capabilities);
      applyTelepathyLanguage(this, capabilities);
      applyRocketThrust(this, capabilities);
      return result;
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
