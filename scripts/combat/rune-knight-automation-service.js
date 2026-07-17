import { MODULE_ID } from "../constants.js";

const FIGHTER_CLASS_IDENTIFIER = "fighter-rework-v028";
const EFFECT_MODE_ADD = 2;
const RUNE_IDS = new Set(["stone", "frost", "cloud", "fire", "hill", "storm"]);
const SELF_ACTIVATION_IDS = new Set(["frost", "hill", "storm"]);
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

function contextActor(...contexts) {
  for (const context of contexts) {
    const actor = context?.actor
      ?? context?.subject
      ?? context?.item?.actor
      ?? context?.activity?.actor
      ?? context?.data?.actor
      ?? null;
    if (isActorDocument(actor)) return actor;
  }
  return null;
}

function contextIsPoison(...contexts) {
  for (const context of contexts) {
    if (context?.isPoison === true || context?.options?.isPoison === true) return true;
    const values = [
      context?.damageType,
      context?.type,
      context?.options?.damageType,
      context?.options?.type,
      context?.options?.sourceType,
      context?.flavor,
      context?.data?.flavor
    ];
    if (values.some((value) => /(?:^|\W)(?:poison|яд)(?:$|\W)/iu.test(cleanText(value)))) return true;
  }
  return false;
}

function statusIds(document) {
  const ids = new Set();
  const statuses = document?.statuses;
  if (statuses instanceof Set || Array.isArray(statuses)) {
    for (const status of statuses) ids.add(normalizeText(status));
  }
  const coreStatus = cleanText(getProperty(document, "flags.core.statusId"));
  if (coreStatus) ids.add(normalizeText(coreStatus));
  return ids;
}

