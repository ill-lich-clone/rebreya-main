import { MODULE_ID } from "../constants.js";
import { isActiveGmClient as defaultIsActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { getActorHandReservations } from "../integrations/held-items.js";
import { GRAPPLE_BYPASS_OPTION, GRAPPLE_LINK_FLAG } from "./grapple-automation-service.js";

function clean(value) {
  return String(value ?? "").trim();
}

function documentFlag(document, key) {
  if (typeof document?.getFlag === "function") return document.getFlag(MODULE_ID, key);
  return document?.flags?.[MODULE_ID]?.[key];
}

function defaultRandomId() {
  return globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto?.randomUUID?.();
}

async function defaultShowMoveDialog(config) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== "function") return "cancel";
  return DialogV2.wait({
    window: { title: config.title },
    content: config.content,
    buttons: config.buttons.map((button) => ({
      ...button,
      callback: () => button.action
    })),
    rejectClose: false,
    modal: true
  });
}

function defaultNotifyError(message) {
  globalThis.ui?.notifications?.error?.(message);
  console.error(`${MODULE_ID} | ${message}`);
}

function hasPositionChange(changed) {
  return Object.hasOwn(changed ?? {}, "x") || Object.hasOwn(changed ?? {}, "y");
}

function requestedPosition(token, changed, options) {
  const waypoints = options?.movement?.[clean(token?.id)]?.waypoints;
  const requestedWaypoint = Array.isArray(waypoints) ? waypoints.at(-1) : null;
  const source = requestedWaypoint && typeof requestedWaypoint === "object" ? requestedWaypoint : changed;
  if (!hasPositionChange(source)) return null;
  const position = {
    x: Number(Object.hasOwn(source, "x") ? source.x : token?.x),
    y: Number(Object.hasOwn(source, "y") ? source.y : token?.y)
  };
  return Number.isFinite(position.x) && Number.isFinite(position.y) ? position : null;
}

function removeMovementChanges(changed) {
  delete changed.x;
  delete changed.y;
  delete changed._movementHistory;
}

function shouldCancelOriginalUpdate(changed) {
  return Object.keys(changed ?? {}).length === 0 ? false : undefined;
}

const ERROR_MESSAGES = Object.freeze({
  "outside-reach": "схваченное существо нельзя переместить в эту точку",
  "outside-scene": "перемещение выходит за границы сцены",
  "wall-collision": "перемещению мешает стена",
  "stale-link": "связь захвата больше не существует"
});

export function registerGrappleHooks(moduleApi, {
  Hooks = globalThis.Hooks,
  showMoveDialog = defaultShowMoveDialog,
  randomId = defaultRandomId,
  isActiveGmClient = defaultIsActiveGmClient,
  gameProvider = () => globalThis.game,
  notifyError = defaultNotifyError
} = {}) {
  if (typeof Hooks?.on !== "function") throw new TypeError("Hooks.on is required");
  const pendingTargetDialogs = new Map();

  const report = (error) => {
    const code = clean(error?.code);
    const detail = ERROR_MESSAGES[code] ?? (clean(error?.message) || "неизвестная ошибка");
    notifyError(`Автоматика захвата: ${detail}`);
  };
  const schedule = (operation) => {
    Promise.resolve().then(operation).catch(report);
  };
  const operationId = (prefix) => {
    const suffix = clean(randomId());
    if (!suffix) throw new Error("Не удалось создать идентификатор операции захвата");
    return `${prefix}-${suffix}`;
  };

  Hooks.on("preUpdateToken", (token, changed, options = {}, userId = "") => {
    if (options?.[MODULE_ID]?.[GRAPPLE_BYPASS_OPTION] === true) return undefined;
    const position = requestedPosition(token, changed, options);
    if (!position) return undefined;
    const requesterUserId = clean(userId);
    const targetLink = documentFlag(token, GRAPPLE_LINK_FLAG);
    const sourceTokenUuid = clean(token?.uuid);
    const isGrappleSource = getActorHandReservations(token?.actor).some((reservation) => (
      reservation.kind === "grapple" && reservation.sourceTokenUuid === sourceTokenUuid
    ));
    if (!targetLink?.linkId && !isGrappleSource) return undefined;
    removeMovementChanges(changed);

    if (targetLink?.linkId) {
      const linkId = clean(targetLink.linkId);
      if (!pendingTargetDialogs.has(linkId)) {
        const pending = (async () => {
          const config = {
            title: "Существо было схвачено",
            content: "<p>Существо было схвачено. Что сделать с попыткой перемещения?</p>",
            buttons: [
              {
                action: "release",
                label: "Отменить захват",
                icon: "fa-solid fa-link-slash",
                default: true
              },
              {
                action: "cancel",
                label: "Отменить перемещение",
                icon: "fa-solid fa-xmark"
              }
            ]
          };
          const choice = await showMoveDialog(config);
          if (choice !== "release") return;
          await moduleApi.requestReleaseAndMove({
            targetTokenUuid: clean(token?.uuid),
            linkId,
            x: position.x,
            y: position.y,
            operationId: operationId("grapple-release-move"),
            requesterUserId
          });
        })().finally(() => pendingTargetDialogs.delete(linkId));
        pendingTargetDialogs.set(linkId, pending);
        pending.catch(report);
      }
      return shouldCancelOriginalUpdate(changed);
    }

    schedule(() => moduleApi.requestDragFromTokenUpdate({
      sourceTokenUuid,
      x: position.x,
      y: position.y,
      operationId: operationId("grapple-drag"),
      requesterUserId
    }));
    return shouldCancelOriginalUpdate(changed);
  });

  Hooks.on("deleteActiveEffect", (effect, options = {}) => {
    if (options?.[MODULE_ID]?.[GRAPPLE_BYPASS_OPTION] === true) return;
    if (!isActiveGmClient(gameProvider())) return;
    schedule(() => moduleApi.handleManagedEffectDeleted(effect));
  });

  Hooks.on("deleteToken", (token, options = {}) => {
    if (options?.[MODULE_ID]?.[GRAPPLE_BYPASS_OPTION] === true) return;
    if (!isActiveGmClient(gameProvider())) return;
    schedule(() => moduleApi.handleTokenDeleted(token));
  });

  Hooks.on("canvasReady", (canvasOrScene) => {
    if (!isActiveGmClient(gameProvider())) return;
    const scene = canvasOrScene?.scene ?? canvasOrScene;
    if (scene) schedule(() => moduleApi.reconcileScene(scene));
  });

  Hooks.on("ready", () => {
    if (!isActiveGmClient(gameProvider())) return;
    const scene = gameProvider()?.scenes?.active ?? globalThis.canvas?.scene;
    if (scene) schedule(() => moduleApi.reconcileScene(scene));
  });

  return { pendingTargetDialogs };
}
