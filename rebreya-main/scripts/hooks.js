import { MODULE_ID, SETTINGS_KEYS } from "./constants.js";

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
      title: "Открыть календарь Rebreya",
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
      title: "Открыть лутген Rebreya",
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

function injectToolsIntoRecord(tokenControl) {
  if (!tokenControl || typeof tokenControl !== "object") {
    return false;
  }

  if (!tokenControl.tools || typeof tokenControl.tools !== "object" || Array.isArray(tokenControl.tools)) {
    return false;
  }

  const nextTools = buildToolsRecord();
  for (const [toolName, toolConfig] of Object.entries(nextTools)) {
    if (!tokenControl.tools[toolName]) {
      tokenControl.tools[toolName] = toolConfig;
    }
  }

  const preferredTool = `${MODULE_ID}-inventory`;
  if (!tokenControl.activeTool || !tokenControl.tools[tokenControl.activeTool]) {
    tokenControl.activeTool = preferredTool;
  }

  return true;
}

function injectToolsIntoArray(tokenControl) {
  if (!tokenControl || typeof tokenControl !== "object") {
    return false;
  }

  const preferredTool = `${MODULE_ID}-inventory`;

  if (Array.isArray(tokenControl.tools)) {
    const existing = new Set(tokenControl.tools.map((tool) => tool?.name).filter(Boolean));
    for (const tool of buildToolsArray()) {
      if (!existing.has(tool.name)) {
        tokenControl.tools.push(tool);
      }
    }

    if (!tokenControl.activeTool || !tokenControl.tools.some((tool) => tool?.name === tokenControl.activeTool)) {
      tokenControl.activeTool = preferredTool;
    }

    return true;
  }

  return injectToolsIntoRecord(tokenControl);
}

function buildControlRecord(controlsRecord) {
  const controlName = `${MODULE_ID}-rebreya`;
  const tokenControl = controlsRecord?.tokens ?? controlsRecord?.token ?? null;
  const tokenOrder = Number(tokenControl?.order ?? 0);
  const fallbackOrder = Object.keys(controlsRecord ?? {}).length + 100;
  const order = Number.isFinite(tokenOrder) ? tokenOrder + 1 : fallbackOrder;
  const activeTool = `${MODULE_ID}-inventory`;

  return {
    name: controlName,
    order,
    title: "Ребрея",
    icon: "fa-solid fa-box-open",
    visible: true,
    tools: buildToolsRecord(),
    activeTool
  };
}

function buildControlArrayEntry(controlsArray) {
  const controlName = `${MODULE_ID}-rebreya`;
  const tokenIndex = controlsArray.findIndex((control) => control?.name === "tokens" || control?.name === "token");
  const tokenControl = tokenIndex >= 0 ? controlsArray[tokenIndex] : null;
  const tokenOrder = Number(tokenControl?.order ?? 0);
  const order = Number.isFinite(tokenOrder) ? tokenOrder + 1 : (controlsArray.length + 100);
  const activeTool = `${MODULE_ID}-inventory`;

  return {
    name: controlName,
    order,
    title: "Ребрея",
    icon: "fa-solid fa-box-open",
    visible: true,
    tools: buildToolsArray(),
    activeTool
  };
}

function registerSceneControlInRecord(controls) {
  const tokenControl = controls?.tokens ?? controls?.token ?? null;
  if (injectToolsIntoRecord(tokenControl)) {
    return;
  }

  const controlName = `${MODULE_ID}-rebreya`;
  if (controls[controlName]) {
    return;
  }

  controls[controlName] = buildControlRecord(controls);
}

function registerSceneControlInArray(controls) {
  const tokenControl = controls.find((control) => control?.name === "tokens" || control?.name === "token");
  if (injectToolsIntoArray(tokenControl)) {
    return;
  }

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
