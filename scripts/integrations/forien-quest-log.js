import { MODULE_ID } from "../constants.js";
import { FQL_MODULE_ID, REBREYA_QUEST_FLAGS } from "../data/quest-log-service.js";

const OVERLAY_TEMPLATE = `modules/${MODULE_ID}/templates/forien-quest-overlay.hbs`;
let integrationRegistered = false;
let questDbPatched = false;

function getHtmlElement(html) {
  if (!html) {
    return null;
  }

  const HTMLElementCtor = globalThis.HTMLElement;
  if (HTMLElementCtor && html instanceof HTMLElementCtor) {
    return html;
  }

  if (HTMLElementCtor && html[0] instanceof HTMLElementCtor) {
    return html[0];
  }

  return null;
}

function getQuestFromApp(app) {
  return app?.quest ?? app?.object ?? null;
}

function getFqlJsonFromUpdate(updateData = {}) {
  return updateData?.flags?.[FQL_MODULE_ID]?.json
    ?? updateData?.[`flags.${FQL_MODULE_ID}.json`]
    ?? null;
}

function notifyInfo(message) {
  globalThis.ui?.notifications?.info?.(message);
}

function notifyWarn(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

function notifyError(error, fallback) {
  console.error(`${MODULE_ID} | ${fallback}`, error);
  globalThis.ui?.notifications?.error?.(error?.message || fallback);
}

function getActiveGroupId(moduleApi) {
  return moduleApi?.questLogService?.getCurrentGroupContext?.()?.groupId ?? "";
}

async function patchQuestDbFiltering(moduleApi) {
  if (questDbPatched) {
    return;
  }

  const forienModule = globalThis.game?.modules?.get?.(FQL_MODULE_ID);
  if (!forienModule || forienModule.active === false) {
    return;
  }

  let controlModule;
  try {
    controlModule = await import("../../../forien-quest-log/src/control/index.js");
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Forien Quest Log internals were not available for group filtering.`, error);
    return;
  }

  const QuestDB = controlModule?.QuestDB;
  if (!QuestDB?.sortCollect) {
    return;
  }

  const originalSortCollect = QuestDB.sortCollect.bind(QuestDB);
  QuestDB.sortCollect = function sortCollectRebreyaScoped(options = {}) {
    const result = originalSortCollect(options);
    const groupId = getActiveGroupId(moduleApi);
    if (!groupId) {
      return result;
    }

    return moduleApi.questLogService.filterQuestCollectResult(result, groupId, {
      includeUnassigned: Boolean(globalThis.game?.user?.isGM)
    });
  };

  questDbPatched = true;
}

function registerQuestEntryAutoAssignment(moduleApi) {
  const fqlHooks = globalThis.game?.modules?.get?.(FQL_MODULE_ID)?.public?.QuestAPI?.DB?.hooks;
  const hookName = fqlHooks?.createQuestEntry ?? "createQuestEntry";

  globalThis.Hooks?.on?.(hookName, (questEntry) => {
    const quest = questEntry?.quest;
    const service = moduleApi?.questLogService;
    const groupContext = service?.getCurrentGroupContext?.();
    if (!quest?.id || !groupContext?.groupId) {
      return;
    }

    if (service.getQuestMetadata(quest).groupActorIds.length > 0) {
      return;
    }

    service.assignQuestToGroup(quest, groupContext.groupId).catch((error) => {
      console.warn(`${MODULE_ID} | Failed to auto-assign FQL quest to active group.`, error);
    });
  });
}

function registerQuestRequirementGuard(moduleApi) {
  globalThis.Hooks?.on?.("preUpdateJournalEntry", (entry, updateData = {}) => {
    const fqlData = getFqlJsonFromUpdate(updateData);
    const targetStatus = fqlData?.status;
    if (targetStatus !== "active" && targetStatus !== "available") {
      return true;
    }

    const service = moduleApi?.questLogService;
    const metadata = service?.getQuestMetadata?.(entry);
    if (!service || !metadata || metadata.requirements.length === 0) {
      return true;
    }

    const activeGroupId = service.getCurrentGroupContext()?.groupId ?? "";
    const groupId = metadata.groupActorIds.includes(activeGroupId)
      ? activeGroupId
      : metadata.groupActorIds[0] ?? "";
    if (!groupId) {
      return true;
    }

    if (!service.canQuestEnterStatus(entry.id, targetStatus, groupId)) {
      notifyWarn("Rebreya: требования квеста ещё не открыты.");
      return false;
    }

    return true;
  });
}

function getSelectValue(container, name) {
  return String(container.querySelector(`[name="${name}"]`)?.value ?? "").trim();
}

async function refreshQuestPreview(app, moduleApi) {
  await moduleApi?.refreshOpenApps?.();
  if (typeof app?.render === "function") {
    app.render(true);
  }
}

async function handleOverlayAction(event, app, moduleApi) {
  const button = event.currentTarget;
  const action = button?.dataset?.rmFqlAction ?? "";
  const quest = getQuestFromApp(app);
  const service = moduleApi?.questLogService;
  const container = button.closest(".rm-fql-overlay");
  if (!quest?.id || !service || !container) {
    return;
  }

  try {
    if (action === "assign-current-group") {
      await service.assignQuestToGroup(quest.id);
      notifyInfo("Rebreya: квест добавлен в журнал активной группы.");
    }
    else if (action === "import-subquest") {
      const sourceQuestId = getSelectValue(container, "rm-fql-import-quest-id");
      await service.importQuestIntoParent(sourceQuestId, quest.id);
      notifyInfo("Rebreya: квест импортирован как подзадание.");
    }
    else if (action === "add-requirement") {
      const requiredQuestId = getSelectValue(container, "rm-fql-required-quest-id");
      await service.addRequirement(quest.id, { requiredQuestId });
      notifyInfo("Rebreya: требование добавлено.");
    }
    else if (action === "add-unlock-reward") {
      const [targetQuestId, requirementId] = getSelectValue(container, "rm-fql-unlock-target").split("::");
      await service.addUnlockReward(quest.id, { targetQuestId, requirementId });
      notifyInfo("Rebreya: награда-ключ добавлена.");
    }
    else if (action === "apply-unlock-reward") {
      await service.applyUnlockReward(quest.id, button.dataset.rewardId);
      notifyInfo("Rebreya: требование открыто для активной группы.");
    }

    await refreshQuestPreview(app, moduleApi);
  }
  catch (error) {
    notifyError(error, "Forien Quest Log action failed.");
    await refreshQuestPreview(app, moduleApi);
  }
}

async function injectQuestOverlay(app, html, moduleApi) {
  const quest = getQuestFromApp(app);
  const element = getHtmlElement(html);
  const service = moduleApi?.questLogService;
  if (!quest?.id || !element || !service || typeof globalThis.renderTemplate !== "function") {
    return;
  }

  const target = element.querySelector(".tab.management") ?? element.querySelector(".tab.details");
  if (!target || target.querySelector(".rm-fql-overlay")) {
    return;
  }

  const context = service.getQuestOverlayContext(quest.id);
  const rendered = await globalThis.renderTemplate(OVERLAY_TEMPLATE, context);
  target.insertAdjacentHTML("beforeend", rendered);
  target.querySelectorAll("[data-rm-fql-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      void handleOverlayAction(event, app, moduleApi);
    });
  });
}

function registerQuestPreviewOverlay(moduleApi) {
  globalThis.Hooks?.on?.("renderQuestPreview", (app, html) => {
    injectQuestOverlay(app, html, moduleApi).catch((error) => {
      console.warn(`${MODULE_ID} | Failed to render Forien quest overlay.`, error);
    });
  });
}

export async function registerForienQuestLogIntegration(moduleApi) {
  if (integrationRegistered) {
    return;
  }

  integrationRegistered = true;
  await patchQuestDbFiltering(moduleApi);
  registerQuestEntryAutoAssignment(moduleApi);
  registerQuestRequirementGuard(moduleApi);
  registerQuestPreviewOverlay(moduleApi);

  globalThis.Hooks?.once?.("ForienQuestLog.Lifecycle.ready", () => {
    patchQuestDbFiltering(moduleApi).catch((error) => {
      console.warn(`${MODULE_ID} | Failed to patch Forien Quest Log after lifecycle ready.`, error);
    });
  });
}
