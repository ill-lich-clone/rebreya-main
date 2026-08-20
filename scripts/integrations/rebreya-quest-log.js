const REBREYA_QUEST_LOG_MODULE_ID = "rebreya-quest-log";

export async function openRebreyaQuestLog({ game = globalThis.game, options = {} } = {}) {
  const moduleRecord = game?.modules?.get?.(REBREYA_QUEST_LOG_MODULE_ID);
  if (moduleRecord?.active !== true || typeof moduleRecord?.api?.openQuestLog !== "function") {
    throw new Error("Модуль rebreya-quest-log не активен или не предоставил API журнала заданий.");
  }
  return moduleRecord.api.openQuestLog(options);
}
