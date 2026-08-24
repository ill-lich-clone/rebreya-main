import { MODULE_ID } from "../constants.js";

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

export class StorageTokenOverlayController {
  constructor({
    document = globalThis.document,
    window = globalThis.window,
    canvasProvider = () => globalThis.canvas,
    setTimeout = globalThis.setTimeout?.bind(globalThis),
    clearTimeout = globalThis.clearTimeout?.bind(globalThis),
    logger = console
  } = {}) {
    this.document = document;
    this.window = window;
    this.canvasProvider = canvasProvider;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.logger = logger;
    this.node = null;
    this.token = null;
    this.feedbackTimer = null;
    this.listeners = null;
  }

  showActions(token, actions = []) {
    const node = this.#replaceNode(token, "rm-storage-token-actions");
    if (!node) return false;
    for (const action of actions) {
      const button = this.document.createElement("button");
      button.type = "button";
      button.className = "rm-button rm-button--secondary";
      button.dataset.action = String(action?.id ?? "");
      const icon = this.document.createElement("i");
      icon.className = String(action?.icon ?? "");
      const label = this.document.createElement("span");
      label.textContent = String(action?.label ?? "");
      button.append(icon, label);
      button.addEventListener("click", async (event) => {
        event?.stopPropagation?.();
        try {
          const result = await action?.callback?.();
          if (result === false) return;
          this.close();
        }
        catch (error) {
          if (await action?.onError?.(error) === true) return;
          this.logger?.error?.(`${MODULE_ID} | Storage token action failed.`, error);
          globalThis.ui?.notifications?.error(error?.message ?? "Не удалось открыть хранилище.");
        }
      });
      node.append(button);
    }
    this.reposition();
    return true;
  }

  showFeedback(token, text, { durationMs = 2000, className = "" } = {}) {
    const modifier = String(className ?? "").trim().replace(/[^a-zA-Z0-9_-]/gu, "");
    const node = this.#replaceNode(token, ["rm-storage-token-feedback", modifier].filter(Boolean).join(" "));
    if (!node) return false;
    node.textContent = String(text ?? "");
    this.reposition();
    if (Number(durationMs) > 0 && typeof this.setTimeout === "function") {
      this.feedbackTimer = this.setTimeout(() => this.close(), durationMs);
    }
    return true;
  }

  reposition() {
    if (!this.node || !this.token) return false;
    const bounds = storageTokenViewportBounds(this.token, { canvas: this.canvasProvider?.() });
    if (!bounds) return false;
    const size = this.node.getBoundingClientRect?.() ?? { width: this.node.offsetWidth, height: this.node.offsetHeight };
    const placement = placeTokenOverlay({
      tokenBounds: bounds,
      overlaySize: size,
      viewport: {
        width: finite(this.window?.innerWidth, 1),
        height: finite(this.window?.innerHeight, 1)
      }
    });
    this.node.style.left = `${placement.left}px`;
    this.node.style.top = `${placement.top}px`;
    this.node.style.setProperty?.("--rm-storage-pointer-left", `${placement.pointerLeft}px`);
    this.node.dataset.placement = placement.placement;
    return true;
  }

  close() {
    if (this.feedbackTimer != null) this.clearTimeout?.(this.feedbackTimer);
    this.feedbackTimer = null;
    this.listeners?.abort?.();
    this.listeners = null;
    this.node?.remove?.();
    this.node = null;
    this.token = null;
  }

  destroy() {
    this.close();
  }

  #replaceNode(token, className) {
    this.close();
    if (!this.document?.body || typeof this.document.createElement !== "function") return null;
    this.token = token;
    this.node = this.document.createElement("div");
    this.node.className = className;
    this.document.body.append(this.node);
    this.listeners = new AbortController();
    const options = { capture: true, signal: this.listeners.signal };
    this.document.addEventListener?.("pointerdown", (event) => {
      if (!this.node?.contains?.(event.target)) this.close();
    }, options);
    this.document.addEventListener?.("keydown", (event) => {
      if (event.key === "Escape") this.close();
    }, options);
    this.window?.addEventListener?.("resize", () => this.reposition(), { signal: this.listeners.signal });
    return this.node;
  }
}
