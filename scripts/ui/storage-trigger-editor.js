import { MODULE_ID } from "../constants.js";
import { getAppElement } from "../ui.js";
import { STORAGE_TRIGGER_EVENTS } from "../data/storage-trigger-service.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const EVENT_LABELS = Object.freeze({
  beforeOpen: "До открытия",
  afterOpen: "После открытия",
  afterClaim: "После получения",
  emptied: "Опустело"
});

const STEP_TYPES = Object.freeze([
  ["conditionItem", "Проверка предмета"], ["conditionVariable", "Проверка переменной"],
  ["conditionResult", "Проверка результата"], ["abilityCheck", "Проверка характеристики"],
  ["savingThrow", "Спасбросок"], ["consumeItem", "Расходовать предмет"],
  ["damage", "Урон"], ["requesterDialog", "Диалог игроку"],
  ["chatMessage", "Сообщение в чат"], ["notification", "Уведомление"],
  ["setVariable", "Записать переменную"], ["removeVariable", "Удалить переменную"],
  ["branch", "Ветвление"], ["macro", "Макрос"], ["allow", "Разрешить"],
  ["deny", "Запретить"], ["finish", "Завершить"]
]);

function clean(value) { return String(value ?? "").trim(); }
function clone(value) {
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : JSON.parse(JSON.stringify(value));
}
function identity(prefix) {
  const random = globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

export function buildStorageLockTrigger() {
  return {
    id: identity("lock"), name: "Замок", enabled: true, repeat: "always", entryStepId: "has-key",
    steps: [
      { id: "has-key", type: "conditionItem", config: { itemUuid: "" }, successStepId: "allow", failureStepId: "deny" },
      { id: "allow", type: "allow", config: {} },
      { id: "deny", type: "deny", config: { message: "Хранилище заперто." } }
    ]
  };
}

export function buildStorageTrapTrigger() {
  return {
    id: identity("trap"), name: "Ловушка", enabled: true, repeat: "oncePerCharacter", entryStepId: "save",
    steps: [
      { id: "save", type: "savingThrow", config: { ability: "dex", dc: 14 }, successStepId: "finish", failureStepId: "damage" },
      { id: "damage", type: "damage", config: { formula: "2d6", damageType: "piercing" }, nextStepId: "finish" },
      { id: "finish", type: "finish", config: {} }
    ]
  };
}

function stepLabel(step) {
  return clean(step?.name) || STEP_TYPES.find(([type]) => type === step?.type)?.[1] || clean(step?.type) || "Шаг";
}

function configFields(step) {
  const fields = {
    conditionItem: [["itemUuid", "UUID предмета", "text"]],
    conditionVariable: [["name", "Переменная", "text"], ["operator", "Оператор", "text"], ["value", "Значение", "text"]],
    conditionResult: [["stepId", "Шаг-источник", "text"], ["operator", "Оператор", "text"], ["value", "Значение", "text"]],
    abilityCheck: [["ability", "Характеристика", "text"], ["dc", "Сложность", "number"]],
    savingThrow: [["ability", "Характеристика", "text"], ["dc", "Сложность", "number"]],
    consumeItem: [["itemUuid", "UUID предмета", "text"], ["quantity", "Количество", "number"]],
    damage: [["formula", "Формула", "text"], ["damageType", "Тип урона", "text"]],
    requesterDialog: [["title", "Заголовок", "text"], ["message", "Сообщение", "textarea"]],
    chatMessage: [["message", "Сообщение", "textarea"]], notification: [["message", "Сообщение", "textarea"]],
    setVariable: [["name", "Переменная", "text"], ["value", "Значение", "text"]],
    removeVariable: [["name", "Переменная", "text"]],
    macro: [["macroUuid", "UUID макроса", "text"]], deny: [["message", "Сообщение", "textarea"]]
  };
  return (fields[step?.type] ?? []).map(([name, label, type]) => ({
    name, label, type, value: step?.config?.[name] ?? ""
  }));
}

export class StorageTriggerEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-storage-trigger-editor"],
    window: { title: "Триггеры хранилища", icon: "fa-solid fa-bolt", resizable: true },
    position: { width: 1120, height: 720 }
  };

  static PARTS = { main: { root: true, template: `modules/${MODULE_ID}/templates/storage-trigger-editor.hbs` } };

  constructor(moduleApi, tokenUuid, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.tokenUuid = clean(tokenUuid);
    this.path = (Array.isArray(options.path) ? options.path : []).map(clean).filter(Boolean).slice(0, 8);
    this.storageName = clean(options.storageName) || "Хранилище";
    this.snapshot = null;
    this.draft = null;
    this.event = STORAGE_TRIGGER_EVENTS.includes(options.event) ? options.event : "beforeOpen";
    this.chainId = "";
    this.stepId = "";
    this.dirty = false;
    this.validationIssues = [];
    this.listeners = null;
  }

  get id() {
    const scope = [this.tokenUuid, ...this.path].join("-").replace(/[^a-z0-9_-]/giu, "-");
    return `${MODULE_ID}-storage-triggers-${scope}`;
  }

  async #load() {
    this.snapshot = await this.moduleApi.getStorageTriggers(this.tokenUuid, { path: this.path });
    this.draft = clone(this.snapshot.triggers.chainsByEvent);
    this.chainId = clean(this.draft[this.event]?.[0]?.id);
    this.stepId = clean(this.draft[this.event]?.[0]?.entryStepId);
    this.dirty = false;
    this.validationIssues = [];
  }

  #chain() { return this.draft?.[this.event]?.find((chain) => clean(chain?.id) === this.chainId) ?? null; }
  #step() { return this.#chain()?.steps?.find((step) => clean(step?.id) === this.stepId) ?? null; }
  #markDirty() { this.dirty = true; }

  async _prepareContext() {
    if (!this.draft) await this.#load();
    const chains = (this.draft[this.event] ?? []).map((chain) => ({
      ...clone(chain), selected: clean(chain.id) === this.chainId,
      unsupported: chain?.unsupported === true,
      activeLabel: chain?.enabled === true ? "Включена" : "Выключена"
    }));
    const chain = this.#chain();
    const step = this.#step();
    const steps = (chain?.steps ?? []).map((entry, index) => ({
      ...clone(entry), number: index + 1, label: stepLabel(entry), selected: clean(entry.id) === this.stepId
    }));
    const targetOptions = [{ value: "", label: "Завершить цепочку" }, ...steps.map((entry) => ({ value: entry.id, label: entry.label }))];
    return {
      storageName: this.storageName,
      dirty: this.dirty,
      events: STORAGE_TRIGGER_EVENTS.map((event) => ({ event, label: EVENT_LABELS[event], selected: event === this.event })),
      chains, hasChains: chains.length > 0, chain, chainSupported: chain && chain.unsupported !== true,
      steps, hasSteps: steps.length > 0, step: step ? { ...clone(step), label: stepLabel(step) } : null,
      repeatOptions: [
        ["always", "Всегда"], ["onceGlobal", "Один раз"], ["oncePerCharacter", "Раз на персонажа"]
      ].map(([value, label]) => ({ value, label, selected: chain?.repeat === value })),
      stepTypeOptions: STEP_TYPES.map(([value, label]) => ({ value, label, selected: step?.type === value })),
      configFields: configFields(step),
      targetOptions: targetOptions.map((entry) => ({ ...entry, nextSelected: step?.nextStepId === entry.value, successSelected: step?.successStepId === entry.value, failureSelected: step?.failureStepId === entry.value })),
      validationIssues: this.validationIssues
    };
  }

  async #renderCurrent() { await this.render({ force: true }); }

  async #save() {
    try {
      const result = await this.moduleApi.saveStorageTriggers(
        this.tokenUuid,
        { chainsByEvent: clone(this.draft) },
        this.snapshot.triggers.revision,
        identity("trigger-save"),
        { path: this.path }
      );
      this.snapshot = result;
      this.draft = clone(result.triggers.chainsByEvent);
      this.dirty = false;
      this.validationIssues = [];
    }
    catch (error) {
      this.validationIssues = clone(error?.issues ?? [{ message: error?.message || "Не удалось сохранить." }]);
      throw error;
    }
  }

  async #onClick(event) {
    const control = event.target?.closest?.("[data-action]");
    if (!control) return;
    event.preventDefault?.();
    const action = clean(control.dataset.action);
    if (action === "trigger-event") {
      this.event = clean(control.dataset.event); this.chainId = clean(this.draft[this.event]?.[0]?.id); this.stepId = clean(this.draft[this.event]?.[0]?.entryStepId);
    }
    else if (action === "trigger-select-chain") {
      this.chainId = clean(control.dataset.chainId); this.stepId = clean(this.#chain()?.entryStepId);
    }
    else if (action === "trigger-select-step") this.stepId = clean(control.dataset.stepId);
    else if (action === "trigger-template-lock" || action === "trigger-template-trap") {
      const template = action.endsWith("lock") ? buildStorageLockTrigger() : buildStorageTrapTrigger();
      const targetEvent = action.endsWith("lock") ? "beforeOpen" : "afterOpen";
      this.event = targetEvent; this.draft[targetEvent].push(template); this.chainId = template.id; this.stepId = template.entryStepId; this.#markDirty();
    }
    else if (action === "trigger-add-chain") {
      const stepId = identity("finish");
      const chain = { id: identity("chain"), name: "Новая цепочка", enabled: true, repeat: "always", entryStepId: stepId, steps: [{ id: stepId, type: "finish", config: {} }] };
      this.draft[this.event].push(chain); this.chainId = chain.id; this.stepId = stepId; this.#markDirty();
    }
    else if (action === "trigger-delete-chain") {
      this.draft[this.event] = this.draft[this.event].filter((chain) => clean(chain.id) !== this.chainId);
      this.chainId = clean(this.draft[this.event]?.[0]?.id); this.stepId = clean(this.#chain()?.entryStepId); this.#markDirty();
    }
    else if (action === "trigger-add-step") {
      const chain = this.#chain(); const id = identity("step");
      chain.steps.push({ id, type: "finish", config: {} }); this.stepId = id; this.#markDirty();
    }
    else if (action === "trigger-delete-step") {
      const chain = this.#chain();
      if (chain.steps.length <= 1) throw new Error("В цепочке должен остаться хотя бы один шаг.");
      const removedId = clean(control.dataset.stepId);
      chain.steps = chain.steps.filter((step) => clean(step.id) !== removedId);
      for (const step of chain.steps) {
        for (const key of ["nextStepId", "successStepId", "failureStepId"]) {
          if (clean(step[key]) === removedId) step[key] = "";
        }
      }
      if (clean(chain.entryStepId) === removedId) chain.entryStepId = clean(chain.steps[0].id);
      this.stepId = clean(chain.entryStepId); this.#markDirty();
    }
    else if (action === "trigger-move-step") {
      const chain = this.#chain(); const index = chain.steps.findIndex((step) => clean(step.id) === clean(control.dataset.stepId));
      const target = index + Number(control.dataset.direction);
      if (index >= 0 && target >= 0 && target < chain.steps.length) [chain.steps[index], chain.steps[target]] = [chain.steps[target], chain.steps[index]];
      this.#markDirty();
    }
    else if (action === "trigger-save") await this.#save();
    else if (action === "trigger-reload") await this.#load();
    else if (action === "trigger-reset") await this.moduleApi.resetStorageTriggerExecutions(this.tokenUuid, identity("trigger-reset"), { path: this.path });
    else return;
    await this.#renderCurrent();
  }

  async #onChange(event) {
    const input = event.target;
    const field = clean(input?.dataset?.field);
    if (!field) return;
    const chain = this.#chain(); const step = this.#step();
    if (field === "chain.name") chain.name = clean(input.value);
    else if (field === "chain.enabled") chain.enabled = input.checked === true;
    else if (field === "chain.repeat") chain.repeat = clean(input.value);
    else if (field === "step.type") { step.type = clean(input.value); step.config = {}; }
    else if (field.startsWith("step.config.")) {
      const key = field.slice("step.config.".length); step.config ??= {};
      step.config[key] = input.type === "number" ? Number(input.value) : input.value;
    }
    else if (field.startsWith("step.")) step[field.slice(5)] = clean(input.value);
    else return;
    this.#markDirty(); await this.#renderCurrent();
  }

  async #onDrop(event) {
    const step = this.#step();
    if (!step || step.type !== "macro") return;
    let data = globalThis.TextEditor?.getDragEventData?.(event);
    if (!data) try { data = JSON.parse(event.dataTransfer?.getData?.("text/plain") || "{}"); } catch (_error) { return; }
    if (data?.type !== "Macro" || !clean(data.uuid)) return;
    event.preventDefault?.(); step.config = { ...step.config, macroUuid: clean(data.uuid) }; this.#markDirty(); await this.#renderCurrent();
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    this.listeners?.abort(); this.listeners = new AbortController();
    const root = getAppElement(this); if (!root) return;
    const listenerOptions = { signal: this.listeners.signal };
    const run = (operation) => void operation.catch((error) => {
      console.error(`${MODULE_ID} | Storage trigger editor action failed.`, error);
      globalThis.ui?.notifications?.error?.(error?.message || "Не удалось изменить триггер.");
      void this.#renderCurrent();
    });
    root.addEventListener("click", (event) => run(this.#onClick(event)), listenerOptions);
    root.addEventListener("change", (event) => run(this.#onChange(event)), listenerOptions);
    root.addEventListener("drop", (event) => run(this.#onDrop(event)), listenerOptions);
    root.addEventListener("dragover", (event) => { if (this.#step()?.type === "macro") event.preventDefault(); }, listenerOptions);
  }

  async close(options = {}) {
    if (this.dirty && options?.force !== true) {
      const confirmed = await globalThis.foundry?.applications?.api?.DialogV2?.confirm?.({
        window: { title: "Несохранённые изменения" }, content: "<p>Закрыть редактор без сохранения?</p>"
      });
      if (!confirmed) return this;
    }
    this.listeners?.abort();
    return super.close(options);
  }
}
