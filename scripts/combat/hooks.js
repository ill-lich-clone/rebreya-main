import { MODULE_ID } from "../constants.js";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.combatHooksRegistered`;

export function registerCombatHooks(moduleApi) {
  const hasStatusService = Boolean(moduleApi?.combatStatusService);
  const hasAttackService = Boolean(moduleApi?.combatAttackService);
  const hasRaceService = Boolean(moduleApi?.raceAutomationService);
  const hasFighterService = Boolean(moduleApi?.fighterAutomationService);
  const hasPaladinService = Boolean(moduleApi?.paladinAutomationService);
  const hasRogueService = Boolean(moduleApi?.rogueAutomationService);
  const hasAttackRollBoostService = Boolean(moduleApi?.attackRollBoostService);
  const hasPerformerService = Boolean(moduleApi?.performerAutomationService);
  if (!hasStatusService && !hasAttackService && !hasRaceService && !hasFighterService && !hasPaladinService && !hasRogueService && !hasAttackRollBoostService && !hasPerformerService) {
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

    Hooks.on("preCreateActiveEffect", (effect, _data, options) => {
      try {
        moduleApi.combatStatusService.prepareActiveEffectCreate(effect, options);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to prepare active effect creation for status sync.`, error);
      }
    });

    Hooks.on("preDeleteActiveEffect", (effect, options) => {
      try {
        moduleApi.combatStatusService.prepareActiveEffectDelete(effect, options);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to prepare active effect deletion for status sync.`, error);
      }
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
        if (
          hasPerformerService
          && moduleApi.performerAutomationService.applyDnd5ePreUseActivity(
            activity,
            usageConfig,
            dialogConfig,
            messageConfig
          ) === false
        ) {
          return false;
        }

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
        const result = moduleApi.combatAttackService.applyDnd5ePostAttackRoll(
          rolls,
          context
        );
        if (hasAttackRollBoostService) {
          moduleApi.attackRollBoostService.applyDnd5eRollAttack(rolls, context).catch((error) => {
            console.error(`${MODULE_ID} | Failed to apply dnd5e attack roll boost automation.`, error);
          });
        }
        if (hasPerformerService) {
          moduleApi.performerAutomationService.applyDnd5eD20Roll(rolls, context, "attack").catch((error) => {
            console.error(`${MODULE_ID} | Failed to consume performer d20 effect after attack roll.`, error);
          });
        }
        return result;
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to capture post-attack roll automation.`, error);
        return true;
      }
    });

    Hooks.on("midi-qol.hitsChecked", async (workflow) => {
      try {
        if (hasAttackRollBoostService) {
          await moduleApi.attackRollBoostService.applyMidiHitsChecked(workflow);
        }
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

  if (!hasAttackService && hasPerformerService) {
    Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.performerAutomationService.applyDnd5ePreUseActivity(
          activity,
          usageConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply performer pre-use automation.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.rollAttack", (rolls, context) => {
      moduleApi.performerAutomationService.applyDnd5eD20Roll(rolls, context, "attack").catch((error) => {
        console.error(`${MODULE_ID} | Failed to consume performer d20 effect after attack roll.`, error);
      });
      return true;
    });
  }

  if (!hasAttackService && hasAttackRollBoostService) {
    Hooks.on("midi-qol.hitsChecked", async (workflow) => {
      try {
        return await moduleApi.attackRollBoostService.applyMidiHitsChecked(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply attack roll boost automation.`, error);
        return true;
      }
    });
  }

  if (hasPerformerService) {
    Hooks.on("dnd5e.preRollD20Test", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.performerAutomationService.applyDnd5ePreRollD20Test(
          rollConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply performer d20 modifier before roll.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
      moduleApi.performerAutomationService.applyDnd5ePostUseActivity(
        activity,
        usageConfig,
        results
      ).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply performer activity automation.`, error);
      });
      return true;
    });

    Hooks.on("dnd5e.rollSkill", (rolls, context) => {
      moduleApi.performerAutomationService.applyDnd5eD20Roll(rolls, context, "skill").catch((error) => {
        console.error(`${MODULE_ID} | Failed to consume performer d20 effect after skill roll.`, error);
      });
    });

    Hooks.on("dnd5e.rollToolCheck", (rolls, context) => {
      moduleApi.performerAutomationService.applyDnd5eD20Roll(rolls, context, "tool").catch((error) => {
        console.error(`${MODULE_ID} | Failed to consume performer d20 effect after tool roll.`, error);
      });
    });

    Hooks.on("dnd5e.rollAbilityCheck", (rolls, context) => {
      moduleApi.performerAutomationService.applyDnd5eD20Roll(rolls, context, "ability").catch((error) => {
        console.error(`${MODULE_ID} | Failed to consume performer d20 effect after ability roll.`, error);
      });
    });

    Hooks.on("dnd5e.rollSavingThrow", (rolls, context) => {
      moduleApi.performerAutomationService.applyDnd5eD20Roll(rolls, context, "save").catch((error) => {
        console.error(`${MODULE_ID} | Failed to consume performer d20 effect after saving throw.`, error);
      });
    });

    Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
      moduleApi.performerAutomationService.handleRestCompleted(actor, result, config).catch((error) => {
        console.error(`${MODULE_ID} | Failed to clear performer rest automation.`, error);
      });
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
    Hooks.on("createItem", (item, options, userId) => {
      moduleApi.paladinAutomationService.handleCreatedItem(item, options, userId).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle paladin initial spell preparation.`, error);
      });
    });

    Hooks.on("updateItem", (item, changed, options, userId) => {
      moduleApi.paladinAutomationService.handleUpdatedItem(item, changed, options, userId).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle paladin level item update.`, error);
      });
    });

    Hooks.on("updateActor", (actor, changed, options, userId) => {
      moduleApi.paladinAutomationService.handleActorUpdated(actor, changed, options, userId).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle paladin actor level update.`, error);
      });
    });

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

    Hooks.on("midi-qol.preDamageRoll", async (workflow, activity, config, dialog, message) => {
      try {
        return await moduleApi.paladinAutomationService.applyMidiPreDamageRoll(workflow, activity, config, dialog, message);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply paladin MIDI pre-damage automation.`, error);
        return true;
      }
    });
  }

  if (hasRogueService) {
    Hooks.on("midi-qol.preDamageRoll", async (workflow, activity, config, dialog, message) => {
      try {
        return await moduleApi.rogueAutomationService.applyMidiPreDamageRoll(workflow, activity, config, dialog, message);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply rogue MIDI pre-damage automation.`, error);
        return true;
      }
    });
  }
}
