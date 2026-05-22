import { MODULE_ID } from "../constants.js";

export const CHOICE_FLAG_SCOPE = MODULE_ID;
export const CHOICE_CONFIG_FLAG = "choiceConfig";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.featChoiceAutomationHooksRegistered`;
const AUTOMATION_OPTION_KEY = "featChoiceAutomation";
const EFFECT_MODE_ADD = 2;
const DND5E_SYSTEM_ID = "dnd5e";

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) {
    return undefined;
  }

  if (globalThis.foundry?.utils?.deepClone) {
    return foundry.utils.deepClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  const text = cleanString(value);
  if (globalThis.foundry?.utils?.escapeHTML) {
    return foundry.utils.escapeHTML(text);
  }

  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty
    ? foundry.utils.getProperty(source, path)
    : path.split(".").reduce((current, part) => current?.[part], source);
  return value === undefined ? fallback : value;
}

function isDnd5eWorld() {
  return globalThis.game?.system?.id === DND5E_SYSTEM_ID;
}

function automationOptions(options = {}) {
  return {
    ...options,
    [MODULE_ID]: {
      ...(isPlainObject(options[MODULE_ID]) ? options[MODULE_ID] : {}),
      [AUTOMATION_OPTION_KEY]: true
    }
  };
}

function isAutomationUpdate(options = {}) {
  return options?.[MODULE_ID]?.[AUTOMATION_OPTION_KEY] === true;
}

function normalizeOption(option) {
  if (typeof option === "string" || typeof option === "number") {
    const value = cleanString(option);
    return value ? { value, label: value } : null;
  }

  if (!isPlainObject(option)) {
    return null;
  }

  const value = cleanString(option.value, cleanString(option.id, cleanString(option.key, option.label)));
  if (!value) {
    return null;
  }

  return {
    ...clone(option),
    value,
    label: cleanString(option.label, cleanString(option.name, value))
  };
}

function selectedValuesFromRaw(rawConfig, optionValues, type) {
  const values = [];
  const pushValue = (value) => {
    const cleaned = cleanString(value);
    if (cleaned && optionValues.has(cleaned) && !values.includes(cleaned)) {
      values.push(cleaned);
    }
  };

  if (Array.isArray(rawConfig.selectedValues)) {
    rawConfig.selectedValues.forEach(pushValue);
  }

  pushValue(rawConfig.selectedValue);

  if (type === "single") {
    return values.slice(0, 1);
  }

  return values;
}

export function normalizeChoiceConfig(rawConfig) {
  if (!isPlainObject(rawConfig)) {
    return null;
  }

  const options = (Array.isArray(rawConfig.options) ? rawConfig.options : [])
    .map(normalizeOption)
    .filter(Boolean);
  if (!options.length) {
    return null;
  }

  const optionValues = new Set(options.map((option) => option.value));
  const requestedCount = Number(rawConfig.count ?? 1);
  const count = Math.max(1, Math.min(
    options.length,
    Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 1
  ));
  const rawType = cleanString(rawConfig.type).toLowerCase();
  const multipleTypes = new Set(["multi", "multiple", "checkbox", "checkboxes"]);
  const type = multipleTypes.has(rawType) || count > 1 ? "multiple" : "single";
  const selectedValues = selectedValuesFromRaw(rawConfig, optionValues, type).slice(0, count);

  const normalized = {
    ...clone(rawConfig),
    title: cleanString(rawConfig.title, "Выберите вариант"),
    type,
    count,
    options,
    effectChanges: clone(rawConfig.effectChanges ?? []),
    selectedValues
  };

  if (type === "single") {
    normalized.selectedValue = selectedValues[0] ?? "";
  }
  else {
    delete normalized.selectedValue;
  }

  return normalized;
}

export function getSelectedChoiceValues(rawConfig) {
  const config = normalizeChoiceConfig(rawConfig);
  if (!config) {
    return [];
  }

  return Array.isArray(config.selectedValues) ? [...config.selectedValues] : [];
}

function hasCompleteChoiceSelection(config) {
  return getSelectedChoiceValues(config).length === config.count;
}

function renderTemplate(value, option) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .replace(/\{\{\s*value\s*\}\}/gu, option.value)
    .replace(/\{\{\s*label\s*\}\}/gu, option.label);
}

function normalizeChange(change, option) {
  if (!isPlainObject(change)) {
    return null;
  }

  const key = cleanString(renderTemplate(change.key, option));
  if (!key) {
    return null;
  }

  const mode = Number(change.mode ?? EFFECT_MODE_ADD);
  return {
    key,
    mode: Number.isFinite(mode) ? mode : EFFECT_MODE_ADD,
    value: renderTemplate(change.value ?? "", option),
    priority: change.priority ?? null
  };
}

function getRootChangesForOption(effectChanges, option) {
  if (Array.isArray(effectChanges)) {
    return effectChanges;
  }

  if (!isPlainObject(effectChanges)) {
    return [];
  }

  if (Array.isArray(effectChanges[option.value])) {
    return effectChanges[option.value];
  }

  if (Array.isArray(effectChanges.default)) {
    return effectChanges.default;
  }

  return [];
}

export function buildChoiceEffectChanges(rawConfig) {
  const config = normalizeChoiceConfig(rawConfig);
  if (!config) {
    return [];
  }

  const selectedValues = getSelectedChoiceValues(config);
  const optionByValue = new Map(config.options.map((option) => [option.value, option]));
  const changes = [];
  const signatures = new Set();

  for (const selectedValue of selectedValues) {
    const option = optionByValue.get(selectedValue);
    if (!option) {
      continue;
    }

    const sourceChanges = Array.isArray(option.effectChanges)
      ? option.effectChanges
      : getRootChangesForOption(config.effectChanges, option);

    for (const sourceChange of sourceChanges) {
      const change = normalizeChange(sourceChange, option);
      if (!change) {
        continue;
      }

      const signature = JSON.stringify(change);
      if (signatures.has(signature)) {
        continue;
      }

      signatures.add(signature);
      changes.push(change);
    }
  }

  return changes;
}

function selectedChoiceLabels(config) {
  const optionByValue = new Map(config.options.map((option) => [option.value, option]));
  return getSelectedChoiceValues(config)
    .map((value) => optionByValue.get(value)?.label ?? value)
    .filter(Boolean);
}

function renderEffectName(item, config, labels) {
  const itemName = cleanString(item?.name, "Черта");
  const selectedLabel = labels.join(", ");
  const template = cleanString(config.effectName);
  if (template) {
    return template
      .replace(/\{\{\s*item\s*\}\}/gu, itemName)
      .replace(/\{\{\s*label\s*\}\}/gu, selectedLabel)
      .replace(/\{\{\s*value\s*\}\}/gu, getSelectedChoiceValues(config).join(", "));
  }

  return selectedLabel ? `${itemName}: ${selectedLabel}` : itemName;
}

export function buildChoiceEffectData(item, rawConfig) {
  const config = normalizeChoiceConfig(rawConfig);
  if (!config) {
    return null;
  }

  const labels = selectedChoiceLabels(config);
  const selectedValues = getSelectedChoiceValues(config);
  const changes = buildChoiceEffectChanges(config);
  const description = cleanString(
    config.effectDescription,
    `Выбранный вариант: ${labels.join(", ") || selectedValues.join(", ")}.`
  );

  return {
    name: renderEffectName(item, config, labels),
    type: "base",
    img: cleanString(config.effectImg, cleanString(item?.img, "icons/svg/aura.svg")),
    system: {},
    origin: cleanString(item?.uuid),
    disabled: false,
    duration: {
      startTime: null,
      seconds: null,
      combat: null,
      rounds: null,
      turns: null,
      startRound: null,
      startTurn: null
    },
    transfer: true,
    statuses: [],
    changes,
    sort: 0,
    description: `<p>${escapeHtml(description)}</p>`,
    flags: {
      [MODULE_ID]: {
        choiceAutomation: {
          managed: true,
          selectedValue: selectedValues[0] ?? "",
          selectedValues,
          sourceFlag: `flags.${MODULE_ID}.${CHOICE_CONFIG_FLAG}`
        },
        managed: true,
        automation: "feat-choice"
      }
    }
  };
}

function getDialogRoot(html) {
  if (typeof HTMLElement !== "undefined" && html instanceof HTMLElement) {
    return html;
  }

  if (typeof HTMLElement !== "undefined" && html?.[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function getItemEffects(item) {
  if (Array.isArray(item?.effects)) {
    return item.effects;
  }

  return Array.from(item?.effects?.values?.() ?? []);
}

function readChoiceConfig(item) {
  if (!item) {
    return null;
  }

  try {
    const flagValue = item.getFlag?.(CHOICE_FLAG_SCOPE, CHOICE_CONFIG_FLAG);
    if (flagValue) {
      return flagValue;
    }
  }
  catch (_error) {
    // Fall through to direct access for stale or unregistered flag scopes.
  }

  return getProperty(item, `flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}`, null);
}

function readManagedChoiceEffectFlag(effect) {
  try {
    const flagValue = effect?.getFlag?.(CHOICE_FLAG_SCOPE, "choiceAutomation");
    if (flagValue) {
      return flagValue;
    }
  }
  catch (_error) {
    // Fall through to direct access for plain source objects.
  }

  return getProperty(effect, `flags.${CHOICE_FLAG_SCOPE}.choiceAutomation`, null);
}

function isManagedChoiceEffect(effect) {
  return readManagedChoiceEffectFlag(effect)?.managed === true;
}

function isActorOwnedItem(item) {
  const parent = item?.parent ?? item?.actor ?? null;
  if (!parent) {
    return false;
  }

  if (typeof Actor !== "undefined" && parent instanceof Actor) {
    return true;
  }

  return parent.documentName === "Actor" || parent.constructor?.name === "Actor";
}

function isCurrentUserHook(userId) {
  const currentUserId = cleanString(globalThis.game?.user?.id);
  const hookUserId = cleanString(userId);
  return !hookUserId || !currentUserId || hookUserId === currentUserId;
}

export class FeatChoiceAutomationService {
  constructor(moduleApi = null) {
    this.moduleApi = moduleApi;
  }

  async handleItemCreated(item, options = {}, userId = "") {
    if (!this.#shouldHandleHookItem(item, options, userId)) {
      return false;
    }

    return this.configureItemChoice(item, { promptIfMissing: true });
  }

  async handleItemUpdated(item, _changed = {}, options = {}, userId = "") {
    if (!this.#shouldHandleHookItem(item, options, userId)) {
      return false;
    }

    return this.configureItemChoice(item, { promptIfMissing: true });
  }

  async handleItemDeleted(item, _options = {}, _userId = "") {
    return Boolean(readChoiceConfig(item));
  }

  async configureItemChoice(item, { promptIfMissing = false } = {}) {
    const config = normalizeChoiceConfig(readChoiceConfig(item));
    if (!config) {
      return false;
    }

    if (!hasCompleteChoiceSelection(config)) {
      await this.#deleteManagedChoiceEffects(item);
      if (!promptIfMissing) {
        return false;
      }

      const selectedValues = await this.#promptForSelection(item, config);
      if (!selectedValues.length) {
        return false;
      }

      const updatedItem = await this.#saveSelection(item, config, selectedValues);
      return this.configureItemChoice(updatedItem ?? item, { promptIfMissing: false });
    }

    return this.#upsertManagedChoiceEffect(item, config);
  }

  #shouldHandleHookItem(item, options, userId) {
    if (isAutomationUpdate(options) || !isDnd5eWorld() || !isCurrentUserHook(userId)) {
      return false;
    }

    if (!isActorOwnedItem(item) || item?.type !== "feat" || !readChoiceConfig(item)) {
      return false;
    }

    return this.#canConfigure(item);
  }

  #canConfigure(item) {
    return Boolean(globalThis.game?.user?.isGM || item?.isOwner || item?.parent?.isOwner);
  }

  async #saveSelection(item, config, selectedValues) {
    const updates = {};
    if (config.type === "single") {
      updates[`flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}.selectedValue`] = selectedValues[0] ?? "";
      updates[`flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}.selectedValues`] = null;
    }
    else {
      updates[`flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}.selectedValue`] = null;
      updates[`flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}.selectedValues`] = selectedValues;
    }

    return item.update(updates, automationOptions());
  }

  async #upsertManagedChoiceEffect(item, config) {
    const effectData = buildChoiceEffectData(item, config);
    if (!effectData?.changes?.length) {
      globalThis.ui?.notifications?.warn?.(`${item.name}: не настроены Active Effect changes для выбранного варианта.`);
      await this.#deleteManagedChoiceEffects(item);
      return false;
    }

    const existingEffect = getItemEffects(item).find(isManagedChoiceEffect) ?? null;
    if (existingEffect) {
      const effectId = existingEffect.id ?? existingEffect._id;
      await item.updateEmbeddedDocuments(
        "ActiveEffect",
        [{ _id: effectId, ...effectData }],
        automationOptions()
      );
      return true;
    }

    await item.createEmbeddedDocuments("ActiveEffect", [effectData], automationOptions());
    return true;
  }

  async #deleteManagedChoiceEffects(item) {
    const effectIds = getItemEffects(item)
      .filter(isManagedChoiceEffect)
      .map((effect) => effect.id ?? effect._id)
      .filter(Boolean);
    if (!effectIds.length) {
      return false;
    }

    await item.deleteEmbeddedDocuments("ActiveEffect", effectIds, automationOptions());
    return true;
  }

  async #promptForSelection(item, config) {
    if (!this.#canConfigure(item) || typeof Dialog !== "function") {
      return [];
    }

    return new Promise((resolve) => {
      let settled = false;
      const selected = new Set(getSelectedChoiceValues(config));
      const content = config.type === "multiple"
        ? this.#buildMultipleChoiceContent(config, selected)
        : this.#buildSingleChoiceContent(config, selected);

      const dialog = new Dialog({
        title: config.title,
        content,
        buttons: {
          confirm: {
            label: "Применить",
            callback: (html) => {
              const root = getDialogRoot(html);
              const selectedValues = config.type === "multiple"
                ? Array.from(root?.querySelectorAll("[data-choice-value]:checked") ?? []).map((input) => input.value)
                : [cleanString(root?.querySelector("[data-choice-value]")?.value)];
              const normalizedValues = selectedValues
                .map(cleanString)
                .filter(Boolean);

              if (normalizedValues.length !== config.count) {
                globalThis.ui?.notifications?.warn?.(`Выберите вариантов: ${config.count}.`);
                return false;
              }

              settled = true;
              resolve(normalizedValues);
              return true;
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve([]);
            }
          }
        },
        default: "confirm",
        close: () => {
          if (!settled) {
            resolve([]);
          }
        }
      });

      dialog.render(true);
    });
  }

  #buildSingleChoiceContent(config, selected) {
    const options = config.options.map((option) => `
      <option value="${escapeHtml(option.value)}" ${selected.has(option.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>
    `).join("");

    return `
      <form>
        <p>${escapeHtml(config.prompt ?? "Выберите вариант для этой черты.")}</p>
        <div class="form-group">
          <label>${escapeHtml(config.title)}</label>
          <select data-choice-value>${options}</select>
        </div>
      </form>
    `;
  }

  #buildMultipleChoiceContent(config, selected) {
    const options = config.options.map((option) => `
      <label class="checkbox">
        <input type="checkbox" data-choice-value value="${escapeHtml(option.value)}" ${selected.has(option.value) ? "checked" : ""}>
        ${escapeHtml(option.label)}
      </label>
    `).join("");

    return `
      <form>
        <p>${escapeHtml(config.prompt ?? `Выберите вариантов: ${config.count}.`)}</p>
        <div class="form-group stacked">${options}</div>
      </form>
    `;
  }
}

export function registerFeatChoiceAutomationHooks(moduleApi) {
  if (!isDnd5eWorld()) {
    return;
  }

  if (game[HOOKS_REGISTERED_KEY]) {
    return;
  }
  game[HOOKS_REGISTERED_KEY] = true;

  const service = moduleApi?.featChoiceAutomationService ?? new FeatChoiceAutomationService(moduleApi);

  Hooks.on("createItem", (item, options, userId) => {
    service.handleItemCreated(item, options, userId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to configure feat choice on item creation.`, error);
    });
  });

  Hooks.on("updateItem", (item, changed, options, userId) => {
    service.handleItemUpdated(item, changed, options, userId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to configure feat choice on item update.`, error);
    });
  });

  Hooks.on("deleteItem", (item, options, userId) => {
    service.handleItemDeleted(item, options, userId).catch((error) => {
      console.error(`${MODULE_ID} | Failed to handle feat choice item deletion.`, error);
    });
  });
}
