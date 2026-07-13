import { MODULE_ID } from "../constants.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const UPDATE_COMBAT_HOOK = "updateCombat";
const PATCHED_MARKER = "__rebreyaEffectMacroCombatCompatPatched";
const SOCKET_EVENT_EFFECTMACRO_UPDATE_COMBAT = "effectmacro-update-combat";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const ACTORLESS_APPLIED_EFFECTS_PATTERN = /Cannot read properties of undefined \(reading ['"]appliedEffects['"]\)/u;
const ACTORLESS_TEST_USER_PERMISSION_PATTERN = /Cannot read properties of undefined \(reading ['"]testUserPermission['"]\)/u;

let effectMacroCombatSocketHook = null;
let effectMacroCombatSocketRegistered = false;
const effectMacroCombatCoordinator = new WorldMutationCoordinator();

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createRequestId() {
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `effectmacro-${Date.now()}-${randomPart}`;
}

function cloneSocketData(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value ?? {});
  }

  return value == null ? {} : JSON.parse(JSON.stringify(value));
}

function getHookEntries(hookName, HooksApi = globalThis.Hooks) {
  const stores = [HooksApi?.events, HooksApi?._hooks];
  for (const store of stores) {
    const entries = store?.[hookName];
    if (Array.isArray(entries)) {
      return entries;
    }
  }

  return null;
}

function getHookFunction(entry) {
  return typeof entry === "function" ? entry : entry?.fn;
}

function setHookFunction(entries, index, entry, hookFunction) {
  if (typeof entry === "function") {
    entries[index] = hookFunction;
    return;
  }

  entry.fn = hookFunction;
}

function isActorlessAppliedEffectsError(error) {
  return error instanceof TypeError && ACTORLESS_APPLIED_EFFECTS_PATTERN.test(String(error.message ?? ""));
}

function isActorlessExecutorError(error) {
  return error instanceof TypeError && ACTORLESS_TEST_USER_PERMISSION_PATTERN.test(String(error.message ?? ""));
}

function isEffectMacroActorlessError(error) {
  return isActorlessAppliedEffectsError(error) || isActorlessExecutorError(error);
}

function isEffectMacroCombatHook(hookFunction) {
  if (typeof hookFunction !== "function" || hookFunction[PATCHED_MARKER]) {
    return false;
  }

  if (hookFunction.name !== UPDATE_COMBAT_HOOK) {
    return false;
  }

  const source = Function.prototype.toString.call(hookFunction);
  return source.includes("appliedEffects") || source.includes("_executeAppliedEffects");
}

function getCombatPayload(args) {
  const [combat, update = {}, options = {}] = args;
  const combatUuid = cleanString(combat?.uuid);
  const combatId = cleanString(combat?.id);
  if (!combatUuid && !combatId) {
    return null;
  }

  return {
    combatUuid,
    combatId,
    sceneUuid: cleanString(combat?.scene?.uuid),
    sceneId: cleanString(combat?.scene?.id ?? combat?.sceneId),
    update: cloneSocketData(update),
    options: cloneSocketData(options)
  };
}

function resolveCombatFromPayload(payload = {}) {
  const combatUuid = cleanString(payload.combatUuid);
  const combatId = cleanString(payload.combatId);
  if (combatUuid) {
    const combat = globalThis.foundry?.utils?.fromUuidSync?.(combatUuid);
    if (combat) {
      return combat;
    }
  }

  const combats = globalThis.game?.combats;
  return combats?.get?.(combatId)
    ?? combats?.contents?.find?.((combat) => combat?.id === combatId)
    ?? (globalThis.game?.combat?.id === combatId ? globalThis.game.combat : null);
}

function requestGmEffectMacroCombatUpdate(args) {
  if (globalThis.game?.user?.isGM) {
    return;
  }

  const payload = getCombatPayload(args);
  if (!payload) {
    return;
  }

  globalThis.game?.socket?.emit?.(SOCKET_CHANNEL, {
    type: SOCKET_EVENT_EFFECTMACRO_UPDATE_COMBAT,
    requestId: createRequestId(),
    payload,
    senderId: cleanString(globalThis.game?.user?.id)
  });
}

async function handleEffectMacroCombatSocketMessage(message, transportSenderId) {
  if (message?.type !== SOCKET_EVENT_EFFECTMACRO_UPDATE_COMBAT || !isActiveGmClient(globalThis.game)) {
    return;
  }

  const requestId = cleanString(message.requestId);
  const senderId = cleanString(message.senderId);
  const authenticatedSenderId = cleanString(transportSenderId);
  if (!requestId || !senderId || !authenticatedSenderId || authenticatedSenderId !== senderId) {
    return;
  }

  const combat = resolveCombatFromPayload(message.payload ?? {});
  if (!combat || typeof effectMacroCombatSocketHook !== "function") {
    return;
  }

  try {
    await effectMacroCombatCoordinator.runIdempotent(
      `effectmacro-combat:${cleanString(combat.id ?? combat.uuid)}`,
      `${senderId}\u0000${SOCKET_EVENT_EFFECTMACRO_UPDATE_COMBAT}\u0000${requestId}`,
      () => effectMacroCombatSocketHook(
        combat,
        cloneSocketData(message.payload?.update),
        cloneSocketData(message.payload?.options)
      )
    );
  }
  catch (error) {
    if (isEffectMacroActorlessError(error)) {
      return;
    }

    console.warn(`${MODULE_ID} | Failed to run EffectMacro combat hook from socket.`, error);
  }
}

function registerEffectMacroCombatSocket(originalHook) {
  if (typeof originalHook !== "function") {
    return;
  }

  effectMacroCombatSocketHook = originalHook;
  if (effectMacroCombatSocketRegistered) {
    return;
  }

  if (typeof globalThis.game?.socket?.on !== "function") {
    return;
  }

  globalThis.game.socket.on(SOCKET_CHANNEL, handleEffectMacroCombatSocketMessage);
  effectMacroCombatSocketRegistered = true;
}

function handleEffectMacroActorlessError(error, args) {
  if (!isEffectMacroActorlessError(error)) {
    throw error;
  }

  requestGmEffectMacroCombatUpdate(args);
  return undefined;
}

function createSafeEffectMacroCombatHook(originalHook) {
  const safeHook = function rebreyaEffectMacroUpdateCombatCompat(...args) {
    if (globalThis.game?.user?.isGM === true && !isActiveGmClient(globalThis.game)) {
      return undefined;
    }

    try {
      const result = originalHook.call(this, ...args);
      if (result && typeof result.catch === "function") {
        return result.catch((error) => handleEffectMacroActorlessError(error, args));
      }

      return result;
    }
    catch (error) {
      return handleEffectMacroActorlessError(error, args);
    }
  };

  Object.defineProperty(safeHook, PATCHED_MARKER, { value: true });
  return safeHook;
}

export function patchEffectMacroCombatHooks(HooksApi = globalThis.Hooks) {
  const entries = getHookEntries(UPDATE_COMBAT_HOOK, HooksApi);
  if (!entries) {
    return 0;
  }

  let patched = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const hookFunction = getHookFunction(entry);
    if (!isEffectMacroCombatHook(hookFunction)) {
      continue;
    }

    registerEffectMacroCombatSocket(hookFunction);
    setHookFunction(entries, index, entry, createSafeEffectMacroCombatHook(hookFunction));
    patched += 1;
  }

  return patched;
}
