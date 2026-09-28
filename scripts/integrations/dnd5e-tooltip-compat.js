const PATCH_STATE = Symbol.for("rebreya-main.dnd5eTooltipRaceGuard");

function isStaleTooltipDatasetRace(error, game) {
  return game?.tooltip?.element == null
    && error?.name === "TypeError"
    && /^Cannot read properties of (?:null|undefined) \(reading 'dataset'\)$/u.test(String(error?.message ?? ""));
}

export function patchDnd5eTooltipRaceGuard({
  gameProvider = () => globalThis.game
} = {}) {
  const game = gameProvider?.();
  if (game?.system?.id !== "dnd5e") return false;

  const tooltips = game.dnd5e?.tooltips;
  const original = tooltips?._onHoverContentLink;
  if (typeof original !== "function" || tooltips[PATCH_STATE]) return false;

  const guardedHoverContentLink = async function (...args) {
    try {
      return await original.apply(this, args);
    }
    catch (error) {
      if (isStaleTooltipDatasetRace(error, gameProvider?.())) return undefined;
      throw error;
    }
  };

  Object.defineProperty(tooltips, PATCH_STATE, {
    configurable: false,
    enumerable: false,
    value: { original },
    writable: false
  });
  tooltips._onHoverContentLink = guardedHoverContentLink;
  return true;
}
