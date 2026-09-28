import { MODULE_ID } from "../constants.js";
import { isActiveGmClient as defaultIsActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { getActorHandReservations } from "../integrations/held-items.js";
import { GRAPPLE_BYPASS_OPTION, GRAPPLE_LINK_FLAG } from "./grapple-automation-service.js";

const patchedDragConstrainPrototypes = new WeakSet();

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

function isGrappleSource(token) {
  const document = token?.document ?? token;
  const sourceTokenUuid = clean(document?.uuid);
  const actor = token?.actor ?? document?.actor;
  return getActorHandReservations(actor).some((reservation) => (
    reservation.kind === "grapple" && reservation.sourceTokenUuid === sourceTokenUuid
  ));
}

function patchDragConstrainOptions(TokenClass) {
  const prototype = TokenClass?.prototype;
  if (!prototype || patchedDragConstrainPrototypes.has(prototype)) return false;
  const original = prototype._getDragConstrainOptions;
  if (typeof original !== "function") return false;
  prototype._getDragConstrainOptions = function rebreyaGrappleDragConstrainOptions(...args) {
    const options = original.apply(this, args);
    if (!isGrappleSource(this)) return options;
    return { ...(options ?? {}), ignoreTokens: true };
  };
  patchedDragConstrainPrototypes.add(prototype);
  return true;
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
  canvasProvider = () => globalThis.canvas,
  notifyError = defaultNotifyError,
  TokenClass = globalThis.CONFIG?.Token?.objectClass
    ?? globalThis.foundry?.canvas?.placeables?.Token
    ?? globalThis.Token
} = {}) {
  if (typeof Hooks?.on !== "function") throw new TypeError("Hooks.on is required");
  patchDragConstrainOptions(TokenClass);
  const pendingTargetDialogs = new Map();

  const report = (error) => {
    const code = clean(error?.code);
    const detail = ERROR_MESSAGES[code] ?? (clean(error?.message) || "неизвестная ошибка");
    notifyError(`Автоматика захвата: ${detail}`);
  };
  const schedule = (operation) => {
    Promise.resolve().then(operation).catch(report);
  };
  const refreshTwistedAura = (scene, combat = gameProvider()?.combat ?? null) => (
    moduleApi.refreshTwistedAura?.(combat, scene)
  );
  const currentScene = () => canvasProvider()?.scene ?? gameProvider()?.scenes?.active ?? null;
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
    const twistedTargetLink = moduleApi.getTwistedLink?.(token) ?? null;
    const twistedSourceLinks = moduleApi.getTwistedLinksForSource?.(token) ?? [];
    const twistedTargetOutside = twistedTargetLink
      && moduleApi.isTwistedTargetOutsideRadius?.(token, position) === true;
    if (!targetLink?.linkId && !isGrappleSource(token) && !twistedTargetOutside && !twistedSourceLinks.length) return undefined;
    if (twistedTargetLink && !twistedTargetOutside && !targetLink?.linkId && !isGrappleSource(token)) return undefined;
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

    if (twistedTargetOutside) {
      const linkId = clean(twistedTargetLink.linkId);
      const pendingKey = `twisted:${linkId}`;
      if (!pendingTargetDialogs.has(pendingKey)) {
        const pending = (async () => {
          const choice = await showMoveDialog({
            title: "Существо было скручено",
            content: "<p>Скрученное существо не может покинуть область действия. Что сделать?</p>",
            buttons: [
              { action: "release-twisted", label: "Отменить скручивание", icon: "fa-solid fa-link-slash", default: true },
              { action: "cancel", label: "Отменить перемещение", icon: "fa-solid fa-xmark" }
            ]
          });
          if (choice !== "release-twisted") return;
          await moduleApi.requestTwistedReleaseAndMove({
            targetTokenUuid: clean(token?.uuid), linkId,
            x: position.x, y: position.y,
            operationId: operationId("twisted-release-move"), requesterUserId
          });
        })().finally(() => pendingTargetDialogs.delete(pendingKey));
        pendingTargetDialogs.set(pendingKey, pending);
        pending.catch(report);
      }
      return shouldCancelOriginalUpdate(changed);
    }

    if (twistedSourceLinks.length) {
      schedule(() => moduleApi.requestTwistedPullFromTokenUpdate({
        sourceTokenUuid, x: position.x, y: position.y,
        operationId: operationId("twisted-pull"), requesterUserId
      }));
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
    const scene = currentScene();
    schedule(async () => {
      await moduleApi.handleManagedEffectDeleted(effect);
      await refreshTwistedAura(scene);
    });
  });

  for (const event of ["createActiveEffect", "updateActiveEffect", "updateActor"]) {
    Hooks.on(event, () => {
      if (!isActiveGmClient(gameProvider())) return;
      const scene = currentScene();
      if (scene) schedule(async () => {
        await moduleApi.reconcileTwistedLinks(scene);
        await refreshTwistedAura(scene);
      });
    });
  }

  Hooks.on("deleteToken", (token, options = {}) => {
    if (options?.[MODULE_ID]?.[GRAPPLE_BYPASS_OPTION] === true) return;
    if (!isActiveGmClient(gameProvider())) return;
    const scene = token?.parent ?? currentScene();
    schedule(async () => {
      await moduleApi.handleTokenDeleted(token);
      await refreshTwistedAura(scene);
    });
  });

  Hooks.on("updateToken", (token, changed) => {
    if (!hasPositionChange(changed) || !isActiveGmClient(gameProvider())) return;
    if (!(moduleApi.getTwistedLinksForSource?.(token)?.length > 0)) return;
    const scene = token?.parent ?? currentScene();
    schedule(() => refreshTwistedAura(scene));
  });

  Hooks.on("canvasReady", (canvasOrScene) => {
    if (!isActiveGmClient(gameProvider())) return;
    const scene = canvasOrScene?.scene ?? canvasOrScene;
    if (scene) schedule(async () => {
      await moduleApi.reconcileScene(scene);
      await moduleApi.reconcileTwistedLinks(scene);
      await refreshTwistedAura(scene);
    });
  });

  Hooks.on("ready", () => {
    if (!isActiveGmClient(gameProvider())) return;
    const scene = currentScene();
    if (scene) schedule(async () => {
      await moduleApi.reconcileScene(scene);
      await moduleApi.reconcileTwistedLinks(scene);
      await refreshTwistedAura(scene);
    });
  });

  Hooks.on("createCombat", (combat) => {
    if (!isActiveGmClient(gameProvider())) return;
    const scene = combat?.scene ?? currentScene();
    schedule(() => refreshTwistedAura(scene, combat));
  });

  Hooks.on("combatTurn", (combat) => {
    if (!isActiveGmClient(gameProvider())) return;
    const scene = combat?.scene ?? currentScene();
    schedule(() => refreshTwistedAura(scene, combat));
  });

  Hooks.on("deleteCombat", () => {
    if (!isActiveGmClient(gameProvider())) return;
    const scene = currentScene();
    schedule(() => refreshTwistedAura(scene, null));
  });

  return { pendingTargetDialogs };
}
