const REBREYA_QUEST_LOG_MODULE_ID = "rebreya-quest-log";

export async function openRebreyaQuestLog({
  game = globalThis.game,
  hooks = globalThis.Hooks,
  options = {}
} = {}) {
  const moduleRecord = game?.modules?.get?.(REBREYA_QUEST_LOG_MODULE_ID);
  if (moduleRecord?.active !== true) {
    throw new Error("Модуль rebreya-quest-log не активен или не предоставил API журнала заданий.");
  }
  if (typeof moduleRecord?.api?.openQuestLog === "function") {
    return moduleRecord.api.openQuestLog(options);
  }
  if (typeof hooks?.call === "function") {
    return hooks.call("ForienQuestLog.Open.QuestLog", options);
  }
  throw new Error("Модуль rebreya-quest-log не активен или не предоставил API журнала заданий.");
}
