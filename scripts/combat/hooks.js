import { MODULE_ID } from "../constants.js";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.combatHooksRegistered`;

export function registerCombatHooks(moduleApi) {
  const hasStatusService = Boolean(moduleApi?.combatStatusService);
  const hasAttackService = Boolean(moduleApi?.combatAttackService);
  const hasRaceService = Boolean(moduleApi?.raceAutomationService);
  const hasFighterService = Boolean(moduleApi?.fighterAutomationService);
  const hasPaladinService = Boolean(moduleApi?.paladinAutomationService);
  if (!hasStatusService && !hasAttackService && !hasRaceService && !hasFighterService && !hasPaladinService) {
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

    Hooks.on("createActiveEffect", (effect) => {
      moduleApi.combatStatusService.handleActiveEffectCreated(effect).catch((error) => {
        console.error(`${MODULE_ID} | Failed to sync discreet status after effect creation.`, error);
      });
    });

    Hooks.on("updateActiveEffect", (effect, changed) => {
      moduleApi.combatStatusService.handleActiveEffectUpdate(effect, changed).catch((error) => {
        console.error(`${MODULE_ID} | Failed to sync discreet status after effect update.`, error);
      });
    });

    Hooks.on("deleteActiveEffect", (effect) => {
      moduleApi.combatStatusService.handleActiveEffectDeleted(effect).catch((error) => {
        console.error(`${MODULE_ID} | Failed to sync discreet status after effect deletion.`, error);
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

    if (hasRaceService) {
      try {
        moduleApi.raceAutomationService.handleCombatTurnChange(combat, updateData, updateOptions);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to handle combat turn race automation.`, error);
      }
    }

    if (hasFighterService) {
      moduleApi.fighterAutomationService.handleCombatTurnChange(combat, updateData, updateOptions).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle combat turn fighter automation.`, error);
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
        if (hasRaceService) {
          moduleApi.raceAutomationService.applyDnd5eAttackRollConfig(
            rollConfig,
            dialogConfig,
            messageConfig
          );
        }

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

  if (hasRaceService) {
    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
      moduleApi.raceAutomationService.applyDnd5ePostUseActivity(
        activity,
        usageConfig,
        results
      ).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply race activity automation.`, error);
      });
      return true;
    });

    Hooks.on("dnd5e.preApplyDamage", (actor, amount, updates, options) => {
      try {
        return moduleApi.raceAutomationService.applyDnd5ePreApplyDamage(
          actor,
          amount,
          updates,
          options
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply race pre-damage automation.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.applyDamage", (actor, amount, options) => {
      moduleApi.raceAutomationService.applyDnd5eApplyDamage(
        actor,
        amount,
        options
      ).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply race post-damage automation.`, error);
      });
      return true;
    });

    Hooks.on("dnd5e.rollSkill", (rolls, context) => {
      moduleApi.raceAutomationService.handleSkillRoll(rolls, context).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply race skill roll automation.`, error);
      });
    });

    Hooks.on("dnd5e.rollToolCheck", (rolls, context) => {
      moduleApi.raceAutomationService.handleToolRoll(rolls, context).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply race tool roll automation.`, error);
      });
    });

    Hooks.on("dnd5e.rollAbilityCheck", (rolls, context) => {
      moduleApi.raceAutomationService.handleAbilityCheckRoll(rolls, context).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply race ability roll automation.`, error);
      });
    });

    Hooks.on("dnd5e.rollSavingThrow", (rolls, context) => {
      moduleApi.raceAutomationService.handleSavingThrowRoll(rolls, context).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply race save roll automation.`, error);
      });
    });

    Hooks.on("dnd5e.preLongRest", (actor, config) => {
      try {
        return moduleApi.raceAutomationService.applyDnd5ePreLongRest(actor, config);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply race pre-rest automation.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
      moduleApi.raceAutomationService.handleRestCompleted(actor, result, config).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply race rest automation.`, error);
      });
    });

    Hooks.on("dnd5e.determineOccupiedGridSpaceBlocking", (gridSpace, token, options, found) => {
      try {
        moduleApi.raceAutomationService.handleMovementBlocking(gridSpace, token, options, found);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply race movement automation.`, error);
      }
    });

    Hooks.on("midi-qol.RollComplete", (workflow) => {
      moduleApi.raceAutomationService.applyMidiRollComplete(workflow).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply MIDI race automation.`, error);
      });
      return true;
    });
  }

  if (hasFighterService) {
    Hooks.on("createItem", (item, options, userId) => {
      moduleApi.fighterAutomationService.handleCreatedItem(item, options, userId).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle fighter starting equipment.`, error);
      });
    });

    const repairFighterActor = (app) => {
      const actor = app?.actor ?? app?.document ?? null;
      moduleApi.fighterAutomationService.repairActor(actor).catch((error) => {
        console.error(`${MODULE_ID} | Failed to repair fighter actor items.`, error);
      });
    };

    for (const hookName of [
      "renderActorSheet",
      "renderActorSheet5eCharacter2",
      "renderActorSheet5eCharacter",
      "renderCharacterActorSheet"
    ]) {
      Hooks.on(hookName, repairFighterActor);
    }

    Hooks.on("combatTurnChange", (combat, previous, current) => {
      void previous;
      moduleApi.fighterAutomationService.handleCombatTurnChange(combat, current ?? {}).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle combat turn-change fighter automation.`, error);
      });
    });

    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
      moduleApi.fighterAutomationService.applyDnd5ePostUseActivity(
        activity,
        usageConfig,
        results
      ).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply fighter activity automation.`, error);
      });
      return true;
    });

    Hooks.on("dnd5e.applyDamage", (actor, amount, options) => {
      moduleApi.fighterAutomationService.applyDnd5eApplyDamage(
        actor,
        amount,
        options
      ).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply fighter healing automation.`, error);
      });
      return true;
    });

    Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
      moduleApi.fighterAutomationService.handleRestCompleted(actor, result, config).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply fighter rest automation.`, error);
      });
    });

    Hooks.on("midi-qol.RollComplete", (workflow) => {
      try {
        return moduleApi.fighterAutomationService.applyMidiRollComplete(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to capture fighter MIDI workflow.`, error);
        return true;
      }
    });
  }

  if (hasPaladinService) {
    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
      moduleApi.paladinAutomationService.applyDnd5ePostUseActivity(
        activity,
        usageConfig,
        results
      ).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply paladin activity automation.`, error);
      });
      return true;
    });

    Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
      moduleApi.paladinAutomationService.handleRestCompleted(actor, result, config).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply paladin rest automation.`, error);
      });
    });
  }
}
