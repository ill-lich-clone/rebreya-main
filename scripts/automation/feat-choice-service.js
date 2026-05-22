import { MODULE_ID } from "../constants.js";

export const CHOICE_FLAG_SCOPE = MODULE_ID;
export const CHOICE_CONFIG_FLAG = "choiceConfig";

const HOOKS_REGISTERED_KEY = `${MODULE_ID}.featChoiceAutomationHooksRegistered`;
const AUTOMATION_OPTION_KEY = "featChoiceAutomation";
const DND5E_SYSTEM_ID = "dnd5e";
const DEFAULT_ADVANCEMENT_LEVEL = 0;
const LEGACY_COMPENDIUM_ITEM_UUID_PATTERN = /^Compendium\.([^.]+)\.([^.]+)\.([A-Za-z0-9]{16})$/u;

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function normalizeCompendiumItemUuid(value) {
  const uuid = cleanString(value);
  const match = uuid.match(LEGACY_COMPENDIUM_ITEM_UUID_PATTERN);
  if (!match) {
    return uuid;
  }

  return `Compendium.${match[1]}.${match[2]}.Item.${match[3]}`;
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

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty
    ? foundry.utils.getProperty(source, path)
    : path.split(".").reduce((current, part) => current?.[part], source);
  return value === undefined ? fallback : value;
}

function deterministicId(value) {
  const text = cleanString(value, "feat-choice");
  let hashA = 0x811c9dc5;
  let hashB = 0x45d9f3b;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB + code, 0x27d4eb2d) >>> 0;
  }

  return `${hashA.toString(16).padStart(8, "0")}${hashB.toString(16).padStart(8, "0")}`.slice(0, 16);
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

function firstDefined(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }

  return Math.floor(number);
}

function toLevel(value, fallback = DEFAULT_ADVANCEMENT_LEVEL) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function clampChoiceCount(value, optionCount) {
  return Math.max(1, Math.min(optionCount, value));
}

