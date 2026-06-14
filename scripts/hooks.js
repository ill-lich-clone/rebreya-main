import { MODULE_ID, SETTINGS_KEYS } from "./constants.js";

let bg3HotbarSuppressionHookRegistered = false;
let bg3HotbarDeathSavesCompatRegistered = false;
let fixedRaceSizeHookRegistered = false;
let playerInventoryQuickButtonHookRegistered = false;
const PANEL_TOOL_NAME = `${MODULE_ID}-panel`;
const DND5E_ACTOR_SIZES = new Set(["tiny", "sm", "med", "lg", "huge", "grg"]);
const BG3_HOTBAR_MODULE_ID = "bg3-inspired-hotbar";
const BG3_DEATH_SAVES_CONTAINER_PATH = `/modules/${BG3_HOTBAR_MODULE_ID}/scripts/components/containers/DeathSavesContainer.js`;
const BG3_DEATH_SAVES_PATCH_FLAG = Symbol.for(`${MODULE_ID}.bg3DeathSavesPatch`);
const PLAYER_INVENTORY_BUTTON_SELECTOR = "[data-rebreya-player-inventory-button='true']";
const PLAYER_INVENTORY_BUTTON_LEFT = "clamp(220px, 8.5vw, 280px)";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasObjectKeys(value) {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

export function shouldSuppressBg3HotbarAutoAdd(item) {
  if (!item || item.type !== "feat") {
    return false;
  }

  const rebreyaFlags = item.flags?.[MODULE_ID];
  const teyvankalFlags = item.flags?.teyvankal;
  const managed = item.getFlag?.(MODULE_ID, "managed") ?? rebreyaFlags?.managed;
  const automation = item.getFlag?.(MODULE_ID, "automation") ?? rebreyaFlags?.automation;
  const choiceOption = item.getFlag?.(MODULE_ID, "choiceOption") ?? rebreyaFlags?.choiceOption;
  const sourceType = item.getFlag?.(MODULE_ID, "sourceType") ?? rebreyaFlags?.sourceType;
  const classIdentifier = item.getFlag?.(MODULE_ID, "classIdentifier") ?? rebreyaFlags?.classIdentifier;
  const featureId = item.getFlag?.(MODULE_ID, "featureId") ?? rebreyaFlags?.featureId;

  return Boolean(
    managed
    || automation
    || choiceOption
    || sourceType
    || classIdentifier
    || featureId
    || hasObjectKeys(teyvankalFlags)
  );
}

export function applyBg3HotbarAutoAddSuppression(item, options) {
  if (!isPlainObject(options) || !shouldSuppressBg3HotbarAutoAdd(item)) {
    return false;
  }

  options.noBG3AutoAdd = true;
  return true;
}

function normalizeDeathSaveCounter(value) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
}

function getBg3DeathSavesDisplaySetting() {
  try {
    return game.settings.get(BG3_HOTBAR_MODULE_ID, "showDeathSavingThrow") ?? "hide";
  }
  catch (_error) {
    return "hide";
  }
}

export function getBg3DeathSaveData(actor, display = getBg3DeathSavesDisplaySetting()) {
  const death = actor?.system?.attributes?.death ?? {};
  return {
    display,
    success: normalizeDeathSaveCounter(death.success),
    failure: normalizeDeathSaveCounter(death.failure)
  };
}

function isBg3HotbarActive() {
  try {
    return globalThis.game?.modules?.get?.(BG3_HOTBAR_MODULE_ID)?.active === true;
  }
  catch (_error) {
    return false;
  }
}

