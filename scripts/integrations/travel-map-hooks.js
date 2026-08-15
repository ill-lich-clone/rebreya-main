import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export function registerTravelMapHooks(moduleApi, {
  Hooks = globalThis.Hooks,
  gameProvider = () => globalThis.game,
  logger = globalThis.console
} = {}) {
  if (!(Hooks?.on instanceof Function) || !(moduleApi?.syncTravelMapToken instanceof Function)) {
    return false;
  }

  Hooks.on("canvasReady", () => {
    const game = gameProvider?.() ?? globalThis.game;
    if (!isActiveGmClient(game)) {
      return true;
    }

    Promise.resolve()
      .then(() => moduleApi.syncTravelMapToken())
      .catch((error) => {
        logger?.warn?.(`${MODULE_ID} | Failed to sync the travel token after canvas ready.`, error);
      });
    return true;
  });
  return true;
}
