import { MODULE_ID } from "../constants.js";
import { preflightStorageAccess } from "../data/storage-access.js";
import { isStorageActor } from "../data/storage-service.js";
import { isDeadNpcStorageTarget } from "../data/corpse-storage-materializer.js";
import { StorageTokenOverlayController } from "../ui/storage-token-overlay.js";

export function buildStorageTokenActions(moduleApi, token, {
  isGM = false,
  characterTokenUuid = ""
} = {}) {
  const tokenUuid = String(token?.document?.uuid ?? token?.uuid ?? "").trim();
  const safeCharacterTokenUuid = String(characterTokenUuid ?? "").trim();
  const actions = [{
    id: "open",
    label: "Открыть",
    icon: "fa-solid fa-box-open",
    callback: () => moduleApi.openStorageApp({
      tokenUuid,
      configure: false,
      anchorToToken: true,
      ...(safeCharacterTokenUuid ? { characterTokenUuid: safeCharacterTokenUuid } : {})
    })
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

  const pointerHandlers = new WeakMap();
  const showAccessFailure = (token, access) => {
    if (access.reason === "distance") {
      overlayController.showFeedback(token, "Подойдите ближе", { durationMs: 2000 });
      return;
    }
    const messages = {
      character: "Выберите принадлежащего вам персонажа.",
      scene: "Персонаж и хранилище должны находиться на одной сцене.",
      visibility: "Персонаж не видит это хранилище."
    };
    globalThis.ui?.notifications?.warn(messages[access.reason] ?? "Хранилище сейчас недоступно.");
  };
  const resolvePlayerAccess = (token, game) => {
    const access = preflightStorageAccess(token, { game, canvas: canvasProvider() });
    if (!access.allowed) {
      showAccessFailure(token, access);
      return null;
    }
    return access;
  };
  const showTokenActions = (token) => {
    const game = gameProvider();
    if (game?.user?.isGM === true) {
      overlayController.showActions(token, buildStorageTokenActions(moduleApi, token, { isGM: true }));
      return;
    }
    const access = resolvePlayerAccess(token, game);
    if (!access) return;
    overlayController.showActions(token, buildStorageTokenActions(moduleApi, token, {
      isGM: false,
      characterTokenUuid: access.characterTokenUuid
    }));
  };
  const openCorpseStorage = async (token) => {
    if (!isDeadNpcStorageTarget(token)) return;
    const game = gameProvider();
    const access = game?.user?.isGM === true ? null : resolvePlayerAccess(token, game);
    if (game?.user?.isGM !== true && !access) return;
    const tokenUuid = String(token?.document?.uuid ?? token?.uuid ?? "").trim();
    await moduleApi.openStorageApp({
      tokenUuid,
      configure: false,
      anchorToToken: true,
      ...(access?.characterTokenUuid ? { characterTokenUuid: access.characterTokenUuid } : {})
    });
  };
  const bindPointerClick = (token) => {
    if ((!isStorageActor(token?.actor) && !isDeadNpcStorageTarget(token)) || typeof token?.on !== "function") return;
    let handler = pointerHandlers.get(token);
    if (!handler) {
      handler = async (event) => {
        const button = Number(event?.button ?? event?.data?.button ?? 0);
        if (button !== 0) return;
        if (isStorageActor(token?.actor)) {
          showTokenActions(token);
          return;
        }
        try {
          await openCorpseStorage(token);
        }
        catch (error) {
          globalThis.ui?.notifications?.error(error?.message ?? "Не удалось открыть хранилище.");
        }
      };
      pointerHandlers.set(token, handler);
    }
    token.off?.("pointertap", handler);
    token.on("pointertap", handler);
  };

  hooks.on("controlToken", async (token, controlled) => {
    if (!controlled || (!isStorageActor(token?.actor) && !isDeadNpcStorageTarget(token))) return;
    bindPointerClick(token);
  });
  hooks.on("hoverToken", (token, hovered) => {
    if (hovered) bindPointerClick(token);
  });
  hooks.on("drawToken", bindPointerClick);
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
