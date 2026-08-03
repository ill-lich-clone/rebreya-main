import { MODULE_ID } from "../constants.js";
import { parseStorageDepositDragData } from "../data/storage-deposit-source.js";
import { isStorageActor } from "../data/storage-service.js";
import { promptStorageTransferQuantity } from "../ui/storage-transfer-ui.js";
import {
  StorageTokenOverlayController,
  storageTokenViewportBounds
} from "../ui/storage-token-overlay.js";

const registeredHookObjects = new WeakSet();
const patchedTokenPrototypes = new WeakSet();
const patchedDragCallback = Symbol("rebreyaStorageTokenDragCallback");
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

function appElement(application) {
  const element = application?.element;
  return element?.nodeType === 1 ? element : element?.[0] ?? null;
}

export function characterSheetAtPoint(x, y, {
  document = globalThis.document,
  windows = globalThis.ui?.windows,
  actors = globalThis.game?.actors
} = {}) {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  const topElement = document?.elementFromPoint?.(Number(x), Number(y)) ?? null;
  const sheetElement = topElement?.closest?.(".sheet.actor, .actor.sheet") ?? null;
  if (sheetElement && sheetElement.classList?.contains?.("minimized") !== true
    && pointInside(sheetElement.getBoundingClientRect?.(), Number(x), Number(y))) {
    const actorId = clean(sheetElement.dataset?.actorId)
      || clean(sheetElement.dataset?.documentId)
      || clean(sheetElement.id).match(/Actor-([a-z0-9]+)(?:$|-)/iu)?.[1]
      || "";
    const actor = actors?.get?.(actorId) ?? null;
    if (actor?.type === "character") return actor;
  }
  const applications = Object.values(windows ?? {}).reverse();
  for (const application of applications) {
    const actor = application?.actor ?? application?.document ?? application?.object;
    if (actor?.type !== "character" || application?.minimized === true || application?._minimized === true) continue;
    const element = appElement(application);
    if (!element) continue;
    if (topElement && typeof element.contains === "function" && !element.contains(topElement)) continue;
    const bounds = element.getBoundingClientRect?.();
    if (pointInside(bounds, Number(x), Number(y))) return actor;
  }
  return null;
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
    characterSheetProvider = (x, y) => characterSheetAtPoint(x, y, { document }),
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
    this.characterSheetProvider = characterSheetProvider;
    this.logger = logger;
    this.dragSource = null;
    this.canvasDragSource = null;
    this.activeToken = null;
    this.activeTargetKind = null;
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
    this.document.addEventListener("pointerup", (event) => this.handleCanvasTokenPointerUp(event), { capture: true, signal });
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

  handleCanvasTokenDragMove(sourceToken, event) {
    if (!isStorageActor(sourceToken?.actor)) {
      this.clear();
      return false;
    }
    this.canvasDragSource = { kind: "storage-token", tokenUuid: tokenUuid(sourceToken) };
    const destination = event?.interactionData?.destination;
    let target = this.#tokenAtCanvasPoint(
      Number(destination?.x),
      Number(destination?.y),
      sourceToken
    );
    let targetKind = "storage";
    if (!target) {
      target = this.#characterAtCanvasPoint(
        Number(destination?.x),
        Number(destination?.y),
        sourceToken
      );
      targetKind = "character";
    }
    if (!target) {
      this.#clearTarget();
      return false;
    }
    this.dragSource = this.canvasDragSource;
    if (this.activeToken === target && this.activeTargetKind === targetKind) return true;
    this.#activateTarget(target, targetKind);
    return true;
  }

  handleCanvasTokenDragDrop(sourceToken, event) {
    const destination = event?.interactionData?.destination;
    const target = this.activeToken ?? this.#tokenAtCanvasPoint(
      Number(destination?.x),
      Number(destination?.y),
      sourceToken
    );
    const targetKind = this.activeTargetKind ?? "storage";
    const source = this.dragSource ?? {
      kind: "storage-token",
      tokenUuid: tokenUuid(sourceToken)
    };
    const ready = this.ready && target === this.activeToken && clean(source.tokenUuid);
    this.clear();
    if (!ready || !target) return false;
    if (targetKind === "character") {
      void this.#moveTokenToCharacter(source, target.actor, tokenUuid(target));
    }
    else void this.#depositSource(target, source);
    return true;
  }

  handleCanvasTokenDragCancel() {
    if (this.canvasDragSource?.kind !== "storage-token" && this.dragSource?.kind !== "storage-token") return false;
    this.clear();
    return true;
  }

  handleCanvasTokenPointerUp(event) {
    const source = this.canvasDragSource;
    if (source?.kind !== "storage-token") return false;
    const actor = this.characterSheetProvider?.(Number(event?.clientX), Number(event?.clientY));
    if (actor?.type !== "character" || !clean(actor?.uuid)) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    this.clear();
    void this.#moveTokenToCharacter(source, actor);
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

    await this.#depositSource(token, source);
    return true;
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
    this.canvasDragSource = null;
  }

  #tokenAt(x, y) {
    const tokens = [...(this.canvasProvider?.()?.tokens?.placeables ?? [])].reverse();
    return tokens.find((token) => (
      token?.visible !== false
      && isStorageActor(token?.actor)
      && pointInside(this.boundsProvider(token), Number(x), Number(y))
    )) ?? null;
  }

  #tokenAtCanvasPoint(x, y, excludedToken = null) {
    return this.#placeableAtCanvasPoint(x, y, excludedToken, (token) => isStorageActor(token?.actor));
  }

  #characterAtCanvasPoint(x, y, excludedToken = null) {
    return this.#placeableAtCanvasPoint(x, y, excludedToken, (token) => token?.actor?.type === "character");
  }

  #placeableAtCanvasPoint(x, y, excludedToken, predicate) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const tokens = [...(this.canvasProvider?.()?.tokens?.placeables ?? [])].reverse();
    return tokens.find((token) => {
      if (token === excludedToken || token?.document === excludedToken?.document) return false;
      if (token?.visible === false || predicate?.(token) !== true) return false;
      const canvas = this.canvasProvider?.();
      const gridSize = Math.max(1, Number(canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100) || 100);
      const document = token?.document ?? token;
      const left = Number(document?.x);
      const top = Number(document?.y);
      const width = Math.max(1, Number(document?.width ?? 1)) * gridSize;
      const height = Math.max(1, Number(document?.height ?? 1)) * gridSize;
      if (Number.isFinite(left) && Number.isFinite(top)
        && x >= left && x <= left + width && y >= top && y <= top + height) return true;
      return typeof token?.bounds?.contains === "function" && token.bounds.contains(x, y);
    }) ?? null;
  }

  #activateTarget(token, targetKind = "storage") {
    this.#clearTarget();
    this.activeToken = token;
    this.activeTargetKind = targetKind;
    this.#highlight(token);
    if (targetKind === "character") {
      this.ready = true;
      this.overlayController.showFeedback(token, "Отпустите, чтобы передать", {
        durationMs: 0,
        className: "rm-storage-token-feedback--drop-ready"
      });
      return;
    }
    if (typeof this.setTimeout !== "function") return;
    this.readyTimer = this.setTimeout(() => {
      if (this.activeToken !== token || !this.dragSource) return;
      this.readyTimer = null;
      this.ready = true;
      this.overlayController.showFeedback(token, targetKind === "character"
        ? "Отпустите, чтобы передать"
        : "Отпустите, чтобы добавить", {
        durationMs: 0,
        className: "rm-storage-token-feedback--drop-ready"
      });
    }, 1000);
  }

  async #depositSource(token, source) {
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

  async #moveTokenToCharacter(source, actor, characterTokenUuid = "") {
    try {
      if (typeof this.moduleApi?.moveStorageTokenToCharacter !== "function") {
        throw new Error("API переноса хранилища Rebreya недоступен.");
      }
      const request = clean(characterTokenUuid)
        ? { characterTokenUuid: clean(characterTokenUuid) }
        : undefined;
      const args = [
        clean(source.tokenUuid),
        clean(actor.uuid),
        this.createMutationId()
      ];
      if (request) args.push(request);
      await this.moduleApi.moveStorageTokenToCharacter(...args);
      globalThis.ui?.notifications?.info?.(`${clean(actor.name) || "Персонаж"} получает хранилище.`);
    }
    catch (error) {
      this.logger?.error?.(`${MODULE_ID} | Storage token character transfer failed.`, error);
      globalThis.ui?.notifications?.error?.(error?.message ?? "Не удалось перенести хранилище персонажу.");
    }
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
    this.activeTargetKind = null;
  }
}

