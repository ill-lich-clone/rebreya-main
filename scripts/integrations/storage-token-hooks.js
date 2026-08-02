import { MODULE_ID } from "../constants.js";
import { preflightStorageAccess } from "../data/storage-access.js";
import { isStorageActor } from "../data/storage-service.js";
import { StorageTokenOverlayController } from "../ui/storage-token-overlay.js";

export function buildStorageTokenActions(moduleApi, token, { isGM = false } = {}) {
  const tokenUuid = String(token?.document?.uuid ?? token?.uuid ?? "").trim();
  const actions = [{
    id: "open",
    label: "Открыть",
    icon: "fa-solid fa-box-open",
    callback: () => moduleApi.openStorageApp({ tokenUuid, configure: false, anchorToToken: true })
  }];
  if (isGM) {
    actions.push({
      id: "configure",
      label: "Настроить",
      icon: "fa-solid fa-gear",
      callback: () => moduleApi.openStorageApp({ tokenUuid, configure: true, anchorToToken: true })
    });
  }
  return actions;
}

export function registerStorageTokenHooks(moduleApi, {
  hooks = globalThis.Hooks,
  gameProvider = () => globalThis.game,
  canvasProvider = () => globalThis.canvas,
  overlayController = new StorageTokenOverlayController({ canvasProvider })
} = {}) {
  if (typeof hooks?.on !== "function") return false;

  const boundTokens = new WeakSet();
  const showTokenActions = (token) => {
    const game = gameProvider();
    if (game?.user?.isGM === true) {
      overlayController.showActions(token, buildStorageTokenActions(moduleApi, token, { isGM: true }));
      return;
    }
    const access = preflightStorageAccess(token, { game, canvas: canvasProvider() });
    if (access.reason === "distance") {
      overlayController.showFeedback(token, "Подойдите ближе", { durationMs: 2000 });
      return;
    }
    if (!access.allowed) {
      const messages = {
        character: "Выберите принадлежащего вам персонажа.",
        scene: "Персонаж и хранилище должны находиться на одной сцене.",
        visibility: "Персонаж не видит это хранилище."
      };
      globalThis.ui?.notifications?.warn(messages[access.reason] ?? "Хранилище сейчас недоступно.");
      return;
    }
    overlayController.showActions(token, buildStorageTokenActions(moduleApi, token, { isGM: false }));
  };
  const bindPointerClick = (token) => {
    if (!isStorageActor(token?.actor) || typeof token?.on !== "function" || boundTokens.has(token)) return;
    boundTokens.add(token);
    token.on("pointertap", (event) => {
      const button = Number(event?.button ?? event?.data?.button ?? 0);
      if (button === 0) showTokenActions(token);
    });
  };

  hooks.on("controlToken", async (token, controlled) => {
    if (!controlled || !isStorageActor(token?.actor)) return;
    bindPointerClick(token);
    showTokenActions(token);
  });
  hooks.on("hoverToken", (token, hovered) => {
    if (hovered) bindPointerClick(token);
  });
  hooks.on("canvasPan", () => overlayController.reposition());
  hooks.on("updateToken", () => overlayController.reposition());
  hooks.on("deleteToken", () => overlayController.close());
  hooks.on("canvasReady", () => overlayController.close());
  hooks.on("canvasTearDown", () => overlayController.close());

  hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    const game = gameProvider();
    const actor = app?.actor ?? app?.document ?? null;
    if (game?.user?.isGM !== true || actor?.type !== "npc" || isStorageActor(actor)) return;
    buttons.unshift({
      label: "Хранилище",
      class: `${MODULE_ID}-mark-storage`,
      icon: "fa-solid fa-box",
      onclick: () => moduleApi.markStorageActor(actor.uuid)
    });
  });

  hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
    const game = gameProvider();
    const actor = app?.actor ?? app?.document ?? null;
    if (game?.user?.isGM !== true || actor?.type !== "npc" || isStorageActor(actor)) return;
    controls.unshift({
      action: `${MODULE_ID}-mark-storage`,
      icon: "fa-solid fa-box",
      label: "Хранилище",
      onClick: () => moduleApi.markStorageActor(actor.uuid)
    });
  });

  return true;
}
