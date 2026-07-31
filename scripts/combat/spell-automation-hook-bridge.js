import { MODULE_ID } from "../constants.js";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readModuleFlag(source) {
  if (!isRecord(source)) {
    return undefined;
  }

  const fromDocument = typeof source.getFlag === "function"
    ? source.getFlag(MODULE_ID, "spellAutomation")
    : undefined;
  return fromDocument ?? source.flags?.[MODULE_ID]?.spellAutomation;
}

function isDeclaration(value) {
  return isRecord(value)
    && typeof value.runtime === "string" && value.runtime.length > 0
    && typeof value.recipe === "string" && value.recipe.length > 0
    && Number.isInteger(value.version) && value.version > 0;
}

function isSummonDeclaration(value) {
  return isDeclaration(value) && value.runtime === "summon";
}

function summonOperationId(options) {
  const candidates = [options?.summons?.[MODULE_ID], options?.[MODULE_ID], options?.flags?.[MODULE_ID]];
  return candidates.find((candidate) => typeof candidate?.operationId === "string" && candidate.operationId.length > 0)?.operationId;
}

function operationIdFallback() {
  return globalThis.foundry?.utils?.randomID?.(16)
    ?? globalThis.crypto?.randomUUID?.()
    ?? `spell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function moduleUsageConfig(usageConfig) {
  const direct = usageConfig?.[MODULE_ID];
  const flagged = usageConfig?.flags?.[MODULE_ID];
  if (!isRecord(direct)) {
    return isRecord(flagged) ? flagged : {};
  }
  if (!isRecord(flagged)) {
    return direct;
  }
  return { ...flagged, ...direct };
}

function usageConfigFor(eventName, rawArgs, workflow) {
  if (eventName === "preUseActivity" || eventName === "postUseActivity") {
    return rawArgs[1] ?? {};
  }

  if (workflow) {
    return workflow.options ?? workflow.config ?? workflow.workflowOptions ?? {};
  }

  return {};
}

function isPromise(value) {
  return value !== null && (typeof value === "object" || typeof value === "function")
    && typeof value.then === "function";
}

function operationIdFrom(source, usageConfig, options) {
  const existing = options.operationId
    ?? moduleUsageConfig(usageConfig).operationId
    ?? source?.operationId
    ?? source?.options?.[MODULE_ID]?.operationId
    ?? source?.options?.flags?.[MODULE_ID]?.operationId;
  if (typeof existing === "string" && existing.length > 0) {
    return existing;
  }

  return (options.operationIdFactory ?? operationIdFallback)();
}

function hasOperationId(value) {
  return typeof value === "string" && value.length > 0;
}

function persistOperationId(usageConfig, operationId) {
  if (!isRecord(usageConfig) || !hasOperationId(operationId)) {
    return;
  }

  if (!isRecord(usageConfig[MODULE_ID])) {
    usageConfig[MODULE_ID] = {};
  }
  if (!hasOperationId(usageConfig[MODULE_ID].operationId)) {
    usageConfig[MODULE_ID].operationId = operationId;
  }

  if (!isRecord(usageConfig.flags)) {
    usageConfig.flags = {};
  }
  if (!isRecord(usageConfig.flags[MODULE_ID])) {
    usageConfig.flags[MODULE_ID] = {};
  }
  if (!hasOperationId(usageConfig.flags[MODULE_ID].operationId)) {
    usageConfig.flags[MODULE_ID].operationId = operationId;
  }

  if (usageConfig.midiOptions == null) {
    usageConfig.midiOptions = {};
  }
  if (!isRecord(usageConfig.midiOptions)) {
    return;
  }
  if (!isRecord(usageConfig.midiOptions.workflowOptions)) {
    usageConfig.midiOptions.workflowOptions = {};
  }
  if (!isRecord(usageConfig.midiOptions.workflowOptions[MODULE_ID])) {
    usageConfig.midiOptions.workflowOptions[MODULE_ID] = {};
  }
  if (!hasOperationId(usageConfig.midiOptions.workflowOptions[MODULE_ID].operationId)) {
    usageConfig.midiOptions.workflowOptions[MODULE_ID].operationId = operationId;
  }
}

function activityFor(eventName, source) {
  if (eventName === "midiRollComplete") {
    return source?.activity ?? null;
  }

  return source?.activity ?? source ?? null;
}

function eventParts(eventName, rawArgs) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const document = args[0] ?? null;
  const workflow = eventName === "midiRollComplete" ? document : null;
  const activity = activityFor(eventName, document);
  const item = activity?.item ?? workflow?.item ?? document?.item ?? null;
  const actor = activity?.actor ?? item?.actor ?? workflow?.actor ?? workflow?.token?.actor ?? null;
  const usageConfig = usageConfigFor(eventName, args, workflow);

  return {
    args,
    document,
    workflow,
    activity,
    item,
    actor,
    usageConfig
  };
}

function tokenAndScene({ document, workflow, activity, item, actor }) {
  // Prefer the workflow's resolved target, then directly related activity,
  // item, actor, and event-document references. This never scans collections.
  const token = workflow?.token
    ?? activity?.token
    ?? item?.token
    ?? actor?.token
    ?? document?.token
    ?? null;
  const scene = token?.scene
    ?? token?.parent
    ?? workflow?.scene
    ?? activity?.scene
    ?? item?.scene
    ?? actor?.scene
    ?? document?.scene
    ?? null;
  return { token, scene };
}

function preflightSpellAutomationEvent(eventName, rawArgs) {
  const parts = eventParts(eventName, rawArgs);
  return {
    ...parts,
    declaration: declarationFor(parts.activity, parts.item, parts.document),
    isChildInvocation: isSpellAutomationChildInvocation(parts.usageConfig)
  };
}

function declarationFor(activity, item, source) {
  for (const candidate of [activity, item, source]) {
    const declaration = readModuleFlag(candidate);
    if (isDeclaration(declaration)) {
      return declaration;
    }
  }

  return null;
}

/**
 * Reads only versioned spell-automation declarations. Legacy `kind` flags are
 * intentionally not declarations for the registry bridge.
 */
export function readSpellAutomationDeclaration(source) {
  return declarationFor(source, source?.item, source);
}

export function isSpellAutomationChildInvocation(usageConfig = {}) {
  const flags = moduleUsageConfig(usageConfig);
  return flags.spellAutomationChild === true
    || (flags.spellAutomationBypass === true && flags.spellAutomationResume !== true);
}

export function buildSpellAutomationContext(eventName, rawArgs, options = {}) {
  const preflight = options.preflight ?? preflightSpellAutomationEvent(eventName, rawArgs);
  const {
    args,
    document,
    workflow,
    activity,
    item,
    actor,
    usageConfig,
    declaration,
    isChildInvocation
  } = preflight;
  const { token, scene } = tokenAndScene(preflight);
  const dialogConfig = eventName === "preUseActivity"
    ? args[2] ?? {}
    : workflow?.dialogConfig ?? workflow?.dialogOptions ?? {};
  const messageConfig = eventName === "preUseActivity"
    ? args[3] ?? {}
    : workflow?.messageConfig ?? workflow?.messageOptions ?? {};

  return {
    eventName,
    action: options.action ?? usageConfig?.action ?? document?.action ?? declaration?.action ?? eventName,
    operationId: operationIdFrom(document, usageConfig, options),
    declaration,
    isChildInvocation,
    childInvocation: isChildInvocation,
    document,
    activity,
    item,
    actor,
    token,
    scene,
    workflow,
    usageConfig,
    dialogConfig,
    messageConfig,
    rawArgs: args,
    results: options.results ?? (eventName === "postUseActivity" ? args[2] ?? null : null),
    profile: options.profile ?? null,
    tokens: options.tokens ?? [],
    summonOptions: options.summonOptions ?? {},
    tokenData: options.tokenData ?? null,
    changeType: options.changeType ?? null,
    changed: options.changed ?? null,
    options: options.hookOptions ?? {},
    prior: options.prior ?? null,
    current: options.current ?? null
  };
}

export class SpellAutomationHookBridge {
  constructor({ registry, operationIdFactory, notifyWarning, logger } = {}) {
    this.registry = registry;
    this.operationIdFactory = operationIdFactory ?? operationIdFallback;
    this.notifyWarning = notifyWarning ?? globalThis.ui?.notifications?.warn;
    this.logger = logger ?? console;
  }

  handlePreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
    const rawArgs = [activity, usageConfig, dialogConfig, messageConfig];
    const preflight = preflightSpellAutomationEvent("preUseActivity", rawArgs);
    if (preflight.isChildInvocation || !preflight.declaration) {
      return true;
    }
    const context = buildSpellAutomationContext("preUseActivity", rawArgs, {
      preflight,
      operationIdFactory: this.operationIdFactory
    });
    persistOperationId(usageConfig, context.operationId);

    try {
      const dispatched = this.registry?.dispatch?.("preUseActivity", context.declaration, context);
      if (!dispatched?.handled) {
        this.#warn("No pre-use spell automation recipe is registered for this activity.");
        return false;
      }
      if (isPromise(dispatched.value)) {
        void Promise.resolve(dispatched.value).catch((error) => {
          try {
            this.#error("Rejected spell automation pre-use handler.", error);
          }
          catch {
            // The rejection has been observed; logging must not re-reject it.
          }
        });
        this.#warn("Spell automation pre-use handlers must return synchronously.");
        return false;
      }
      return dispatched.value !== false;
    }
    catch (error) {
      this.#error("Failed to run spell automation pre-use handler.", error);
      return true;
    }
  }

  handlePostUseActivity(activity, usageConfig, results) {
    return this.#handleAsync("postUseActivity", [activity, usageConfig, results], { results });
  }

  handleMidiRollComplete(workflow) {
    return this.#handleAsync("midiRollComplete", [workflow]);
  }

  handlePostSummon(activity, profile, tokens, summonOptions) {
    return this.#handleAsync("postSummon", [activity, profile, tokens, summonOptions], {
      profile,
      tokens,
      summonOptions,
      summonOnly: true,
      operationId: summonOperationId(summonOptions)
    });
  }

  handlePreSummon(activity, profile, summonOptions) {
    return this.#handleSummonSync("preSummon", [activity, profile, summonOptions], {
      profile,
      summonOptions,
      operationId: summonOperationId(summonOptions)
    });
  }

  handleSummonToken(activity, profile, tokenData, summonOptions) {
    return this.#handleSummonSync("summonToken", [activity, profile, tokenData, summonOptions], {
      profile,
      tokenData,
      summonOptions,
      operationId: summonOperationId(summonOptions)
    });
  }

  handleActiveEffectChanged(changeType, effect, changed, options) {
    return this.#handleAsync("activeEffectChanged", [effect, changed, options], {
      action: changeType,
      changeType,
      changed,
      hookOptions: options
    });
  }

  handleMeasuredTemplateChanged(changeType, template, changed, options) {
    return this.#handleAsync("measuredTemplateChanged", [template, changed, options], {
      action: changeType,
      changeType,
      changed,
      hookOptions: options
    });
  }

  handleCombatTurnChanged(combat, prior, current) {
    return this.#handleAsync("combatTurnChanged", [combat, prior, current], { prior, current });
  }

  #handleAsync(eventName, rawArgs, options = {}) {
    const preflight = preflightSpellAutomationEvent(eventName, rawArgs);
    if (preflight.isChildInvocation || !preflight.declaration || (options.summonOnly && !isSummonDeclaration(preflight.declaration))) {
      return Promise.resolve(true);
    }
    const context = buildSpellAutomationContext(eventName, rawArgs, {
      ...options,
      preflight,
      operationIdFactory: this.operationIdFactory
    });

    try {
      const dispatched = this.registry?.dispatch?.(eventName, context.declaration, context);
      if (!dispatched?.handled) {
        return Promise.resolve(true);
      }
      return Promise.resolve(dispatched.value)
        .then((value) => value !== false)
        .catch((error) => {
          this.#error(`Failed to run spell automation ${eventName} handler.`, error);
          return true;
        });
    }
    catch (error) {
      this.#error(`Failed to run spell automation ${eventName} handler.`, error);
      return Promise.resolve(true);
    }
  }

  #handleSummonSync(eventName, rawArgs, options) {
    const preflight = preflightSpellAutomationEvent(eventName, rawArgs);
    if (preflight.isChildInvocation || !isSummonDeclaration(preflight.declaration)) {
      return true;
    }
    const context = buildSpellAutomationContext(eventName, rawArgs, {
      ...options,
      preflight,
      operationIdFactory: this.operationIdFactory
    });
    try {
      const dispatched = this.registry?.dispatch?.(eventName, context.declaration, context);
      if (!dispatched?.handled) return true;
      if (isPromise(dispatched.value)) {
        this.#warn("Summon token lifecycle handlers must return synchronously.");
        return false;
      }
      return dispatched.value !== false;
    }
    catch (error) {
      this.#error(`Failed to run spell automation ${eventName} handler.`, error);
      return true;
    }
  }

  #warn(message) {
    try {
      this.notifyWarning?.(message);
    }
    catch (error) {
      this.#error("Failed to show spell automation warning.", error);
    }
  }

  #error(message, error) {
    this.logger?.error?.(`${MODULE_ID} | ${message}`, error);
  }
}