export async function patchBg3HotbarDeathSavesContainer({
  force = false,
  importModule = (path) => import(path)
} = {}) {
  if (!force && !isBg3HotbarActive()) {
    return false;
  }

  let module;
  try {
    module = await importModule(BG3_DEATH_SAVES_CONTAINER_PATH);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to load BG3 hotbar death saves component for compatibility patch.`, error);
    return false;
  }

  const prototype = module?.DeathSavesContainer?.prototype;
  if (!prototype || prototype[BG3_DEATH_SAVES_PATCH_FLAG]) {
    return false;
  }

  prototype[BG3_DEATH_SAVES_PATCH_FLAG] = true;
  prototype.getData = async function getRebreyaSafeDeathSavesData() {
    return getBg3DeathSaveData(this.actor);
  };
  return true;
}

function registerBg3HotbarAutoAddSuppression() {
  if (bg3HotbarSuppressionHookRegistered || !globalThis.Hooks?.on) {
    return;
  }

  bg3HotbarSuppressionHookRegistered = true;
  Hooks.on("createItem", (item, options) => {
    applyBg3HotbarAutoAddSuppression(item, options);
  });
}

function registerBg3HotbarDeathSavesCompat() {
  if (bg3HotbarDeathSavesCompatRegistered || !globalThis.Hooks?.once) {
    return;
  }

  bg3HotbarDeathSavesCompatRegistered = true;
  Hooks.once("ready", () => {
    patchBg3HotbarDeathSavesContainer().catch((error) => {
      console.warn(`${MODULE_ID} | Failed to patch BG3 hotbar death saves component.`, error);
    });
  });
}

function getItemFlag(item, key) {
  return item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key];
}

export async function applyFixedRaceSize(item) {
  if (!item || item.type !== "race") {
    return false;
  }

  const fixedSize = String(getItemFlag(item, "fixedSize") ?? "").trim();
  if (!DND5E_ACTOR_SIZES.has(fixedSize)) {
    return false;
  }

  const actor = item.parent ?? item.actor ?? null;
  if (!actor || actor.type !== "character") {
    return false;
  }

  if (actor.system?.traits?.size === fixedSize) {
    return false;
  }

  await actor.update({ "system.traits.size": fixedSize });
  return true;
}

function registerFixedRaceSizeHook() {
  if (fixedRaceSizeHookRegistered || !globalThis.Hooks?.on) {
    return;
  }

  fixedRaceSizeHookRegistered = true;
  Hooks.on("createItem", (item) => {
    applyFixedRaceSize(item).catch((error) => {
      console.error(`${MODULE_ID} | Failed to apply fixed race size.`, error);
    });
  });
}

function unwrapHtmlElement(value) {
  const HTMLElementClass = globalThis.HTMLElement;
  const element = Array.isArray(value) ? value[0] : value?.[0] ?? value;
  if (HTMLElementClass && element instanceof HTMLElementClass) {
    return element;
  }

  if (typeof element?.querySelector === "function") {
    return element;
  }

  return null;
}

function findPlayersRoot(element) {
  if (!element?.querySelector) {
    return null;
  }

  if (element.id === "players") {
    return element;
  }

  return element.closest?.("#players") ?? element.querySelector("#players");
}

export function resolvePlayerInventoryButtonAnchor(app, html = null) {
  const appRoot = findPlayersRoot(unwrapHtmlElement(app?.element ?? app));
  if (appRoot) {
    return appRoot;
  }

  const htmlRoot = findPlayersRoot(unwrapHtmlElement(html));
  if (htmlRoot) {
    return htmlRoot;
  }

  const jqueryResult = app?.element?.find?.("#players")?.[0] ?? html?.find?.("#players")?.[0] ?? null;
  if (jqueryResult) {
    return jqueryResult;
  }

  return globalThis.document?.getElementById?.("players") ?? null;
}

function formatViewportUnit(value, viewportSize, unit) {
  if (!Number.isFinite(value) || !Number.isFinite(viewportSize) || viewportSize <= 0) {
    return "0";
  }

  return `${Number(((value / viewportSize) * 100).toFixed(3))}${unit}`;
}

export function positionPlayerInventoryQuickButton(button, playersElement, { viewport = globalThis } = {}) {
  if (!button?.style || typeof playersElement?.getBoundingClientRect !== "function") {
    return false;
  }

  const rect = playersElement.getBoundingClientRect();
  const ownerDocument = playersElement.ownerDocument ?? globalThis.document;
  const viewportHeight = Number(
    viewport?.innerHeight
    ?? globalThis.innerHeight
    ?? ownerDocument?.documentElement?.clientHeight
    ?? 0
  );

  if (!Number.isFinite(rect?.right) || !Number.isFinite(rect?.top) || !Number.isFinite(rect?.height)) {
    return false;
  }

  const buttonSize = 30;
  const centerY = rect.top + (rect.height * 0.58);
  const top = Math.max(8, Math.min(viewportHeight - buttonSize - 8, centerY - (buttonSize / 2)));

  button.style.left = PLAYER_INVENTORY_BUTTON_LEFT;
  button.style.top = formatViewportUnit(top, viewportHeight, "vh");
  return true;
}

function removeEmbeddedPlayerInventoryButton(playersElement, buttonHost) {
  const embeddedButton = playersElement?.querySelector?.(PLAYER_INVENTORY_BUTTON_SELECTOR);
  if (embeddedButton && embeddedButton.parentElement !== buttonHost) {
    embeddedButton.remove?.();
  }
}

export function ensurePlayerInventoryQuickButton(
  playersElement,
  moduleApi = globalThis.game?.rebreyaMain,
  { viewport = globalThis } = {}
) {
  const ownerDocument = playersElement?.ownerDocument ?? globalThis.document;
  const buttonHost = ownerDocument?.body;
  if (!playersElement || !buttonHost?.querySelector || !ownerDocument?.createElement) {
    return false;
  }

  removeEmbeddedPlayerInventoryButton(playersElement, buttonHost);

  const existingButton = buttonHost.querySelector(PLAYER_INVENTORY_BUTTON_SELECTOR);
  if (existingButton) {
    positionPlayerInventoryQuickButton(existingButton, playersElement, { viewport });
    return false;
  }

  const label = "Открыть инвентарь Rebreya";
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.dataset.rebreyaPlayerInventoryButton = "true";
  button.classList?.add?.("rm-player-inventory-button");
  button.title = label;
  button.setAttribute?.("aria-label", label);
  button.innerHTML = '<i class="fa-solid fa-bag-shopping" aria-hidden="true"></i>';
  button.addEventListener?.("click", async (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();

    try {
      await (moduleApi ?? globalThis.game?.rebreyaMain)?.openInventoryApp?.();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open inventory from player list button.`, error);
    }
  });

  if (typeof buttonHost.append === "function") {
    buttonHost.append(button);
  }
  else {
    buttonHost.appendChild?.(button);
  }
  positionPlayerInventoryQuickButton(button, playersElement, { viewport });
  return true;
}

