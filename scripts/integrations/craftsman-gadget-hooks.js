import { MODULE_ID } from "../constants.js";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.craftsmanGadgetHooksRegistered`;

function cleanString(value) {
  return String(value ?? "").trim();
}

function combatTurnKey(combat) {
  const id = cleanString(combat?.id ?? combat?._id);
  const round = Number(combat?.round);
  const turn = Number(combat?.turn);
  return id && Number.isFinite(round) && Number.isFinite(turn) ? `${id}:${round}:${turn}` : "";
}

function report(label, error) {
  console.error(`${MODULE_ID} | ${label}`, error);
}

function runAsync(label, operation) {
  Promise.resolve()
    .then(operation)
    .catch((error) => report(label, error));
  return true;
}

export function registerCraftsmanGadgetHooks(moduleApi, options = {}) {
  const Hooks = options.Hooks ?? globalThis.Hooks;
  const game = options.game ?? globalThis.game;
  const gadgetService = moduleApi?.craftsmanGadgetService;
  const zoneService = moduleApi?.craftsmanGadgetZoneService;
  const vehicleService = moduleApi?.craftsmanVehicleService;
  const constructorService = moduleApi?.craftsmanConstructorService;
  if (!Hooks?.on || (!gadgetService && !zoneService && !vehicleService && !constructorService)) return false;
  if (game?.[HOOKS_REGISTERED_KEY]) return true;
  if (game) game[HOOKS_REGISTERED_KEY] = true;

  if (gadgetService || constructorService) {
    Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
      try {
        const gadgetAllowed = gadgetService?.applyDnd5ePreUseActivity?.(
          activity,
          usageConfig,
          dialogConfig,
          messageConfig
        ) ?? true;
        if (gadgetAllowed === false) return false;
        return constructorService?.applyDnd5ePreUseActivity?.(
          activity,
          usageConfig,
          dialogConfig,
          messageConfig
        ) ?? true;
      }
      catch (error) {
        report("Failed to validate Craftsman activity.", error);
        return true;
      }
    });
  }

  if (gadgetService) {
    Hooks.on("dnd5e.preCreateActivityTemplate", (activity, templateData) => {
      try {
        return gadgetService.applyDnd5ePreCreateActivityTemplate?.(activity, templateData) ?? true;
      }
      catch (error) {
        report("Failed to prepare Craftsman smoke template.", error);
        return true;
      }
    });

    Hooks.on("dnd5e.preRollAttack", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return gadgetService.applyDnd5eAttackRollConfig?.(
          rollConfig,
          dialogConfig,
          messageConfig
        ) ?? true;
      }
      catch (error) {
        report("Failed to apply Craftsman gadget attack modifiers.", error);
        return true;
      }
    });

    Hooks.on("dnd5e.rollAttack", (rolls, context) => runAsync(
      "Failed to resolve Craftsman gadget attack roll.",
      () => gadgetService.applyDnd5eRollAttack?.(rolls, context)
    ));

    Hooks.on("dnd5e.preRollDamage", (rollConfig, dialogConfig, messageConfig) => {
      try {
        return gadgetService.applyDnd5ePreRollDamage?.(
          rollConfig,
          dialogConfig,
          messageConfig
        ) ?? true;
      }
      catch (error) {
        report("Failed to apply Craftsman gadget damage modifier.", error);
        return true;
      }
    });

  }

  if (gadgetService || constructorService) {
    Hooks.on("dnd5e.postUseActivity", (activity, usageConfig, results) => runAsync(
      "Failed to apply Craftsman activity.",
      async () => {
        await gadgetService?.applyDnd5ePostUseActivity?.(activity, usageConfig, results);
        await constructorService?.handlePostUseActivity?.(activity, usageConfig, results);
      }
    ));

    Hooks.on("updateWorldTime", (worldTime) => runAsync(
      "Failed to advance Craftsman timed automation.",
      async () => {
        await gadgetService?.handleWorldTime?.(worldTime);
        await constructorService?.handleWorldTime?.(worldTime);
      }
    ));

    for (const hookName of ["createItem", "updateItem", "deleteItem"]) {
      Hooks.on(hookName, (item) => runAsync(
        "Failed to reconcile Craftsman embedded items.",
        async () => {
          if (hookName === "deleteItem") await gadgetService?.handleDeletedItem?.(item);
          await constructorService?.handleOwnerItemChanged?.(item);
        }
      ));
    }
  }

  if (constructorService) {
    Hooks.on("dnd5e.postSummon", (activity, profile, tokens, summonOptions) => runAsync(
      "Failed to configure a summoned Craftsman construct.",
      () => constructorService.handlePostSummon?.(activity, profile, tokens, summonOptions)
    ));
    Hooks.on("updateToken", (token, changed) => runAsync(
      "Failed to reconcile a Craftsman construct token.",
      () => constructorService.handleTokenUpdated?.(token, changed)
    ));
    Hooks.on("updateActor", (actor, changed) => runAsync(
      "Failed to reconcile a Craftsman construct actor.",
      () => constructorService.handleActorUpdated?.(actor, changed)
    ));
    Hooks.on("deleteActor", (actor) => runAsync(
      "Failed to unlink Craftsman constructs from a deleted owner.",
      () => constructorService.handleOwnerDeleted?.(actor)
    ));
    Hooks.on("combatStart", (combat) => runAsync(
      "Failed to restore a repaired Craftsman construct for initiative.",
      () => constructorService.handleCombatStart?.(combat)
    ));
  }

  if (gadgetService || zoneService || vehicleService) {
    Hooks.on("combatTurnChange", (combat) => {
      const key = combatTurnKey(combat);
      if (gadgetService) runAsync(
        "Failed to advance Craftsman gadget turn state.",
        () => gadgetService.handleCombatTurnChange?.(combat)
      );
      if (zoneService) runAsync(
        "Failed to apply Craftsman smoke turn automation.",
        () => zoneService.handleCombatTurn?.(combat)
      );
      if (vehicleService) runAsync(
        "Failed to advance Craftsman vehicle gadget state.",
        () => vehicleService.handleCombatTurnChange?.(key)
      );
      return true;
    });
  }

  if (zoneService || constructorService) {
    Hooks.on("canvasReady", (canvas) => {
      try {
        zoneService?.registerSceneTemplates?.(canvas?.scene ?? globalThis.canvas?.scene);
        constructorService?.reconcileScene?.(canvas?.scene ?? globalThis.canvas?.scene);
      }
      catch (error) {
        report("Failed to reconcile Craftsman scene automation.", error);
      }
    });
  }

  if (zoneService) {
    for (const hookName of ["createMeasuredTemplate", "updateMeasuredTemplate"]) {
      Hooks.on(hookName, (document) => {
        try {
          zoneService.registerTemplate?.(document);
        }
        catch (error) {
          report("Failed to index a Craftsman smoke template document.", error);
        }
      });
    }
    Hooks.on("deleteMeasuredTemplate", (document) => {
      try {
        zoneService.unregisterTemplate?.(document);
      }
      catch (error) {
        report("Failed to unregister a Craftsman smoke template document.", error);
      }
    });
    Hooks.on("deleteScene", () => {
      try {
        zoneService.clearTemplates?.();
      }
      catch (error) {
        report("Failed to clear Craftsman smoke templates for a deleted scene.", error);
      }
    });
  }

  if (vehicleService) {
    Hooks.on("deleteCombat", () => runAsync(
      "Failed to restore a Craftsman vehicle boost after combat deletion.",
      () => vehicleService.handleCombatTurnChange?.("")
    ));
  }

  return true;
}