function wrapStorageTokenDragMove(controller, originalMove) {
  const wrapped = function rebreyaStorageDragMove(event) {
    const result = originalMove.call(this, event);
    controller.handleCanvasTokenDragMove(this, event);
    return result;
  };
  wrapped[patchedDragCallback] = true;
  return wrapped;
}

function wrapStorageTokenDragDrop(controller, originalDrop) {
  const wrapped = function rebreyaStorageDragDrop(event) {
    if (controller.handleCanvasTokenDragDrop(this, event)) return undefined;
    return originalDrop.call(this, event);
  };
  wrapped[patchedDragCallback] = true;
  return wrapped;
}

export function patchStorageTokenInteractionManager(controller, token) {
  const callbacks = token?.mouseInteractionManager?.callbacks;
  if (!callbacks) return false;
  let changed = false;
  if (typeof callbacks.dragLeftMove === "function" && !callbacks.dragLeftMove[patchedDragCallback]) {
    callbacks.dragLeftMove = wrapStorageTokenDragMove(controller, callbacks.dragLeftMove);
    changed = true;
  }
  if (typeof callbacks.dragLeftDrop === "function" && !callbacks.dragLeftDrop[patchedDragCallback]) {
    callbacks.dragLeftDrop = wrapStorageTokenDragDrop(controller, callbacks.dragLeftDrop);
    changed = true;
  }
  return changed;
}

