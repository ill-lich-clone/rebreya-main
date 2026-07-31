import { MODULE_ID } from "../constants.js";
import {
  MELFS_ACTIVITY_IDS,
  MELFS_MINUTE_METEORS_RECIPE,
  MELFS_MINUTE_METEORS_VERSION
} from "../data/melfs-minute-meteors-item.js";

function numberAtLeastThree(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.max(3, Math.floor(normalized)) : 3;
}

function activitiesFor(item) {
  const activities = item?.system?.activities;
  if (!activities) return [];
  if (Array.isArray(activities)) return activities;
  if (Array.isArray(activities.contents)) return activities.contents;
  if (typeof activities.values === "function") return Array.from(activities.values());
  return Object.values(activities);
}

function activityById(item, id) {
  const activities = item?.system?.activities;
  if (typeof activities?.get === "function") {
    const found = activities.get(id);
    if (found) return found;
  }
  return activitiesFor(item).find((activity) => activity?._id === id || activity?.id === id) ?? null;
}

function completed(result) {
  if (!result || result.cancelled === true || result.counterspelled === true || result.aborted === true) {
    return false;
  }
  return result !== false && result.completed !== false;
}

function normalConcentrationEffect(context) {
  if (context?.concentrationEffect) return context.concentrationEffect;
  const effects = context?.actor?.effects;
  const values = Array.isArray(effects) ? effects : effects?.contents ?? [];
  return values.find((effect) => effect?.isConcentration === true || effect?.statuses?.has?.("concentrating")) ?? null;
}

function normalizeChoice(choice, allowed) {
  if (!choice || choice.cancelled === true) return null;
  const count = Number(choice.count);
  return allowed.includes(count) ? count : null;
}

function defaultDialog({ mode, counts }) {
  const wait = globalThis.foundry?.applications?.api?.DialogV2?.wait;
  if (typeof wait !== "function") return Promise.resolve({ cancelled: true, count: 0 });
  const buttons = counts.map((count) => ({
    action: String(count),
    label: String(count),
    callback: () => ({ cancelled: false, count })
  }));
  buttons.push({
    action: "cancel",
    label: "Отмена",
    callback: () => ({ cancelled: true, count: 0 })
  });
  return Promise.resolve(wait({
    window: { title: "Метеоры Мельфа" },
    content: `<p>Выберите число метеоров: ${counts.join(", ")}.</p>`,
    buttons,
    rejectClose: false
  })).then((result) => {
    if (result && typeof result === "object" && "count" in result) return result;
    const count = Number(result);
    return counts.includes(count) ? { cancelled: false, count } : { cancelled: true, count: 0 };
  });
}

async function defaultRunActivity(activity, usageConfig) {
  const completeActivityUse = globalThis.MidiQOL?.completeActivityUse;
  if (typeof completeActivityUse !== "function") {
    throw new Error("Midi-QOL completeActivityUse is unavailable for Melf's Minute Meteors.");
  }
  return completeActivityUse(activity, {
    ...usageConfig,
    midiOptions: {
      ...(usageConfig?.midiOptions ?? {}),
      configureDialog: false,
      workflowOptions: { autoRollDamage: "always", autoFastDamage: true }
    },
  });
}

function errorReporter(notifyError, logger, error) {
  logger?.error?.(`${MODULE_ID} | Melf's Minute Meteors automation failed.`, error);
  try {
    notifyError?.("Метеоры Мельфа: автоматизация не завершена.");
  }
  catch (notificationError) {
    logger?.error?.(`${MODULE_ID} | Failed to report Melf's Minute Meteors automation error.`, notificationError);
  }
}

function childUsage(usageConfig, { instanceId, meteorIndex, operationId } = {}) {
  const { spell: ignoredSpellConfig, ...withoutSpellSlot } = usageConfig ?? {};
  void ignoredSpellConfig;
  return {
    ...withoutSpellSlot,
    [MODULE_ID]: {
      ...(usageConfig?.[MODULE_ID] ?? {}),
      spellAutomationChild: true,
      operationId,
      ...(instanceId ? { instanceId } : {}),
      ...(Number.isInteger(meteorIndex) ? { meteorIndex } : {})
    }
  };
}

