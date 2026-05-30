import { MODULE_ID, SETTINGS_KEYS } from "./constants.js";

let bg3HotbarSuppressionHookRegistered = false;
const PANEL_TOOL_NAME = `${MODULE_ID}-panel`;

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

function registerBg3HotbarAutoAddSuppression() {
  if (bg3HotbarSuppressionHookRegistered || !globalThis.Hooks?.on) {
    return;
  }

  bg3HotbarSuppressionHookRegistered = true;
  Hooks.on("createItem", (item, options) => {
    applyBg3HotbarAutoAddSuppression(item, options);
  });
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

function buildToolsRecord() {
  const economyToolName = `${MODULE_ID}-economy`;
  const inventoryToolName = `${MODULE_ID}-inventory`;
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
