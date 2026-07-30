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

function operationIdFallback() {
  return globalThis.foundry?.utils?.randomID?.(16)
    ?? globalThis.crypto?.randomUUID?.()
    ?? `spell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function moduleUsageConfig(usageConfig) {
  return usageConfig?.[MODULE_ID] ?? usageConfig?.flags?.[MODULE_ID] ?? {};
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

function activityFor(eventName, source) {
  if (eventName === "midiRollComplete") {
    return source?.activity ?? null;
  }

  return source?.activity ?? source ?? null;
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
  return flags.spellAutomationChild === true || flags.spellAutomationBypass === true;
}

export function buildSpellAutomationContext(eventName, rawArgs, options = {}) {
  const args = Array.isArray(rawArgs) ? rawArgs : [];
  const source = args[0] ?? null;
  const workflow = eventName === "midiRollComplete" ? source : null;
  const activity = activityFor(eventName, source);
  const item = activity?.item ?? workflow?.item ?? source?.item ?? null;
  const actor = activity?.actor ?? item?.actor ?? workflow?.actor ?? workflow?.token?.actor ?? null;
  const usageConfig = usageConfigFor(eventName, args, workflow);
  const dialogConfig = eventName === "preUseActivity"
    ? args[2] ?? {}
    : workflow?.dialogConfig ?? workflow?.dialogOptions ?? {};
  const messageConfig = eventName === "preUseActivity"
    ? args[3] ?? {}
    : workflow?.messageConfig ?? workflow?.messageOptions ?? {};

  return {
    eventName,
    action: options.action ?? usageConfig?.action ?? source?.action ?? eventName,
    operationId: operationIdFrom(source, usageConfig, options),
    declaration: declarationFor(activity, item, source),
    childInvocation: isSpellAutomationChildInvocation(usageConfig),
    document: source,
    activity,
    item,
    actor,
    workflow,
    usageConfig,
    dialogConfig,
    messageConfig,
    rawArgs: args,
    results: options.results,
    profile: options.profile,
    tokens: options.tokens,
    summonOptions: options.summonOptions,
    changeType: options.changeType,
    changed: options.changed,
    options: options.hookOptions,
    prior: options.prior,
    current: options.current
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
    const context = buildSpellAutomationContext("preUseActivity", [activity, usageConfig, dialogConfig, messageConfig], {
      operationIdFactory: this.operationIdFactory
    });
    if (context.childInvocation || !context.declaration) {
      return true;
    }

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
      summonOptions
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
    const context = buildSpellAutomationContext(eventName, rawArgs, {
      ...options,
      operationIdFactory: this.operationIdFactory
    });
    if (context.childInvocation || !context.declaration) {
      return Promise.resolve(true);
    }

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
