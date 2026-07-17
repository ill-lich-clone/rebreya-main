import { MODULE_ID } from "../constants.js";

const FIGHTER_CLASS_IDENTIFIER = "fighter-rework-v028";
const RUNE_IDS = new Set(["stone", "frost", "cloud", "fire", "hill", "storm"]);
const RUNE_RECOVERY = Object.freeze([
  Object.freeze({ period: "sr", type: "recoverAll", formula: "" }),
  Object.freeze({ period: "lr", type: "recoverAll", formula: "" })
]);
const LONG_REST_RECOVERY = Object.freeze([
  Object.freeze({ period: "lr", type: "recoverAll", formula: "" })
]);
const MIGRATION_AUTOMATION_BY_NAME = new Map([
  ["каменная руна", "stone"],
  ["ледяная руна", "frost"],
  ["облачная руна", "cloud"],
  ["огненная руна", "fire"],
  ["холмовая руна", "hill"],
  ["штормовая руна", "storm"],
  ["мощь великана", "giant-might"],
  ["рунический щит", "runic-shield"],
  ["мастер рун", "master-of-runes"]
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function numberValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function getProperty(source, path) {
  if (typeof globalThis.foundry?.utils?.getProperty === "function") {
    return globalThis.foundry.utils.getProperty(source, path);
  }
  return String(path ?? "").split(".").reduce((value, key) => value?.[key], source);
}

function setProperty(source, path, value) {
  if (typeof globalThis.foundry?.utils?.setProperty === "function") {
    globalThis.foundry.utils.setProperty(source, path, value);
    return;
  }

  const keys = String(path ?? "").split(".");
  const finalKey = keys.pop();
  let target = source;
  for (const key of keys) {
    target[key] ??= {};
    target = target[key];
  }
  target[finalKey] = value;
}

function clone(value) {
  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isActorDocument(actor) {
  return Boolean(actor && typeof actor === "object" && (actor.uuid || actor.id || actor._id));
}

function actorFromEmbeddedDocument(document) {
  const parent = document?.actor ?? document?.parent ?? null;
  if (!parent || parent === document) return null;
  if (isActorDocument(parent)) return parent;
  return isActorDocument(parent?.actor) ? parent.actor : null;
}

function actorKey(actor) {
  return cleanText(actor?.uuid ?? actor?.id ?? actor?._id);
}

function documentId(document) {
  return cleanText(document?.id ?? document?._id);
}

function automationId(document) {
  const flagged = cleanText(getProperty(document, `flags.${MODULE_ID}.runeKnightAutomation.id`));
  return flagged || MIGRATION_AUTOMATION_BY_NAME.get(normalizeText(document?.name)) || "";
}

function classIdentifier(item) {
  return cleanText(
    getProperty(item, "system.identifier")
      ?? getProperty(item, `flags.${MODULE_ID}.classIdentifier`)
  );
}

function fighterLevel(actor) {
  const fighter = collectionValues(actor?.items).find((item) => (
    item?.type === "class" && classIdentifier(item) === FIGHTER_CLASS_IDENTIFIER
  ));
  return Math.max(0, Math.floor(numberValue(fighter?.system?.levels, 0)));
}

function proficiencyBonus(actor) {
  return Math.max(0, Math.floor(numberValue(actor?.system?.attributes?.prof, 0)));
}

function recoveryMatches(current, expected) {
  const normalized = (Array.isArray(current) ? current : []).map(({ period, type, formula }) => ({
    period: cleanText(period),
    type: cleanText(type),
    formula: cleanText(formula)
  }));
  return JSON.stringify(normalized) === JSON.stringify(expected);
}

function mergeRepairOptions(current = {}, incoming = {}) {
  return {
    restoreRunes: current.restoreRunes === true || incoming.restoreRunes === true,
    restoreLongRest: current.restoreLongRest === true || incoming.restoreLongRest === true
  };
}

function restType(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) return "long";
  if (result?.shortRest === true || config?.shortRest === true) return "short";

  const values = [
    result?.type,
    result?.restType,
    result?.period,
    config?.type,
    config?.restType,
    config?.period
  ].map(normalizeText);
  if (values.some((value) => value === "long" || value === "lr" || value.includes("продолж"))) {
    return "long";
  }
  if (values.some((value) => value === "short" || value === "sr" || value.includes("корот"))) {
    return "short";
  }
  return "";
}

async function updateItem(item, patch) {
  if (!item || !Object.keys(patch).length) return false;
  if (typeof item.update === "function") {
    await item.update(patch, { render: false });
  }
  else {
    const actor = actorFromEmbeddedDocument(item);
    const id = documentId(item);
    if (id && typeof actor?.updateEmbeddedDocuments === "function") {
      await actor.updateEmbeddedDocuments("Item", [{ _id: id, ...patch }], { render: false });
    }
  }
  for (const [path, value] of Object.entries(patch)) setProperty(item, path, clone(value));
  return true;
}

export class RuneKnightAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this.options = options;
    this._repairActorPromises = new Map();
    this._pendingRepairOptions = new Map();
  }

  async initialize() {
    return true;
  }

  repairActor(actor, options = {}) {
    if (!isActorDocument(actor)) {
      return Promise.resolve(false);
    }

    const key = actorKey(actor) || actor;
    this._pendingRepairOptions.set(
      key,
      mergeRepairOptions(this._pendingRepairOptions.get(key), options)
    );
    const current = this._repairActorPromises.get(key);
    if (current) return current;

    const repairPromise = this.#drainActorRepairs(actor, key);
    this._repairActorPromises.set(key, repairPromise);
    return repairPromise;
  }

  async #drainActorRepairs(actor, key) {
    try {
      await Promise.resolve();
      let repaired = false;
      while (this._pendingRepairOptions.has(key)) {
        const options = this._pendingRepairOptions.get(key) ?? {};
        this._pendingRepairOptions.delete(key);
        repaired = (await this.#repairActorNow(actor, options)) || repaired;
      }
      return repaired;
    }
    finally {
      this._pendingRepairOptions.delete(key);
      this._repairActorPromises.delete(key);
    }
  }

  async #repairActorNow(actor, { restoreRunes = false, restoreLongRest = false } = {}) {
    const items = collectionValues(actor?.items);
    const level = fighterLevel(actor);
    const hasMasterOfRunes = level >= 15 && items.some((item) => automationId(item) === "master-of-runes");
    const runeMaximum = hasMasterOfRunes ? 2 : 1;
    const pb = proficiencyBonus(actor);
    let changed = false;

    for (const item of items) {
      const id = automationId(item);
      if (RUNE_IDS.has(id)) {
        changed = (await this.#synchronizeUses(item, runeMaximum, RUNE_RECOVERY, restoreRunes)) || changed;
      }
      else if (id === "giant-might" || id === "runic-shield") {
        changed = (await this.#synchronizeUses(item, pb, LONG_REST_RECOVERY, restoreLongRest)) || changed;
      }
    }

    return changed;
  }

  async #synchronizeUses(item, maximum, recovery, restore) {
    const safeMaximum = Math.max(0, Math.floor(numberValue(maximum, 0)));
    const uses = item?.system?.uses ?? {};
    const spent = Math.max(0, Math.floor(numberValue(uses.spent, 0)));
    const patch = {};
    if (numberValue(uses.max, -1) !== safeMaximum) {
      patch["system.uses.max"] = safeMaximum;
    }
    if (!recoveryMatches(uses.recovery, recovery)) {
      patch["system.uses.recovery"] = clone(recovery);
    }
    const nextSpent = restore ? 0 : Math.min(spent, safeMaximum);
    if (spent !== nextSpent) {
      patch["system.uses.spent"] = nextSpent;
    }
    return updateItem(item, patch);
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    const type = restType(result, config);
    if (!type) return true;
    await this.repairActor(actor, {
      restoreRunes: true,
      restoreLongRest: type === "long"
    });
    return true;
  }

  async handleEmbeddedItemChange(item) {
    const actor = actorFromEmbeddedDocument(item);
    if (!actor) return true;

    const id = automationId(item);
    if (RUNE_IDS.has(id) && !this.#actorStillOwnsItem(actor, item)) {
      await this.#deleteSourceEffects(actor, cleanText(item?.uuid));
    }
    await this.repairActor(actor);
    return true;
  }

  async handleEmbeddedEffectChange(effect) {
    const actor = actorFromEmbeddedDocument(effect);
    if (actor) await this.repairActor(actor);
    return true;
  }

  #actorStillOwnsItem(actor, sourceItem) {
    const sourceUuid = cleanText(sourceItem?.uuid);
    const sourceId = documentId(sourceItem);
    return collectionValues(actor?.items).some((item) => (
      item === sourceItem
        || (sourceUuid && cleanText(item?.uuid) === sourceUuid)
        || (sourceId && documentId(item) === sourceId)
    ));
  }

  async #deleteSourceEffects(actor, sourceItemUuid) {
    if (!sourceItemUuid) return false;
    const effects = collectionValues(actor?.effects).filter((effect) => (
      cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.sourceItemUuid`)) === sourceItemUuid
    ));
    if (!effects.length) return false;

    const ids = effects.map(documentId).filter(Boolean);
    if (ids.length && typeof actor.deleteEmbeddedDocuments === "function") {
      await actor.deleteEmbeddedDocuments("ActiveEffect", ids, { render: false });
      return true;
    }
    await Promise.all(effects.map((effect) => effect?.delete?.({ render: false })));
    return true;
  }
}