export function patchStorageTokenCanvasDrag(controller, {
  TokenClass = globalThis.foundry?.canvas?.placeables?.Token ?? globalThis.Token
} = {}) {
  const prototype = TokenClass?.prototype;
  if (!prototype) return false;
  let changed = false;
  if (!patchedTokenPrototypes.has(prototype)) {
    const originalMove = prototype._onDragLeftMove;
    const originalDrop = prototype._onDragLeftDrop;
    const originalCancel = prototype._onDragLeftCancel;
    if (typeof originalMove !== "function" || typeof originalDrop !== "function") return false;

    prototype._onDragLeftMove = wrapStorageTokenDragMove(controller, originalMove);
    prototype._onDragLeftDrop = wrapStorageTokenDragDrop(controller, originalDrop);
    if (typeof originalCancel === "function") {
      prototype._onDragLeftCancel = function rebreyaStorageDragCancel(event) {
        controller.handleCanvasTokenDragCancel(this, event);
        return originalCancel.call(this, event);
      };
    }
    patchedTokenPrototypes.add(prototype);
    changed = true;
  }
  for (const token of controller.canvasProvider?.()?.tokens?.placeables ?? []) {
    changed = patchStorageTokenInteractionManager(controller, token) || changed;
  }
  return changed;
}

export function registerStorageTokenDropHooks(moduleApi, {
  hooks = globalThis.Hooks,
  controller = new StorageTokenDropController(moduleApi)
} = {}) {
  if (typeof hooks?.on !== "function" || registeredHookObjects.has(hooks)) return false;
  registeredHookObjects.add(hooks);
  controller.bind();
  patchStorageTokenCanvasDrag(controller);
  hooks.on("canvasReady", () => {
    controller.bind();
    patchStorageTokenCanvasDrag(controller);
  });
  hooks.on("canvasTearDown", () => controller.clear());
  hooks.on("deleteToken", (token) => {
    if (controller.activeToken === (token?.object ?? token)) controller.clear();
  });
  return true;
}
