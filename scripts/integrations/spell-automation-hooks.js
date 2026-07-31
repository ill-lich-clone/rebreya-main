import { MODULE_ID } from "../constants.js";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.spellAutomationHooksRegistered`;

function report(error) {
  try {
    console.error(`${MODULE_ID} | Failed to route spell automation hook.`, error);
  }
  catch {
    // A logging failure must not reject a Foundry hook.
  }
}

function runAsync(operation) {
  Promise.resolve()
    .then(operation)
    .catch(report);
  return true;
}

export function registerSpellAutomationHooks(moduleApi, {
  Hooks = globalThis.Hooks,
  game = globalThis.game
} = {}) {
  const bridge = moduleApi?.spellAutomationHookBridge;
  if (!Hooks?.on || !bridge || !game) return false;
  if (game[HOOKS_REGISTERED_KEY]) return true;
  game[HOOKS_REGISTERED_KEY] = true;

  Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
    try {
      return bridge.handlePreUseActivity?.(activity, usageConfig, dialogConfig, messageConfig) ?? true;
    }
    catch (error) {
      report(error);
      return true;
    }
  });

  Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => runAsync(
    () => bridge.handlePostUseActivity?.(activity, usageConfig, results)
  ));
  Hooks.on("midi-qol.RollComplete", (workflow) => runAsync(
    () => bridge.handleMidiRollComplete?.(workflow)
  ));
  Hooks.on("dnd5e.preSummon", (activity, profile, summonOptions) => {
    try {
      return bridge.handlePreSummon?.(activity, profile, summonOptions) ?? true;
    }
    catch (error) {
      report(error);
      return true;
    }
  });
  Hooks.on("dnd5e.summonToken", (activity, profile, tokenData, summonOptions) => {
    try {
      return bridge.handleSummonToken?.(activity, profile, tokenData, summonOptions) ?? true;
    }
    catch (error) {
      report(error);
      return true;
    }
  });
  Hooks.on("dnd5e.postSummon", (activity, profile, tokens, summonOptions) => runAsync(
    () => bridge.handlePostSummon?.(activity, profile, tokens, summonOptions)
  ));

  Hooks.on("createActiveEffect", (effect, options) => runAsync(
    () => bridge.handleActiveEffectChanged?.("create", effect, undefined, options)
  ));
  Hooks.on("updateActiveEffect", (effect, changed, options) => runAsync(
    () => bridge.handleActiveEffectChanged?.("update", effect, changed, options)
  ));
  Hooks.on("deleteActiveEffect", (effect, options) => runAsync(
    () => bridge.handleActiveEffectChanged?.("delete", effect, undefined, options)
  ));

  Hooks.on("createMeasuredTemplate", (template, options) => runAsync(
    () => bridge.handleMeasuredTemplateChanged?.("create", template, undefined, options)
  ));
  Hooks.on("updateMeasuredTemplate", (template, changed, options) => runAsync(
    () => bridge.handleMeasuredTemplateChanged?.("update", template, changed, options)
  ));
  Hooks.on("deleteMeasuredTemplate", (template, options) => runAsync(
    () => bridge.handleMeasuredTemplateChanged?.("delete", template, undefined, options)
  ));
  Hooks.on("combatTurnChange", (combat, prior, current) => runAsync(
    () => bridge.handleCombatTurnChanged?.(combat, prior, current)
  ));

  return true;
}
