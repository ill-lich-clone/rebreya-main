import { MODULE_ID } from "../constants.js";
import { renderImplantItemSheetActions } from "./implant-item-sheet.js";

const registeredHookSets = new WeakSet();

export function registerImplantAutomationHooks(moduleApi, { Hooks = globalThis.Hooks } = {}) {
  const service = moduleApi?.implantAutomationService;
  if (!Hooks || typeof Hooks.on !== "function" || !service) return false;
  if (registeredHookSets.has(Hooks)) return false;
  registeredHookSets.add(Hooks);

  Hooks.on("dnd5e.preRollAttack", (rollConfig, dialogConfig, messageConfig) => {
    try {
      return service.applyDnd5ePreRollAttack(rollConfig, dialogConfig, messageConfig);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply implant weapon-attack bonus.`, error);
      return true;
    }
  });

  Hooks.on("dnd5e.preRollTool", (rollConfig, dialogConfig, messageConfig) => {
    try {
      return service.applyDnd5ePreRollTool(rollConfig, dialogConfig, messageConfig);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply implant artisan-tool bonus.`, error);
      return true;
    }
  });

  Hooks.on("dnd5e.preRollD20Test", (rollConfig, dialogConfig, messageConfig) => {
    try {
      return service.applyDnd5ePreRollD20Test(rollConfig, dialogConfig, messageConfig);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply implant grapple/shove bonus.`, error);
      return true;
    }
  });

  Hooks.on("dnd5e.preApplyDamage", (actor, amount, updates, options) => {
    try {
      return service.applyDnd5ePreApplyDamage(actor, amount, updates, options);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply implant falling-damage absorption.`, error);
      return true;
    }
  });

  const renderImplantItemSheet = (app, html) => {
    try {
      renderImplantItemSheetActions(app, html, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to render implant Item actions.`, error);
    }
  };
  Hooks.on("renderItemSheet", renderImplantItemSheet);
  Hooks.on("renderItemSheet5e", renderImplantItemSheet);

  Hooks.on("preUpdateToken", (token, changed) => (
    service.handlePreUpdateToken(token, changed)
  ));
  Hooks.on("updateToken", (token, changed) => (
    service.handleUpdateToken(token, changed)
  ));

  Hooks.on("combatTurnChange", (combat, previous, current) => {
    Promise.resolve(service.handleCombatTurnChange(combat, previous, current)).catch((error) => {
      console.error(`${MODULE_ID} | Failed to apply implant turn movement.`, error);
    });
    return true;
  });
  Hooks.on("deleteCombat", (combat) => {
    Promise.resolve(service.handleCombatEnd(combat)).catch((error) => {
      console.error(`${MODULE_ID} | Failed to clear implant turn movement.`, error);
    });
    return true;
  });

  return true;
}
