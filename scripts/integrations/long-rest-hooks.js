import { MODULE_ID } from "../constants.js";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.longRestHooksRegistered`;

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizedRestValue(value) {
  return cleanString(value).toLocaleLowerCase("ru-RU");
}

export function restKind(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) {
    return "long";
  }
  if (result?.shortRest === true || config?.shortRest === true) {
    return "short";
  }

  for (const value of [
    result?.type,
    result?.restType,
    result?.period,
    config?.type,
    config?.restType,
    config?.period
  ]) {
    const normalized = normalizedRestValue(value);
    if (
      normalized === "long"
      || normalized === "lr"
      || normalized.includes("продолж")
    ) {
      return "long";
    }
    if (
      normalized === "short"
      || normalized === "sr"
      || normalized.includes("корот")
    ) {
      return "short";
    }
  }
  return "";
}

export function registerLongRestHooks(moduleApi, options = {}) {
  const Hooks = options.Hooks ?? globalThis.Hooks;
  const game = options.game ?? globalThis.game;
  const logger = options.logger ?? console;
  const pipeline = moduleApi?.longRestPipelineService;
  if (!Hooks?.on || !pipeline) {
    return false;
  }
  if (game?.[HOOKS_REGISTERED_KEY]) {
    return true;
  }
  if (game) {
    game[HOOKS_REGISTERED_KEY] = true;
  }

  const fieldCraft = (actor) => actor && (moduleApi.alchemyCraftingService?.fieldSnapshot?.(actor)
    ?? actor.flags?.[MODULE_ID]?.alchemyCraftField);
  Hooks.on("dnd5e.preRestCompleted", (actor, result, config) => {
    if (config && restKind(result, config) === "short" && fieldCraft(actor)?.status === "prepared") {
      config.chat = true;
    }
  });
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
    const kind = restKind(result, config);
    let operation;
    if (kind === "long") {
      operation = pipeline.enqueue(actor, result, config);
    }
    else if (kind === "short") {
      operation = moduleApi?.runeKnightAutomationService?.handleRestCompleted?.(
        actor,
        result,
        config
      );
      const craft = fieldCraft(actor);
      if (craft?.status === "prepared" && result.message?.uuid) {
        void Promise.resolve(moduleApi.mutateAlchemyCraft?.("completeField", {
          groupId: craft.groupId, actorId: actor.id, operationId: craft.operationId, restMessageUuid: result.message.uuid
        })).then((outcome) => {
          if (!outcome) return;
          const message = outcome.outcome === "field-success" ? "Полевое зелье готово." : "Проверка полевой алхимии провалена.";
          globalThis.ui?.notifications?.info?.(message);
        }).catch((error) => {
          logger?.error?.(`${MODULE_ID} | Field alchemy failed.`, error);
          globalThis.ui?.notifications?.warn?.(error.message);
        });
      }
    }
    if (operation) {
      Promise.resolve(operation).catch((error) => {
        logger?.error?.(
          `${MODULE_ID} | Failed to process ${kind} rest pipeline.`,
          error
        );
      });
    }
    return true;
  });

  Hooks.once?.("closeWorld", () => {
    pipeline.shutdown?.("world-closed");
  });
  return true;
}
