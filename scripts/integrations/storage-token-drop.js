import { MODULE_ID } from "../constants.js";
import { parseStorageDepositDragData } from "../data/storage-deposit-source.js";
import { isStorageActor } from "../data/storage-service.js";
import { promptStorageTransferQuantity } from "../ui/storage-transfer-ui.js";
import {
  StorageTokenOverlayController,
  storageTokenViewportBounds
} from "../ui/storage-token-overlay.js";

const registeredHookObjects = new WeakSet();
const DRAG_MIME_TYPES = ["text/plain", "text", "application/json", "text/uri-list"];

function clean(value) {
  return String(value ?? "").trim();
}

function tokenUuid(token) {
  return clean(token?.document?.uuid ?? token?.uuid);
}

function pointInside(bounds, x, y) {
  return bounds
    && Number.isFinite(x)
    && Number.isFinite(y)
    && x >= Number(bounds.left)
    && x <= Number(bounds.right)
    && y >= Number(bounds.top)
    && y <= Number(bounds.bottom);
}

function parseDragEvent(event) {
  try {
    const foundryData = globalThis.TextEditor?.getDragEventData?.(event);
    const parsed = parseStorageDepositDragData(foundryData);
    if (parsed) return parsed;
  }
  catch (_error) {
    // Fall through to raw MIME data.
  }
  for (const type of DRAG_MIME_TYPES) {
    try {
      const parsed = parseStorageDepositDragData(event?.dataTransfer?.getData?.(type));
      if (parsed) return parsed;
    }
    catch (_error) {
      // Try the next MIME type.
    }
  }
  return null;
}

function defaultMutationId() {
  const random = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `storage-token-deposit-${random}`;
}

export class StorageTokenDropController {
  constructor(moduleApi, {
    document = globalThis.document,
    canvasProvider = () => globalThis.canvas,
    boundsProvider = (token) => storageTokenViewportBounds(token, { canvas: canvasProvider() }),
    overlayController = new StorageTokenOverlayController({ canvasProvider }),
    promptQuantity = promptStorageTransferQuantity,
    setTimeout = globalThis.setTimeout?.bind(globalThis),
    clearTimeout = globalThis.clearTimeout?.bind(globalThis),
    createMutationId = defaultMutationId,
    logger = console
  } = {}) {
    this.moduleApi = moduleApi;
    this.document = document;
    this.canvasProvider = canvasProvider;
    this.boundsProvider = boundsProvider;
    this.overlayController = overlayController;
    this.promptQuantity = promptQuantity;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.createMutationId = createMutationId;
    this.logger = logger;
    this.dragSource = null;
    this.activeToken = null;
    this.ready = false;
    this.readyTimer = null;
    this.highlightState = null;
    this.listeners = null;
  }

  bind() {
    if (this.listeners || typeof this.document?.addEventListener !== "function") return false;
    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    this.document.addEventListener("dragstart", (event) => this.handleDragStart(event), { signal });
    this.document.addEventListener("dragover", (event) => this.handleDragOver(event), { capture: true, signal });
    this.document.addEventListener("dragleave", (event) => this.handleDragLeave(event), { capture: true, signal });
    this.document.addEventListener("drop", (event) => { void this.handleDrop(event); }, { capture: true, signal });
    this.document.addEventListener("dragend", () => this.handleDragEnd(), { capture: true, signal });
    this.document.addEventListener("keydown", (event) => this.handleKeyDown(event), { capture: true, signal });
    return true;
  }

  unbind() {
    this.listeners?.abort?.();
    this.listeners = null;
    this.clear();
  }

  handleDragStart(event) {
    this.clear();
    this.dragSource = parseDragEvent(event);
    return Boolean(this.dragSource);
  }

