const UPDATE_COMBAT_HOOK = "updateCombat";
const PATCHED_MARKER = "__rebreyaEffectMacroCombatCompatPatched";
const ACTORLESS_APPLIED_EFFECTS_PATTERN = /Cannot read properties of undefined \(reading ['"]appliedEffects['"]\)/u;

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

function createSafeEffectMacroCombatHook(originalHook) {
  const safeHook = function rebreyaEffectMacroUpdateCombatCompat(...args) {
    try {
      const result = originalHook.call(this, ...args);
      if (result && typeof result.catch === "function") {
        return result.catch((error) => {
          if (isActorlessAppliedEffectsError(error)) {
            return undefined;
          }
          throw error;
        });
      }

      return result;
    }
    catch (error) {
      if (isActorlessAppliedEffectsError(error)) {
        return undefined;
      }
      throw error;
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

    setHookFunction(entries, index, entry, createSafeEffectMacroCombatHook(hookFunction));
    patched += 1;
  }

  return patched;
}