function actorIsIncapacitated(actor) {
  if (statusIds(actor).has("incapacitated")) return true;
  return collectionValues(actor?.effects).some((effect) => statusIds(effect).has("incapacitated"));
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
    this._actorFeatureCache = new Map();
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
    this.#cacheActorFeatures(actor, items);
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
    this._actorFeatureCache.delete(actorKey(actor));
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

  async applyDnd5ePostUseActivity(activity, usageConfig = {}, results = {}) {
    void usageConfig;
    void results;
    const id = automationId(activity);
    if (!SELF_ACTIVATION_IDS.has(id)) return true;

    const actor = contextActor(activity, activity?.item);
    const item = activity?.item;
    if (!actor || !item || this.#hasRuntimeEffect(actor, item, id)) return true;

    const rollback = await this.#consumeItemUse(item);
    if (!rollback) return false;
    try {
      const created = await this.#createRuneActivationEffect(actor, item, id);
      if (!created) {
        await rollback();
        return false;
      }
      return true;
    }
    catch (error) {
      await rollback();
      throw error;
    }
  }

  applyDnd5ePreRollToolCheck(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = contextActor(rollConfig, dialogConfig, messageConfig);
    if (!actor || !this.#actorHasFeature(actor, "fire") || rollConfig._rebreyaRuneToolExpertise) {
      return true;
    }

    const proficiency = rollConfig.proficiency
      ?? actor?.system?.tools?.[rollConfig.tool]?.prof
      ?? rollConfig.tool?.system?.proficient
      ?? rollConfig.item?.system?.proficient
      ?? 0;
    const multiplier = typeof proficiency === "object"
      ? numberValue(
        proficiency.multiplier
          ?? proficiency.value
          ?? (proficiency.hasProficiency === true ? 1 : 0),
        0
      )
      : numberValue(proficiency, 0);
    if (multiplier <= 0) return true;

    const currentBonus = cleanText(rollConfig.bonus);
    if (!/(?:^|\W)@prof(?:$|\W)/u.test(currentBonus)) {
      rollConfig.bonus = currentBonus ? `${currentBonus} + @prof` : "@prof";
    }
    if (typeof rollConfig.proficiency === "object" && rollConfig.proficiency) {
      rollConfig.proficiency.multiplier = Math.max(2, multiplier);
    }
    else if (Object.hasOwn(rollConfig, "proficiency")) {
      rollConfig.proficiency = Math.max(2, multiplier);
    }
    rollConfig._rebreyaRuneToolExpertise = true;
    return true;
  }

  applyDnd5ePreRollSavingThrow(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = contextActor(rollConfig, dialogConfig, messageConfig);
    if (!actor || !this.#actorHasFeature(actor, "hill") || !contextIsPoison(rollConfig, dialogConfig, messageConfig)) {
      return true;
    }
    rollConfig.advantage = true;
    if (dialogConfig && typeof dialogConfig === "object") dialogConfig.advantage = true;
    return true;
  }

  prepareActiveEffectCreate(effect) {
    const actor = actorFromEmbeddedDocument(effect);
    if (!actor || !this.#actorHasFeature(actor, "storm") || actorIsIncapacitated(actor)) return true;
    return statusIds(effect).has("surprised") ? false : true;
  }

  #cacheActorFeatures(actor, items = collectionValues(actor?.items)) {
    const ids = new Set(items.map(automationId).filter(Boolean));
    this._actorFeatureCache.set(actorKey(actor), ids);
    return ids;
  }

  #actorHasFeature(actor, id) {
    const key = actorKey(actor);
    const cached = this._actorFeatureCache.get(key) ?? this.#cacheActorFeatures(actor);
    return cached.has(id);
  }

  #hasRuntimeEffect(actor, item, id) {
    const sourceItemUuid = cleanText(item?.uuid);
    return collectionValues(actor?.effects).some((effect) => (
      cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.id`)) === id
        && cleanText(getProperty(effect, `flags.${MODULE_ID}.runeKnight.sourceItemUuid`)) === sourceItemUuid
    ));
  }

  async #consumeItemUse(item) {
    const uses = item?.system?.uses ?? {};
    const spent = Math.max(0, Math.floor(numberValue(uses.spent, 0)));
    const maximum = Math.max(0, Math.floor(numberValue(uses.max, 0)));
    if (spent >= maximum) return null;
    await updateItem(item, { "system.uses.spent": spent + 1 });
    return async () => updateItem(item, { "system.uses.spent": spent });
  }

  async #createRuneActivationEffect(actor, item, id) {
    if (typeof actor?.createEmbeddedDocuments !== "function") return false;
    const configurations = {
      frost: {
        name: "Ледяная руна: стойкость",
        seconds: 600,
        changes: [
          "system.abilities.str.bonuses.check",
          "system.abilities.str.bonuses.save",
          "system.abilities.con.bonuses.check",
          "system.abilities.con.bonuses.save"
        ].map((key) => ({ key, mode: EFFECT_MODE_ADD, value: "+2", priority: 20 }))
      },
      hill: {
        name: "Холмовая руна: стойкость великана",
        seconds: 60,
        changes: ["bludgeoning", "piercing", "slashing"].map((value) => ({
          key: "system.traits.dr.value",
          mode: EFFECT_MODE_ADD,
          value,
          priority: 20
        }))
      },
      storm: {
        name: "Штормовая руна: пророческое состояние",
        seconds: 60,
        changes: []
      }
    };
    const configuration = configurations[id];
    if (!configuration) return false;
    const effect = {
      name: configuration.name,
      type: "base",
      img: cleanText(item?.img, "icons/svg/aura.svg"),
      origin: cleanText(item?.uuid),
      disabled: false,
      transfer: false,
      duration: {
        seconds: configuration.seconds,
        rounds: null,
        turns: null,
        startRound: null,
        startTurn: null,
        combat: null,
        startTime: globalThis.game?.time?.worldTime ?? null
      },
      statuses: [],
      changes: configuration.changes,
      flags: {
        dae: { stackable: "noneName" },
        [MODULE_ID]: {
          managed: true,
          runeKnight: {
            id,
            sourceItemUuid: cleanText(item?.uuid),
            propheticState: id === "storm"
          }
        }
      },
      description: cleanText(item?.system?.description?.value)
    };
    const created = await actor.createEmbeddedDocuments("ActiveEffect", [effect], { render: false });
    return Array.isArray(created) ? created.length > 0 : created !== false;
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
