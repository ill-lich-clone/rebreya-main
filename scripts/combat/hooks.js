import { MODULE_ID } from "../constants.js";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.combatHooksRegistered`;

export function registerCombatHooks(moduleApi) {
  const hasStatusService = Boolean(moduleApi?.combatStatusService);
  const hasAttackService = Boolean(moduleApi?.combatAttackService);
  if (!hasStatusService && !hasAttackService) {
    return;
  }

  if (game[HOOKS_REGISTERED_KEY]) {
    return;
  }
  game[HOOKS_REGISTERED_KEY] = true;

  if (hasStatusService) {
    Hooks.on("updateActor", (actor, changed) => {
      moduleApi.combatStatusService.handleActorHpUpdate(actor, changed).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle actor HP update for status sync.`, error);
      });
    });

    Hooks.on("renderTokenHUD", (app, html) => {
      moduleApi.combatStatusService.bindTokenHud(app, html).catch((error) => {
        console.error(`${MODULE_ID} | Failed to bind token HUD status interactions.`, error);
      });
    });
  }

  Hooks.on("combatTurn", (combat, updateData, updateOptions) => {
    if (hasStatusService) {
      moduleApi.combatStatusService.handleCombatTurnChange(combat, updateData, updateOptions).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle combat turn status processing.`, error);
      });
    }

    if (hasAttackService) {
      moduleApi.combatAttackService.handleCombatTurnChange(combat, updateData, updateOptions).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle combat turn reaction processing.`, error);
      });
    }
  });

  if (hasAttackService) {
    Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.combatAttackService.applyDnd5ePreUseActivity(
          activity,
          usageConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply pre-use activity automation.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.preRollAttack", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.combatAttackService.applyDnd5eAttackRollConfig(
          rollConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply attack roll automation.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.preRollDamage", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.combatAttackService.applyDnd5eDamageRollConfig(
          rollConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply damage roll automation.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.applyDamage", (actor, amount, options) => {
      try {
        return moduleApi.combatAttackService.applyDnd5eApplyDamage(
          actor,
          amount,
          options
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply post-damage automation.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.rollAttack", (rolls, context) => {
      try {
        return moduleApi.combatAttackService.applyDnd5ePostAttackRoll(
          rolls,
          context
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to capture post-attack roll automation.`, error);
        return true;
      }
    });

    Hooks.on("midi-qol.hitsChecked", (workflow) => {
      try {
        return moduleApi.combatAttackService.applyMidiHitsChecked(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply MIDI hit-check automation.`, error);
        return true;
      }
    });

    Hooks.on("midi-qol.RollComplete", (workflow) => {
      try {
        return moduleApi.combatAttackService.applyMidiRollComplete(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply MIDI roll-complete automation.`, error);
        return true;
      }
    });
  }
}
