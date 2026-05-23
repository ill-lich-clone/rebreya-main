const UPDATE_ACTOR_HOOK = "updateActor";
const PATCHED_MARKER = "__rebreyaTransformCleanupCompatPatched";
const ORIGINAL_HOOK_MARKER = "__rebreyaOriginalTransformCleanupHook";

function getHookEntries(hookName) {
  const hooks = globalThis.Hooks;
  const hookStores = [hooks?.events, hooks?._hooks];

  for (const store of hookStores) {
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

function isUnsafeTransformCleanupHook(hookFunction) {
  if (typeof hookFunction !== "function" || hookFunction[PATCHED_MARKER]) {
    return false;
  }

  const source = Function.prototype.toString.call(hookFunction);
  return hookFunction.name === "onUpdateActor"
    && source.includes("isPolymorphed")
    && source.includes("changed.flags.dnd5e");
}

function createSafeTransformCleanupHook(originalHook) {
  const safeHook = function rebreyaTransformCleanupCompatOnUpdateActor(updatedActor, changed = {}, options, userId) {
    if (!changed?.flags?.dnd5e) {
      return undefined;
    }

    return originalHook.call(this, updatedActor, changed, options, userId);
  };

  Object.defineProperty(safeHook, PATCHED_MARKER, { value: true });
  Object.defineProperty(safeHook, ORIGINAL_HOOK_MARKER, { value: originalHook });
  return safeHook;
}

export function patchTransformCleanupUpdateActorHook() {
  const entries = getHookEntries(UPDATE_ACTOR_HOOK);
  if (!entries) {
    return false;
  }

  let patched = false;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const hookFunction = getHookFunction(entry);
    if (!isUnsafeTransformCleanupHook(hookFunction)) {
      continue;
    }

    setHookFunction(entries, index, entry, createSafeTransformCleanupHook(hookFunction));
    patched = true;
  }

  return patched;
}
