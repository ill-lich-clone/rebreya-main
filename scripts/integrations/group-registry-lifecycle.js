import { MODULE_ID } from "../constants.js";

const defaultGameProvider = () => globalThis.game;
const defaultSchedule = operation => Promise.resolve().then(operation);

export async function pruneMissingRegisteredGroups(groupContextService, {
  gameProvider = defaultGameProvider,
  isActiveGmClient = () => false
} = {}) {
  if (!isActiveGmClient(gameProvider())) {
    return null;
  }

  return groupContextService.pruneMissingGroups();
}

export function registerGroupRegistryLifecycleHooks({
  hooks = globalThis.Hooks,
  groupContextService,
  gameProvider = defaultGameProvider,
  isActiveGmClient = () => false,
  schedule = defaultSchedule,
  afterPrune = null,
  logger = globalThis.console
} = {}) {
  if (typeof hooks?.on !== "function") {
    throw new Error("Foundry Hooks API is unavailable");
  }

  return hooks.on("deleteActor", (actor) => {
    if (actor?.type !== "group" || !isActiveGmClient(gameProvider())) {
      return null;
    }

    return Promise.resolve(schedule(async () => {
      const result = await pruneMissingRegisteredGroups(groupContextService, {
        gameProvider,
        isActiveGmClient
      });

      if (result?.removedGroupActorIds?.length > 0 && typeof afterPrune === "function") {
        await afterPrune(result);
      }

      return result;
    })).catch((error) => {
      logger?.warn?.(`${MODULE_ID} | Failed to prune deleted Group Actor from the registry.`, error);
      return null;
    });
  });
}
