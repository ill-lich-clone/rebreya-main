import { MODULE_ID } from "../constants.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";

export const SPELL_INSTANCE_FLAG = "spellInstance";

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSerializable(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol"
    || typeof value === "bigint" || value === null || typeof value !== "object") {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  const values = Array.isArray(value)
    ? value
    : isPlainObject(value) ? Object.values(value) : null;
  if (values === null) {
    return false;
  }
  return values.every((entry) => isSerializable(entry, seen));
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireNonEmptyString(value, label) {
  const normalized = cleanString(value);
  if (!normalized) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return normalized;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requireState(state) {
  if (!isPlainObject(state) || !isSerializable(state)) {
    throw new TypeError("Spell instance state must be a serializable plain object.");
  }
  return cloneSerializable(state);
}

function declarationFor(declaration) {
  if (!isPlainObject(declaration)) {
    throw new TypeError("Spell instance declaration must be a plain object.");
  }
  return {
    recipe: requireNonEmptyString(declaration.recipe, "Spell instance recipe"),
    version: requirePositiveInteger(declaration.version, "Spell instance version")
  };
}

function documentUuid(document, label) {
  return requireNonEmptyString(document?.uuid, `${label} UUID`);
}

function flagFrom(effect) {
  const fromDocument = typeof effect?.getFlag === "function"
    ? effect.getFlag(MODULE_ID, SPELL_INSTANCE_FLAG)
    : undefined;
  return fromDocument ?? effect?.flags?.[MODULE_ID]?.[SPELL_INSTANCE_FLAG];
}

function validateInstanceData(value) {
  if (!isPlainObject(value) || value.runtime !== "instance") {
    return null;
  }
  try {
    const data = {
      ...value,
      recipe: requireNonEmptyString(value.recipe, "Spell instance recipe"),
      version: requirePositiveInteger(value.version, "Spell instance version"),
      instanceId: requireNonEmptyString(value.instanceId, "Spell instance ID"),
      sourceActorUuid: requireNonEmptyString(value.sourceActorUuid, "Source actor UUID"),
      sourceItemUuid: requireNonEmptyString(value.sourceItemUuid, "Source item UUID"),
      sourceActivityUuid: requireNonEmptyString(value.sourceActivityUuid, "Source activity UUID"),
      concentrationEffectUuid: requireNonEmptyString(value.concentrationEffectUuid, "Concentration effect UUID"),
      createdOperationId: requireNonEmptyString(value.createdOperationId, "Created operation ID"),
      revision: requireNonNegativeInteger(value.revision, "Spell instance revision"),
      state: requireState(value.state)
    };
    return data;
  }
  catch {
    return null;
  }
}

function actorEffects(actor) {
  const effects = actor?.effects;
  if (Array.isArray(effects)) {
    return effects;
  }
  if (Array.isArray(effects?.contents)) {
    return effects.contents;
  }
  if (typeof effects?.values === "function") {
    return Array.from(effects.values());
  }
  return [];
}

function recordFor(effect) {
  const instance = readSpellInstance(effect);
  return instance ? { effect, ...instance } : null;
}

async function defaultLinkDependency(concentrationEffect, instanceEffect) {
  const addDependent = globalThis.MidiQOL?.addDependent;
  if (typeof addDependent === "function") {
    await addDependent(concentrationEffect, instanceEffect);
    return;
  }

  const update = { "flags.dnd5e.dependentOn": concentrationEffect.uuid };
  if (typeof instanceEffect?.update !== "function") {
    throw new TypeError("Spell instance effect must support update for dependency fallback.");
  }
  await instanceEffect.update(update);
}

/**
 * Returns valid persisted instance data from one ActiveEffect, or null when the
 * effect is not a module-owned spell instance.
 */
export function readSpellInstance(effect) {
  return validateInstanceData(flagFrom(effect));
}

/**
 * Builds the only actor-local ActiveEffect document created for a spell instance.
 */
export function buildSpellInstanceEffectData(context, declaration, state) {
  const actorUuid = documentUuid(context?.actor, "Source actor");
  const itemUuid = documentUuid(context?.item, "Source item");
  const activityUuid = documentUuid(context?.activity, "Source activity");
  const concentrationEffectUuid = documentUuid(context?.concentrationEffect, "Concentration effect");
  const instanceId = requireNonEmptyString(context?.instanceId ?? context?.operationId, "Spell instance ID");
  const operationId = requireNonEmptyString(context?.operationId, "Spell instance operation ID");
  const normalizedDeclaration = declarationFor(declaration);
  const normalizedState = requireState(state);

  return {
    name: `Spell Instance: ${normalizedDeclaration.recipe}`,
    origin: itemUuid,
    transfer: false,
    disabled: false,
    flags: {
      [MODULE_ID]: {
        [SPELL_INSTANCE_FLAG]: {
          runtime: "instance",
          recipe: normalizedDeclaration.recipe,
          version: normalizedDeclaration.version,
          instanceId,
          sourceActorUuid: actorUuid,
          sourceItemUuid: itemUuid,
          sourceActivityUuid: activityUuid,
          concentrationEffectUuid,
          createdOperationId: operationId,
          revision: 0,
          state: normalizedState
        }
      }
    }
  };
}

/**
 * Finds one exact instance among the supplied actor's current effects only.
 */
export function findSpellInstance(actor, query = {}) {
  const instanceId = cleanString(query.instanceId);
  const recipe = cleanString(query.recipe);
  const version = query.version;

  for (const effect of actorEffects(actor)) {
    const instance = readSpellInstance(effect);
    if (!instance) {
      continue;
    }
    if (instanceId && instance.instanceId !== instanceId) {
      continue;
    }
    if (recipe && instance.recipe !== recipe) {
      continue;
    }
    if (version !== undefined && instance.version !== version) {
      continue;
    }
    return effect;
  }
  return null;
}

export class SpellInstanceRuntime {
  #coordinator;
  #linkDependency;
  #registry;

  constructor({
    registry,
    coordinator = new WorldMutationCoordinator(),
    linkDependency = defaultLinkDependency
  } = {}) {
    if (!coordinator || typeof coordinator.runIdempotent !== "function") {
      throw new TypeError("Spell instance runtime requires a WorldMutationCoordinator.");
    }
    if (typeof linkDependency !== "function") {
      throw new TypeError("Spell instance runtime linkDependency must be a function.");
    }
    this.#coordinator = coordinator;
    this.#linkDependency = linkDependency;
    this.#registry = registry;
  }

  registerRecipe(recipe) {
    if (!this.#registry || typeof this.#registry.register !== "function") {
      throw new TypeError("Spell runtime requires a registry with a register method.");
    }
    return this.#registry.register({ ...recipe, runtime: "instance" });
  }

  readInstance({ actor, recipe, version, instanceId } = {}) {
    return recordFor(findSpellInstance(actor, { recipe, version, instanceId }));
  }

  createInstance(context, initialState) {
    const declaration = declarationFor(context?.declaration);
    const effectData = buildSpellInstanceEffectData(context, declaration, initialState);
    const actor = context?.actor;
    const actorUuid = documentUuid(actor, "Source actor");
    const instance = effectData.flags[MODULE_ID][SPELL_INSTANCE_FLAG];
    const key = `spell-instance:${actorUuid}:${instance.instanceId}`;

    return this.#coordinator.runIdempotent(key, instance.createdOperationId, async () => {
      const existing = findSpellInstance(actor, {
        recipe: instance.recipe,
        version: instance.version,
        instanceId: instance.instanceId
      });
      if (existing) {
        return recordFor(existing);
      }
      if (typeof actor?.createEmbeddedDocuments !== "function") {
        throw new TypeError("Spell instance actor must support createEmbeddedDocuments.");
      }
      const created = await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
      const effect = Array.isArray(created) ? created[0] : null;
      if (!effect) {
        throw new Error("Spell instance effect creation returned no effect.");
      }
      await this.#linkDependency(context.concentrationEffect, effect);
      return recordFor(effect) ?? { effect, ...instance };
    });
  }

  runInstanceOperation({ actor, instanceId, operationId } = {}, operation) {
    const actorUuid = documentUuid(actor, "Spell instance actor");
    const normalizedInstanceId = requireNonEmptyString(instanceId, "Spell instance ID");
    const normalizedOperationId = requireNonEmptyString(operationId, "Spell instance operation ID");
    if (typeof operation !== "function") {
      throw new TypeError("Spell instance operation must be a function.");
    }
    const key = `spell-instance:${actorUuid}:${normalizedInstanceId}`;

    return this.#coordinator.runIdempotent(key, normalizedOperationId, async () => {
      const effect = findSpellInstance(actor, { instanceId: normalizedInstanceId });
      const record = recordFor(effect);
      if (!record) {
        throw new Error(`Spell instance not found: ${normalizedInstanceId}`);
      }
      return operation(record);
    });
  }

  updateInstance({ actor, instanceId, expectedRevision, operationId, state } = {}) {
    const revision = requireNonNegativeInteger(expectedRevision, "Expected spell instance revision");
    const nextState = requireState(state);
    return this.runInstanceOperation({ actor, instanceId, operationId }, async (record) => {
      if (record.revision !== revision) {
        throw new Error(`Spell instance has stale revision: expected ${revision}, found ${record.revision}`);
      }
      if (typeof record.effect.update !== "function") {
        throw new TypeError("Spell instance effect must support update.");
      }
      const next = {
        ...record,
        revision: record.revision + 1,
        state: nextState
      };
      delete next.effect;
      await record.effect.update({ [`flags.${MODULE_ID}.${SPELL_INSTANCE_FLAG}`]: next });
      return { effect: record.effect, ...next };
    });
  }

  deleteInstance({ actor, instanceId, expectedRevision, operationId } = {}) {
    const revision = requireNonNegativeInteger(expectedRevision, "Expected spell instance revision");
    return this.runInstanceOperation({ actor, instanceId, operationId }, async (record) => {
      if (record.revision !== revision) {
        throw new Error(`Spell instance has stale revision: expected ${revision}, found ${record.revision}`);
      }
      if (typeof actor?.deleteEmbeddedDocuments !== "function") {
        throw new TypeError("Spell instance actor must support deleteEmbeddedDocuments.");
      }
      await actor.deleteEmbeddedDocuments("ActiveEffect", [record.effect.id]);
      delete record.effect;
      return record;
    });
  }
}
