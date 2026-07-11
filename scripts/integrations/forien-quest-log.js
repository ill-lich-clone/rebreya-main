import { MODULE_ID } from "../constants.js";
import { FQL_MODULE_ID, REBREYA_QUEST_FLAGS } from "../data/quest-log-service.js";

const OVERLAY_TEMPLATE = `modules/${MODULE_ID}/templates/forien-quest-overlay.hbs`;
const ACTIVITIES_TEMPLATE = `modules/${MODULE_ID}/templates/forien-quest-log-activities.hbs`;
const RUMOR_EDITOR_TEMPLATE = `modules/${MODULE_ID}/templates/forien-quest-rumor-editor.hbs`;
const EVENT_EDITOR_TEMPLATE = `modules/${MODULE_ID}/templates/forien-quest-event-editor.hbs`;
let integrationRegistered = false;
let questDbPatched = false;
let RebreyaRumorEditor = null;
let RebreyaQuestEventEditor = null;
const activityEditors = new Map();

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

function getInputValue(container, name) {
  return String(container.querySelector(`[name="${name}"]`)?.value ?? "").trim();
}

function getPositiveIntegerValue(container, name) {
  const value = Number(getInputValue(container, name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeCss(value) {
  return globalThis.CSS?.escape?.(String(value ?? ""))
    ?? String(value ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function promptText({ title, label, value = "" } = {}) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2 ?? null;
  if (typeof DialogV2?.wait === "function") {
    return DialogV2.wait({
      window: { title },
      content: `<label>${escapeHtml(label)} <input type="text" name="value" value="${escapeHtml(value)}"></label>`,
      buttons: [
        {
          action: "confirm",
          label: "Сохранить",
          default: true,
          callback: (_event, button) => getInputValue(button.form, "value")
        },
        {
          action: "cancel",
          label: "Отмена"
        }
      ]
    });
  }

  return globalThis.window?.prompt?.(label, value) ?? "";
}

function renderQuestActivityField(field) {
  const tag = field.type === "textarea"
    ? `<textarea name="${escapeHtml(field.name)}" rows="${Number(field.rows) || 4}">${escapeHtml(field.value ?? "")}</textarea>`
    : `<input type="text" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value ?? "")}">`;

  return `
    <label class="rm-fql-activity-dialog__field">
      <span>${escapeHtml(field.label)}</span>
      ${tag}
    </label>
  `;
}

function readQuestActivityForm(form, fields = []) {
  const result = {};
  for (const field of fields) {
    result[field.name] = getInputValue(form, field.name);
  }
  return result;
}

async function promptQuestActivityForm({ title, fields = [], submitLabel = "Сохранить" } = {}) {
  const normalizedFields = fields.filter((field) => field?.name);
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2 ?? null;

  if (typeof DialogV2?.wait === "function") {
    const content = `<div class="rm-fql-activity-dialog">${normalizedFields.map(renderQuestActivityField).join("")}</div>`;
    const result = await DialogV2.wait({
      window: { title },
      content,
      buttons: [
        {
          action: "confirm",
          label: submitLabel,
          default: true,
          callback: (_event, button) => readQuestActivityForm(button.form, normalizedFields)
        },
        {
          action: "cancel",
          label: "Отмена",
          callback: () => null
        }
      ]
    });

    return result && typeof result === "object" ? result : null;
  }

  const prompt = globalThis.window?.prompt;
  if (typeof prompt !== "function") {
    return null;
  }

  const result = {};
  for (const field of normalizedFields) {
    const value = prompt(field.label, field.value ?? "");
    if (value == null) {
      return null;
    }

    result[field.name] = String(value).trim();
  }
  return result;
}

function getQuestActivities(service, groupActorId = "") {
  return service?.getQuestActivitiesContext?.(groupActorId)?.activities ?? { rumors: [], events: [] };
}

function getRumorTopic(service, rumorId, groupActorId = "") {
  const id = String(rumorId ?? "");
  return getQuestActivities(service, groupActorId).rumors.find((rumor) => rumor.id === id) ?? null;
}

function getRumorEntry(service, rumorId, entryId, groupActorId = "") {
  const entry = String(entryId ?? "");
  return getRumorTopic(service, rumorId, groupActorId)?.entries.find((item) => item.id === entry) ?? null;
}

function getQuestEvent(service, eventId, groupActorId = "") {
  const id = String(eventId ?? "");
  return getQuestActivities(service, groupActorId).events.find((event) => event.id === id) ?? null;
}

function hasRequiredText(data, fieldName, label) {
  if (String(data?.[fieldName] ?? "").trim()) {
    return true;
  }

  notifyWarn(`Rebreya: ${label} не заполнено.`);
  return false;
}

function getLegacyApplicationBase() {
  return globalThis.foundry?.appv1?.api?.Application ?? globalThis.Application ?? null;
}

function mergeApplicationOptions(baseOptions, options) {
  return globalThis.foundry?.utils?.mergeObject?.(baseOptions, options) ?? {
    ...baseOptions,
    ...options,
    classes: [...(baseOptions.classes ?? []), ...(options.classes ?? [])],
    tabs: options.tabs ?? baseOptions.tabs
  };
}

function getEditorKey(kind, groupActorId, activityId) {
  return `${kind}:${groupActorId}:${activityId}`;
}

async function refreshActivityEditorParent(app, moduleApi, tabId) {
  await refreshQuestLog(app, moduleApi, tabId);
}

function getRebreyaRumorEditorClass() {
  if (RebreyaRumorEditor) {
    return RebreyaRumorEditor;
  }

  const BaseApplication = getLegacyApplicationBase();
  if (!BaseApplication) {
    return null;
  }

  RebreyaRumorEditor = class RebreyaRumorEditor extends BaseApplication {
    constructor({ moduleApi, service, groupActorId, rumorId, logApp } = {}, options = {}) {
      super(options);
      this.moduleApi = moduleApi;
      this.service = service;
      this.groupActorId = groupActorId;
      this.rumorId = rumorId;
      this.logApp = logApp;
      this.editorKey = getEditorKey("rumor", groupActorId, rumorId);
    }

    static get defaultOptions() {
      return mergeApplicationOptions(super.defaultOptions, {
        classes: ["forien-quest-preview", "rm-fql-activity-editor-window"],
        template: RUMOR_EDITOR_TEMPLATE,
        width: 820,
        height: 560,
        minimizable: true,
        resizable: true,
        title: "Слух",
        tabs: [{ navSelector: ".quest-tabs", contentSelector: ".quest-body", initial: "details" }]
      });
    }

    get id() {
      return `${MODULE_ID}-rumor-${this.groupActorId}-${this.rumorId}`;
    }

    get title() {
      return `Слух - ${getRumorTopic(this.service, this.rumorId, this.groupActorId)?.title ?? this.rumorId}`;
    }

    async getData(options = {}) {
      const context = this.service?.getQuestActivitiesContext?.(this.groupActorId);
      const rumor = getRumorTopic(this.service, this.rumorId, this.groupActorId) ?? {
        id: this.rumorId,
        title: "Слух не найден",
        tableUuid: "",
        entries: []
      };
      return {
        ...(await super.getData(options)),
        canEdit: context?.canEdit === true,
        rumor
      };
    }

    activateListeners(html) {
      super.activateListeners(html);
      const element = getHtmlElement(html);
      if (!element) {
        return;
      }

      element.querySelectorAll("[data-rm-fql-editor-action]").forEach((button) => {
        button.addEventListener("click", (event) => {
          void this.#handleAction(event);
        });
      });
    }

    async #handleAction(event) {
      const button = event.currentTarget;
      const action = button?.dataset?.rmFqlEditorAction ?? "";
      const element = getHtmlElement(this.element) ?? getHtmlElement(this._element);
      event.preventDefault();

      try {
        if (this.service?.getQuestActivitiesContext?.(this.groupActorId)?.canEdit !== true) {
          notifyWarn("Rebreya: только GM может редактировать слухи.");
          return;
        }

        if (action === "save-rumor") {
          const data = {
            title: getInputValue(element, "rm-fql-rumor-title"),
            tableUuid: getInputValue(element, "rm-fql-rumor-table")
          };
          if (!hasRequiredText(data, "title", "тема слухов")) {
            return;
          }

          await this.service.updateRumorTopic(this.rumorId, data, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-rumors");
          this.render(true, { focus: false });
        }
        else if (action === "remove-rumor-topic") {
          await this.service.removeRumorTopic(this.rumorId, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-rumors");
          await this.close();
        }
        else if (action === "add-rumor-entry") {
          await this.service.addRumorEntry(this.rumorId, { text: "Новый слух" }, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-rumors");
          this.render(true, { focus: false });
        }
        else if (action === "roll-rumor-table") {
          const rumor = getRumorTopic(this.service, this.rumorId, this.groupActorId);
          const text = await rollRumorFromTable(rumor?.tableUuid);
          await this.service.addRumorEntry(this.rumorId, { text }, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-rumors");
          this.render(true, { focus: false });
        }
        else if (action === "save-rumor-entry") {
          const row = button.closest("[data-rumor-entry-id]");
          const text = getInputValue(row, "rm-fql-rumor-entry-text");
          if (!hasRequiredText({ text }, "text", "текст слуха")) {
            return;
          }

          await this.service.updateRumorEntry(this.rumorId, button.dataset.rumorEntryId, { text }, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-rumors");
          this.render(true, { focus: false });
        }
        else if (action === "toggle-rumor-entry-visibility") {
          const entry = getRumorEntry(this.service, this.rumorId, button.dataset.rumorEntryId, this.groupActorId);
          await this.service.updateRumorEntry(this.rumorId, button.dataset.rumorEntryId, {
            hidden: !entry?.hidden
          }, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-rumors");
          this.render(true, { focus: false });
        }
        else if (action === "remove-rumor-entry") {
          await this.service.removeRumorEntry(this.rumorId, button.dataset.rumorEntryId, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-rumors");
          this.render(true, { focus: false });
        }
      }
      catch (error) {
        notifyError(error, "Forien Quest Log rumor editor action failed.");
      }
    }

    async close(options) {
      activityEditors.delete(this.editorKey);
      return super.close(options);
    }
  };

  return RebreyaRumorEditor;
}

function getRebreyaQuestEventEditorClass() {
  if (RebreyaQuestEventEditor) {
    return RebreyaQuestEventEditor;
  }

  const BaseApplication = getLegacyApplicationBase();
  if (!BaseApplication) {
    return null;
  }

  RebreyaQuestEventEditor = class RebreyaQuestEventEditor extends BaseApplication {
    constructor({ moduleApi, service, groupActorId, eventId, logApp } = {}, options = {}) {
      super(options);
      this.moduleApi = moduleApi;
      this.service = service;
      this.groupActorId = groupActorId;
      this.eventId = eventId;
      this.logApp = logApp;
      this.editorKey = getEditorKey("event", groupActorId, eventId);
    }

    static get defaultOptions() {
      return mergeApplicationOptions(super.defaultOptions, {
        classes: ["forien-quest-preview", "rm-fql-activity-editor-window"],
        template: EVENT_EDITOR_TEMPLATE,
        width: 780,
        height: 520,
        minimizable: true,
        resizable: true,
        title: "Событие"
      });
    }

    get id() {
      return `${MODULE_ID}-event-${this.groupActorId}-${this.eventId}`;
    }

    get title() {
      return `Событие - ${getQuestEvent(this.service, this.eventId, this.groupActorId)?.title ?? this.eventId}`;
    }

    async getData(options = {}) {
      const context = this.service?.getQuestActivitiesContext?.(this.groupActorId);
      const event = getQuestEvent(this.service, this.eventId, this.groupActorId) ?? {
        id: this.eventId,
        title: "Событие не найдено",
        text: ""
      };
      return {
        ...(await super.getData(options)),
        canEdit: context?.canEdit === true,
        event
      };
    }

    activateListeners(html) {
      super.activateListeners(html);
      const element = getHtmlElement(html);
      if (!element) {
        return;
      }

      element.querySelectorAll("[data-rm-fql-editor-action]").forEach((button) => {
        button.addEventListener("click", (event) => {
          void this.#handleAction(event);
        });
      });
    }

    async #handleAction(event) {
      const button = event.currentTarget;
      const action = button?.dataset?.rmFqlEditorAction ?? "";
      const element = getHtmlElement(this.element) ?? getHtmlElement(this._element);
      event.preventDefault();

      try {
        if (this.service?.getQuestActivitiesContext?.(this.groupActorId)?.canEdit !== true) {
          notifyWarn("Rebreya: только GM может редактировать события.");
          return;
        }

        if (action === "save-event") {
          const data = {
            title: getInputValue(element, "rm-fql-event-title"),
            text: getInputValue(element, "rm-fql-event-text")
          };
          if (!hasRequiredText(data, "title", "название события")) {
            return;
          }

          await this.service.updateQuestEvent(this.eventId, data, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-events");
          this.render(true, { focus: false });
        }
        else if (action === "remove-event") {
          await this.service.removeQuestEvent(this.eventId, this.groupActorId);
          await refreshActivityEditorParent(this.logApp, this.moduleApi, "rebreya-events");
          await this.close();
        }
      }
      catch (error) {
        notifyError(error, "Forien Quest Log event editor action failed.");
      }
    }

    async close(options) {
      activityEditors.delete(this.editorKey);
      return super.close(options);
    }
  };

  return RebreyaQuestEventEditor;
}

function openQuestActivityEditor(kind, activityId, moduleApi, logApp, groupActorId = "") {
  const service = moduleApi?.questLogService;
  const context = service?.getQuestActivitiesContext?.(groupActorId);
  const groupId = context?.groupActorId ?? "";
  const id = String(activityId ?? "");
  if (!service || !groupId || !id) {
    notifyWarn("Rebreya: не найден журнал активной группы.");
    return null;
  }

  const EditorClass = kind === "event" ? getRebreyaQuestEventEditorClass() : getRebreyaRumorEditorClass();
  if (!EditorClass) {
    notifyWarn("Rebreya: окно редактора Foundry недоступно.");
    return null;
  }

  const key = getEditorKey(kind, groupId, id);
  const existing = activityEditors.get(key);
  if (existing) {
    existing.render(true, { focus: true });
    return existing;
  }

  const editor = kind === "event"
    ? new EditorClass({ moduleApi, service, groupActorId: groupId, eventId: id, logApp })
    : new EditorClass({ moduleApi, service, groupActorId: groupId, rumorId: id, logApp });
  activityEditors.set(key, editor);
  editor.render(true, { focus: true });
  return editor;
}

function getTaskSubtaskIcon(subtask) {
  if (subtask.failed) {
    return "fa-times";
  }

  return subtask.completed ? "fa-check" : "fa-square";
}

function getTaskSubtaskClass(subtask) {
  if (subtask.failed) {
    return "is-failed";
  }

  return subtask.completed ? "is-completed" : "";
}

function getApplicationInstances(value) {
  if (!value) {
    return [];
  }

  if (value instanceof Map) {
    return Array.from(value.values());
  }

  if (Array.isArray(value)) {
    return value;
  }

  return Object.values(value);
}

function getOpenForienApps() {
  const apps = [
    ...Object.values(globalThis.ui?.windows ?? {}),
    ...getApplicationInstances(globalThis.foundry?.applications?.instances)
  ];
  const seen = new Set();

  return apps.filter((app) => {
    if (!app || seen.has(app) || !app.rendered || typeof app.render !== "function") {
      return false;
    }

    const classes = app.options?.classes ?? [];
    const id = String(app.id ?? app.options?.id ?? "");
    const isForienApp = classes.includes(FQL_MODULE_ID)
      || classes.includes("forien-quest-preview")
      || id === FQL_MODULE_ID
      || id.startsWith("quest-");
    if (!isForienApp) {
      return false;
    }

    seen.add(app);
    return true;
  });
}

function filterQuestSelectOptions(input) {
  const container = input.closest(".rm-fql-overlay");
  const targetName = input.dataset.rmFqlSearchTarget ?? "";
  const select = container?.querySelector(`[name="${targetName}"]`);
  if (!select) {
    return;
  }

  const query = input.value.trim().toLocaleLowerCase("ru");
  let firstVisible = null;
  let selectedVisible = false;

  for (const option of select.options) {
    const matches = !query || option.textContent.toLocaleLowerCase("ru").includes(query);
    option.hidden = !matches;
    option.disabled = !matches;
    if (matches && !firstVisible) {
      firstVisible = option;
    }
    if (matches && option.selected) {
      selectedVisible = true;
    }
  }

  if (!selectedVisible && firstVisible) {
    select.value = firstVisible.value;
  }
}

function getRequirementRow(button) {
  return button.closest("[data-requirement-id]");
}

function getRequirementPayload(container, prefix = "rm-fql-required") {
  const type = getSelectValue(container, `${prefix}-type`) || "quest";
  if (type === "level") {
    return {
      type,
      level: getPositiveIntegerValue(container, `${prefix}-level`)
    };
  }

  if (type === "item") {
    return {
      type,
      itemName: getSelectValue(container, `${prefix}-item-name`) || getInputValue(container, `${prefix}-item-search`)
    };
  }

  return {
    type,
    requiredQuestId: getSelectValue(container, `${prefix}-quest-id`),
    status: getSelectValue(container, `${prefix}-status`)
  };
}

function syncRequirementTypeFields(scope) {
  const root = scope?.querySelectorAll ? scope : globalThis.document;
  const forms = root?.matches?.("[data-rm-fql-requirement-form]")
    ? [root]
    : Array.from(root?.querySelectorAll?.("[data-rm-fql-requirement-form]") ?? []);

  forms.forEach((form) => {
    const typeSelect = form.querySelector('[name="rm-fql-required-type"], [name="rm-fql-requirement-type"]');
    const selectedType = String(typeSelect?.value ?? "quest");

    form.querySelectorAll("[data-rm-fql-requirement-field]").forEach((field) => {
      const active = field.dataset.rmFqlRequirementField === selectedType;
      field.hidden = !active;

      field.querySelectorAll("input, select, textarea, button").forEach((control) => {
        control.dataset.rmFqlOriginalDisabled ??= String(control.disabled);
        control.disabled = !active || control.dataset.rmFqlOriginalDisabled === "true";
      });
    });
  });
}

function renderSubtasksForTask(taskId, subtasks = []) {
  if (!subtasks.length) {
    return "";
  }

  const items = subtasks.map((subtask) => `
    <li class="rm-fql-subtask ${getTaskSubtaskClass(subtask)}" data-subtask-id="${escapeHtml(subtask.id)}">
      <i class="fas ${getTaskSubtaskIcon(subtask)} rm-fql-subtask__state" data-rm-fql-task-action="toggle-subtask" data-subtask-id="${escapeHtml(subtask.id)}" title="ЛКМ: выполнить, ПКМ: провалить"></i>
      <span class="rm-fql-subtask__title">${escapeHtml(subtask.title)}</span>
      <span class="rm-fql-subtask__actions">
        <button type="button" data-rm-fql-task-action="edit-subtask" data-subtask-id="${escapeHtml(subtask.id)}" title="Редактировать"><i class="fas fa-pen"></i></button>
        <button type="button" data-rm-fql-task-action="remove-subtask" data-subtask-id="${escapeHtml(subtask.id)}" title="Удалить"><i class="fas fa-trash"></i></button>
      </span>
    </li>
  `).join("");

  return `<ul class="rm-fql-subtasks" data-task-id="${escapeHtml(taskId)}">${items}</ul>`;
}

function getTaskRow(element) {
  return element?.closest?.("li.task[data-uuidv4]") ?? null;
}

async function handleTaskEnhancementClick(event, app, moduleApi) {
  const control = event.target.closest("[data-rm-fql-task-action]");
  if (!control) {
    return;
  }

  const quest = getQuestFromApp(app);
  const service = moduleApi?.questLogService;
  const row = getTaskRow(control);
  if (!quest?.id || !service || !row?.dataset.uuidv4) {
    return;
  }

  const action = control.dataset.rmFqlTaskAction;
  const taskId = row.dataset.uuidv4;
  event.preventDefault();
  event.stopPropagation();

  try {
    if (action === "add-subtask") {
      const title = String(await promptText({ title: "Новая подзадача", label: "Подзадача" }) ?? "").trim();
      if (title) {
        await service.addTaskSubtask(quest.id, taskId, { title });
      }
    }
    else if (action === "toggle-subtask") {
      const subtaskId = control.dataset.subtaskId;
      const failed = control.classList.contains("fa-times");
      const completed = control.classList.contains("fa-check");
      await service.updateTaskSubtask(quest.id, taskId, subtaskId, {
        completed: failed || completed ? false : true,
        failed: false
      });
    }
    else if (action === "edit-subtask") {
      const subtaskId = control.dataset.subtaskId;
      const currentTitle = row.querySelector(`[data-subtask-id="${escapeCss(subtaskId)}"] .rm-fql-subtask__title`)?.textContent ?? "";
      const title = String(await promptText({ title: "Редактировать подзадачу", label: "Подзадача", value: currentTitle }) ?? "").trim();
      if (title) {
        await service.updateTaskSubtask(quest.id, taskId, subtaskId, { title });
      }
    }
    else if (action === "remove-subtask") {
      await service.removeTaskSubtask(quest.id, taskId, control.dataset.subtaskId);
    }

    await refreshQuestPreview(app, moduleApi);
  }
  catch (error) {
    notifyError(error, "Forien Quest Log task enhancement failed.");
    await refreshQuestPreview(app, moduleApi);
  }
}

async function handleTaskEnhancementContextMenu(event, app, moduleApi) {
  const quest = getQuestFromApp(app);
  const service = moduleApi?.questLogService;
  const subtaskControl = event.target.closest("[data-rm-fql-task-action='toggle-subtask']");
  const taskControl = event.target.closest(".toggleState");
  const row = getTaskRow(subtaskControl ?? taskControl);
  if (!quest?.id || !service || !row?.dataset.uuidv4 || (!subtaskControl && !taskControl)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  try {
    if (subtaskControl) {
      await service.updateTaskSubtask(quest.id, row.dataset.uuidv4, subtaskControl.dataset.subtaskId, {
        completed: false,
        failed: true
      });
    }
    else {
      await service.markTaskFailed(quest.id, row.dataset.uuidv4);
    }

    await refreshQuestPreview(app, moduleApi);
  }
  catch (error) {
    notifyError(error, "Forien Quest Log task failure failed.");
    await refreshQuestPreview(app, moduleApi);
  }
}

function injectQuestTaskEnhancements(app, element, moduleApi) {
  const quest = getQuestFromApp(app);
  const service = moduleApi?.questLogService;
  if (!quest?.id || !element || !service) {
    return;
  }

  const metadata = service.getQuestMetadata(quest);
  const details = element.querySelector(".tab.details") ?? element;
  details.querySelectorAll(".rm-fql-subtasks, .rm-fql-task-add-subtask").forEach((node) => node.remove());

  for (const row of details.querySelectorAll(".quest-tasks li.task[data-uuidv4]")) {
    const taskId = row.dataset.uuidv4;
    const toggle = row.querySelector(".toggleState");
    if (toggle?.classList.contains("fa-minus-square")) {
      toggle.classList.remove("fa-minus-square");
      toggle.classList.add("fa-times", "rm-fql-task-failed");
    }

    const actions = row.querySelector(".actions.tasks");
    if (actions) {
      const spacer = actions.querySelector(".spacer");
      const button = globalThis.document?.createElement?.("button");
      if (button) {
        button.type = "button";
        button.className = "rm-fql-task-add-subtask";
        button.dataset.rmFqlTaskAction = "add-subtask";
        button.title = "Добавить подзадачу";
        button.innerHTML = '<i class="fas fa-tasks"></i>';
        actions.insertBefore(button, spacer ?? actions.firstChild);
      }
    }

    const renderedSubtasks = renderSubtasksForTask(taskId, metadata.taskSubtasksById[taskId] ?? []);
    if (renderedSubtasks) {
      row.insertAdjacentHTML("beforeend", renderedSubtasks);
    }
  }

  details.addEventListener("click", (event) => {
    void handleTaskEnhancementClick(event, app, moduleApi);
  });
  details.addEventListener("contextmenu", (event) => {
    void handleTaskEnhancementContextMenu(event, app, moduleApi);
  });
}

export async function refreshForienQuestLogApps() {
  const forienModule = globalThis.game?.modules?.get?.(FQL_MODULE_ID);
  if (!forienModule || forienModule.active === false) {
    return;
  }

  try {
    const { ViewManager } = await import("../../../forien-quest-log/src/control/index.js");
    ViewManager.renderAll({ force: true, questPreview: true, focus: false });
    return;
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Forien Quest Log ViewManager was not available for group refresh.`, error);
  }

  const tasks = getOpenForienApps().map((app) => app.render(true, { focus: false }));
  await Promise.allSettled(tasks);
}

async function refreshQuestPreview(app, moduleApi) {
  await moduleApi?.refreshOpenApps?.();
  await refreshForienQuestLogApps();
  if (typeof app?.render === "function") {
    app.render(true);
  }
}

function getQuestLogElementFromApp(app) {
  return getHtmlElement(app?.element) ?? getHtmlElement(app?._element);
}

function getActiveQuestLogTab(root) {
  return root?.querySelector?.(".log-tabs .item.active")?.dataset?.tab ?? "";
}

function rememberQuestLogTab(app, tabId) {
  if (app) {
    app._rebreyaQuestLogActiveTab = tabId || "";
  }
}

async function refreshQuestLog(app, moduleApi, tabId = "") {
  await moduleApi?.refreshOpenApps?.();
  if (typeof app?.render === "function") {
    rememberQuestLogTab(app, tabId || getActiveQuestLogTab(getQuestLogElementFromApp(app)));
    app.render(true, { focus: false });
  }
}

async function resolveRollTable(tableRef) {
  const reference = String(tableRef ?? "").trim();
  if (!reference) {
    return null;
  }

  if (typeof globalThis.fromUuid === "function") {
    try {
      const byUuid = await globalThis.fromUuid(reference);
      if (byUuid?.documentName === "RollTable" || byUuid?.roll) {
        return byUuid;
      }
    }
    catch (_error) {
      // Non-UUID input is still valid here: fall back to table id or name lookup.
    }
  }

  return globalThis.game?.tables?.get?.(reference)
    ?? globalThis.game?.tables?.contents?.find((table) => table?.name === reference)
    ?? null;
}

async function rollRumorFromTable(tableRef) {
  const table = await resolveRollTable(tableRef);
  if (!table || typeof table.draw !== "function") {
    throw new Error("Таблица слухов не найдена.");
  }

  const draw = await table.draw({ displayChat: true });
  const results = Array.from(draw?.results ?? []);
  const text = results.map((result) => result?.text ?? result?.description ?? "").filter(Boolean).join("\n");
  if (!text) {
    throw new Error("Таблица слухов не вернула текст.");
  }

  return text;
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
      await service.addRequirement(quest.id, getRequirementPayload(container, "rm-fql-required"));
      notifyInfo("Rebreya: требование добавлено.");
    }
    else if (action === "update-requirement") {
      const row = getRequirementRow(button);
      await service.updateRequirement(quest.id, button.dataset.requirementId, getRequirementPayload(row, "rm-fql-requirement"));
      notifyInfo("Rebreya: требование обновлено.");
    }
    else if (action === "remove-requirement") {
      await service.removeRequirement(quest.id, button.dataset.requirementId);
      notifyInfo("Rebreya: требование удалено.");
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
    else if (action === "remove-unlock-reward") {
      await service.removeUnlockReward(quest.id, button.dataset.rewardId);
      notifyInfo("Rebreya: награда-ключ удалена.");
    }

    await refreshQuestPreview(app, moduleApi);
  }
  catch (error) {
    notifyError(error, "Forien Quest Log action failed.");
    await refreshQuestPreview(app, moduleApi);
  }
}

function activateQuestLogTab(root, tabId) {
  const nav = root.querySelector(".log-tabs");
  const body = root.querySelector(".log-body");
  if (!nav || !body) {
    return;
  }

  nav.querySelectorAll(".item").forEach((item) => item.classList.remove("active"));
  body.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.remove("active");
    if (tab.classList.contains("rm-fql-log-panel")) {
      tab.hidden = true;
    }
  });

  const navItem = nav.querySelector(`[data-tab="${escapeCss(tabId)}"]`);
  const panel = body.querySelector(`[data-tab="${escapeCss(tabId)}"]`);
  navItem?.classList.add("active");
  if (panel) {
    panel.hidden = false;
    panel.classList.add("active");
  }
}

async function handleQuestLogActivityAction(event, app, moduleApi) {
  const button = event.target.closest("[data-rm-fql-log-action]");
  const service = moduleApi?.questLogService;
  if (!button || !service) {
    return;
  }

  const action = button.dataset.rmFqlLogAction;
  event.preventDefault();

  try {
    if (action === "add-rumor-topic") {
      const rumor = await service.addRumorTopic({ title: "Новый слух" });
      await refreshQuestLog(app, moduleApi, "rebreya-rumors");
      openQuestActivityEditor("rumor", rumor.id, moduleApi, app);
      return;
    }

    if (action === "open-rumor-topic" || action === "edit-rumor-topic") {
      rememberQuestLogTab(app, "rebreya-rumors");
      openQuestActivityEditor("rumor", button.dataset.rumorId, moduleApi, app);
      return;
    }

    if (action === "remove-rumor-topic") {
      await service.removeRumorTopic(button.dataset.rumorId);
      await refreshQuestLog(app, moduleApi, "rebreya-rumors");
      return;
    }

    if (action === "add-rumor-entry") {
      await service.addRumorEntry(button.dataset.rumorId, { text: "Новый слух" });
      await refreshQuestLog(app, moduleApi, "rebreya-rumors");
      openQuestActivityEditor("rumor", button.dataset.rumorId, moduleApi, app);
      return;
    }

    if (action === "edit-rumor-entry") {
      rememberQuestLogTab(app, "rebreya-rumors");
      openQuestActivityEditor("rumor", button.dataset.rumorId, moduleApi, app);
      return;
    }

    if (action === "remove-rumor-entry") {
      await service.removeRumorEntry(button.dataset.rumorId, button.dataset.rumorEntryId);
      await refreshQuestLog(app, moduleApi, "rebreya-rumors");
      return;
    }

    if (action === "roll-rumor-table") {
      const text = await rollRumorFromTable(button.dataset.tableUuid);
      await service.addRumorEntry(button.dataset.rumorId, { text });
      await refreshQuestLog(app, moduleApi, "rebreya-rumors");
      return;
    }

    if (action === "add-event") {
      const activityEvent = await service.addQuestEvent({ title: "Новое событие" });
      await refreshQuestLog(app, moduleApi, "rebreya-events");
      openQuestActivityEditor("event", activityEvent.id, moduleApi, app);
      return;
    }

    if (action === "open-event" || action === "edit-event") {
      rememberQuestLogTab(app, "rebreya-events");
      openQuestActivityEditor("event", button.dataset.eventId, moduleApi, app);
      return;
    }

    if (action === "remove-event") {
      await service.removeQuestEvent(button.dataset.eventId);
      await refreshQuestLog(app, moduleApi, "rebreya-events");
      return;
    }
  }
  catch (error) {
    notifyError(error, "Forien Quest Log activity action failed.");
    await refreshQuestLog(app, moduleApi, getActiveQuestLogTab(button.closest(".quest-log")));
    return;
  }

  try {
    if (action === "add-rumor-topic") {
      const data = await promptQuestActivityForm({
        title: "Новый слух",
        fields: [
          { name: "title", label: "Источник или тема слухов" },
          { name: "tableUuid", label: "UUID, id или имя таблицы слухов" }
        ]
      });
      if (!data || !hasRequiredText(data, "title", "тема слухов")) {
        return;
      }

      await service.addRumorTopic(data);
    }
    else if (action === "edit-rumor-topic") {
      const rumor = getRumorTopic(service, button.dataset.rumorId);
      const data = await promptQuestActivityForm({
        title: "Редактировать слух",
        fields: [
          { name: "title", label: "Источник или тема слухов", value: rumor?.title ?? "" },
          { name: "tableUuid", label: "UUID, id или имя таблицы слухов", value: rumor?.tableUuid ?? "" }
        ]
      });
      if (!data || !hasRequiredText(data, "title", "тема слухов")) {
        return;
      }

      await service.updateRumorTopic(button.dataset.rumorId, data);
    }
    else if (action === "remove-rumor-topic") {
      await service.removeRumorTopic(button.dataset.rumorId);
    }
    else if (action === "add-rumor-entry") {
      const data = await promptQuestActivityForm({
        title: "Новая запись слуха",
        fields: [
          { name: "text", label: "Текст слуха", type: "textarea", rows: 5 }
        ]
      });
      if (!data || !hasRequiredText(data, "text", "текст слуха")) {
        return;
      }

      await service.addRumorEntry(button.dataset.rumorId, data);
    }
    else if (action === "edit-rumor-entry") {
      const entry = getRumorEntry(service, button.dataset.rumorId, button.dataset.rumorEntryId);
      const data = await promptQuestActivityForm({
        title: "Редактировать запись слуха",
        fields: [
          { name: "text", label: "Текст слуха", type: "textarea", rows: 5, value: entry?.text ?? "" }
        ]
      });
      if (!data || !hasRequiredText(data, "text", "текст слуха")) {
        return;
      }

      await service.updateRumorEntry(button.dataset.rumorId, button.dataset.rumorEntryId, data);
    }
    else if (action === "remove-rumor-entry") {
      await service.removeRumorEntry(button.dataset.rumorId, button.dataset.rumorEntryId);
    }
    else if (action === "roll-rumor-table") {
      const text = await rollRumorFromTable(button.dataset.tableUuid);
      await service.addRumorEntry(button.dataset.rumorId, { text });
    }
    else if (action === "add-event") {
      const data = await promptQuestActivityForm({
        title: "Новое событие",
        fields: [
          { name: "title", label: "Название события" },
          { name: "text", label: "Описание события", type: "textarea", rows: 6 }
        ]
      });
      if (!data || !hasRequiredText(data, "title", "название события")) {
        return;
      }

      await service.addQuestEvent(data);
    }
    else if (action === "edit-event") {
      const activityEvent = getQuestEvent(service, button.dataset.eventId);
      const data = await promptQuestActivityForm({
        title: "Редактировать событие",
        fields: [
          { name: "title", label: "Название события", value: activityEvent?.title ?? "" },
          { name: "text", label: "Описание события", type: "textarea", rows: 6, value: activityEvent?.text ?? "" }
        ]
      });
      if (!data || !hasRequiredText(data, "title", "название события")) {
        return;
      }

      await service.updateQuestEvent(button.dataset.eventId, data);
    }
    else if (action === "remove-event") {
      await service.removeQuestEvent(button.dataset.eventId);
    }

    await refreshQuestLog(app, moduleApi);
  }
  catch (error) {
    notifyError(error, "Forien Quest Log activity action failed.");
    await refreshQuestLog(app, moduleApi);
  }
}

async function injectQuestLogActivities(app, html, moduleApi) {
  const element = getHtmlElement(html);
  const service = moduleApi?.questLogService;
  if (!element || !service || typeof globalThis.renderTemplate !== "function") {
    return;
  }

  const log = element.querySelector(".quest-log");
  const nav = log?.querySelector(".log-tabs");
  const body = log?.querySelector(".log-body");
  if (!log || !nav || !body || nav.querySelector("[data-rm-fql-log-tab]")) {
    return;
  }

  nav.insertAdjacentHTML("beforeend", `
    <a class="item rm-fql-log-tab" data-tab="rebreya-rumors" data-rm-fql-log-tab="rumors">Слухи</a>
    <a class="item rm-fql-log-tab" data-tab="rebreya-events" data-rm-fql-log-tab="events">События</a>
  `);

  const context = service.getQuestActivitiesContext();
  const rendered = await globalThis.renderTemplate(ACTIVITIES_TEMPLATE, context);
  body.insertAdjacentHTML("beforeend", rendered);

  nav.querySelectorAll("[data-rm-fql-log-tab]").forEach((tab) => {
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      rememberQuestLogTab(app, tab.dataset.tab);
      activateQuestLogTab(log, tab.dataset.tab);
    });
  });
  nav.querySelectorAll(".item:not([data-rm-fql-log-tab])").forEach((tab) => {
    tab.addEventListener("click", () => {
      rememberQuestLogTab(app, "");
      body.querySelectorAll(".rm-fql-log-panel").forEach((panel) => {
        panel.hidden = true;
        panel.classList.remove("active");
      });
      nav.querySelectorAll("[data-rm-fql-log-tab]").forEach((item) => item.classList.remove("active"));
    });
  });
  log.querySelectorAll("[data-rm-fql-log-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      void handleQuestLogActivityAction(event, app, moduleApi);
    });
  });

  if (app?._rebreyaQuestLogActiveTab) {
    activateQuestLogTab(log, app._rebreyaQuestLogActiveTab);
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
  target.querySelectorAll("[data-rm-fql-search-target]").forEach((input) => {
    input.addEventListener("input", () => {
      filterQuestSelectOptions(input);
    });
  });
  target.querySelectorAll('[name="rm-fql-required-type"], [name="rm-fql-requirement-type"]').forEach((select) => {
    select.addEventListener("change", () => {
      syncRequirementTypeFields(select.closest("[data-rm-fql-requirement-form]") ?? target);
    });
  });
  syncRequirementTypeFields(target);
}

function registerQuestPreviewOverlay(moduleApi) {
  globalThis.Hooks?.on?.("renderQuestPreview", (app, html) => {
    injectQuestTaskEnhancements(app, getHtmlElement(html), moduleApi);
    injectQuestOverlay(app, html, moduleApi).catch((error) => {
      console.warn(`${MODULE_ID} | Failed to render Forien quest overlay.`, error);
    });
  });
}

function registerQuestLogActivities(moduleApi) {
  globalThis.Hooks?.on?.("renderQuestLog", (app, html) => {
    injectQuestLogActivities(app, html, moduleApi).catch((error) => {
      console.warn(`${MODULE_ID} | Failed to render Forien quest log activities.`, error);
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
  registerQuestLogActivities(moduleApi);

  globalThis.Hooks?.once?.("ForienQuestLog.Lifecycle.ready", () => {
    patchQuestDbFiltering(moduleApi).catch((error) => {
      console.warn(`${MODULE_ID} | Failed to patch Forien Quest Log after lifecycle ready.`, error);
    });
  });
}
