import { MODULE_ID } from "../constants.js";
import { getActiveGm } from "../infrastructure/foundry/active-gm.js";

const EFFECT_MODE_ADD = globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;

const CHARACTER_SIZE_RULES = Object.freeze({
  tiny: Object.freeze({
    size: "tiny",
    label: "Крошечный",
    ac: 2,
    strengthChecks: -2,
    dexterityChecks: 2,
    baseReachFeet: 0
  }),
  sm: Object.freeze({
    size: "sm",
    label: "Маленький",
    ac: 1,
    strengthChecks: -1,
    dexterityChecks: 1,
    baseReachFeet: 5
  }),
  med: Object.freeze({
    size: "med",
    label: "Средний",
    ac: 0,
    strengthChecks: 0,
    dexterityChecks: 0,
    baseReachFeet: 5
  }),
  lg: Object.freeze({
    size: "lg",
    label: "Большой",
    ac: -1,
    strengthChecks: 1,
    dexterityChecks: -1,
    baseReachFeet: 10
  }),
  huge: Object.freeze({
    size: "huge",
    label: "Огромный",
    ac: -2,
    strengthChecks: 2,
    dexterityChecks: -2,
    baseReachFeet: 15
  }),
  grg: Object.freeze({
    size: "grg",
    label: "Громадный",
    ac: -3,
    strengthChecks: 3,
    dexterityChecks: -3,
    baseReachFeet: 20
  })
});

function collectionContents(collection) {
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection?.contents)) {
    return collection.contents;
  }
  if (collection && typeof collection[Symbol.iterator] === "function") {
    return Array.from(collection);
  }
  return [];
}

function gameUsers(users) {
  if (Array.isArray(users?.contents)) return users.contents;
  if (Array.isArray(users)) return users;
  if (typeof users?.values === "function") return Array.from(users.values());
  if (users && typeof users[Symbol.iterator] === "function") return Array.from(users);
  return [];
}

function defaultCanManageActor(actor) {
  const game = globalThis.game;
  const currentUser = game?.user;
  if (!currentUser?.active) return false;

  const activeGm = getActiveGm(game);
  if (activeGm) return String(activeGm.id) === String(currentUser.id);

  const activeOwners = gameUsers(game?.users)
    .filter((user) => (
      user?.active
      && !user.isGM
      && actor?.testUserPermission?.(user, "OWNER") === true
    ))
    .sort((left, right) => {
      const leftId = String(left.id);
      const rightId = String(right.id);
      if (leftId < rightId) return -1;
      if (leftId > rightId) return 1;
      return 0;
    });
  if (activeOwners.length > 0) {
    return String(activeOwners[0].id) === String(currentUser.id);
  }
  return actor?.isOwner === true;
}

function isMissingActiveEffectError(error) {
  const message = String(error?.message ?? error ?? "");
  return /ActiveEffect\s+"[^"]+"\s+does not exist!?/iu.test(message);
}

async function deleteManagedEffects(actor, ids, options) {
  for (const id of new Set(ids.filter(Boolean))) {
    try {
      await actor.deleteEmbeddedDocuments("ActiveEffect", [id], options);
    }
    catch (error) {
      if (!isMissingActiveEffectError(error)) throw error;
    }
  }
}

function isManagedSizeEffect(effect) {
  return effect?.flags?.[MODULE_ID]?.sizeAutomation?.managed === true;
}

function comparableEffectData(effect) {
  return {
    name: String(effect?.name ?? ""),
    img: String(effect?.img ?? ""),
    disabled: effect?.disabled === true,
    transfer: effect?.transfer === true,
    changes: collectionContents(effect?.changes).map((change) => ({
      key: String(change?.key ?? ""),
      mode: Number(change?.mode ?? 0),
      value: String(change?.value ?? ""),
      priority: Number(change?.priority ?? 0)
    })),
    sizeAutomation: {
      managed: effect?.flags?.[MODULE_ID]?.sizeAutomation?.managed === true,
      size: String(effect?.flags?.[MODULE_ID]?.sizeAutomation?.size ?? "")
    }
  };
}

