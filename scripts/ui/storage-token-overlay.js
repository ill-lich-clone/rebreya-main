function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function storageTokenViewportBounds(token, { canvas = globalThis.canvas } = {}) {
  const object = token?.object ?? token;
  const bounds = object?.bounds;
  const apply = canvas?.stage?.worldTransform?.apply;
  const canvasElement = canvas?.app?.canvas ?? canvas?.app?.view;
  if (!bounds || typeof apply !== "function" || typeof canvasElement?.getBoundingClientRect !== "function") return null;

  const topLeft = apply.call(canvas.stage.worldTransform, { x: finite(bounds.x), y: finite(bounds.y) });
  const bottomRight = apply.call(canvas.stage.worldTransform, {
    x: finite(bounds.x) + finite(bounds.width),
    y: finite(bounds.y) + finite(bounds.height)
  });
  const canvasBounds = canvasElement.getBoundingClientRect();
  const left = finite(canvasBounds.left) + Math.min(finite(topLeft.x), finite(bottomRight.x));
  const top = finite(canvasBounds.top) + Math.min(finite(topLeft.y), finite(bottomRight.y));
  const right = finite(canvasBounds.left) + Math.max(finite(topLeft.x), finite(bottomRight.x));
  const bottom = finite(canvasBounds.top) + Math.max(finite(topLeft.y), finite(bottomRight.y));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function placeTokenOverlay({
  tokenBounds,
  overlaySize,
  viewport,
  gap = 10,
  margin = 8
} = {}) {
  const width = Math.max(0, finite(overlaySize?.width));
  const height = Math.max(0, finite(overlaySize?.height));
  const viewportWidth = Math.max(width + margin * 2, finite(viewport?.width));
  const viewportHeight = Math.max(height + margin * 2, finite(viewport?.height));
  const tokenCenter = (finite(tokenBounds?.left) + finite(tokenBounds?.right)) / 2;
  const preferredLeft = tokenCenter - width / 2;
  const left = Math.min(Math.max(margin, preferredLeft), viewportWidth - width - margin);
  const preferredTop = finite(tokenBounds?.top) - gap - height;
  const placement = preferredTop >= margin ? "above" : "below";
  const rawTop = placement === "above" ? preferredTop : finite(tokenBounds?.bottom) + gap;
  const top = Math.min(Math.max(margin, rawTop), viewportHeight - height - margin);
  const pointerLeft = Math.min(Math.max(8, tokenCenter - left), Math.max(8, width - 8));
  return { left, top, placement, pointerLeft };
}
