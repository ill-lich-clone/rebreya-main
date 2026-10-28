import { formatMagicAttunement } from "../shared/magic-attunement.js?v=1.5.21";

const PATCH_STATE = Symbol.for("rebreya-main.dnd5eTooltipRaceGuard");
const RESIZE_PATCH_STATE = Symbol.for("rebreya-main.dnd5eInventoryResizeGuard");

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
    if (args[0] == null) return undefined;
    try {
      const target = gameProvider?.()?.tooltip?.element;
      const result = await original.apply(this, args);
      const item = args[0];
      const rank = item?.flags?.["rebreya-main"]?.rank ?? item?.flags?.["rebreya-main"]?.itemRank;
      const visible = item?.system?.identified !== false || gameProvider?.()?.user?.isGM;
      const subtitle = this.tooltip?.querySelector?.(".header .subtitle");
      if (item?.documentName === "Item" && visible && target === gameProvider?.()?.tooltip?.element
        && subtitle && /^(?:0|[1-9]\d*)$/u.test(String(rank ?? ""))) {
        subtitle.insertAdjacentText("beforeend", `${subtitle.textContent ? " • " : ""}Ранг ${rank}`);
      }
      const detail = formatMagicAttunement(item?.flags?.["rebreya-main"]?.catalogAttunement);
      const description = this.tooltip?.querySelector?.(".content > .description");
      if (item?.documentName === "Item" && item?.parent?.documentName === "Actor" && visible && detail
        && target === gameProvider?.()?.tooltip?.element && description
        && !description.textContent?.includes(`Настройка: ${detail}`)) {
        const line = this.tooltip.ownerDocument.createElement("p");
        line.textContent = `Настройка: ${detail}`;
        description.append(line);
      }
      return result;
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

export function patchDnd5eInventoryResizeGuard({
  gameProvider = () => globalThis.game,
  customElementsProvider = () => globalThis.customElements
} = {}) {
  if (gameProvider?.()?.system?.id !== "dnd5e") return false;
  const prototype = customElementsProvider?.()?.get?.("dnd5e-inventory")?.prototype;
  const original = prototype?._onResize;
  if (typeof original !== "function" || prototype[RESIZE_PATCH_STATE]) return false;
  const pending = new WeakMap();
  prototype._onResize = function (entries) {
    if (this.isConnected === false) return;
    const view = this.ownerDocument?.defaultView;
    if (!view?.requestAnimationFrame) return original.call(this, entries);
    if (pending.has(this)) { pending.set(this, entries); return; }
    pending.set(this, entries);
    view.requestAnimationFrame(() => {
      const latest = pending.get(this);
      pending.delete(this);
      if (this.isConnected !== false) original.call(this, latest);
    });
  };
  Object.defineProperty(prototype, RESIZE_PATCH_STATE, { value: { original } });
  return true;
}
