import { MODULE_ID } from "../constants.js";

export const ELEMENTAL_ADEPT_IDENTIFIER = "stihiynyy-adept";
export const ELEMENTAL_ADEPT_FLAG_KEY = "elementalAdept";
export const ELEMENTAL_ADEPT_FLAG_PATH = `flags.${MODULE_ID}.${ELEMENTAL_ADEPT_FLAG_KEY}`;
export const ELEMENTAL_ADEPT_DAMAGE_TYPES = Object.freeze(["acid", "cold", "fire", "lightning", "thunder"]);
export const ELEMENTAL_ADEPT_CHOICES = Object.freeze([
  { value: "acid", label: "Кислота" },
  { value: "cold", label: "Холод" },
  { value: "fire", label: "Огонь" },
  { value: "lightning", label: "Молния" },
  { value: "thunder", label: "Гром" },
]);

const ELEMENTAL_ADEPT_DAMAGE_TYPE_SET = new Set(ELEMENTAL_ADEPT_DAMAGE_TYPES);
const ELEMENTAL_ADEPT_MIDI_DAMAGE_MARKER = Symbol("elementalAdeptMidiDamageHandled");

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty
    ? globalThis.foundry.utils.getProperty(source, path)
    : String(path).split(".").reduce((current, key) => current?.[key], source);
  return value === undefined ? fallback : value;
}

export function normalizeCollection(collection) {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }
  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }
  return [];
}

export function getElementalAdeptActor(item) {
  return item?.parent ?? item?.actor ?? null;
}

export function isElementalAdeptItem(item) {
  const actor = getElementalAdeptActor(item);
  return Boolean(
    item
    && !item.pack
    && actor?.type === "character"
    && item.type === "feat"
    && cleanString(item.system?.identifier).toLowerCase() === ELEMENTAL_ADEPT_IDENTIFIER,
  );
}

export function getConfiguredElementalAdeptType(item) {
  const configured = typeof item?.getFlag === "function"
    ? item.getFlag(MODULE_ID, ELEMENTAL_ADEPT_FLAG_KEY)
    : getProperty(item, ELEMENTAL_ADEPT_FLAG_PATH);
  const type = cleanString(configured).toLowerCase();
  return ELEMENTAL_ADEPT_DAMAGE_TYPE_SET.has(type) ? type : "";
}

export function getConfiguredElementalAdeptTypes(actor, { excludeItem = null } = {}) {
  return Array.from(new Set(
    normalizeCollection(actor?.items)
      .filter((item) => item !== excludeItem && isElementalAdeptItem(item))
      .map(getConfiguredElementalAdeptType)
      .filter(Boolean),
  ));
}

export function getAvailableElementalAdeptChoices(actor, item = null) {
  const configured = new Set(getConfiguredElementalAdeptTypes(actor, { excludeItem: item }));
  return ELEMENTAL_ADEPT_CHOICES.filter((choice) => !configured.has(choice.value));
}

export function normalizeElementalAdeptDamageType(value) {
  const candidate = cleanString(typeof value === "object" ? value?.type ?? value?.damageType ?? value?.value : value).toLowerCase();
  return ELEMENTAL_ADEPT_DAMAGE_TYPE_SET.has(candidate) ? candidate : "";
}

export function normalizeElementalAdeptDamageTypes(value) {
  const values = Array.isArray(value) ? value : normalizeCollection(value);
  return Array.from(new Set(values.map(normalizeElementalAdeptDamageType).filter(Boolean)));
}

export function normalizeElementalAdeptSpellSubject(subject) {
  const item = subject?.item ?? subject?.activity?.item ?? subject?.spell ?? subject ?? null;
  return item?.type === "spell" ? item : null;
}

function elementalAdeptActorFromSubject(subject) {
  const activity = subject?.activity ?? subject ?? null;
  const item = activity?.item ?? activity?.spell ?? null;
  return activity?.actor
    ?? subject?.actor
    ?? (activity?.parent?.type === "character" ? activity.parent : null)
    ?? getElementalAdeptActor(item)
    ?? getElementalAdeptActor(activity?.parent)
    ?? null;
}

