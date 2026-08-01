import { MODULE_ID } from "../constants.js";
import { isStorageActor } from "../data/storage-service.js";

const STORAGE_MENU_ID = `${MODULE_ID}-storage-token-menu`;

function defaultShowActions(_token, actions) {
  const document = globalThis.document;
  if (!document?.body) return;
  document.getElementById(STORAGE_MENU_ID)?.remove();
  const menu = document.createElement("div");
  menu.id = STORAGE_MENU_ID;
  menu.className = "rm-storage-token-menu";
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rm-button rm-button--secondary";
    const icon = document.createElement("i");
    icon.className = action.icon;
    const label = document.createElement("span");
    label.textContent = action.label;
    button.append(icon, label);
    button.addEventListener("click", async () => {
      try {
        await action.callback();
        menu.remove();
      }
      catch (error) {
        console.error(`${MODULE_ID} | Storage token action failed.`, error);
        globalThis.ui?.notifications?.error(error?.message ?? "Не удалось открыть хранилище.");
      }
    });
    menu.append(button);
  }
  document.body.append(menu);
}

export function buildStorageTokenActions(moduleApi, token, { isGM = false } = {}) {
  const tokenUuid = String(token?.document?.uuid ?? token?.uuid ?? "").trim();
  const actions = [{
    id: "open",
    label: "Открыть",
    icon: "fa-solid fa-box-open",
    callback: () => moduleApi.openStorageApp({ tokenUuid, configure: false })
  }];
  if (isGM) {
    actions.push({
      id: "configure",
      label: "Настроить",
      icon: "fa-solid fa-gear",
      callback: () => moduleApi.openStorageApp({ tokenUuid, configure: true })
    });
  }
  return actions;
}

export function registerStorageTokenHooks(moduleApi, {
  hooks = globalThis.Hooks,
  gameProvider = () => globalThis.game,
  showActions = defaultShowActions
} = {}) {
  if (typeof hooks?.on !== "function") return false;

  const boundTokens = new WeakSet();
  const showTokenActions = (token) => {
    const isGM = gameProvider()?.user?.isGM === true;
    showActions(token, buildStorageTokenActions(moduleApi, token, { isGM }));
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