  handleDragOver(event) {
    this.dragSource ??= parseDragEvent(event);
    if (!this.dragSource) {
      this.#clearTarget();
      return false;
    }
    const token = this.#tokenAt(event?.clientX, event?.clientY);
    if (!token) {
      this.#clearTarget();
      return false;
    }
    event?.preventDefault?.();
    if (this.activeToken === token) return true;
    this.#clearTarget();
    this.activeToken = token;
    this.#highlight(token);
    if (typeof this.setTimeout === "function") {
      this.readyTimer = this.setTimeout(() => {
        if (this.activeToken !== token || !this.dragSource) return;
        this.readyTimer = null;
        this.ready = true;
        this.overlayController.showFeedback(token, "Отпустите, чтобы добавить", {
          durationMs: 0,
          className: "rm-storage-token-feedback--drop-ready"
        });
      }, 1000);
    }
    return true;
  }

  handleDragLeave(event) {
    if (!this.activeToken) return false;
    const bounds = this.boundsProvider(this.activeToken);
    if (pointInside(bounds, Number(event?.clientX), Number(event?.clientY))) return false;
    this.#clearTarget();
    return true;
  }

  async handleDrop(event) {
    this.dragSource ??= parseDragEvent(event);
    const token = this.activeToken ?? this.#tokenAt(event?.clientX, event?.clientY);
    if (!this.dragSource || !token) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    const source = this.dragSource;
    const ready = this.ready && token === this.activeToken;
    this.clear();
    if (!ready) return true;

    try {
      const inspected = await this.moduleApi.inspectStorageDepositSource(source);
      const quantity = await this.promptQuantity(inspected.available);
      if (quantity === null) return true;
      await this.moduleApi.depositStorageItem(
        tokenUuid(token),
        inspected.source,
        quantity,
        this.createMutationId()
      );
      return true;
    }
    catch (error) {
      this.logger?.error?.(`${MODULE_ID} | Storage token deposit failed.`, error);
      globalThis.ui?.notifications?.error?.(error?.message ?? "Не удалось добавить предмет в хранилище.");
      return true;
    }
  }

  handleDragEnd() {
    this.clear();
  }

  handleKeyDown(event) {
    if (event?.key !== "Escape") return false;
    this.clear();
    return true;
  }

  clear() {
    this.#clearTarget();
    this.dragSource = null;
  }

  #tokenAt(x, y) {
    const tokens = [...(this.canvasProvider?.()?.tokens?.placeables ?? [])].reverse();
    return tokens.find((token) => (
      token?.visible !== false
      && isStorageActor(token?.actor)
      && pointInside(this.boundsProvider(token), Number(x), Number(y))
    )) ?? null;
  }

  #highlight(token) {
    this.highlightState = {
      token,
      hover: token?.hover,
      borderVisible: token?.border?.visible
    };
    if (token && "hover" in token) token.hover = true;
    if (token?.border && "visible" in token.border) token.border.visible = true;
    token?.renderFlags?.set?.({ refreshState: true });
  }

  #clearTarget() {
    if (this.readyTimer != null) this.clearTimeout?.(this.readyTimer);
    this.readyTimer = null;
    this.ready = false;
    this.overlayController?.close?.();
    const state = this.highlightState;
    if (state?.token) {
      if ("hover" in state.token) state.token.hover = state.hover;
      if (state.token.border && "visible" in state.token.border) {
        state.token.border.visible = state.borderVisible;
      }
      state.token.renderFlags?.set?.({ refreshState: true });
    }
    this.highlightState = null;
    this.activeToken = null;
  }
}

export function registerStorageTokenDropHooks(moduleApi, {
  hooks = globalThis.Hooks,
  controller = new StorageTokenDropController(moduleApi)
} = {}) {
  if (typeof hooks?.on !== "function" || registeredHookObjects.has(hooks)) return false;
  registeredHookObjects.add(hooks);
  controller.bind();
  hooks.on("canvasReady", () => controller.bind());
  hooks.on("canvasTearDown", () => controller.clear());
  hooks.on("deleteToken", (token) => {
    if (controller.activeToken === (token?.object ?? token)) controller.clear();
  });
  return true;
}