function elementalAdeptSpellProperty(value) {
  const properties = value instanceof Set
    ? Array.from(value)
    : Array.isArray(value)
      ? value
      : normalizeCollection(value);
  return properties.some((property) => cleanString(
    typeof property === "object" ? property?.id ?? property?.key ?? property?.value : property,
  ).toLowerCase() === "spell");
}

function hasElementalAdeptSpellEvidence(activity, roll) {
  const item = activity?.item ?? activity?.spell ?? null;
  if (activity?.type === "spell" || item?.type === "spell") {
    return true;
  }
  return [activity, item, roll?.options, roll].some((source) => (
    source?.isSpell === true
    || source?.spell === true
    || source?.isSpellDamage === true
    || source?.spellDamage === true
    || getProperty(source, "flags.dnd5e.spell") === true
    || getProperty(source, "flags.dnd5e.spellDamage") === true
    || elementalAdeptSpellProperty(source?.properties)
    || elementalAdeptSpellProperty(source?.system?.properties)
  ));
}

function elementalAdeptRollDamageTypes(roll) {
  const options = roll?.options ?? {};
  const values = [options.type, ...(typeof options.types === "string" ? [options.types] : normalizeCollection(options.types))];
  return new Set(values.map(normalizeElementalAdeptDamageType).filter(Boolean));
}

function elementalAdeptDamageDescriptionTypes(damage) {
  const types = [damage?.type, damage?.damageType, ...normalizeCollection(damage?.types)];
  return new Set(types.map(normalizeElementalAdeptDamageType).filter(Boolean));
}

function elementalAdeptDamageIsSpell(damage) {
  return hasElementalAdeptSpellEvidence(damage?.activity ?? damage?.subject ?? damage, damage);
}

function elementalAdeptActorDocument(document) {
  const candidates = [
    document,
    document?.actor,
    document?.parent,
    document?.parent?.actor,
  ];
  return candidates.find((candidate) => candidate?.type === "character") ?? null;
}

function elementalAdeptSameActor(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const leftUuid = cleanString(left.uuid);
  const rightUuid = cleanString(right.uuid);
  if (leftUuid && rightUuid) {
    return leftUuid === rightUuid;
  }
  const leftId = cleanString(left.id ?? left._id);
  const rightId = cleanString(right.id ?? right._id);
  return Boolean(leftId && rightId && leftId === rightId);
}

function elementalAdeptMergeIgnoredDamageTypes(options, key, types) {
  if (!options || typeof options !== "object" || options.ignore === true) {
    return false;
  }
  if (!options.ignore || typeof options.ignore !== "object" || Array.isArray(options.ignore)) {
    options.ignore = {};
  }
  const current = options.ignore[key];
  if (current === true) {
    return false;
  }
  const ignored = current instanceof Set
    ? current
    : new Set(current === false || current === undefined || current === null ? [] : normalizeCollection(current));
  let changed = false;
  for (const type of types) {
    if (!ignored.has(type)) {
      ignored.add(type);
      changed = true;
    }
  }
  if (current !== ignored) {
    options.ignore[key] = ignored;
    changed = true;
  }
  return changed;
}

function isElementalAdeptDieTerm(term) {
  const DiceTerm = globalThis.DiceTerm ?? globalThis.foundry?.dice?.terms?.DiceTerm ?? null;
  if (typeof DiceTerm === "function" && term instanceof DiceTerm) {
    return true;
  }
  const kind = cleanString(term?.class ?? term?.constructor?.name).toLowerCase();
  return kind === "die" || kind === "dieterm" || (Array.isArray(term?.results) && term?.faces !== undefined);
}