function effectDataMatches(effect, desired) {
  return JSON.stringify(comparableEffectData(effect)) === JSON.stringify(comparableEffectData(desired));
}

export function getCharacterSizeRule(size) {
  const normalized = String(size ?? "").trim().toLowerCase();
  return CHARACTER_SIZE_RULES[normalized] ?? CHARACTER_SIZE_RULES.med;
}

export function buildCharacterSizeEffectData(size) {
  const rule = getCharacterSizeRule(size);
  if (rule.size === "med") {
    return null;
  }

  return {
    name: `Размер существа: ${rule.label}`,
    img: "icons/svg/upgrade.svg",
    disabled: false,
    transfer: false,
    changes: [
      {
        key: "system.attributes.ac.bonus",
        mode: EFFECT_MODE_ADD,
        value: String(rule.ac),
        priority: 20
      },
      {
        key: "system.abilities.str.bonuses.check",
        mode: EFFECT_MODE_ADD,
        value: String(rule.strengthChecks),
        priority: 20
      },
      {
        key: "system.abilities.dex.bonuses.check",
        mode: EFFECT_MODE_ADD,
        value: String(rule.dexterityChecks),
        priority: 20
      }
    ],
    flags: {
      [MODULE_ID]: {
        sizeAutomation: {
          managed: true,
          size: rule.size
        }
      }
    }
  };
}

export class SizeAutomationService {
  constructor(moduleApi, {
    canManageActor = defaultCanManageActor,
    actors = () => globalThis.game?.actors?.contents ?? []
  } = {}) {
    this.moduleApi = moduleApi;
    this._canManageActor = canManageActor;
    this._actors = actors;
    this._actorQueues = new Map();
  }

  async initialize() {
    for (const actor of this._actors()) {
      await this.syncActor(actor);
    }
    return true;
  }

  syncActor(actor) {
    if (actor?.type !== "character" || !this._canManageActor(actor)) {
      return Promise.resolve(false);
    }

    const actorKey = actor.uuid ?? actor.id;
    const previous = this._actorQueues.get(actorKey) ?? Promise.resolve();
    const queued = previous.catch(() => false).then(() => this._syncActorNow(actor));
    this._actorQueues.set(actorKey, queued);
    return queued.finally(() => {
      if (this._actorQueues.get(actorKey) === queued) {
        this._actorQueues.delete(actorKey);
      }
    });
  }

  handleActorUpdated(actor, _changed, options = {}) {
    if (options.rebreyaSizeAutomation === true) {
      return Promise.resolve(false);
    }
    return this.syncActor(actor);
  }

  handleActiveEffectChanged(effect, options = {}) {
    if (options.rebreyaSizeAutomation === true) {
      return Promise.resolve(false);
    }
    return this.syncActor(effect?.parent);
  }

  async _syncActorNow(actor) {
    const managed = collectionContents(actor?.effects).filter(isManagedSizeEffect);
    const desired = buildCharacterSizeEffectData(actor?.system?.traits?.size);
    const mutationOptions = { rebreyaSizeAutomation: true };

    if (!desired) {
      const ids = managed.map((effect) => effect.id ?? effect._id).filter(Boolean);
      if (ids.length > 0) {
        await deleteManagedEffects(actor, ids, mutationOptions);
      }
      return ids.length > 0;
    }

    const [primary, ...duplicates] = managed;
    let changed = false;
    if (!primary) {
      await actor.createEmbeddedDocuments("ActiveEffect", [desired], mutationOptions);
      changed = true;
    }
    else if (!effectDataMatches(primary, desired)) {
      await actor.updateEmbeddedDocuments("ActiveEffect", [{
        _id: primary.id ?? primary._id,
        ...desired
      }], mutationOptions);
      changed = true;
    }

    const duplicateIds = duplicates.map((effect) => effect.id ?? effect._id).filter(Boolean);
    if (duplicateIds.length > 0) {
      await deleteManagedEffects(actor, duplicateIds, mutationOptions);
      changed = true;
    }
    return changed;
  }
}
