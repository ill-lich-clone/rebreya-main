import { MODULE_ID } from "../constants.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";
import { spellAutomationKey } from "./spell-automation-registry.js";
import { SUMMON_LIFECYCLE_MUTATION_COMMAND, isValidSummonLifecycleMutationPayload } from "../integrations/summon-lifecycle-socket.js";

export const SUMMON_LINK_FLAG = "summonLink";

const SUMMON_RUNTIME = "summon";
const PROVIDER_CALLBACKS = Object.freeze([
  "validate",
  "prepareToken",
  "finalizeToken",
  "finalizeSummon",
  "cleanup"
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const DEFAULT_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_PENDING_CLAIMS = 128;

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isIdentifier(value) {
  return typeof value === "string" && value.length > 0 && !FORBIDDEN_KEYS.has(value);
}

function isSerializable(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isSerializable);
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  return Object.entries(value).every(([key, entry]) => !FORBIDDEN_KEYS.has(key) && isSerializable(entry));
}

function cloneSerializable(value) {
  if (!isSerializable(value)) {
    throw new TypeError("Summon lifecycle data must be plain and serializable.");
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneSerializable));
  }
  if (isPlainRecord(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneSerializable(entry)])));
  }
  return value;
}

function strictSummonDeclaration(value) {
  if (!isPlainRecord(value)
    || value.runtime !== SUMMON_RUNTIME
    || !isIdentifier(value.recipe)
    || !Number.isInteger(value.version)
    || value.version <= 0) {
    throw new TypeError("Summon declarations require runtime 'summon', a safe recipe, and a positive integer version.");
  }
  return Object.freeze({
    runtime: SUMMON_RUNTIME,
    recipe: value.recipe,
    version: value.version
  });
}

function maybeUuid(document) {
  const uuid = document?.uuid;
  if (uuid == null) {
    return null;
  }
  if (!isIdentifier(uuid)) {
    throw new TypeError("Summon lifecycle document UUIDs must be non-empty strings.");
  }
  return uuid;
}

function readActivityDeclaration(activity, context) {
  const declaration = context?.declaration
    ?? activity?.flags?.[MODULE_ID]?.spellAutomation
    ?? activity?.item?.flags?.[MODULE_ID]?.spellAutomation;
  try {
    return strictSummonDeclaration(declaration);
  }
  catch {
    return null;
  }
}

function hasLegacyCraftsmanDeclaration(activity, context) {
  return Boolean(
    context?.craftsmanConstructor
    ?? activity?.flags?.[MODULE_ID]?.craftsmanConstructor
    ?? activity?.item?.flags?.[MODULE_ID]?.craftsmanConstructor
  );
}

function operationIdFrom(value) {
  if (isIdentifier(value)) {
    return value;
  }
  return null;
}

function correlationFrom(options) {
  if (!isPlainRecord(options)) {
    return null;
  }
  const candidates = [
    options.summons?.[MODULE_ID],
    options[MODULE_ID],
    options.flags?.[MODULE_ID]
  ];
  for (const candidate of candidates) {
    const operationId = operationIdFrom(candidate?.operationId);
    if (operationId) {
      return operationId;
    }
  }
  return null;
}

function frozenTokens(tokens = []) {
  return Object.freeze(Array.from(Array.isArray(tokens) ? tokens : []));
}