function elementalAdeptDiceForRoll(roll, seen = new Set(), dice = []) {
  const collect = (terms) => {
    for (const term of normalizeCollection(terms)) {
      if (!term || typeof term !== "object" || seen.has(term)) {
        continue;
      }
      seen.add(term);
      if (isElementalAdeptDieTerm(term)) {
        dice.push(term);
      }
      collect(term.terms);
      collect(term.dice);
    }
  };
  collect(roll?.dice);
  collect(roll?.terms);
  return dice;
}

function elementalAdeptNestedRolls(terms, seen = new Set(), nested = []) {
  for (const term of normalizeCollection(terms)) {
    if (!term || typeof term !== "object" || seen.has(term)) {
      continue;
    }
    seen.add(term);
    if (term.roll && typeof term.roll === "object") {
      nested.push(term.roll);
    }
    for (const nestedRoll of normalizeCollection(term.rolls)) {
      if (nestedRoll && typeof nestedRoll === "object") {
        nested.push(nestedRoll);
      }
    }
    elementalAdeptNestedRolls(term.terms, seen, nested);
    elementalAdeptNestedRolls(term.dice, seen, nested);
  }
  return nested;
}

function adjustElementalAdeptRoll(roll, seen = new Set()) {
  if (!roll || typeof roll !== "object" || seen.has(roll)) {
    return false;
  }
  seen.add(roll);
  let changed = false;
  for (const nestedRoll of elementalAdeptNestedRolls(roll.terms)) {
    changed = adjustElementalAdeptRoll(nestedRoll, seen) || changed;
  }
  for (const die of elementalAdeptDiceForRoll(roll)) {
    for (const result of die.results) {
      if (
        result?.active === true
        && result?.rerolled !== true
        && result?.discarded !== true
        && (result.result === 1 || result.result === 2)
      ) {
        result.result = 3;
        changed = true;
      }
    }
  }
  if (changed && typeof roll._evaluateTotal === "function") {
    roll._total = roll._evaluateTotal();
  }
  return changed;
}

function isCurrentUserHook(userId) {
  const currentUserId = cleanString(globalThis.game?.user?.id);
  const hookUserId = cleanString(userId);
  return !hookUserId || !currentUserId || hookUserId === currentUserId;
}

function actorOwnerLevel() {
  return Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
}

function userOwnsActor(actor, user) {
  if (!actor || !user?.id) {
    return false;
  }
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true;
  }
  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? ownership.default ?? 0) >= actorOwnerLevel();
}

function hasActivePlayerOwner(actor) {
  return normalizeCollection(globalThis.game?.users)
    .some((user) => user?.isGM !== true && user?.active !== false && userOwnsActor(actor, user));
}

export function canPromptForElementalAdeptActor(actor) {
  const currentUser = globalThis.game?.user;
  if (!currentUser) {
    return actor?.isOwner === true;
  }
  if (currentUser.isGM === true) {
    return !hasActivePlayerOwner(actor);
  }
  return actor?.isOwner === true || userOwnsActor(actor, currentUser);
}

export function shouldSkipElementalAdeptAutomation(options = {}) {
  return options?.[MODULE_ID]?.skipElementalAdeptAutomation === true
    || options?.skipElementalAdeptAutomation === true;
}

function elementalAdeptItemKey(item) {
  return cleanString(item?.uuid ?? item?.id ?? item?._id);
}

function elementalAdeptSubtype(item) {
  return cleanString(getProperty(item, "system.type.subtype"));
}

function hasElementalAdeptAcquisitionSubtype(item) {
  return ["general", "minor"].includes(elementalAdeptSubtype(item));
}

function elementalAdeptUpdateOptions() {
  return {
    [MODULE_ID]: { skipElementalAdeptAutomation: true },
    skipElementalAdeptAutomation: true,
  };
}

