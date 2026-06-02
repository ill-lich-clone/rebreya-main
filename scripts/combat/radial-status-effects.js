import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";

const DEFAULT_GRID_SIZE = 100;
const BASE_ICON_SIZE = 20;
const RADIAL_DISTANCE_MULTIPLIER = 1.1;
const MIN_ICON_COMPRESSION_SCALE = 0.55;
const REFRESH_EFFECTS_WRAPPER = Symbol.for(`${MODULE_ID}.radialStatusEffects.refreshEffectsWrapper`);
const REFRESH_STATE_WRAPPER = Symbol.for(`${MODULE_ID}.radialStatusEffects.refreshStateWrapper`);

function toPositiveNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

export function getRadialStatusIconScale(tokenSize) {
  const size = toPositiveNumber(tokenSize, 1);
  if (size >= 2.5) return size / 2;
  if (size >= 1.5) return size * 0.7;
  return 1.4;
}

export function getRadialStatusMaxIcons(tokenWidth) {
  const width = toPositiveNumber(tokenWidth, 1);
  if (width < 1) return 9;
  if (width === 1) return 16;
  if (width === 2) return 28;
  return 40;
}

export function getRadialStatusOffset(tokenSize) {
  const size = toPositiveNumber(tokenSize, 1);
  if (size < 1) return 1.4;
  if (size === 1) return 1.25;
  if (size === 2) return 1.125;
  return 1.075;
}

export function buildRadialStatusEffectLayouts({
  tokenWidth = 1,
  tokenHeight = tokenWidth,
  gridSize = DEFAULT_GRID_SIZE,
  count = 0
} = {}) {
  const safeGridSize = toPositiveNumber(gridSize, DEFAULT_GRID_SIZE);
  const safeTokenWidth = toPositiveNumber(tokenWidth, 1);
  const safeTokenHeight = toPositiveNumber(tokenHeight, safeTokenWidth);
  const tokenSize = Math.min(safeTokenWidth, safeTokenHeight);
  const tokenExtent = Math.max(safeTokenWidth, safeTokenHeight);
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  const gridScale = safeGridSize / DEFAULT_GRID_SIZE;
  const capacity = getRadialStatusMaxIcons(safeTokenWidth);
  const compressionScale = safeCount > capacity
    ? Math.max(MIN_ICON_COMPRESSION_SCALE, capacity / safeCount)
    : 1;
  const slotSize = BASE_ICON_SIZE * getRadialStatusIconScale(tokenSize) * gridScale * compressionScale;
  const slots = Math.max(safeCount, 1);
  const radius = getRadialStatusOffset(tokenSize) * tokenExtent * safeGridSize / 2 * RADIAL_DISTANCE_MULTIPLIER;
  const centerX = safeTokenWidth * safeGridSize / 2;
  const centerY = safeTokenHeight * safeGridSize / 2;
  const initialRotation = -Math.PI / 2;

  return Array.from({ length: safeCount }, (_entry, index) => {
    const angle = ((index / slots) * 2 * Math.PI) + initialRotation;
    return {
      index,
      x: centerX + (radius * Math.cos(angle)),
      y: centerY + (radius * Math.sin(angle)),
      slotSize,
      backgroundRadius: (slotSize / 2) + (slotSize * 0.1)
    };
  });
}

export function isRadialStatusEffectsEnabled() {
  try {
    return globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.RADIAL_STATUS_EFFECTS) === true;
  }
  catch (_error) {
    return false;
  }
}

function getTokenGridSize(token) {
  return toPositiveNumber(
    token?.scene?.grid?.size
      ?? globalThis.canvas?.grid?.size
      ?? globalThis.canvas?.dimensions?.size,
    DEFAULT_GRID_SIZE
  );
}

function getTokenGridDimensions(token, gridSize) {
  const documentWidth = toPositiveNumber(token?.document?.width, 0);
  const documentHeight = toPositiveNumber(token?.document?.height, 0);
  if (documentWidth > 0 && documentHeight > 0) {
    return { width: documentWidth, height: documentHeight };
  }

  const size = token?.document?.getSize?.() ?? null;
  const pixelWidth = toPositiveNumber(size?.width ?? token?.w, gridSize);
  const pixelHeight = toPositiveNumber(size?.height ?? token?.h, pixelWidth);
  return {
    width: pixelWidth / gridSize,
    height: pixelHeight / gridSize
  };
}

function getStatusEffectSprites(token) {
  const effects = token?.effects;
  if (!effects?.children?.length) return [];

  return effects.children.filter((child) => child !== effects.bg && child !== effects.overlay);
}