function injectPlayerInventoryQuickButton(app, html) {
  const playersElement = resolvePlayerInventoryButtonAnchor(app, html);
  ensurePlayerInventoryQuickButton(playersElement);
}

function registerPlayerInventoryQuickButtonHook() {
  if (playerInventoryQuickButtonHookRegistered || !globalThis.Hooks?.on) {
    return;
  }

  playerInventoryQuickButtonHookRegistered = true;
  Hooks.on("renderPlayerList", (app, html) => {
    injectPlayerInventoryQuickButton(app, html);
  });
  Hooks.on("renderPlayers", (app, html) => {
    injectPlayerInventoryQuickButton(app, html);
  });
  Hooks.once?.("ready", () => {
    injectPlayerInventoryQuickButton();
  });
  globalThis.addEventListener?.("resize", () => {
    injectPlayerInventoryQuickButton();
  }, { passive: true });
}

function canShowRebreyaControls() {
  return true;
}

function isEconomyButtonVisible() {
  try {
    return game.settings.get(MODULE_ID, SETTINGS_KEYS.SHOW_BUTTON) !== false;
  }
  catch (_error) {
    return true;
  }
}

function rerenderSceneControls() {
  const controlsApp = ui?.controls;
  if (!controlsApp) {
    return;
  }

  try {
    controlsApp.render?.({ reset: true });
  }
  catch (_error) {
    controlsApp.render?.(true);
  }
}

function createSafeAction(callback, errorLabel) {
  return async (_event, active = true) => {
    if (active === false) {
      return;
    }

    try {
      await callback();
    }
    catch (error) {
      console.error(`${MODULE_ID} | ${errorLabel}`, error);
    }
  };
}

function isTilesLayer(layer) {
  if (!layer) {
    return false;
  }

  const tilesLayer = globalThis.canvas?.tiles ?? null;
  const layerName = String(
    layer.options?.name
    ?? layer.constructor?.layerOptions?.name
    ?? layer.name
    ?? ""
  );

  return layer === tilesLayer || layerName === "tiles";
}

function deactivateActiveTilesLayer() {
  const activeLayer = globalThis.canvas?.activeLayer ?? null;
  if (!isTilesLayer(activeLayer) || typeof activeLayer.deactivate !== "function") {
    return;
  }

  activeLayer.deactivate();
}

