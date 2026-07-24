import { MODULE_ID } from "../constants.js";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.combatHooksRegistered`;
const CHARACTER_SHEET_RENDER_HOOKS = Object.freeze([
  "renderActorSheet",
  "renderActorSheet5eCharacter2",
  "renderActorSheet5eCharacter",
  "renderCharacterActorSheet"
]);

export function registerCombatHooks(moduleApi) {
  const hasStatusService = Boolean(moduleApi?.combatStatusService);
  const hasAttackService = Boolean(moduleApi?.combatAttackService);
  const hasRaceService = Boolean(moduleApi?.raceAutomationService);
  const hasFighterService = Boolean(moduleApi?.fighterAutomationService);
  const hasSorcererService = Boolean(moduleApi?.sorcererAutomationService);
  const hasElementalAdeptService = Boolean(moduleApi?.elementalAdeptAutomationService);
  const hasPaladinService = Boolean(moduleApi?.paladinAutomationService);
  const hasRogueService = Boolean(moduleApi?.rogueAutomationService);
  const hasAttackRollBoostService = Boolean(moduleApi?.attackRollBoostService);
  const hasPerformerService = Boolean(moduleApi?.performerAutomationService);
  const hasBardicInspirationCompatService = Boolean(moduleApi?.bardicInspirationCompatService);
  const hasEnvironmentService = Boolean(moduleApi?.environmentAutomationService);
  const hasSpellService = Boolean(moduleApi?.spellAutomationService);
  const hasReactionCapabilityIndex = Boolean(moduleApi?.reactionCapabilityIndex);
  const hasRuneKnightService = Boolean(moduleApi?.runeKnightAutomationService);
  const hasSizeService = Boolean(moduleApi?.sizeAutomationService);
  if (!hasStatusService && !hasAttackService && !hasRaceService && !hasFighterService && !hasSorcererService && !hasElementalAdeptService && !hasPaladinService && !hasRogueService && !hasAttackRollBoostService && !hasPerformerService && !hasBardicInspirationCompatService && !hasEnvironmentService && !hasSpellService && !hasReactionCapabilityIndex && !hasRuneKnightService && !hasSizeService) {
    return;
  }

  if (game[HOOKS_REGISTERED_KEY]) {
    return;
  }
  game[HOOKS_REGISTERED_KEY] = true;

  if (hasSizeService) {
    const handleSizeError = (error) => {
      console.error(`${MODULE_ID} | Failed to synchronize character size modifiers.`, error);
    };
    Hooks.on("updateActor", (actor, changed, options) => {
      moduleApi.sizeAutomationService.handleActorUpdated(actor, changed, options).catch(handleSizeError);
    });
    Hooks.on("createActiveEffect", (effect, options) => {
      moduleApi.sizeAutomationService.handleActiveEffectChanged(effect, options).catch(handleSizeError);
    });
    Hooks.on("updateActiveEffect", (effect, _changed, options) => {
      moduleApi.sizeAutomationService.handleActiveEffectChanged(effect, options).catch(handleSizeError);
    });
    Hooks.on("deleteActiveEffect", (effect, options) => {
      moduleApi.sizeAutomationService.handleActiveEffectChanged(effect, options).catch(handleSizeError);
    });
    for (const hookName of CHARACTER_SHEET_RENDER_HOOKS) {
      Hooks.on(hookName, (app) => {
        moduleApi.sizeAutomationService.syncActor(app?.actor ?? app?.document).catch(handleSizeError);
      });
    }
  }

  if (hasReactionCapabilityIndex) {
    const index = moduleApi.reactionCapabilityIndex;
    const parentActor = (document) => document?.actor ?? document?.parent ?? null;
    const refreshParentActor = (document) => {
      const actor = parentActor(document);
      if (actor) {
        index.refreshActor(actor);
      }
    };

    Hooks.on("canvasReady", (scene) => index.rebuildScene(scene ?? globalThis.canvas?.scene));
    Hooks.on("createActor", (actor) => index.refreshActor(actor));
    Hooks.on("updateActor", (actor) => index.refreshActor(actor));
    Hooks.on("deleteActor", (actor) => index.removeActor(actor));
    for (const hookName of ["createItem", "updateItem", "deleteItem"]) {
      Hooks.on(hookName, refreshParentActor);
    }
    for (const hookName of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      Hooks.on(hookName, refreshParentActor);
    }
    Hooks.on("createToken", (tokenDocument) => index.refreshToken(tokenDocument));
    Hooks.on("updateToken", (tokenDocument) => index.refreshToken(tokenDocument));
    Hooks.on("deleteToken", (tokenDocument) => index.removeToken(
      tokenDocument?.uuid ?? tokenDocument?.document?.uuid ?? tokenDocument?.id
    ));
    Hooks.on("updateUser", () => index.rebuildScene(globalThis.canvas?.scene));
    Hooks.on("deleteCombat", (combat) => index.invalidateScene(
      combat?.scene?.id ?? combat?.scene?._id ?? combat?.scene ?? globalThis.canvas?.scene?.id
    ));
  }

  if (hasRuneKnightService) {
    const handleRuneKnightItem = (item) => {
      moduleApi.runeKnightAutomationService.handleEmbeddedItemChange(item).catch((error) => {
        console.error(`${MODULE_ID} | Failed to synchronize Rune Knight item resources.`, error);
      });
    };
    const handleRuneKnightEffect = (effect) => {
      moduleApi.runeKnightAutomationService.handleEmbeddedEffectChange(effect).catch((error) => {
        console.error(`${MODULE_ID} | Failed to synchronize Rune Knight source effects.`, error);
      });
    };
    for (const hookName of ["createItem", "updateItem", "deleteItem"]) {
      Hooks.on(hookName, handleRuneKnightItem);
    }
    for (const hookName of ["createActiveEffect", "updateActiveEffect"]) {
      Hooks.on(hookName, handleRuneKnightEffect);
    }
    Hooks.on("deleteActiveEffect", (effect) => {
      moduleApi.runeKnightAutomationService.handleEmbeddedEffectDeletion(effect).catch((error) => {
        console.error(`${MODULE_ID} | Failed to restore Rune Knight form state.`, error);
      });
    });
    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
      moduleApi.runeKnightAutomationService.applyDnd5ePostUseActivity(activity, usageConfig, results).catch((error) => {
        console.error(`${MODULE_ID} | Failed to apply Rune Knight activity automation.`, error);
      });
      return true;
    });
    Hooks.on("dnd5e.preRollTool", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.runeKnightAutomationService.applyDnd5ePreRollToolCheck(rollConfig, dialogConfig, messageConfig);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply Fire Rune tool expertise.`, error);
        return true;
      }
    });
    Hooks.on("dnd5e.preRollAttack", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.runeKnightAutomationService.applyDnd5eStormRollMode(
          rollConfig,
          dialogConfig,
          messageConfig,
          "attack"
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply the resolved Storm Rune attack mode.`, error);
        return true;
      }
    });
    Hooks.on("dnd5e.preRollD20Test", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.runeKnightAutomationService.applyDnd5eStormRollMode(
          rollConfig,
          dialogConfig,
          messageConfig,
          "check"
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply the resolved Storm Rune check mode.`, error);
        return true;
      }
    });
    Hooks.on("dnd5e.preRollDamage", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.runeKnightAutomationService.applyDnd5eGiantMightDamage(
          rollConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply Giant's Might native damage.`, error);
        return true;
      }
    });
    Hooks.on("dnd5e.preRollSavingThrow", (rollConfig, dialogConfig, messageConfig) => {
      try {
        moduleApi.runeKnightAutomationService.applyDnd5ePreRollSavingThrow(rollConfig, dialogConfig, messageConfig);
        return moduleApi.runeKnightAutomationService.applyDnd5eStormRollMode(
          rollConfig,
          dialogConfig,
          messageConfig,
          "save"
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply Rune Knight saving-throw modifiers.`, error);
        return true;
      }
    });
    Hooks.on("preCreateActiveEffect", (effect, data, options) => {
      try {
        return moduleApi.runeKnightAutomationService.prepareActiveEffectCreate(effect, data, options);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply Storm Rune surprise immunity.`, error);
        return true;
      }
    });
    Hooks.on("midi-qol.preAttackRoll", async (workflow) => {
      try {
        await moduleApi.runeKnightAutomationService.applyMidiStormPreRoll(workflow, "attack");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to resolve Storm Rune before an attack roll.`, error);
      }
      return true;
    });
    Hooks.on("midi-qol.preTargetSave", async (target, workflow, saveDetails) => {
      try {
        await moduleApi.runeKnightAutomationService.applyMidiStormPreRoll(saveDetails, "save", {
          actor: target?.actor ?? target?.document?.actor,
          token: target,
          workflow
        });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to resolve Storm Rune before a saving throw.`, error);
      }
      return true;
    });
    Hooks.on("midi-qol.hitsChecked", async (workflow) => {
      try {
        return await moduleApi.runeKnightAutomationService.applyMidiHitsChecked(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to prepare Rune Knight hit automation.`, error);
        return true;
      }
    });
    Hooks.on("midi-qol.preDamageRollComplete", async (workflow) => {
      try {
        return await moduleApi.runeKnightAutomationService.applyMidiPreDamageRollComplete(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply Rune Knight bonus damage.`, error);
        return true;
      }
    });
    Hooks.on("midi-qol.RollComplete", async (workflow) => {
      try {
        return await moduleApi.runeKnightAutomationService.applyMidiRollComplete(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to clear Rune Knight workflow state.`, error);
        return true;
      }
    });
  }

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

  if (hasEnvironmentService) {
    const applyCurrentEnvironment = async () => {
      try {
        await moduleApi.environmentAutomationService.updateCurrentTargetEnvironment();
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update Rebreya environment statuses.`, error);
      }
      return true;
    };

    Hooks.on("targetToken", applyCurrentEnvironment);
    Hooks.on("controlToken", applyCurrentEnvironment);
  }

  const advanceSorcererCooldowns = (combat, updateData, updateOptions) => {
    moduleApi.sorcererAutomationService.handleCombatTurnChange(
      combat,
      updateData,
      updateOptions
    ).catch((error) => {
      console.error(`${MODULE_ID} | Failed to update Sorcerer virtual-slot cooldowns.`, error);
    });
  };

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

    if (hasRuneKnightService) {
      moduleApi.runeKnightAutomationService.handleCombatTurnChange(combat, updateData, updateOptions).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle Rune Knight turn-end automation.`, error);
      });
    }

    if (hasSorcererService) {
      advanceSorcererCooldowns(combat, updateData, updateOptions);
    }

    if (hasPaladinService) {
      moduleApi.paladinAutomationService.handleCombatTurnChange(combat, updateData, updateOptions).catch((error) => {
        console.error(`${MODULE_ID} | Failed to handle paladin turn automation.`, error);
      });
    }
  });

  if (hasSorcererService) {
    Hooks.on("combatRound", advanceSorcererCooldowns);
  }

  if (hasAttackService) {
    const repairFirearmActor = (app) => {
      const actor = app?.actor ?? app?.document ?? null;
      moduleApi.combatAttackService.repairFirearmActivities(actor).catch((error) => {
        console.error(`${MODULE_ID} | Failed to repair firearm activities.`, error);
      });
    };
    const repairFirearmItem = (app) => {
      const item = app?.document ?? app?.item ?? null;
      moduleApi.combatAttackService.repairFirearmActivities(item).catch((error) => {
        console.error(`${MODULE_ID} | Failed to repair firearm item activities.`, error);
      });
    };

    for (const hookName of [
      "renderActorSheet",
      "renderActorSheet5eCharacter2",
      "renderActorSheet5eCharacter",
      "renderCharacterActorSheet"
    ]) {
      Hooks.on(hookName, repairFirearmActor);
    }
    for (const hookName of [
      "renderItemSheet",
      "renderItemSheet5e"
    ]) {
      Hooks.on(hookName, repairFirearmItem);
    }

    Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
      try {
        const continuePreUse = () => {
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

          if (
            hasSorcererService
            && moduleApi.sorcererAutomationService.deferDnd5ePreUseActivity(
              activity,
              usageConfig,
              dialogConfig,
              messageConfig
            ) === false
          ) {
            return false;
          }

          if (
            hasSpellService
            && moduleApi.spellAutomationService.deferDnd5ePreUseActivity(
              activity,
              usageConfig,
              dialogConfig,
              messageConfig
            ) === false
          ) {
            return false;
          }

          if (
            hasSorcererService
            && moduleApi.sorcererAutomationService.finalizeDnd5ePreUseActivity(
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
        };

        return continuePreUse();
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply pre-use activity automation.`, error);
        return true;
      }
    });

    Hooks.on("dnd5e.preRollAttack", (rollConfig, dialogConfig, messageConfig) => {
      try {
        if (hasEnvironmentService) {
          moduleApi.environmentAutomationService.applyDnd5eAttackRollConfig(
            rollConfig,
            dialogConfig,
            messageConfig
          ).catch((error) => {
            console.error(`${MODULE_ID} | Failed to update Rebreya environment before attack roll.`, error);
          });
        }

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
        const result = moduleApi.combatAttackService.applyDnd5eDamageRollConfig(
          rollConfig,
          dialogConfig,
          messageConfig
        );
        if (hasSorcererService) {
          moduleApi.sorcererAutomationService.applyDnd5ePreRollDamage(
            rollConfig,
            dialogConfig,
            messageConfig
          );
        }
        return result;
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
        if (hasSorcererService) {
          moduleApi.sorcererAutomationService.applyDnd5ePostAttackRoll(rolls, context).catch((error) => {
            console.error(`${MODULE_ID} | Failed to apply Sorcerer seeking spell automation.`, error);
          });
        }
        if (hasEnvironmentService) {
          moduleApi.environmentAutomationService.applyDnd5eAttackRollConfig(context).catch((error) => {
            console.error(`${MODULE_ID} | Failed to update Rebreya environment after attack roll.`, error);
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

  if (!hasAttackService && hasEnvironmentService) {
    Hooks.on("dnd5e.preRollAttack", async (rollConfig, dialogConfig, messageConfig) => {
      try {
        await moduleApi.environmentAutomationService.applyDnd5eAttackRollConfig(
          rollConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update Rebreya environment before attack roll.`, error);
      }
      return true;
    });
  }

  if (hasSorcererService) {
    for (const hookName of ["renderApplicationV2", "renderDialogV2"]) {
      Hooks.on(hookName, (...args) => {
        try {
          moduleApi.sorcererAutomationService.bindSorcererCastDialogControls?.(...args);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to bind Sorcerer cast dialog controls.`, error);
        }
      });
    }

    Hooks.on("dnd5e.preRollSavingThrow", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.sorcererAutomationService.applyDnd5ePreRollSavingThrow(
          rollConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply Sorcerer save-roll automation.`, error);
        return true;
      }
    });

    if (!hasAttackService) {
      Hooks.on("dnd5e.rollAttack", (rolls, context) => {
        moduleApi.sorcererAutomationService.applyDnd5ePostAttackRoll(rolls, context).catch((error) => {
          console.error(`${MODULE_ID} | Failed to apply Sorcerer seeking spell automation.`, error);
        });
        return true;
      });
    }

    if (!hasAttackService) {
      Hooks.on("dnd5e.preRollDamage", (rollConfig, dialogConfig, messageConfig) => {
        try {
          return moduleApi.sorcererAutomationService.applyDnd5ePreRollDamage(
            rollConfig,
            dialogConfig,
            messageConfig
          );
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to apply Sorcerer pre-damage automation.`, error);
          return true;
        }
      });
    }

    Hooks.on("dnd5e.postCreateUsageMessage", (activity, message) => {
      try {
        return moduleApi.sorcererAutomationService.handleDnd5ePostCreateUsageMessage(activity, message);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to capture Sorcerer save overrides.`, error);
        return true;
      }
    });
  }

  if (hasSorcererService || hasElementalAdeptService) {
    Hooks.on("dnd5e.rollDamage", (rolls, context) => {
      let completion = Promise.resolve();
      if (hasSorcererService) {
        completion = completion.then(() => moduleApi.sorcererAutomationService.applyDnd5ePostDamageRoll(rolls, context))
          .catch((error) => {
            console.error(`${MODULE_ID} | Failed to apply Sorcerer empowered spell automation.`, error);
          });
      }
      if (hasElementalAdeptService) {
        completion = completion.then(() => moduleApi.elementalAdeptAutomationService.applyDnd5ePostDamageRoll(rolls, context))
          .catch((error) => {
            console.error(`${MODULE_ID} | Failed to apply Elemental Adept post-damage automation.`, error);
          });
      }
      return completion.then(() => true);
    });
  }

  if (!hasAttackService && (hasSorcererService || hasSpellService)) {
    Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
      try {
        if (
          hasSorcererService
          && moduleApi.sorcererAutomationService.deferDnd5ePreUseActivity(
            activity,
            usageConfig,
            dialogConfig,
            messageConfig
          ) === false
        ) {
          return false;
        }

        if (
          hasSpellService
          && moduleApi.spellAutomationService.deferDnd5ePreUseActivity(
            activity,
            usageConfig,
            dialogConfig,
            messageConfig
          ) === false
        ) {
          return false;
        }

        if (
          hasSorcererService
          && moduleApi.sorcererAutomationService.finalizeDnd5ePreUseActivity(
            activity,
            usageConfig,
            dialogConfig,
            messageConfig
          ) === false
        ) {
          return false;
        }

        return true;
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply spell reaction automation.`, error);
        return true;
      }
    });
  }

  if (hasSpellService) {
    Hooks.on("midi-qol.preItemRoll", async (workflow) => {
      try {
        return await moduleApi.spellAutomationService.applyMidiWorkflow(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply MIDI spell reaction automation.`, error);
        return true;
      }
    });
  }

  if (hasEnvironmentService) {
    Hooks.on("midi-qol.preAttackRoll", async (workflow) => {
      try {
        await moduleApi.environmentAutomationService.applyMidiPreAttackRoll(workflow);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to update Rebreya environment before MIDI attack roll.`, error);
      }
      return true;
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

  }

  if (hasBardicInspirationCompatService) {
    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => {
      moduleApi.bardicInspirationCompatService.applyDnd5ePostUseActivity(
        activity,
        usageConfig,
        results
      ).catch((error) => {
        console.error(`${MODULE_ID} | Failed to synchronize bardic inspiration compatibility.`, error);
      });
      return true;
    });
  }

  if (hasRaceService) {
    const handleRaceConfigurationError = (error) => {
      console.error(`${MODULE_ID} | Failed to configure an owned race item.`, error);
    };
    Hooks.on("createItem", (item, options, userId) => {
      moduleApi.raceAutomationService.handleCreatedItem(item, options, userId).catch(handleRaceConfigurationError);
    });
    for (const hookName of CHARACTER_SHEET_RENDER_HOOKS) {
      Hooks.on(hookName, (app) => {
        const actor = app?.actor ?? app?.document ?? null;
        moduleApi.raceAutomationService.repairActor(actor).catch(handleRaceConfigurationError);
      });
    }

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

  if (hasSorcererService) {
    const repairSorcererActor = (app) => {
      const actor = app?.actor ?? app?.document ?? null;
      moduleApi.sorcererAutomationService.repairActor(actor).catch((error) => {
        console.error(`${MODULE_ID} | Failed to repair Sorcerer actor items.`, error);
      });
    };

    for (const hookName of [
      "renderActorSheet",
      "renderActorSheet5eCharacter2",
      "renderActorSheet5eCharacter",
      "renderCharacterActorSheet"
    ]) {
      Hooks.on(hookName, repairSorcererActor);
    }

    Hooks.on("createItem", (item, options, userId) => {
      moduleApi.sorcererAutomationService.handleCreatedItem(item, options, userId).catch((error) => {
        console.error(`${MODULE_ID} | Failed to process Sorcerer item creation.`, error);
      });
    });

    Hooks.on("updateItem", (item, changed, options, userId) => {
      moduleApi.sorcererAutomationService.handleUpdatedItem(item, changed, options, userId).catch((error) => {
        console.error(`${MODULE_ID} | Failed to synchronize Sorcery Points after class update.`, error);
      });
    });

  }

  if (hasElementalAdeptService) {
    const repairElementalAdeptActor = (app) => {
      const actor = app?.actor ?? app?.document ?? null;
      moduleApi.elementalAdeptAutomationService.repairActor(actor).catch((error) => {
        console.error(`${MODULE_ID} | Failed to repair Elemental Adept items.`, error);
      });
    };

    for (const hookName of [
      "renderActorSheet",
      "renderActorSheet5eCharacter2",
      "renderActorSheet5eCharacter",
      "renderCharacterActorSheet"
    ]) {
      Hooks.on(hookName, repairElementalAdeptActor);
    }

    Hooks.on("createItem", (item, options, userId) => {
      moduleApi.elementalAdeptAutomationService.handleCreatedItem(item, options, userId).catch((error) => {
        console.error(`${MODULE_ID} | Failed to process Elemental Adept item creation.`, error);
      });
    });

    Hooks.on("updateItem", (item, changed, options, userId) => {
      moduleApi.elementalAdeptAutomationService.handleUpdatedItem(item, changed, options, userId).catch((error) => {
        console.error(`${MODULE_ID} | Failed to process Elemental Adept item update.`, error);
      });
    });

    Hooks.on("midi-qol.dnd5ePreCalculateDamage", (actor, damages, options) => {
      try {
        moduleApi.elementalAdeptAutomationService.applyMidiPreCalculateDamage(actor, damages, options);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply Elemental Adept Midi-QOL damage bypass.`, error);
      }
      return true;
    });

    Hooks.on("dnd5e.preCalculateDamage", (actor, damages, options) => {
      try {
        moduleApi.elementalAdeptAutomationService.applyDnd5ePreCalculateDamage(actor, damages, options);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply Elemental Adept native damage bypass.`, error);
      }
      return true;
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

    Hooks.on("dnd5e.preRollD20Test", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return moduleApi.paladinAutomationService.applyDnd5ePreRollD20Test(
          rollConfig,
          dialogConfig,
          messageConfig
        );
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to apply paladin d20 automation.`, error);
        return true;
      }
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