function escapeHtml(value) {
  if (typeof globalThis.foundry?.utils?.escapeHTML === "function") {
    return globalThis.foundry.utils.escapeHTML(String(value ?? ""));
  }
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

export async function promptElementalAdeptChoice({ item, choices = [] } = {}) {
  if (!choices.length) {
    return null;
  }
  if (typeof globalThis.Dialog !== "function") {
    globalThis.ui?.notifications?.warn?.("Невозможно выбрать тип урона: диалог Foundry недоступен.");
    return null;
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const options = choices
      .map((choice) => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`)
      .join("");
    const dialog = new globalThis.Dialog({
      title: item?.name ?? "Стихийный адепт",
      content: `<form><div class="form-group"><label>Тип урона</label><select name="elementalAdeptType">${options}</select></div></form>`,
      buttons: {
        apply: {
          label: "Выбрать",
          callback: (html) => {
            const root = html?.[0] ?? html;
            done(cleanString(root?.querySelector?.("[name='elementalAdeptType']")?.value));
          },
        },
        cancel: { label: "Отмена", callback: () => done(null) },
      },
      default: "apply",
      close: () => done(null),
    });
    dialog.render(true);
  });
}

export class ElementalAdeptAutomationService {
  constructor(moduleApi = null, options = {}) {
    if (moduleApi && typeof moduleApi.prompt === "function" && !Object.keys(options).length) {
      options = moduleApi;
      moduleApi = null;
    }
    this.moduleApi = moduleApi;
    this._prompt = typeof options.prompt === "function" ? options.prompt : promptElementalAdeptChoice;
    this._pendingItems = new Set();
    this._actorPromises = new Map();
    this._messagePromises = new Map();
    this._messageRollStates = new Map();
    this._fromUuid = options.fromUuid ?? options.uuidResolver ?? globalThis.fromUuid ?? globalThis.fromUuidSync;
    this._midiDamageOptions = new WeakSet();
  }

  async handleCreatedItem(item, options = {}, userId = "") {
    if (!isCurrentUserHook(userId) || shouldSkipElementalAdeptAutomation(options) || !isElementalAdeptItem(item)) {
      return false;
    }
    return this.#enqueueActor(getElementalAdeptActor(item), () => this.#configureItem(item, { allowDeletion: true }));
  }

  async handleUpdatedItem(item, _changed = {}, options = {}, userId = "") {
    if (shouldSkipElementalAdeptAutomation(options)) {
      return false;
    }
    if (!isCurrentUserHook(userId) || !isElementalAdeptItem(item)) {
      return false;
    }
    return this.#enqueueActor(getElementalAdeptActor(item), () => this.#configureItem(item));
  }

  async repairActor(actor) {
    if (actor?.type !== "character" || !canPromptForElementalAdeptActor(actor)) {
      return false;
    }
    return this.#enqueueActor(actor, async () => {
      let changed = false;
      for (const item of normalizeCollection(actor.items)) {
        if (isElementalAdeptItem(item) && !getConfiguredElementalAdeptType(item)) {
          changed = (await this.#configureItem(item)) || changed;
        }
      }
      return changed;
    });
  }

  async applyDnd5ePostDamageRoll(rolls = [], context = {}) {
    const safeRolls = (Array.isArray(rolls) ? rolls : [rolls]).filter(Boolean);
    const activity = context?.subject?.activity ?? context?.subject ?? null;
    const actor = elementalAdeptActorFromSubject(context?.subject);
    const configuredTypes = new Set(getConfiguredElementalAdeptTypes(actor));
    if (!configuredTypes.size) {
      return false;
    }

    const changedRolls = new Set();
    for (const roll of safeRolls) {
      const rollTypes = elementalAdeptRollDamageTypes(roll);
      if (!hasElementalAdeptSpellEvidence(activity, roll) || !Array.from(rollTypes).some((type) => configuredTypes.has(type))) {
        continue;
      }
      const changed = adjustElementalAdeptRoll(roll);
      if (changed) {
        changedRolls.add(roll);
      }
    }

    const changedRollsByMessage = new Map();
    for (const [position, roll] of safeRolls.entries()) {
      if (!changedRolls.has(roll)) {
        continue;
      }
      const message = roll.parent;
      if (typeof message?.update !== "function") {
        continue;
      }
      const messageUpdate = changedRollsByMessage.get(message) ?? { replacements: [], safeRolls };
      messageUpdate.replacements.push({ position, roll });
      changedRollsByMessage.set(message, messageUpdate);
    }
    await Promise.all(Array.from(changedRollsByMessage, ([message, update]) => this.#enqueueMessageUpdate(
      message,
      update.replacements,
      update.safeRolls,
    )));
    return changedRolls.size > 0;
  }

  async applyMidiPreCalculateDamage(actor, damages = [], options = {}) {
    this.#markMidiDamageOptions(options);
    return this.#applyPreCalculateDamage(actor, damages, options, { absorption: true });
  }

  async applyDnd5ePreCalculateDamage(actor, damages = [], options = {}) {
    if (this.#hasMidiDamageMarker(options)) {
      return false;
    }
    return this.#applyPreCalculateDamage(actor, damages, options, { absorption: false });
  }

  #actorKey(actor) {
    return cleanString(actor?.uuid ?? actor?.id ?? actor?._id) || actor;
  }

  async #applyPreCalculateDamage(actor, damages, options, { absorption }) {
    try {
      const sourceActor = await this.#resolveDamageSourceActor(actor, options);
      const selectedTypes = new Set(getConfiguredElementalAdeptTypes(sourceActor));
      if (!selectedTypes.size) {
        return false;
      }
      const matchingTypes = new Set();
      for (const damage of normalizeCollection(damages)) {
        if (!elementalAdeptDamageIsSpell(damage)) {
          continue;
        }
        for (const type of elementalAdeptDamageDescriptionTypes(damage)) {
          if (selectedTypes.has(type)) {
            matchingTypes.add(type);
          }
        }
      }
      if (!matchingTypes.size) {
        return false;
      }
      const resistanceChanged = elementalAdeptMergeIgnoredDamageTypes(options, "resistance", matchingTypes);
      const absorptionChanged = absorption
        ? elementalAdeptMergeIgnoredDamageTypes(options, "absorption", matchingTypes)
        : false;
      return resistanceChanged || absorptionChanged;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to apply Elemental Adept damage bypass.`, error);
      return false;
    }
  }

  async #resolveDamageSourceActor(actor, options) {
    const positionalActor = elementalAdeptActorDocument(actor);
    const directSource = elementalAdeptActorDocument(options?.sourceActor ?? options?.midi?.sourceActor);
    const sourceActorUuid = cleanString(options?.midi?.sourceActorUuid ?? options?.sourceActorUuid);
    if (!sourceActorUuid) {
      return directSource ?? positionalActor;
    }
    if (typeof this._fromUuid !== "function") {
      return null;
    }
    const resolved = elementalAdeptActorDocument(await this._fromUuid(sourceActorUuid));
    if (!resolved) {
      return null;
    }
    if ((positionalActor && !elementalAdeptSameActor(positionalActor, resolved))
      || (directSource && !elementalAdeptSameActor(directSource, resolved))) {
      return null;
    }
    return resolved;
  }

  #markMidiDamageOptions(options) {
    if (!options || typeof options !== "object") {
      return;
    }
    this._midiDamageOptions.add(options);
    try {
      Object.defineProperty(options, ELEMENTAL_ADEPT_MIDI_DAMAGE_MARKER, {
        value: true,
        configurable: true,
      });
    }
    catch (_error) {
      // The per-service WeakSet marker still protects non-extensible hook options.
    }
  }

  #hasMidiDamageMarker(options) {
    return Boolean(options?.[ELEMENTAL_ADEPT_MIDI_DAMAGE_MARKER])
      || Boolean(options && typeof options === "object" && this._midiDamageOptions.has(options));
  }

  async #enqueueActor(actor, operation) {
    if (!actor || !canPromptForElementalAdeptActor(actor)) {
      return false;
    }
    const key = this.#actorKey(actor);
    const previous = this._actorPromises.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this._actorPromises.set(key, current);
    try {
      return await current;
    }
    finally {
      if (this._actorPromises.get(key) === current) {
        this._actorPromises.delete(key);
      }
    }
  }

  #messageKey(message) {
    return cleanString(message?.uuid ?? message?.id ?? message?._id) || message;
  }

  async #enqueueMessageUpdate(message, replacements, safeRolls) {
    const key = this.#messageKey(message);
    const completeRolls = normalizeCollection(message?.rolls);
    const state = this._messageRollStates.get(key) ?? {
      rolls: (completeRolls.length ? completeRolls : safeRolls).slice(),
    };
    this._messageRollStates.set(key, state);
    for (const { position, roll } of replacements) {
      if (position < state.rolls.length) {
        state.rolls[position] = roll;
      }
    }
    const previous = this._messagePromises.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => message.update({ rolls: state.rolls.map((roll) => roll.toJSON?.() ?? roll) }));
    this._messagePromises.set(key, current);
    try {
      await current;
    }
    finally {
      if (this._messagePromises.get(key) === current) {
        this._messagePromises.delete(key);
        this._messageRollStates.delete(key);
      }
    }
  }

  async #configureItem(item, { allowDeletion = false } = {}) {
    const itemKey = elementalAdeptItemKey(item);
    if (!itemKey || this._pendingItems.has(itemKey) || !isElementalAdeptItem(item)) {
      return false;
    }
    this._pendingItems.add(itemKey);
    try {
      const actor = getElementalAdeptActor(item);
      if (getConfiguredElementalAdeptType(item)) {
        return false;
      }
      if (!elementalAdeptSubtype(item)) {
        const hasClassifiedSibling = normalizeCollection(actor?.items)
          .some((candidate) => candidate !== item && isElementalAdeptItem(candidate) && hasElementalAdeptAcquisitionSubtype(candidate));
        const subtype = hasClassifiedSibling ? "minor" : "general";
        await item.update?.({ "system.type.subtype": subtype }, elementalAdeptUpdateOptions());
      }
      let attempts = 0;
      while (attempts < 5) {
        const choices = getAvailableElementalAdeptChoices(actor, item);
        if (!choices.length) {
          if (!allowDeletion) {
            globalThis.ui?.notifications?.warn?.("Нет доступных типов урона для настройки черты Стихийный адепт.");
            return false;
          }
          if (typeof item.delete !== "function") {
            globalThis.ui?.notifications?.warn?.("Не удалось удалить лишнюю копию черты Стихийный адепт.");
            return false;
          }
          await item.delete(elementalAdeptUpdateOptions());
          globalThis.ui?.notifications?.warn?.("Лишняя копия черты Стихийный адепт удалена: все типы урона уже выбраны.");
          return true;
        }
        const selected = normalizeElementalAdeptDamageType(await this._prompt({ item, actor, choices, options: choices }));
        if (!selected) {
          return false;
        }
        const refreshed = getAvailableElementalAdeptChoices(actor, item);
        if (!refreshed.some((choice) => choice.value === selected)) {
          attempts += 1;
          globalThis.ui?.notifications?.warn?.("Этот тип урона уже выбран другой копией черты. Выберите другой тип.");
          continue;
        }
        const label = ELEMENTAL_ADEPT_CHOICES.find((choice) => choice.value === selected)?.label ?? selected;
        const baseName = cleanString(item.name, "Стихийный адепт").replace(/\s*\([^)]*\)\s*$/u, "");
        const nextName = `${baseName} (${label})`;
        await item.update?.({
          name: nextName,
          [ELEMENTAL_ADEPT_FLAG_PATH]: selected,
        }, elementalAdeptUpdateOptions());
        globalThis.ui?.notifications?.info?.(`Черта «${nextName}» настроена.`);
        return true;
      }
      return false;
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to configure Elemental Adept.`, error);
      globalThis.ui?.notifications?.error?.(error?.message || "Не удалось настроить черту Стихийный адепт.");
      return false;
    }
    finally {
      this._pendingItems.delete(itemKey);
    }
  }
}
