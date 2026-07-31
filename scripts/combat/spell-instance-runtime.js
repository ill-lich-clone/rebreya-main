import { MODULE_ID } from "../constants.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";

export const SPELL_INSTANCE_FLAG = "spellInstance";

const SPELL_INSTANCE_MUTATION_COMMAND = "spell-instance-mutation";
const SPELL_OPERATION_JOURNAL_FLAG = "spellOperationJournal";
const SPELL_OPERATION_JOURNAL_VERSION = 1;
const DEFAULT_SPELL_OPERATION_JOURNAL_LIMIT = 128;

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

function coordinatorRequestId(key, operationId) {
  return `${key}\u0000${operationId}`;
}

function currentUserCanUpdateActor(actor) {
  const user = globalThis.game?.user;
  if (!user) return true;
  if (user?.isGM === true) return true;
  if (typeof actor?.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER");
  }
  const ownership = actor?.ownership ?? actor?._source?.ownership ?? {};
  return Number(ownership[user?.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
}

function declarationFrom(record) {
  return { recipe: record.recipe, version: record.version };
}

function actorFlag(actor, key) {
  const fromDocument = typeof actor?.getFlag === "function" ? actor.getFlag(MODULE_ID, key) : undefined;
  return fromDocument ?? actor?.flags?.[MODULE_ID]?.[key];
}

function journalEntry(declaration, operationId) {
  return { ...declarationFor(declaration), operationId: requireNonEmptyString(operationId, "Spell operation ID") };
}

function operationJournal(actor) {
  const value = actorFlag(actor, SPELL_OPERATION_JOURNAL_FLAG);
  if (value === undefined) return { entries: [], version: SPELL_OPERATION_JOURNAL_VERSION };
  if (!isPlainObject(value) || value.version !== SPELL_OPERATION_JOURNAL_VERSION || !Array.isArray(value.entries)) {
    throw new Error("Spell operation journal is invalid.");
  }
  return {
    entries: value.entries.map((entry) => journalEntry(entry, entry?.operationId)),
    version: SPELL_OPERATION_JOURNAL_VERSION
  };
}

function sameJournalEntry(entry, candidate) {
  return entry.recipe === candidate.recipe && entry.version === candidate.version
    && entry.operationId === candidate.operationId;
}

function socketResult(record) {
  const { effect, ...serialized } = record;
  return cloneSerializable(serialized);
}

async function defaultLinkDependency(concentrationEffect, instanceEffect) {
  const midiQol = globalThis.MidiQOL;
  if (typeof midiQol?.addDependent === "function") {
    await midiQol.addDependent(concentrationEffect, instanceEffect);
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
  #activeOperationCount = 0;
  #canUpdateActor;
  #coordinator;
  #linkDependency;
  #operationJournalLimit;
  #registry;
  #socketCommandBus;

  constructor({
    registry,
    coordinator = new WorldMutationCoordinator(),
    linkDependency = defaultLinkDependency,
    socketCommandBus,
    canUpdateActor = currentUserCanUpdateActor,
    operationJournalLimit = DEFAULT_SPELL_OPERATION_JOURNAL_LIMIT
  } = {}) {
    if (!coordinator || typeof coordinator.runIdempotent !== "function" || typeof coordinator.run !== "function") {
      throw new TypeError("Spell instance runtime requires a WorldMutationCoordinator.");
    }
    if (typeof linkDependency !== "function") {
      throw new TypeError("Spell instance runtime linkDependency must be a function.");
    }
    if (socketCommandBus != null && typeof socketCommandBus.request !== "function") {
      throw new TypeError("Spell instance socket command bus must support request.");
    }
    if (typeof canUpdateActor !== "function") {
      throw new TypeError("Spell instance runtime canUpdateActor must be a function.");
    }
    if (!Number.isInteger(operationJournalLimit) || operationJournalLimit < 1) {
      throw new TypeError("Spell operation journal limit must be a positive integer.");
    }
    this.#canUpdateActor = canUpdateActor;
    this.#coordinator = coordinator;
    this.#linkDependency = linkDependency;
    this.#operationJournalLimit = operationJournalLimit;
    this.#registry = registry;
    this.#socketCommandBus = socketCommandBus;
  }

  registerRecipe(recipe) {
    if (!this.#registry || typeof this.#registry.register !== "function") {
      throw new TypeError("Spell runtime requires a registry with a register method.");
    }
    return this.#registry.register({ ...recipe, runtime: "instance" });
  }

  get activeOperationCount() {
    return this.#activeOperationCount;
  }

  readInstance({ actor, recipe, version, instanceId } = {}) {
    return recordFor(findSpellInstance(actor, { recipe, version, instanceId }));
  }

  claimOperation({ actor, declaration, operationId, authoritative = false } = {}) {
    const actorUuid = documentUuid(actor, "Spell operation actor");
    const normalizedDeclaration = declarationFor(declaration);
    const normalizedOperationId = requireNonEmptyString(operationId, "Spell operation ID");
    if (typeof authoritative !== "boolean") {
      throw new TypeError("Spell operation authoritative mutation flag must be a boolean.");
    }
    if (authoritative || !this.#canUpdateActor(actor)) {
      return this.#requestMutation({
        action: "claim-operation",
        actorUuid,
        declaration: normalizedDeclaration,
        operationId: normalizedOperationId
      });
    }
    return this.#claimOperationLocal({ actor, declaration: normalizedDeclaration, operationId: normalizedOperationId });
  }

  #claimOperationLocal({ actor, declaration, operationId } = {}) {
    const actorUuid = documentUuid(actor, "Spell operation actor");
    const entry = journalEntry(declaration, operationId);
    const key = `spell-operation-journal:${actorUuid}`;
    return this.#trackOperation(() => this.#coordinator.run(key, async () => {
      const journal = operationJournal(actor);
      const existing = journal.entries.find((candidate) => sameJournalEntry(candidate, entry));
      if (existing) return { entry: cloneSerializable(existing), status: "completed" };
      if (typeof actor?.update !== "function") {
        throw new TypeError("Spell operation actor must support update.");
      }
      const next = {
        entries: [...journal.entries, entry].slice(-this.#operationJournalLimit),
        version: SPELL_OPERATION_JOURNAL_VERSION
      };
      await actor.update({ [`flags.${MODULE_ID}.${SPELL_OPERATION_JOURNAL_FLAG}`]: next });
      return { entry: cloneSerializable(entry), status: "claimed" };
    }));
  }

  createInstance(context, initialState) {
    if (!this.#canUpdateActor(context?.actor)) {
      const declaration = declarationFor(context?.declaration);
      const actorUuid = documentUuid(context?.actor, "Source actor");
      return this.#requestMutation({
        action: "create",
        actorUuid,
        concentrationEffectUuid: documentUuid(context?.concentrationEffect, "Concentration effect"),
        declaration,
        expectedRevision: 0,
        instanceId: requireNonEmptyString(context?.instanceId ?? context?.operationId, "Spell instance ID"),
        operationId: requireNonEmptyString(context?.operationId, "Spell instance operation ID"),
        sourceActivityUuid: documentUuid(context?.activity, "Source activity"),
        sourceItemUuid: documentUuid(context?.item, "Source item"),
        state: requireState(initialState)
      });
    }
    return this.#createInstanceLocal(context, initialState);
  }

  #createInstanceLocal(context, initialState) {
    const declaration = declarationFor(context?.declaration);
    const effectData = buildSpellInstanceEffectData(context, declaration, initialState);
    const actor = context?.actor;
    const actorUuid = documentUuid(actor, "Source actor");
    const instance = effectData.flags[MODULE_ID][SPELL_INSTANCE_FLAG];
    const key = `spell-instance:${actorUuid}:${instance.instanceId}`;

    return this.#trackOperation(() => this.#coordinator.runIdempotent(key, coordinatorRequestId(key, instance.createdOperationId), async () => {
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
      try {
        await this.#linkDependency(context.concentrationEffect, effect);
      }
      catch (error) {
        try {
          await actor.deleteEmbeddedDocuments?.("ActiveEffect", [effect.id]);
        }
        catch {
          // The link failure remains the actionable error even if best-effort cleanup also fails.
        }
        throw error;
      }
      return recordFor(effect) ?? { effect, ...instance };
    }));
  }

  runInstanceOperation({ actor, instanceId, operationId } = {}, operation) {
    const actorUuid = documentUuid(actor, "Spell instance actor");
    const normalizedInstanceId = requireNonEmptyString(instanceId, "Spell instance ID");
    const normalizedOperationId = requireNonEmptyString(operationId, "Spell instance operation ID");
    if (typeof operation !== "function") {
      throw new TypeError("Spell instance operation must be a function.");
    }
    const key = `spell-instance:${actorUuid}:${normalizedInstanceId}`;

    return this.#trackOperation(() => this.#coordinator.runIdempotent(key, coordinatorRequestId(key, normalizedOperationId), async () => {
      const effect = findSpellInstance(actor, { instanceId: normalizedInstanceId });
      const record = recordFor(effect);
      if (!record) {
        throw new Error(`Spell instance not found: ${normalizedInstanceId}`);
      }
      return operation(record);
    }));
  }

  updateInstance({ actor, instanceId, expectedRevision, operationId, state, authoritative = false } = {}) {
    const revision = requireNonNegativeInteger(expectedRevision, "Expected spell instance revision");
    const nextState = requireState(state);
    if (typeof authoritative !== "boolean") {
      throw new TypeError("Spell instance authoritative mutation flag must be a boolean.");
    }
    if (authoritative || !this.#canUpdateActor(actor)) {
      const record = this.readInstance({ actor, instanceId });
      if (!record) throw new Error(`Spell instance not found: ${requireNonEmptyString(instanceId, "Spell instance ID")}`);
      return this.#requestMutation({
        action: "replace-state",
        actorUuid: documentUuid(actor, "Spell instance actor"),
        declaration: declarationFrom(record),
        expectedRevision: revision,
        instanceId: requireNonEmptyString(instanceId, "Spell instance ID"),
        operationId: requireNonEmptyString(operationId, "Spell instance operation ID"),
        state: nextState
      });
    }
    return this.#updateInstanceLocal({ actor, instanceId, expectedRevision: revision, operationId, state: nextState });
  }

  #updateInstanceLocal({ actor, instanceId, expectedRevision, operationId, state } = {}) {
    return this.runInstanceOperation({ actor, instanceId, operationId }, async (record) => {
      if (record.revision !== expectedRevision) {
        throw new Error(`Spell instance has stale revision: expected ${expectedRevision}, found ${record.revision}`);
      }
      if (typeof record.effect.update !== "function") {
        throw new TypeError("Spell instance effect must support update.");
      }
      const next = {
        ...record,
        revision: record.revision + 1,
        state
      };
      delete next.effect;
      await record.effect.update({ [`flags.${MODULE_ID}.${SPELL_INSTANCE_FLAG}`]: next });
      return { effect: record.effect, ...next };
    });
  }

  deleteInstance({ actor, instanceId, expectedRevision, operationId, authoritative = false } = {}) {
    const revision = requireNonNegativeInteger(expectedRevision, "Expected spell instance revision");
    if (typeof authoritative !== "boolean") {
      throw new TypeError("Spell instance authoritative mutation flag must be a boolean.");
    }
    if (authoritative || !this.#canUpdateActor(actor)) {
      const record = this.readInstance({ actor, instanceId });
      if (!record) throw new Error(`Spell instance not found: ${requireNonEmptyString(instanceId, "Spell instance ID")}`);
      return this.#requestMutation({
        action: "delete",
        actorUuid: documentUuid(actor, "Spell instance actor"),
        declaration: declarationFrom(record),
        expectedRevision: revision,
        instanceId: requireNonEmptyString(instanceId, "Spell instance ID"),
        operationId: requireNonEmptyString(operationId, "Spell instance operation ID")
      });
    }
    return this.#deleteInstanceLocal({ actor, instanceId, expectedRevision: revision, operationId });
  }

  #deleteInstanceLocal({ actor, instanceId, expectedRevision, operationId } = {}) {
    return this.runInstanceOperation({ actor, instanceId, operationId }, async (record) => {
      if (record.revision !== expectedRevision) {
        throw new Error(`Spell instance has stale revision: expected ${expectedRevision}, found ${record.revision}`);
      }
      if (typeof actor?.deleteEmbeddedDocuments !== "function") {
        throw new TypeError("Spell instance actor must support deleteEmbeddedDocuments.");
      }
      await actor.deleteEmbeddedDocuments("ActiveEffect", [record.effect.id]);
      delete record.effect;
      return record;
    });
  }

  async executeAuthoritativeMutation(payload, { actor } = {}) {
    if (documentUuid(actor, "Spell instance actor") !== payload?.actorUuid) {
      throw new Error("Spell instance actor UUID does not match the authoritative actor.");
    }
    const declaration = declarationFor(payload.declaration);
    if (payload.action === "claim-operation") {
      return this.#claimOperationLocal({ actor, declaration, operationId: payload.operationId });
    }
    if (payload.action === "create") {
      const concentrationEffect = actorEffects(actor).find((effect) => effect?.uuid === payload.concentrationEffectUuid);
      if (!concentrationEffect) {
        throw new Error("Spell instance concentration effect is not on the authoritative actor.");
      }
      const result = await this.#createInstanceLocal({
        actor,
        activity: { uuid: payload.sourceActivityUuid },
        concentrationEffect,
        declaration,
        instanceId: payload.instanceId,
        item: { uuid: payload.sourceItemUuid },
        operationId: payload.operationId
      }, payload.state);
      return socketResult(result);
    }

    const record = this.readInstance({ actor, instanceId: payload.instanceId });
    if (!record || record.sourceActorUuid !== actor.uuid
      || record.recipe !== declaration.recipe || record.version !== declaration.version) {
      throw new Error("Spell instance declaration does not match the authoritative state.");
    }
    if (record.revision !== payload.expectedRevision) {
      throw new Error(`Spell instance has stale revision: expected ${payload.expectedRevision}, found ${record.revision}`);
    }
    if (payload.action === "replace-state") {
      return socketResult(await this.#updateInstanceLocal({
        actor, instanceId: payload.instanceId, expectedRevision: payload.expectedRevision,
        operationId: payload.operationId, state: payload.state
      }));
    }
    if (payload.action === "delete") {
      return socketResult(await this.#deleteInstanceLocal({
        actor, instanceId: payload.instanceId, expectedRevision: payload.expectedRevision,
        operationId: payload.operationId
      }));
    }
    throw new Error("Spell instance mutation action is invalid.");
  }

  #requestMutation(payload) {
    if (typeof this.#socketCommandBus?.request !== "function") {
      return Promise.reject(new Error("Spell instance mutation requires an active-GM socket command bus."));
    }
    return this.#socketCommandBus.request(SPELL_INSTANCE_MUTATION_COMMAND, payload);
  }

  #trackOperation(operation) {
    this.#activeOperationCount += 1;
    try {
      return Promise.resolve(operation()).finally(() => {
        this.#activeOperationCount -= 1;
      });
    }
    catch (error) {
      this.#activeOperationCount -= 1;
      return Promise.reject(error);
    }
  }
}