function serialQueue() {
  const tails = new Map();
  return (key, operation) => {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.catch(() => undefined).finally(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    tails.set(key, tail);
    return result;
  };
}

/** Returns the number of meteors created by a slot level, clamped to level 3. */
export function melfMeteorPool(slotLevel) {
  return 6 + Math.max(0, numberAtLeastThree(slotLevel) - 3) * 2;
}

/**
 * Builds the persisted-state recipe for Melf's Minute Meteors. The injected
 * runner intentionally stays `(activity, usageConfig)` so tests and any Midi
 * API variation share the same recipe behavior.
 */
export function buildMelfsMinuteMeteorsRecipe({
  instanceRuntime,
  dialog = defaultDialog,
  runActivity = defaultRunActivity,
  notifyError = globalThis.ui?.notifications?.error,
  logger = console
} = {}) {
  if (!instanceRuntime || typeof instanceRuntime.createInstance !== "function"
    || typeof instanceRuntime.readInstance !== "function"
    || typeof instanceRuntime.updateInstance !== "function"
    || typeof instanceRuntime.deleteInstance !== "function") {
    throw new TypeError("Melf's Minute Meteors requires the spell instance runtime.");
  }
  if (typeof dialog !== "function" || typeof runActivity !== "function") {
    throw new TypeError("Melf's Minute Meteors requires dialog and activity runners.");
  }

  const runSerial = serialQueue();
  const completedOperations = new Set();
  const inFlightOperations = new Map();

  function operationOnce(operationId, operation) {
    if (completedOperations.has(operationId)) return Promise.resolve(false);
    const inFlight = inFlightOperations.get(operationId);
    if (inFlight) return inFlight;
    const result = Promise.resolve().then(operation).finally(() => {
      inFlightOperations.delete(operationId);
      completedOperations.add(operationId);
    });
    inFlightOperations.set(operationId, result);
    return result;
  }

  function readActiveInstance(actor) {
    return instanceRuntime.readInstance({
      actor,
      recipe: MELFS_MINUTE_METEORS_RECIPE,
      version: MELFS_MINUTE_METEORS_VERSION
    });
  }

  async function choose(mode, counts) {
    return normalizeChoice(await dialog({ mode, counts }), counts);
  }

  async function executeVolley({ actor, activationMode, item, operationId, requestedCount, usageConfig }) {
    void activationMode;
    const initial = readActiveInstance(actor);
    if (!initial || initial.state?.remainingMeteors <= 0) return false;
    const key = `${actor?.uuid ?? "actor"}:${initial.instanceId}`;
    return runSerial(key, async () => {
      const burst = activityById(item, MELFS_ACTIVITY_IDS.BURST);
      if (!burst) throw new Error("Melf's Minute Meteors burst Activity is missing.");

      const count = Math.min(requestedCount, Math.max(0, Number(initial.state?.remainingMeteors) || 0));
      for (let meteorIndex = 0; meteorIndex < count; meteorIndex += 1) {
        const record = readActiveInstance(actor);
        if (!record || record.state?.remainingMeteors <= 0) return meteorIndex > 0;

        const workflow = await runActivity(burst, childUsage(usageConfig, {
          instanceId: record.instanceId,
          meteorIndex,
          operationId
        }));
        if (!completed(workflow)) return meteorIndex > 0;

        const reread = readActiveInstance(actor);
        if (!reread || reread.state?.remainingMeteors <= 0) {
          throw new Error("Melf's Minute Meteors instance disappeared before the meteor could commit.");
        }
        const remainingMeteors = reread.state.remainingMeteors - 1;
        if (remainingMeteors === 0) {
          await instanceRuntime.deleteInstance({
            actor,
            instanceId: reread.instanceId,
            expectedRevision: reread.revision,
            operationId: `${operationId}:meteor:${meteorIndex}`
          });
        }
        else {
          await instanceRuntime.updateInstance({
            actor,
            instanceId: reread.instanceId,
            expectedRevision: reread.revision,
            operationId: `${operationId}:meteor:${meteorIndex}`,
            state: { ...reread.state, remainingMeteors }
          });
        }
      }
      return true;
    });
  }

  async function postUseActivity(context) {
    if (context?.isChildInvocation || context?.action !== "cast" || !completed(context?.workflow ?? context?.results)) {
      return true;
    }
    const concentrationEffect = normalConcentrationEffect(context);
    if (!context?.actor || !context?.item || !context?.activity || !concentrationEffect) {
      errorReporter(notifyError, logger, new Error("Successful Melf cast is missing its normal concentration effect."));
      return true;
    }

    const slotLevel = numberAtLeastThree(
      context?.usageConfig?.spell?.slot
      ?? context?.workflow?.castData?.castLevel
      ?? context?.workflow?.itemLevel
      ?? context?.item?.system?.level
    );
    const totalMeteors = melfMeteorPool(slotLevel);
    let instance;
    try {
      instance = await instanceRuntime.createInstance({
        actor: context.actor,
        activity: context.activity,
        concentrationEffect,
        declaration: { recipe: MELFS_MINUTE_METEORS_RECIPE, version: MELFS_MINUTE_METEORS_VERSION },
        instanceId: context.operationId,
        item: context.item,
        operationId: context.operationId
      }, { slotLevel, remainingMeteors: totalMeteors, totalMeteors });
    }
    catch (error) {
      errorReporter(notifyError, logger, error);
      return true;
    }

    const count = await choose("initial", [0, 1, 2]);
    if (!count) return true;
    try {
      await operationOnce(context.operationId, () => executeVolley({
        actor: context.actor,
        activationMode: "initial",
        item: context.item,
        operationId: context.operationId,
        requestedCount: count,
        usageConfig: context.usageConfig
      }));
    }
    catch (error) {
      errorReporter(notifyError, logger, error);
    }
    void instance;
    return true;
  }

  async function prepareReleaseAndReplay(context) {
    const instance = readActiveInstance(context.actor);
    if (!instance || instance.state?.remainingMeteors <= 0) return;
    const count = await choose("release", [1, 2]);
    if (!count) return;
    const release = activityById(context.item, MELFS_ACTIVITY_IDS.RELEASE);
    if (!release) {
      errorReporter(notifyError, logger, new Error("Melf's Minute Meteors release Activity is missing."));
      return;
    }
    try {
      const replay = await runActivity(release, childUsage(context.usageConfig, { operationId: context.operationId }));
      if (!completed(replay)) return;
      await executeVolley({
        actor: context.actor,
        activationMode: "release",
        item: context.item,
        operationId: context.operationId,
        requestedCount: count,
        usageConfig: context.usageConfig
      });
    }
    catch (error) {
      errorReporter(notifyError, logger, error);
    }
  }

  return {
    recipe: MELFS_MINUTE_METEORS_RECIPE,
    version: MELFS_MINUTE_METEORS_VERSION,
    validateState(state) {
      return Number.isInteger(state?.slotLevel) && state.slotLevel >= 3
        && Number.isInteger(state?.remainingMeteors) && state.remainingMeteors >= 0
        && Number.isInteger(state?.totalMeteors) && state.totalMeteors >= state.remainingMeteors;
    },
    buildInitialState(context) {
      const slotLevel = numberAtLeastThree(
        context?.usageConfig?.spell?.slot
        ?? context?.workflow?.castData?.castLevel
        ?? context?.workflow?.itemLevel
        ?? context?.item?.system?.level
      );
      const totalMeteors = melfMeteorPool(slotLevel);
      return { slotLevel, remainingMeteors: totalMeteors, totalMeteors };
    },
    handlers: {
      preUseActivity(context) {
        if (context?.isChildInvocation || context?.action !== "release") return true;
        void operationOnce(context.operationId, () => prepareReleaseAndReplay(context));
        return false;
      },
      postUseActivity,
      activeEffectChanged() {
        return true;
      }
    }
  };
}
