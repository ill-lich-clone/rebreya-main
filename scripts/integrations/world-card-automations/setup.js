import { registerCprCardHandlers } from "./hooks.js?v=1.5.61";
import { definitions } from "./registry.js";
import { registerSteedLifecycle, summonCardSteed } from "./selected/lib/summons.js";
import { moveCardToken } from "./selected/lib/teleport.js";
import { registerWorldCardTransport } from "./selected/lib/sockets.js";
import { pushCardToken } from "./shove-authority.js";
import { registerWorldCardEffectLifecycle } from "./effect-lifecycle.js?v=1.5.59";
import { configureDarknessRegion, registerDarknessRegionHooks } from "./selected/lib/darkness-region.js";

export function registerWorldCardAutomations({ Hooks, game }) {
  registerWorldCardTransport({
    socketlib: globalThis.socketlib,
    game,
    moveCardToken,
    summonCardSteed,
    configureDarknessRegion,
    pushCardToken
  });
  registerCprCardHandlers({ Hooks, game, definitions });
  registerWorldCardEffectLifecycle({ Hooks, game });
  registerDarknessRegionHooks({ Hooks, game });
  registerSteedLifecycle();
}