function normalizeChoiceBounds(rawConfig, optionCount) {
  const minRaw = firstDefined(rawConfig, ["minCount", "min", "minimum", "minChoices"]);
  const maxRaw = firstDefined(rawConfig, ["maxCount", "max", "maximum", "maxChoices"]);
  const hasRange = minRaw !== undefined || maxRaw !== undefined;
  const exactCount = toPositiveInteger(rawConfig.count, 1);

  if (!hasRange) {
    const count = clampChoiceCount(exactCount, optionCount);
    return { count, minCount: count, maxCount: count };
  }

  const minCount = clampChoiceCount(toPositiveInteger(minRaw, 1), optionCount);
  const maxFallback = rawConfig.count === undefined ? optionCount : exactCount;
  const rawMaxCount = clampChoiceCount(toPositiveInteger(maxRaw, maxFallback), optionCount);
  const maxCount = Math.max(minCount, rawMaxCount);

  return { count: maxCount, minCount, maxCount };
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
    label: cleanString(option.label, cleanString(option.name, value)),
    summary: cleanString(option.summary, cleanString(option.subtitle)),
    description: cleanString(option.description, cleanString(option.text, cleanString(option.hint))),
    uuid: normalizeCompendiumItemUuid(cleanString(option.uuid, cleanString(option.itemUuid, cleanString(option.sourceUuid))))
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
  const { count, minCount, maxCount } = normalizeChoiceBounds(rawConfig, options.length);
  const rawType = cleanString(rawConfig.type).toLowerCase();
  const multipleTypes = new Set(["multi", "multiple", "checkbox", "checkboxes"]);
  const type = multipleTypes.has(rawType) || maxCount > 1 ? "multiple" : "single";
  const selectedValues = selectedValuesFromRaw(rawConfig, optionValues, type);

  const normalized = {
    ...clone(rawConfig),
    title: cleanString(rawConfig.title, "Choose option"),
    type,
    count,
    minCount,
    maxCount,
    advancementLevel: toLevel(firstDefined(rawConfig, ["advancementLevel", "level"])),
    options,
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

function optionUuids(config) {
  return config.options
    .map((option) => cleanString(option.uuid))
    .filter(Boolean);
}

export function buildItemChoiceAdvancementData({ identifier = "feat-choice", choiceConfig, level = undefined } = {}) {
  const config = normalizeChoiceConfig(choiceConfig);
  if (!config) {
    return null;
  }

  const pool = optionUuids(config).map((uuid) => ({ uuid }));
  if (!pool.length) {
    return null;
  }

  const advancementLevel = toLevel(level, config.advancementLevel);
  const advancementId = cleanString(
    config.advancementId,
    deterministicId(`${identifier}:${config.title}:item-choice`)
  );
  const itemType = cleanString(config.itemType, "feat");

  return {
    _id: advancementId,
    type: "ItemChoice",
    title: config.title,
    hint: cleanString(config.prompt, cleanString(config.hint)),
    configuration: {
      allowDrops: config.allowDrops === true,
      choices: {
        [String(advancementLevel)]: {
          count: config.count,
          replacement: config.replacement === true
        }
      },
      pool,
      restriction: {
        level: cleanString(config.restriction?.level),
        list: Array.isArray(config.restriction?.list) ? [...config.restriction.list] : [],
        subtype: cleanString(config.restriction?.subtype),
        type: cleanString(config.restriction?.type)
      },
      spell: null,
      type: itemType
    },
    value: {
      added: {},
      replaced: {}
    },
    flags: {
      [MODULE_ID]: {
        choiceAutomation: {
          managed: true,
          minCount: config.minCount,
          maxCount: config.maxCount,
          sourceFlag: `flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}`
        }
      }
    }
  };
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

function getAdvancements(item) {
  const advancement = item?.system?.advancement;
  if (Array.isArray(advancement)) {
    return advancement;
  }

  if (isPlainObject(advancement)) {
    return Object.values(advancement).filter(isPlainObject);
  }

  return [];
}

function getAdvancementLevel(advancement, config) {
  const choices = advancement?.configuration?.choices;
  const firstLevel = isPlainObject(choices) ? Object.keys(choices)[0] : null;
  return toLevel(firstLevel, config.advancementLevel);
}

function hasManagedChoiceFlag(advancement) {
  return getProperty(advancement, `flags.${MODULE_ID}.choiceAutomation.managed`) === true;
}

function sameUuidList(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function advancementPoolUuids(advancement) {
  return (Array.isArray(advancement?.configuration?.pool) ? advancement.configuration.pool : [])
    .map((entry) => cleanString(entry?.uuid))
    .filter(Boolean);
}

function isChoiceAdvancementCandidate(advancement, config) {
  if (advancement?.type !== "ItemChoice") {
    return false;
  }

  if (hasManagedChoiceFlag(advancement)) {
    return true;
  }

  if (cleanString(advancement.title) === config.title) {
    return true;
  }

  const expected = optionUuids(config);
  const actual = advancementPoolUuids(advancement);
  return expected.length > 0 && sameUuidList(actual, expected);
}

function findChoiceAdvancement(item, config) {
  return getAdvancements(item).find((advancement) => isChoiceAdvancementCandidate(advancement, config)) ?? null;
}

function advancementMatchesChoiceConfig(advancement, desired, config) {
  if (!advancement || !desired) {
    return false;
  }

  const level = getAdvancementLevel(desired, config);
  const actualChoices = advancement.configuration?.choices?.[level]
    ?? advancement.configuration?.choices?.[String(level)]
    ?? null;
  const desiredChoices = desired.configuration.choices[String(level)];

  return advancement.type === desired.type
    && advancement.configuration?.type === desired.configuration.type
    && advancement.configuration?.allowDrops === desired.configuration.allowDrops
    && actualChoices?.count === desiredChoices.count
    && actualChoices?.replacement === desiredChoices.replacement
    && sameUuidList(advancementPoolUuids(advancement), advancementPoolUuids(desired));
}

function getSelectedUuidsFromAdvancement(advancement, level) {
  const added = advancement?.value?.added?.[level]
    ?? advancement?.value?.added?.[String(level)]
    ?? null;

  if (Array.isArray(added)) {
    return added.map(cleanString).filter(Boolean);
  }

  if (isPlainObject(added)) {
    return Object.values(added).map(cleanString).filter(Boolean);
  }

  return [];
}

function selectedValuesFromAdvancement(config, advancement) {
  const level = getAdvancementLevel(advancement, config);
  const selectedUuids = new Set(getSelectedUuidsFromAdvancement(advancement, level));
  if (!selectedUuids.size) {
    return [];
  }

  return config.options
    .filter((option) => selectedUuids.has(cleanString(option.uuid)))
    .map((option) => option.value);
}

function isChoiceSelectionComplete(item, config) {
  const advancement = findChoiceAdvancement(item, config);
  if (!advancement) {
    return false;
  }

  const selectedCount = selectedValuesFromAdvancement(config, advancement).length;
  return selectedCount >= config.minCount && selectedCount <= config.maxCount;
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

function getActorFromItem(item) {
  return item?.parent ?? item?.actor ?? null;
}

function getAdvancementManagerClass() {
  return globalThis.dnd5e?.applications?.advancement?.AdvancementManager ?? null;
}

function renderAdvancementManager(manager) {
  if (!manager?.render) {
    return false;
  }

  try {
    manager.render(true);
  }
  catch (_error) {
    manager.render(true, { force: true });
  }

  return true;
}

function collectionValues(collection) {
  if (Array.isArray(collection)) {
    return collection;
  }

  if (typeof collection?.values === "function") {
    return Array.from(collection.values());
  }

  if (isPlainObject(collection)) {
    return Object.values(collection);
  }

  return [];
}

function dnd5eFlag(document, key) {
  try {
    const flagValue = document?.getFlag?.("dnd5e", key);
    if (flagValue !== undefined) {
      return flagValue;
    }
  }
  catch (_error) {
    // Fall through to source flags for plain objects.
  }

  return getProperty(document, `flags.dnd5e.${key}`, "");
}

function isAdvancementChildOf(item, parentItem) {
  const itemId = cleanString(item?.id, item?._id);
  const parentId = cleanString(parentItem?.id, parentItem?._id);
  if (!itemId || !parentId || itemId === parentId) {
    return false;
  }

  const origin = cleanString(dnd5eFlag(item, "advancementOrigin"));
  const root = cleanString(dnd5eFlag(item, "advancementRoot"));
  return origin === parentId
    || origin.startsWith(`${parentId}.`)
    || root === parentId
    || root.startsWith(`${parentId}.`);
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

  async handleItemDeleted(item, options = {}, userId = "") {
    if (isAutomationUpdate(options) || !isDnd5eWorld() || !isCurrentUserHook(userId)) {
      return false;
    }

    return this.#deleteAdvancementChildItems(item);
  }

  async configureItemChoice(item, { promptIfMissing = false } = {}) {
    const config = normalizeChoiceConfig(readChoiceConfig(item));
    if (!config) {
      return false;
    }

    const configuredItem = await this.#ensureItemChoiceAdvancement(item, config);
    const activeItem = configuredItem ?? item;
    const advancement = findChoiceAdvancement(activeItem, config);
    const selectedValues = advancement ? selectedValuesFromAdvancement(config, advancement) : [];
    await this.#mirrorSelectionFlags(activeItem, config, selectedValues);

    if (isChoiceSelectionComplete(activeItem, config)) {
      return false;
    }

    if (!promptIfMissing) {
      return false;
    }

    return this.#openNativeAdvancement(activeItem, config);
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

  async #ensureItemChoiceAdvancement(item, config) {
    const desired = buildItemChoiceAdvancementData({
      identifier: item?.system?.identifier ?? item?.id ?? item?.name,
      choiceConfig: config
    });
    if (!desired) {
      return item;
    }

    const advancements = getAdvancements(item).map(clone);
    const existingIndex = advancements.findIndex((advancement) => isChoiceAdvancementCandidate(advancement, config));
    if (existingIndex >= 0 && advancementMatchesChoiceConfig(advancements[existingIndex], desired, config)) {
      return item;
    }

    if (existingIndex >= 0) {
      const existing = advancements[existingIndex];
      advancements[existingIndex] = {
        ...desired,
        _id: cleanString(existing._id, desired._id),
        value: isPlainObject(existing.value) ? clone(existing.value) : desired.value
      };
    }
    else {
      advancements.push(desired);
    }

    if (typeof item?.update !== "function") {
      return item;
    }

    return item.update({ "system.advancement": advancements }, automationOptions());
  }

  async #mirrorSelectionFlags(item, config, selectedValues) {
    if (typeof item?.update !== "function") {
      return false;
    }

    const current = getSelectedChoiceValues(readChoiceConfig(item));
    if (sameUuidList(current, selectedValues)) {
      return false;
    }

    const updates = {};
    if (config.type === "single") {
      updates[`flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}.selectedValue`] = selectedValues[0] ?? "";
      updates[`flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}.selectedValues`] = null;
    }
    else {
      updates[`flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}.selectedValue`] = null;
      updates[`flags.${CHOICE_FLAG_SCOPE}.${CHOICE_CONFIG_FLAG}.selectedValues`] = selectedValues;
    }

    await item.update(updates, automationOptions());
    return true;
  }

  #openNativeAdvancement(item, config) {
    if (globalThis.game?.settings?.get?.("dnd5e", "disableAdvancements")) {
      globalThis.ui?.notifications?.warn?.(`${item.name}: dnd5e advancements are disabled.`);
      return false;
    }

    const actor = getActorFromItem(item);
    const AdvancementManager = getAdvancementManagerClass();
    const level = getAdvancementLevel(findChoiceAdvancement(item, config), config);
    const manager = AdvancementManager?.forModifyChoices?.(actor, item.id ?? item._id, level);
    if (!manager?.steps?.length) {
      return false;
    }

    return renderAdvancementManager(manager);
  }

  async #deleteAdvancementChildItems(item) {
    const actor = getActorFromItem(item);
    if (!actor?.deleteEmbeddedDocuments) {
      return false;
    }

    const childItemIds = collectionValues(actor.items)
      .filter((candidate) => isAdvancementChildOf(candidate, item))
      .map((candidate) => candidate.id ?? candidate._id)
      .filter(Boolean);
    if (!childItemIds.length) {
      return false;
    }

    await actor.deleteEmbeddedDocuments("Item", childItemIds, automationOptions());
    return true;
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