function setSpritePosition(sprite, x, y) {
  if (sprite?.position) {
    sprite.position.x = x;
    sprite.position.y = y;
  }
  sprite.x = x;
  sprite.y = y;
}

function scaleSprite(sprite, slotSize) {
  sprite?.anchor?.set?.(0.5);

  const textureWidth = Number(sprite?.texture?.orig?.width ?? sprite?.texture?.width ?? 0);
  const textureHeight = Number(sprite?.texture?.orig?.height ?? sprite?.texture?.height ?? 0);
  const maxTextureSize = Math.max(textureWidth, textureHeight, slotSize);
  const scale = slotSize / maxTextureSize;
  sprite?.scale?.set?.(scale, scale);

  if ("width" in sprite) sprite.width = slotSize;
  if ("height" in sprite) sprite.height = slotSize;

  const scaleModes = globalThis.PIXI?.SCALE_MODES;
  if (scaleModes && sprite?.texture?.baseTexture) {
    sprite.texture.baseTexture.scaleMode = scaleModes.LINEAR;
  }
}

function drawStatusBackground(bg, layout, gridSize) {
  if (!bg?.beginFill || !bg?.drawCircle) return;

  const lineWidth = Math.max(1, gridSize / DEFAULT_GRID_SIZE);
  bg.beginFill(0x242731, 0.95);
  bg.drawCircle(layout.x, layout.y, layout.backgroundRadius);
  bg.endFill?.();
  bg.lineStyle?.(lineWidth, 0x9f9275, 1);
  bg.drawCircle(layout.x, layout.y, layout.backgroundRadius);
  bg.lineStyle?.(0);
}

function elevateRadialStatusEffectLayer(token, enabled = isRadialStatusEffectsEnabled()) {
  if (!enabled) return false;

  if (token?.border?.zIndex === Infinity) {
    token.border.zIndex = 100;
  }

  const effects = token?.effects;
  const currentEffectsZIndex = Number(effects?.zIndex);
  if (effects && (!Number.isFinite(currentEffectsZIndex) || currentEffectsZIndex < 200)) {
    effects.zIndex = 200;
  }

  return true;
}

export function applyRadialStatusEffects(token, { enabled = isRadialStatusEffectsEnabled() } = {}) {
  if (!enabled) return false;

  const effects = token?.effects;
  const bg = effects?.bg;
  const sprites = getStatusEffectSprites(token);
  if (!bg || !sprites.length) return false;

  const gridSize = getTokenGridSize(token);
  const { width, height } = getTokenGridDimensions(token, gridSize);
  const layouts = buildRadialStatusEffectLayouts({
    tokenWidth: width,
    tokenHeight: height,
    gridSize,
    count: sprites.length
  });

  bg.clear?.();
  for (const [index, sprite] of sprites.entries()) {
    const layout = layouts[index];
    if (!layout) continue;

    scaleSprite(sprite, layout.slotSize);
    setSpritePosition(sprite, layout.x, layout.y);
    drawStatusBackground(bg, layout, gridSize);
  }

  elevateRadialStatusEffectLayer(token, enabled);

  return true;
}

function getTokenPrototype() {
  return globalThis.foundry?.canvas?.placeables?.Token?.prototype
    ?? globalThis.Token?.prototype
    ?? null;
}

export function registerRadialStatusEffects() {
  const prototype = getTokenPrototype();
  if (!prototype) return false;

  let patched = false;

  if (typeof prototype._refreshEffects === "function" && !prototype._refreshEffects[REFRESH_EFFECTS_WRAPPER]) {
    const wrappedRefreshEffects = prototype._refreshEffects;
    prototype._refreshEffects = function rebreyaRadialStatusEffectsRefresh(...args) {
      const result = wrappedRefreshEffects.apply(this, args);

      try {
        applyRadialStatusEffects(this);
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to apply radial status effect layout.`, error);
      }

      return result;
    };
    prototype._refreshEffects[REFRESH_EFFECTS_WRAPPER] = true;
    patched = true;
  }

  if (typeof prototype._refreshState === "function" && !prototype._refreshState[REFRESH_STATE_WRAPPER]) {
    const wrappedRefreshState = prototype._refreshState;
    prototype._refreshState = function rebreyaRadialStatusEffectsState(...args) {
      const result = wrappedRefreshState.apply(this, args);

      try {
        elevateRadialStatusEffectLayer(this);
      }
      catch (error) {
        console.warn(`${MODULE_ID} | Failed to refresh radial status effect layer order.`, error);
      }

      return result;
    };
    prototype._refreshState[REFRESH_STATE_WRAPPER] = true;
    patched = true;
  }

  return patched;
}