function createRebreyaControlChange() {
  return (_event, active = true) => {
    if (active === false) {
      return;
    }

    try {
      deactivateActiveTilesLayer();
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to deactivate tiles layer before opening Rebreya controls.`, error);
    }
  };
}

function buildToolsRecord() {
  const economyToolName = `${MODULE_ID}-economy`;
  const inventoryToolName = `${MODULE_ID}-inventory`;
  const groupsToolName = `${MODULE_ID}-groups`;
  const calendarToolName = `${MODULE_ID}-calendar`;
  const lootgenToolName = `${MODULE_ID}-lootgen`;
  const showEconomyButton = isEconomyButtonVisible();

  return {
    [PANEL_TOOL_NAME]: {
      name: PANEL_TOOL_NAME,
      order: 0,
      title: game.i18n.localize("REBREYA_MAIN.Controls.GroupTitle"),
      icon: "fa-solid fa-box-open",
      visible: true
    },
    [economyToolName]: {
      name: economyToolName,
      order: 10,
      title: game.i18n.localize("REBREYA_MAIN.Controls.OpenEconomy"),
      icon: "fa-solid fa-coins",
      button: true,
      visible: game.user?.isGM === true && showEconomyButton,
      onChange: createSafeAction(
        () => game.rebreyaMain?.openEconomyApp?.(),
        "Economy control click failed."
      )
    },
    [inventoryToolName]: {
      name: inventoryToolName,
      order: 20,
      title: game.i18n.localize("REBREYA_MAIN.Controls.OpenInventory"),
      icon: "fa-solid fa-box-open",
      button: true,
      visible: true,
      onChange: createSafeAction(
        () => game.rebreyaMain?.openInventoryApp?.(),
        "Inventory control click failed."
      )
    },
    [groupsToolName]: {
      name: groupsToolName,
      order: 25,
      title: game.i18n.localize("REBREYA_MAIN.Controls.OpenGroups"),
      icon: "fa-solid fa-users",
      button: true,
      visible: game.user?.isGM === true,
      onChange: createSafeAction(
        () => game.rebreyaMain?.openGroupsApp?.(),
        "Groups control click failed."
      )
    },
    [calendarToolName]: {
      name: calendarToolName,
      order: 30,
      title: game.i18n.localize("REBREYA_MAIN.Controls.OpenCalendar"),
      icon: "fa-solid fa-calendar-days",
      button: true,
      visible: true,
      onChange: createSafeAction(
        () => game.rebreyaMain?.openInventoryApp?.({ tab: "calendar" }),
        "Calendar control click failed."
      )
    },
    [lootgenToolName]: {
      name: lootgenToolName,
      order: 40,
      title: game.i18n.localize("REBREYA_MAIN.Controls.OpenLootgen"),
      icon: "fa-solid fa-sack-dollar",
      button: true,
      visible: game.user?.isGM === true,
      onChange: createSafeAction(
        () => game.rebreyaMain?.openLootgenApp?.({ newWindow: true }),
        "Lootgen control click failed."
      )
    }
  };
}

function buildToolsArray() {
  return Object.values(buildToolsRecord());
}

function buildControlRecord(controlsRecord) {
  const controlName = `${MODULE_ID}-rebreya`;
  const tokenControl = controlsRecord?.tokens ?? controlsRecord?.token ?? null;
  const tokenOrder = Number(tokenControl?.order ?? 0);
  const fallbackOrder = Object.keys(controlsRecord ?? {}).length + 100;
  const order = Number.isFinite(tokenOrder) ? tokenOrder + 1 : fallbackOrder;

  return {
    name: controlName,
    order,
    title: game.i18n.localize("REBREYA_MAIN.Controls.GroupTitle"),
    icon: "fa-solid fa-box-open",
    visible: true,
    onChange: createRebreyaControlChange(),
    tools: buildToolsRecord(),
    activeTool: PANEL_TOOL_NAME
  };
}

function buildControlArrayEntry(controlsArray) {
  const controlName = `${MODULE_ID}-rebreya`;
  const tokenIndex = controlsArray.findIndex((control) => control?.name === "tokens" || control?.name === "token");
  const tokenControl = tokenIndex >= 0 ? controlsArray[tokenIndex] : null;
  const tokenOrder = Number(tokenControl?.order ?? 0);
  const order = Number.isFinite(tokenOrder) ? tokenOrder + 1 : (controlsArray.length + 100);

  return {
    name: controlName,
    order,
    title: game.i18n.localize("REBREYA_MAIN.Controls.GroupTitle"),
    icon: "fa-solid fa-box-open",
    visible: true,
    onChange: createRebreyaControlChange(),
    tools: buildToolsArray(),
    activeTool: PANEL_TOOL_NAME
  };
}

function registerSceneControlInRecord(controls) {
  const controlName = `${MODULE_ID}-rebreya`;
  if (controls[controlName]) {
    return;
  }

  controls[controlName] = buildControlRecord(controls);
}

function registerSceneControlInArray(controls) {
  const controlName = `${MODULE_ID}-rebreya`;
  if (controls.some((control) => control?.name === controlName)) {
    return;
  }

  const rebreyaControl = buildControlArrayEntry(controls);
  const tokenIndex = controls.findIndex((control) => control?.name === "tokens" || control?.name === "token");
  if (tokenIndex >= 0) {
    controls.splice(tokenIndex + 1, 0, rebreyaControl);
  }
  else {
    controls.push(rebreyaControl);
  }
}

export function refreshEconomyLauncher() {
  rerenderSceneControls();
}

export function registerSceneControlsHook() {
  registerBg3HotbarAutoAddSuppression();
  registerBg3HotbarDeathSavesCompat();
  registerFixedRaceSizeHook();
  registerPlayerInventoryQuickButtonHook();

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!canShowRebreyaControls() || !controls) {
      return;
    }

    if (Array.isArray(controls)) {
      registerSceneControlInArray(controls);
      return;
    }

    if (typeof controls === "object") {
      registerSceneControlInRecord(controls);
    }
  });

  Hooks.on("canvasReady", () => {
    rerenderSceneControls();
  });
}