function isPromise(value) {
  return value !== null && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function claimView(claim) {
  if (!claim) {
    return null;
  }
  return Object.freeze({
    operationId: claim.operationId,
    activityUuid: claim.activityUuid,
    declaration: cloneSerializable(claim.declaration),
    createdAt: claim.createdAt
  });
}

function clonePlainInput(value) {
  return value === null || value === undefined ? value : cloneSerializable(value);
}

function rawSummonLink(token) {
  return typeof token?.getFlag === "function"
    ? token.getFlag(MODULE_ID, SUMMON_LINK_FLAG)
    : token?.flags?.[MODULE_ID]?.[SUMMON_LINK_FLAG];
}

function documentId(document) {
  return isIdentifier(document?.id) ? document.id : isIdentifier(document?._id) ? document._id : null;
}

function tokenScene(token) {
  return token?.parent ?? token?.scene ?? null;
}

function tokenInScene(token) {
  const scene = tokenScene(token);
  const id = documentId(token);
  if (!scene || !isIdentifier(scene.uuid) || !id) {
    return false;
  }
  const tokens = scene.tokens;
  if (typeof tokens?.get === "function") {
    return tokens.get(id) === token;
  }
  return token.parent === scene || token.scene === scene;
}

function sameOperationMarker(link, claim) {
  return isPlainRecord(link)
    && link.runtime === SUMMON_RUNTIME
    && link.recipe === claim.declaration.recipe
    && link.version === claim.declaration.version
    && link.operationId === claim.operationId;
}

function defaultAddDependent(controllingEffect, token) {
  const midiQol = globalThis.MidiQOL;
  return typeof midiQol?.addDependent === "function"
    ? midiQol.addDependent(controllingEffect, token)
    : undefined;
}

function applyCommonLink(tokenData, link) {
  if (!isPlainRecord(tokenData)) {
    throw new TypeError("Summon token data must be a mutable plain object.");
  }
  if (!isPlainRecord(tokenData.flags)) {
    tokenData.flags = {};
  }
  if (!isPlainRecord(tokenData.flags[MODULE_ID])) {
    tokenData.flags[MODULE_ID] = {};
  }
  tokenData.flags[MODULE_ID][SUMMON_LINK_FLAG] = { ...link };
}

function applyProviderPatch(tokenData, patch) {
  if (patch === undefined || patch === null) {
    return;
  }
  if (!isPlainRecord(patch) || !isSerializable(patch)) {
    throw new TypeError("Summon provider token patches must be serializable plain objects.");
  }
  const allowed = new Set(["name", "disposition", "actorLink", "texture", "sight", "detectionModes", "flags"]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Summon provider token patch field '${key}' is not allowed.`);
    }
  }
  for (const key of ["name", "disposition", "actorLink", "texture", "sight", "detectionModes"]) {
    if (Object.hasOwn(patch, key)) {
      tokenData[key] = structuredClone(patch[key]);
    }
  }
  if (!Object.hasOwn(patch, "flags")) {
    return;
  }
  const flags = patch.flags;
  if (!isPlainRecord(flags) || Object.keys(flags).some((key) => key !== MODULE_ID)) {
    throw new TypeError("Summon provider patches may write only this module's provider flag.");
  }
  const moduleFlags = flags[MODULE_ID];
  if (!isPlainRecord(moduleFlags) || Object.keys(moduleFlags).some((key) => key !== "provider")) {
    throw new TypeError("Summon provider patches may write only the provider flag namespace.");
  }
  if (!isPlainRecord(tokenData.flags)) tokenData.flags = {};
  if (!isPlainRecord(tokenData.flags[MODULE_ID])) tokenData.flags[MODULE_ID] = {};
  tokenData.flags[MODULE_ID].provider = structuredClone(moduleFlags.provider);
}

/**
 * Builds the common persisted token-link shape. It deliberately does not
 * write anything: document stamping starts in the next lifecycle task.
 */
export function buildSummonLink({ declaration, operationId, activity, sourceToken, controllingEffect } = {}) {
  const managedDeclaration = strictSummonDeclaration(declaration);
  const safeOperationId = operationIdFrom(operationId);
  if (!safeOperationId) {
    throw new TypeError("Summon links require a safe operation ID.");
  }
  return Object.freeze({
    runtime: SUMMON_RUNTIME,
    recipe: managedDeclaration.recipe,
    version: managedDeclaration.version,
    operationId: safeOperationId,
    sourceActorUuid: maybeUuid(activity?.actor),
    sourceTokenUuid: maybeUuid(sourceToken),
    sourceItemUuid: maybeUuid(activity?.item),
    sourceActivityUuid: maybeUuid(activity),
    controllingEffectUuid: maybeUuid(controllingEffect)
  });
}

/** Reads only a strict common link; malformed/foreign data is ignored. */
export function readSummonLink(token) {
  const link = typeof token?.getFlag === "function"
    ? token.getFlag(MODULE_ID, SUMMON_LINK_FLAG)
    : token?.flags?.[MODULE_ID]?.[SUMMON_LINK_FLAG];
  if (!isPlainRecord(link)) {
    return null;
  }
  try {
    const declaration = strictSummonDeclaration(link);
    const operationId = operationIdFrom(link.operationId);
    if (!operationId) {
      return null;
    }
    const sourceFields = [
      "sourceActorUuid",
      "sourceTokenUuid",
      "sourceItemUuid",
      "sourceActivityUuid",
      "controllingEffectUuid"
    ];
    const result = {
      runtime: SUMMON_RUNTIME,
      recipe: declaration.recipe,
      version: declaration.version,
      operationId
    };
    for (const field of sourceFields) {
      const value = link[field];
      if (value !== null && value !== undefined && !isIdentifier(value)) {
        return null;
      }
      result[field] = value ?? null;
    }
    return Object.freeze(result);
  }
  catch {
    return null;
  }
}

export class SummonLifecycleRuntime {
  #registry;
  #operationIdFactory;
  #now;
  #claimTimeoutMs;
  #maxPendingClaims;
  #coordinator;
  #addDependent;
  #socketCommandBus;
  #canUpdateScene;
  #providers = new Map();
  #claimsByActivity = new Map();
  #claimsByOptions = new WeakMap();
  #optionsByClaim = new WeakMap();
  #claimsByOperation = new Map();

  constructor({ registry, coordinator = new WorldMutationCoordinator(), addDependent = defaultAddDependent, socketCommandBus, canUpdateScene = (scene) => scene?.isOwner !== false, operationIdFactory, clock, now, claimTimeoutMs = DEFAULT_CLAIM_TIMEOUT_MS, maxPendingClaims = DEFAULT_MAX_PENDING_CLAIMS } = {}) {
    if (!registry || typeof registry.register !== "function" || typeof registry.resolve !== "function") {
      throw new TypeError("SummonLifecycleRuntime requires a SpellAutomationRegistry-compatible registry.");
    }
    if (typeof operationIdFactory !== "function") {
      throw new TypeError("SummonLifecycleRuntime requires an operationIdFactory function.");
    }
    if (!coordinator || typeof coordinator.runIdempotent !== "function") {
      throw new TypeError("SummonLifecycleRuntime requires a mutation coordinator.");
    }
    if (typeof addDependent !== "function") {
      throw new TypeError("SummonLifecycleRuntime addDependent must be a function.");
    }
    if (socketCommandBus != null && typeof socketCommandBus.request !== "function") {
      throw new TypeError("SummonLifecycleRuntime socket command bus must support request.");
    }
    if (typeof canUpdateScene !== "function") {
      throw new TypeError("SummonLifecycleRuntime canUpdateScene must be a function.");
    }
    const clockSource = now ?? clock;
    if (clockSource !== undefined && typeof clockSource !== "function") {
      throw new TypeError("SummonLifecycleRuntime clock must be a function.");
    }
    if (!Number.isFinite(claimTimeoutMs) || claimTimeoutMs <= 0) {
      throw new TypeError("SummonLifecycleRuntime claimTimeoutMs must be positive.");
    }
    if (!Number.isInteger(maxPendingClaims) || maxPendingClaims <= 0) {
      throw new TypeError("SummonLifecycleRuntime maxPendingClaims must be a positive integer.");
    }
    this.#registry = registry;
    this.#operationIdFactory = operationIdFactory;
    this.#coordinator = coordinator;
    this.#addDependent = addDependent;
    this.#socketCommandBus = socketCommandBus;
    this.#canUpdateScene = canUpdateScene;
    this.#now = clockSource ?? (() => Date.now());
    this.#claimTimeoutMs = claimTimeoutMs;
    this.#maxPendingClaims = maxPendingClaims;
  }

  get pendingClaimCount() {
    this.#pruneExpired();
    return this.#claimsByOperation.size;
  }

  registerProvider(provider) {
    this.#pruneExpired();
    if (!isPlainRecord(provider)) {
      throw new TypeError("Summon providers must be plain objects.");
    }
    const declaration = strictSummonDeclaration(provider);
    const config = provider.config === undefined ? Object.freeze({}) : cloneSerializable(provider.config);
    const callbacks = {};
    for (const [name, value] of Object.entries(provider)) {
      if (PROVIDER_CALLBACKS.includes(name)) {
        if (typeof value !== "function") {
          throw new TypeError(`Summon provider callback '${name}' must be a function.`);
        }
        if (name === "prepareToken" && value.constructor?.name === "AsyncFunction") {
          throw new TypeError("Summon provider prepareToken callbacks must be synchronous.");
        }
        callbacks[name] = value;
      }
      else if (typeof value === "function") {
        throw new TypeError(`Unknown summon provider lifecycle callback '${name}'.`);
      }
    }
    const key = spellAutomationKey(declaration);
    if (this.#providers.has(key)) {
      throw new Error(`Summon provider already registered for ${key}.`);
    }
    const frozenCallbacks = Object.freeze({ ...callbacks });
    const providerView = Object.freeze({ ...declaration, config, callbacks: frozenCallbacks });
    const handlers = Object.freeze({
      preUseActivity: (_definition, context) => this.claimPreUse(context),
      preSummon: (_definition, context) => this.bindPreSummon(context),
      summonToken: (_definition, context) => this.prepareSummonToken(context),
      postSummon: (_definition, context) => this.finalizeSummon(context)
    });
    const registered = this.#registry.register({ ...declaration, handlers });
    this.#providers.set(key, providerView);
    return registered;
  }

  claimPreUse(context = {}) {
    this.#pruneExpired();
    const activity = context.activity;
    if (hasLegacyCraftsmanDeclaration(activity, context)) {
      return null;
    }
    const declaration = readActivityDeclaration(activity, context);
    const activityUuid = maybeUuid(activity);
    if (!declaration || !activityUuid) {
      return null;
    }
    const key = spellAutomationKey(declaration);
    const provider = this.#providers.get(key);
    if (!provider) {
      return null;
    }
    const operationId = operationIdFrom(context.operationId) ?? operationIdFrom(this.#operationIdFactory());
    if (!operationId) {
      throw new TypeError("Summon operationIdFactory must return a non-empty string.");
    }
    const existing = this.#claimsByOperation.get(operationId);
    if (existing) {
      this.#copyCorrelation(context.usageConfig, existing);
      return claimView(existing);
    }
    const validationResult = provider.callbacks.validate?.(this.#validationContext(provider, declaration, operationId, activity, context));
    if (isPromise(validationResult)) {
      throw new TypeError("Summon provider validate callbacks must return synchronously.");
    }
    if (validationResult === false) {
      return null;
    }
    const now = this.#readNow();
    const claim = {
      operationId,
      activityUuid,
      declaration,
      createdAt: now
    };
    Object.defineProperties(claim, {
      activity: { value: activity },
      config: { value: provider.config },
      sourceTokenUuid: { value: maybeUuid(context.sourceToken ?? context.token) }
    });
    this.#claimsByOperation.set(operationId, claim);
    const activityClaims = this.#claimsByActivity.get(activityUuid) ?? [];
    activityClaims.push(claim);
    this.#claimsByActivity.set(activityUuid, activityClaims);
    this.#enforceBound();
    if (!this.#claimsByOperation.has(operationId)) {
      return null;
    }
    this.#copyCorrelation(context.usageConfig, claim);
    return claimView(claim);
  }

  bindPreSummon(context = {}) {
    this.#pruneExpired();
    const activityUuid = maybeUuid(context.activity);
    const summonOptions = context.summonOptions;
    if (!activityUuid || !isPlainRecord(summonOptions)) {
      return null;
    }
    const alreadyBound = this.#claimsByOptions.get(summonOptions);
    if (alreadyBound) {
      return alreadyBound.activityUuid === activityUuid ? claimView(alreadyBound) : null;
    }
    const explicitOperationId = correlationFrom(summonOptions);
    let claim = null;
    if (explicitOperationId) {
      const candidate = this.#claimsByOperation.get(explicitOperationId);
      if (!candidate || candidate.activityUuid !== activityUuid) {
        return null;
      }
      claim = candidate;
    }
    else {
      claim = (this.#claimsByActivity.get(activityUuid) ?? []).find((candidate) => !this.#optionsByClaim.has(candidate)) ?? null;
    }
    const boundOptions = claim ? this.#optionsByClaim.get(claim) : null;
    if (!claim || (boundOptions && boundOptions !== summonOptions)) {
      return null;
    }
    this.#optionsByClaim.set(claim, summonOptions);
    this.#claimsByOptions.set(summonOptions, claim);
    return claimView(claim);
  }

  prepareSummonToken(context = {}) {
    this.#pruneExpired();
    const claim = this.#claimForOptions(context.summonOptions, context.activity);
    if (!claim) {
      return null;
    }
    const link = this.#commonLink(claim, context);
    applyCommonLink(context.tokenData, link);
    const patch = this.#providerForClaim(claim)?.callbacks.prepareToken?.(
      this.#providerContext(claim, context, [], { tokenData: cloneSerializable(context.tokenData) })
    );
    if (isPromise(patch)) {
      throw new TypeError("Summon provider prepareToken callbacks must return synchronously.");
    }
    applyProviderPatch(context.tokenData, patch);
    applyCommonLink(context.tokenData, link);
    return claimView(claim);
  }

  async finalizeSummon(context = {}) {
    this.#pruneExpired();
    const claim = this.#claimForOptions(context.summonOptions, context.activity);
    if (!claim) {
      return null;
    }
    const operationTokens = this.#operationTokens(claim, context.tokens);
    const scene = tokenScene(operationTokens[0]);
    const key = `summon:${scene?.uuid ?? claim.activityUuid}:${claim.operationId}`;
    const requestId = [scene?.uuid ?? "", claim.activityUuid, claim.declaration.recipe, claim.declaration.version, claim.operationId].join("\u0000");
    return this.#coordinator.runIdempotent(key, requestId, async () => {
      const currentTokens = this.#operationTokens(claim, context.tokens);
      const provider = this.#providerForClaim(claim);
      try {
        for (const token of currentTokens) {
          await this.#ensureFinalLink(claim, token, context);
          if (context.controllingEffect) {
            await this.#addDependent(context.controllingEffect, token);
          }
          await provider?.callbacks.finalizeToken?.(this.#providerContext(claim, context, currentTokens, { token }));
        }
        await provider?.callbacks.finalizeSummon?.(this.#providerContext(claim, context, currentTokens));
        this.#removeClaim(claim);
        return claimView(claim);
      }
      catch (error) {
        const rollbackTokens = this.#operationTokens(claim, context.tokens);
        await this.#rollbackTokens(rollbackTokens);
        try {
          await provider?.callbacks.cleanup?.(this.#providerContext(claim, context, rollbackTokens, { error }));
        }
        finally {
          this.#removeClaim(claim);
        }
        throw error;
      }
    });
  }

  cancelClaim(claimOrContext) {
    this.#pruneExpired();
    const claim = this.#resolveClaim(claimOrContext);
    if (!claim) {
      return false;
    }
    this.#removeClaim(claim);
    return true;
  }

  failClaim(claimOrContext) {
    return this.cancelClaim(claimOrContext);
  }

  async handleSocketMutation(payload, { actor, scene } = {}) {
    if (!isValidSummonLifecycleMutationPayload(payload)) {
      throw new TypeError("Summon lifecycle mutation payload is invalid.");
    }
    if (actor?.uuid !== payload.actorUuid || scene?.uuid !== payload.sceneUuid) {
      throw new Error("Summon lifecycle mutation documents do not match the payload.");
    }
    const requestId = [payload.sceneUuid, payload.actorUuid, payload.declaration.recipe, payload.declaration.version, payload.operationId, payload.action, ...payload.tokenIds].join("\u0000");
    return this.#coordinator.runIdempotent(`summon-socket:${payload.sceneUuid}:${payload.declaration.recipe}:v${payload.declaration.version}`, requestId, async () => {
      const tokens = payload.tokenIds.map((id) => scene.tokens?.get?.(id)).filter((token) => token && this.#matchesSocketLink(token, payload));
      if (payload.action === "ensure-link") {
        for (const token of tokens) {
          if (typeof token.update !== "function") throw new TypeError("Summon token must support update.");
          await token.update({ [`flags.${MODULE_ID}.${SUMMON_LINK_FLAG}`]: payload.link });
        }
      }
      else if (tokens.length) {
        if (typeof scene.deleteEmbeddedDocuments !== "function") throw new TypeError("Summon scene must support token deletion.");
        await scene.deleteEmbeddedDocuments("Token", tokens.map(documentId));
      }
      return Object.freeze({ action: payload.action, tokenIds: Object.freeze(tokens.map(documentId)) });
    });
  }

  #providerContext(claim, context, tokens, extra = {}) {
    return Object.freeze({
      operationId: claim.operationId,
      declaration: cloneSerializable(claim.declaration),
      activity: claim.activity,
      item: claim.activity?.item ?? null,
      sourceActor: claim.activity?.actor ?? null,
      sourceToken: context.sourceToken ?? context.token ?? null,
      controllingEffect: context.controllingEffect ?? null,
      profile: clonePlainInput(context.profile),
      summonOptions: clonePlainInput(context.summonOptions),
      tokenData: extra.tokenData ?? (context.tokenData ? cloneSerializable(context.tokenData) : null),
      token: extra.token ?? context.token ?? null,
      tokens: frozenTokens(tokens),
      config: claim.config,
      mutate: null,
      error: extra.error ?? null
    });
  }

  #validationContext(provider, declaration, operationId, activity, context) {
    return Object.freeze({
      operationId,
      declaration: cloneSerializable(declaration),
      activity,
      item: activity?.item ?? null,
      sourceActor: activity?.actor ?? null,
      sourceToken: context.sourceToken ?? context.token ?? null,
      controllingEffect: context.controllingEffect ?? null,
      profile: clonePlainInput(context.profile),
      summonOptions: clonePlainInput(context.summonOptions),
      tokenData: null,
      token: null,
      tokens: frozenTokens(),
      config: provider.config,
      mutate: null
    });
  }

  #claimForOptions(summonOptions, activity) {
    if (!isPlainRecord(summonOptions)) {
      return null;
    }
    const claim = this.#claimsByOptions.get(summonOptions);
    if (!claim || (activity && claim.activityUuid !== maybeUuid(activity))) {
      return null;
    }
    return claim;
  }

  #resolveClaim(claimOrContext) {
    if (isPlainRecord(claimOrContext) && isIdentifier(claimOrContext.operationId)) {
      return this.#claimsByOperation.get(claimOrContext.operationId) ?? null;
    }
    if (isIdentifier(claimOrContext)) {
      return this.#claimsByOperation.get(claimOrContext) ?? null;
    }
    return null;
  }

  #providerForClaim(claim) {
    return this.#providers.get(spellAutomationKey(claim.declaration)) ?? null;
  }

  #commonLink(claim, context) {
    return buildSummonLink({
      declaration: claim.declaration,
      operationId: claim.operationId,
      activity: claim.activity,
      sourceToken: context.sourceToken ?? context.token ?? (claim.sourceTokenUuid ? { uuid: claim.sourceTokenUuid } : null),
      controllingEffect: context.controllingEffect
    });
  }

  #operationTokens(claim, tokens) {
    return Array.from(Array.isArray(tokens) ? tokens : []).filter((token) => tokenInScene(token)
      && sameOperationMarker(rawSummonLink(token), claim));
  }

  async #ensureFinalLink(claim, token, context) {
    const expected = this.#commonLink(claim, context);
    const current = readSummonLink(token);
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      if (typeof token.update !== "function") {
        throw new TypeError("Summon token must support update to repair its common link.");
      }
      const scene = tokenScene(token);
      if (this.#canUpdateScene(scene)) {
        await token.update({ [`flags.${MODULE_ID}.${SUMMON_LINK_FLAG}`]: expected });
      }
      else {
        await this.#requestSocketMutation({
          action: "ensure-link", actorUuid: expected.sourceActorUuid, sceneUuid: scene?.uuid, tokenIds: [documentId(token)],
          declaration: { recipe: expected.recipe, version: expected.version }, operationId: expected.operationId, link: expected
        });
      }
    }
  }

  async #rollbackTokens(tokens) {
    const byScene = new Map();
    for (const token of tokens) {
      const scene = tokenScene(token);
      const id = documentId(token);
      if (!scene || !id) continue;
      const ids = byScene.get(scene) ?? [];
      ids.push(id);
      byScene.set(scene, ids);
    }
    for (const [scene, ids] of byScene) {
      if (!ids.length) continue;
      const link = readSummonLink(scene.tokens?.get?.(ids[0]));
      if (this.#canUpdateScene(scene)) {
        if (typeof scene.deleteEmbeddedDocuments === "function") await scene.deleteEmbeddedDocuments("Token", ids);
      }
      else if (link) {
        await this.#requestSocketMutation({
          action: "delete-operation-tokens", actorUuid: link.sourceActorUuid, sceneUuid: scene.uuid, tokenIds: ids,
          declaration: { recipe: link.recipe, version: link.version }, operationId: link.operationId, link
        });
      }
    }
  }

  #matchesSocketLink(token, payload) {
    const link = readSummonLink(token);
    return Boolean(link && link.recipe === payload.declaration.recipe && link.version === payload.declaration.version
      && link.operationId === payload.operationId && link.sourceActorUuid === payload.actorUuid);
  }

  #requestSocketMutation(payload) {
    if (typeof this.#socketCommandBus?.request !== "function") {
      return Promise.reject(new Error("Summon lifecycle mutation requires an active-GM socket command bus."));
    }
    return this.#socketCommandBus.request(SUMMON_LIFECYCLE_MUTATION_COMMAND, payload);
  }

  #copyCorrelation(usageConfig, claim) {
    if (!isPlainRecord(usageConfig)) {
      return;
    }
    if (!isPlainRecord(usageConfig.summons)) {
      usageConfig.summons = {};
    }
    usageConfig.summons[MODULE_ID] = {
      operationId: claim.operationId,
      runtime: SUMMON_RUNTIME,
      recipe: claim.declaration.recipe,
      version: claim.declaration.version
    };
  }

  #readNow() {
    const now = this.#now();
    if (!Number.isFinite(now)) {
      throw new TypeError("SummonLifecycleRuntime clock must return a finite timestamp.");
    }
    return now;
  }

  #pruneExpired() {
    const now = this.#readNow();
    for (const claim of Array.from(this.#claimsByOperation.values())) {
      if (now - claim.createdAt >= this.#claimTimeoutMs) {
        this.#removeClaim(claim);
      }
    }
  }

  #enforceBound() {
    while (this.#claimsByOperation.size > this.#maxPendingClaims) {
      const oldest = this.#claimsByOperation.values().next().value;
      this.#removeClaim(oldest);
    }
  }

  #removeClaim(claim) {
    if (!claim || this.#claimsByOperation.get(claim.operationId) !== claim) {
      return;
    }
    this.#claimsByOperation.delete(claim.operationId);
    const activityClaims = this.#claimsByActivity.get(claim.activityUuid);
    if (activityClaims) {
      const remaining = activityClaims.filter((candidate) => candidate !== claim);
      if (remaining.length === 0) {
        this.#claimsByActivity.delete(claim.activityUuid);
      }
      else {
        this.#claimsByActivity.set(claim.activityUuid, remaining);
      }
    }
    const boundOptions = this.#optionsByClaim.get(claim);
    if (boundOptions) {
      this.#claimsByOptions.delete(boundOptions);
      this.#optionsByClaim.delete(claim);
    }
  }
}
