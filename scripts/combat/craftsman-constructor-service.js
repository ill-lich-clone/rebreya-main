import {
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_CONSTRUCT_TOKEN_PATH,
  MODULE_ID
} from "../constants.js";
import {
  CRAFTSMAN_BODY_ASSEMBLIES,
  CRAFTSMAN_COMBAT_MODES
} from "../data/craftsman-construct-definitions.js";
import { renderDescriptionMarkdown } from "../data/markdown-description.js";

export const CRAFTSMAN_CONSTRUCTOR_ARCHETYPE_ID = "craftsman-specialty-constructor";
const CONSTRUCT_FEATURE_FLAG = "craftsmanConstructFeature";
const CONSTRUCT_ACTIVITY_FLAG = "craftsmanConstructActivity";
const STATE_ACTIVE = "active";
const STATE_DISABLED = "disabled";
const STATE_REPAIRING = "repairing";
const STATE_DESTROYED = "destroyed";
const REPAIR_DELAY_SECONDS = 60;

const FALLBACK_SKILLS = Object.freeze({
  acr: "Акробатика",
  ani: "Уход за животными",
  arc: "Магия",
  ath: "Атлетика",
  dec: "Обман",
  his: "История",
  ins: "Проницательность",
  itm: "Запугивание",
  inv: "Расследование",
  med: "Медицина",
  nat: "Природа",
  prc: "Внимательность",
  prf: "Выступление",
  per: "Убеждение",
  rel: "Религия",
  slt: "Ловкость рук",
  ste: "Скрытность",
  sur: "Выживание"
});

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function clone(value) {
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : structuredClone(value);
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents.filter(Boolean);
  if (Array.isArray(collection)) return collection.filter(Boolean);
  if (typeof collection?.values === "function") return Array.from(collection.values()).filter(Boolean);
  return [];
}

function moduleFlags(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

function documentId(document) {
  return cleanString(document?.id ?? document?._id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function craftsmanClass(actor) {
  return collectionValues(actor?.items).find((item) => (
    item?.type === "class" && item?.system?.identifier === CRAFTSMAN_CLASS_IDENTIFIER
  )) ?? null;
}

function craftsmanLevel(actor) {
  return Math.max(0, Math.floor(Number(craftsmanClass(actor)?.system?.levels) || 0));
}

function archetypeId(item) {
  return cleanString(moduleFlags(item).archetypeId);
}

function constructorSubclass(actor) {
  return collectionValues(actor?.items).find((item) => (
    item?.type === "subclass" && archetypeId(item) === CRAFTSMAN_CONSTRUCTOR_ARCHETYPE_ID
  )) ?? null;
}

export function isCraftsmanConstructor(actor, resolver = null) {
  if (!craftsmanClass(actor)) return false;
  if (typeof resolver === "function") {
    try {
      return archetypeId(resolver(actor)?.specialty) === CRAFTSMAN_CONSTRUCTOR_ARCHETYPE_ID;
    }
    catch {
      return false;
    }
  }
  return Boolean(constructorSubclass(actor));
}

export function isLongRest(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) return true;
  return [result?.type, result?.restType, result?.period, config?.type, config?.restType, config?.period]
    .some((value) => {
      const text = cleanString(value).toLowerCase();
      return text === "long" || text === "lr" || text.includes("продолж");
    });
}

function constructActivityState(activity) {
  return moduleFlags(activity).craftsmanConstructor ?? null;
}

function runtimeActivityState(activity) {
  return moduleFlags(activity)[CONSTRUCT_ACTIVITY_FLAG] ?? null;
}

function constructState(token) {
  return moduleFlags(token).craftsmanConstruct ?? null;
}

function preparedConstructConfiguration(actor) {
  return normalizedConfiguration(moduleFlags(actor).craftsmanConstructPreparation);
}

function isConstructSummonActivity(activity) {
  return constructActivityState(activity)?.kind === "constructSummon";
}

function bodyAssembly(id) {
  return Object.values(CRAFTSMAN_BODY_ASSEMBLIES).find((entry) => entry.id === id) ?? null;
}

function combatMode(id) {
  return Object.values(CRAFTSMAN_COMBAT_MODES).find((entry) => entry.id === id) ?? null;
}

function skillEntries() {
  const configured = globalThis.CONFIG?.DND5E?.skills ?? {};
  const entries = Object.entries(configured).map(([id, config]) => {
    const rawLabel = cleanString(config?.label);
    const localized = cleanString(globalThis.game?.i18n?.localize?.(rawLabel), rawLabel);
    return {
      id,
      label: localized && localized !== rawLabel
        ? localized
        : cleanString(FALLBACK_SKILLS[id], rawLabel || id)
    };
  });
  return entries.length
    ? entries
    : Object.entries(FALLBACK_SKILLS).map(([id, label]) => ({ id, label }));
}

function normalizedConfiguration(value) {
  const bodyId = cleanString(value?.bodyId);
  const combatModeId = cleanString(value?.combatModeId);
  const skillIds = Array.from(new Set(
    (value?.skillIds ?? []).map((id) => cleanString(id)).filter(Boolean)
  ));
  const allowedSkills = new Set(skillEntries().map(({ id }) => id));
  if (!bodyAssembly(bodyId) || !combatMode(combatModeId) || skillIds.length !== 2) return null;
  if (!skillIds.every((id) => allowedSkills.has(id))) return null;
  return { bodyId, combatModeId, skillIds };
}

function utilityActivity(id, name, operation, activationType = "special", condition = "") {
  return {
    _id: id,
    type: "utility",
    name,
    img: CRAFTSMAN_CONSTRUCT_TOKEN_PATH,
    sort: 0,
    activation: { type: activationType, value: activationType === "action" ? 1 : null, condition, override: false },
    consumption: { scaling: { allowed: false, max: "" }, spellSlot: false, targets: [] },
    description: { chatFlavor: name },
    duration: { value: "", units: "inst", special: "", concentration: false, override: false },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        [CONSTRUCT_ACTIVITY_FLAG]: { operation, version: 1 }
      }
    },
    range: { value: null, units: "self", special: "", override: false },
    target: {
      template: { count: "", contiguous: false, type: "", size: "", width: "", height: "", units: "" },
      affects: { count: "", type: "self", choice: false, special: "" },
      prompt: false,
      override: false
    },
    uses: { spent: 0, max: "", recovery: [] }
  };
}

function featureItem(name, descriptionMarkdown, id, activities = {}) {
  return {
    name,
    type: "feat",
    img: CRAFTSMAN_CONSTRUCT_TOKEN_PATH,
    system: {
      description: { value: renderDescriptionMarkdown(descriptionMarkdown), chat: "" },
      identifier: `craftsman-construct-${id}`,
      type: { value: "class", subtype: "" },
      activities,
      uses: { spent: 0, max: "", recovery: [] }
    },
    flags: {
      [MODULE_ID]: {
        managed: true,
        [CONSTRUCT_FEATURE_FLAG]: { id, version: 1 }
      }
    }
  };
}

function constructFeatureItems(configuration) {
  const body = bodyAssembly(configuration.bodyId);
  const mode = combatMode(configuration.combatModeId);
  const items = [
    featureItem(`Сборка тела: ${body.label}`, body.descriptionMarkdown, `body-${body.id}`),
    featureItem(`Боевой режим: ${mode.label}`, mode.descriptionMarkdown, `mode-${mode.id}`),
    featureItem(
      "Владения",
      "**Владения.** Конструкт владеет всеми видами оружия и доспехов. Предполагается, что Конструкт будет использовать для сражения ваш объект исследования, если это снаряжение. Если вы Механик, то конструкт может быть вашим транспортом.",
      "proficiencies"
    ),
    featureItem(
      "Природа конструкта",
      "**Природа конструкта.** Конструкту не нужен воздух, еда, питье и сон.",
      "nature"
    ),
    featureItem(
      "Пересборка",
      "**Пересборка.** Конструкт может совершить 10-минутный перерыв, чтобы восстановить половину потраченных костей хитов.",
      "reassembly"
    ),
    featureItem(
      "Восстановить Конструкта",
      "Вы можете восстановить Конструкта, совершив 10-минутный перерыв. По его окончанию Конструкт может бросить кости хитов словно завершил короткий отдых. Если у конструкта больше 0 хитов, то он придёт в себя спустя минуту либо во время проверки инициативы.",
      "repair",
      { lchconstrrepair1: utilityActivity("lchconstrrepair1", "Восстановить Конструкта", "repair", "special", "10-минутный перерыв") }
    ),
    featureItem(
      "Отключиться",
      "Также вы можете отключить конструкта самостоятельно Действием.",
      "disable",
      { lchconstrdisable: utilityActivity("lchconstrdisable", "Отключиться", "disable", "action") }
    )
  ];
  if (body.id === "sturdy-body") {
    items.push(featureItem(
      "Действенная провокация",
      "**Действенная провокация (только вариант Крепкий корпус).** Конструкт провоцирует всех враждебных существ в пределах 10 футов. Существа становяться Спровоцированными 2 Конструктом.",
      "effective-provocation"
    ));
  }
  if (body.id === "powerful-arms") {
    items.push(featureItem(
      "Сильный выпад",
      "**Сильный выпад (только вариант Мощные руки).** Конструкт совершает особую атаку. Даже при промахе цель получает урон равный модификатору Силы Конструкта.",
      "powerful-lunge"
    ));
  }
  return items;
}

function hasUserGear(actor) {
  return collectionValues(actor?.items).some((item) => !moduleFlags(item)[CONSTRUCT_FEATURE_FLAG]);
}

export class CraftsmanConstructorService {
  constructor(options = {}) {
    this.options = options;
    this.mapObjectTokenService = options.mapObjectTokenService ?? null;
    this._queues = new Map();
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isLongRest(result, config) || craftsmanLevel(actor) < 3 || !this.#isConstructor(actor)) return true;
    const selected = normalizedConfiguration(await this.#promptConfiguration(actor, { result, config }));
    if (!selected) return false;
    await this.#updatePreparation(actor, selected);
    this.#notify("info", "Сборка Конструкта подготовлена. Разместите его активностью «Собрать Конструкта» на нужной сцене.");
    return true;
  }

  applyDnd5ePreUseActivity(activity) {
    if (!isConstructSummonActivity(activity)) return true;
    const owner = activity?.item?.actor ?? activity?.actor ?? null;
    if (!owner || !this.#isConstructor(owner)) return false;
    if (preparedConstructConfiguration(owner)) return true;
    this.#notify("warn", "Сначала подготовьте сборку Конструкта во время продолжительного отдыха.");
    return false;
  }

  async handlePostSummon(activity, profile, tokens = [], options = {}) {
    if (!isConstructSummonActivity(activity)) return true;
    const owner = activity?.item?.actor ?? activity?.actor ?? null;
    if (!owner || !this.#isConstructor(owner)) return false;
    const key = cleanString(owner.uuid ?? owner.id) || owner;
    const previous = this._queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => (
      this.#completeSummon(owner, collectionValues(tokens))
    ));
    this._queues.set(key, current);
    try {
      return await current;
    }
    finally {
      if (this._queues.get(key) === current) this._queues.delete(key);
    }
  }

  async handlePostUseActivity(activity) {
    const operation = runtimeActivityState(activity)?.operation;
    if (!operation) return true;
    const actorToken = activity?.actor?.token ?? activity?.item?.actor?.token ?? null;
    const token = actorToken?.document ?? actorToken;
    if (!token) return false;
    if (operation === "disable") return this.disableConstruct(token, "manual");
    if (operation === "repair") return this.repairConstruct(token);
    return true;
  }

  async handleTokenUpdated(token) {
    if (!this.#canReconcileSharedState()) return true;
    const state = constructState(token);
    if (!state || state.state === STATE_DESTROYED) return true;
    const hp = Number(token?.actor?.system?.attributes?.hp?.value);
    if (!Number.isFinite(hp) || hp > 0) return true;
    if (state.state === STATE_ACTIVE) return this.disableConstruct(token, "zero-hp");
    if (state.state === STATE_DISABLED || state.state === STATE_REPAIRING) {
      return this.destroyConstruct(token, "object-zero-hp");
    }
    return true;
  }

  async handleActorUpdated(actor) {
    if (!this.#canReconcileSharedState()) return true;
    const token = actor?.token?.document ?? actor?.token ?? null;
    if (token && constructState(token)) return this.handleTokenUpdated(token);
    if (Number(actor?.system?.attributes?.hp?.value) > 0) return true;
    for (const construct of this.#findConstructTokens(actor?.uuid)) {
      if (constructState(construct)?.state === STATE_ACTIVE) await this.disableConstruct(construct, "owner-death");
    }
    return true;
  }

  async handleOwnerItemChanged(item) {
    if (!this.#canReconcileSharedState()) return true;
    const owner = item?.actor ?? item?.parent ?? null;
    if (!owner || this.#isConstructor(owner)) return true;
    for (const construct of this.#findConstructTokens(owner.uuid)) {
      if (constructState(construct)?.state === STATE_ACTIVE) await this.disableConstruct(construct, "link-lost");
    }
    return true;
  }

  async handleWorldTime(worldTime) {
    if (!this.#canReconcileSharedState()) return true;
    const now = Number(worldTime);
    if (!Number.isFinite(now)) return true;
    for (const token of this.#findConstructTokens()) {
      const state = constructState(token);
      if (state?.state === STATE_REPAIRING && now >= Number(state.activatesAtWorldTime)) {
        await this.restoreConstruct(token, "repair-complete");
      }
    }
    return true;
  }

  async handleCombatStart() {
    if (!this.#canReconcileSharedState()) return true;
    for (const token of this.#findConstructTokens()) {
      if (constructState(token)?.state === STATE_REPAIRING) await this.restoreConstruct(token, "initiative");
    }
    return true;
  }

  async reconcileScene(scene) {
    if (!this.#canReconcileSharedState()) return true;
    for (const token of collectionValues(scene?.tokens)) {
      if (constructState(token)) await this.handleTokenUpdated(token);
    }
    return true;
  }

  async handleOwnerDeleted(actor) {
    if (!this.#canReconcileSharedState()) return true;
    for (const construct of this.#findConstructTokens(actor?.uuid)) {
      if (constructState(construct)?.state === STATE_ACTIVE) {
        await this.disableConstruct(construct, "link-lost");
      }
    }
    return true;
  }

  async disableConstruct(token, reason = "disabled") {
    const current = constructState(token);
    if (!current || current.state !== STATE_ACTIVE || !this.mapObjectTokenService?.convertTokenToObject) return false;
    const actor = token.actor;
    const attributes = actor?.system?.attributes ?? {};
    const maxHp = Math.max(1, Math.floor(Number(attributes?.hp?.max) || 1));
    const ac = Math.max(0, Math.floor(Number(attributes?.ac?.value ?? attributes?.ac?.flat) || 0));
    const next = {
      ...clone(current),
      state: STATE_DISABLED,
      reason: cleanString(reason, "disabled"),
      disabledAtWorldTime: this.#worldTime(),
      activatesAtWorldTime: null
    };
    await this.mapObjectTokenService.convertTokenToObject(token, {
      name: token?.name ?? actor?.name ?? "Конструкт",
      hp: maxHp,
      ac,
      damageThreshold: 0
    }, {
      flags: { craftsmanConstruct: next }
    });
    return true;
  }

  async repairConstruct(token) {
    const current = constructState(token);
    if (!current || current.state !== STATE_DISABLED) return false;
    if (Number(token?.actor?.system?.attributes?.hp?.value) <= 0) return false;
    const next = {
      ...clone(current),
      state: STATE_REPAIRING,
      reason: "repairing",
      activatesAtWorldTime: this.#worldTime() + REPAIR_DELAY_SECONDS
    };
    await this.#updateTokenState(token, next);
    this.#notify("info", "Конструкт восстановится через 1 минуту или при проверке инициативы.");
    return true;
  }

  async restoreConstruct(token, reason = "restored") {
    const current = constructState(token);
    if (!current || current.state !== STATE_REPAIRING || !this.mapObjectTokenService?.restoreObjectActor) return false;
    const next = {
      ...clone(current),
      state: STATE_ACTIVE,
      reason: cleanString(reason, "restored"),
      activatesAtWorldTime: null
    };
    const snapshot = current.restoreSnapshot ?? {};
    const attributes = clone(snapshot.attributes ?? {});
    attributes.hp = clone(token?.actor?.system?.attributes?.hp ?? attributes.hp ?? {});
    attributes.ac = clone(token?.actor?.system?.attributes?.ac ?? attributes.ac ?? {});
    await this.mapObjectTokenService.restoreObjectActor(token, {
      system: { attributes },
      sight: clone(snapshot.sight ?? { enabled: true, range: 60, visionMode: "darkvision" }),
      flags: { craftsmanConstruct: next }
    });
    return true;
  }

  async destroyConstruct(token, reason = "destroyed") {
    const current = constructState(token);
    if (!current || current.state === STATE_DESTROYED) return false;
    const next = {
      ...clone(current),
      state: STATE_DESTROYED,
      reason: cleanString(reason, "destroyed"),
      destroyedAtWorldTime: this.#worldTime(),
      activatesAtWorldTime: null
    };
    if (this.mapObjectTokenService?.markObjectDestroyed) {
      await this.mapObjectTokenService.markObjectDestroyed(token, {
        flags: { craftsmanConstruct: next }
      });
    }
    else {
      await this.#updateTokenState(token, next);
    }
    return true;
  }

  async #completeSummon(owner, tokens) {
    if (!tokens.length) return false;
    const selected = preparedConstructConfiguration(owner);
    if (!selected) {
      await Promise.all(tokens.map((token) => token?.delete?.()));
      return false;
    }

    try {
      for (const token of tokens) await this.#configureConstruct(owner, token, selected);
    }
    catch (error) {
      await Promise.all(tokens.map((token) => token?.delete?.()));
      throw error;
    }

    const newUuids = new Set(tokens.map((token) => cleanString(token?.uuid)).filter(Boolean));
    for (const oldToken of this.#findConstructTokens(owner.uuid)) {
      if (tokens.includes(oldToken) || newUuids.has(cleanString(oldToken?.uuid))) continue;
      await this.#retireOldConstruct(oldToken);
    }
    await this.#updatePreparation(owner, null);
    return true;
  }

  async #configureConstruct(owner, token, configuration) {
    const actor = token?.actor;
    if (!actor?.update) throw new TypeError("A summoned construct token with a synthetic actor is required");
    const level = craftsmanLevel(owner);
    const baseMaxHp = Math.max(1, Math.floor(Number(actor?.system?.attributes?.hp?.max) || (5 + (5 * level))));
    const maxHp = baseMaxHp + (configuration.bodyId === "sturdy-body" ? 2 * level : 0);
    const state = {
      version: 1,
      state: STATE_ACTIVE,
      ownerUuid: cleanString(owner.uuid),
      ownerActorId: documentId(owner),
      tokenUuid: cleanString(token.uuid),
      bodyId: configuration.bodyId,
      combatModeId: configuration.combatModeId,
      skillIds: clone(configuration.skillIds),
      craftsmanLevel: level,
      nativeMaxHp: baseMaxHp,
      createdAtWorldTime: this.#worldTime(),
      reason: "summoned",
      activatesAtWorldTime: null,
      restoreSnapshot: {
        attributes: {
          ac: clone(actor?.system?.attributes?.ac ?? { calc: "flat", flat: 14 }),
          hp: {
            value: maxHp,
            max: maxHp,
            temp: Number(actor?.system?.attributes?.hp?.temp) || 0,
            tempmax: Number(actor?.system?.attributes?.hp?.tempmax) || 0,
            formula: cleanString(actor?.system?.attributes?.hp?.formula)
          },
          movement: clone(actor?.system?.attributes?.movement ?? { walk: 30, units: "ft" }),
          senses: {
            ...clone(actor?.system?.attributes?.senses ?? { darkvision: 60, units: "ft" }),
            blindsight: configuration.combatModeId === "blind-fighting" ? 10 : 0
          }
        },
        sight: clone(token?.sight ?? token?._source?.sight ?? {
          enabled: true,
          range: 60,
          visionMode: "darkvision"
        })
      }
    };
    const patch = {
      "system.abilities.str.value": configuration.bodyId === "powerful-arms" ? 20 : 16,
      "system.attributes.hp.max": maxHp,
      "system.attributes.hp.value": maxHp,
      "system.attributes.senses.blindsight": configuration.combatModeId === "blind-fighting" ? 10 : 0,
      "system.traits.languages.value": collectionValues(owner?.system?.traits?.languages?.value),
      "system.traits.languages.custom": [
        cleanString(owner?.system?.traits?.languages?.custom),
        "Понимает языки создателя, но не говорит"
      ].filter(Boolean).join("; "),
      [`flags.${MODULE_ID}.craftsmanConstruct`]: state
    };
    for (const id of Object.keys(actor?.system?.skills ?? {})) {
      patch[`system.skills.${id}.value`] = configuration.skillIds.includes(id) ? 1 : 0;
    }
    await actor.update(patch);
    await this.#updateTokenState(token, state);

    const oldManagedIds = collectionValues(actor.items)
      .filter((item) => moduleFlags(item)[CONSTRUCT_FEATURE_FLAG])
      .map(documentId)
      .filter(Boolean);
    if (oldManagedIds.length && actor.deleteEmbeddedDocuments) {
      await actor.deleteEmbeddedDocuments("Item", oldManagedIds);
    }
    if (actor.createEmbeddedDocuments) {
      await actor.createEmbeddedDocuments("Item", constructFeatureItems(configuration));
    }
    return state;
  }

  async #retireOldConstruct(token) {
    const state = constructState(token);
    if (!state || state.state === STATE_DESTROYED) return false;
    if (hasUserGear(token?.actor)) return this.disableConstruct(token, "rebuilt");
    await token?.delete?.();
    return true;
  }

  #isConstructor(actor) {
    return isCraftsmanConstructor(actor, this.options.getCraftsmanSubclasses);
  }

  async #updatePreparation(actor, configuration) {
    const path = `flags.${MODULE_ID}.craftsmanConstructPreparation`;
    if (typeof actor?.update === "function") {
      await actor.update({ [path]: clone(configuration) });
    }
    else {
      actor.flags ??= {};
      actor.flags[MODULE_ID] ??= {};
      actor.flags[MODULE_ID].craftsmanConstructPreparation = clone(configuration);
    }
    return configuration;
  }

  #canReconcileSharedState() {
    if (typeof this.options.isActiveGmClient === "function") {
      return this.options.isActiveGmClient() === true;
    }
    return globalThis.game ? globalThis.game?.user?.isGM === true : true;
  }

  #findConstructTokens(ownerUuid = "") {
    if (typeof this.options.findConstructTokens === "function") {
      return collectionValues(this.options.findConstructTokens(ownerUuid));
    }
    const tokens = collectionValues(this.options.sceneDocuments?.() ?? globalThis.game?.scenes)
      .flatMap((scene) => collectionValues(scene?.tokens));
    return tokens.filter((token) => {
      const state = constructState(token);
      return state && (!ownerUuid || cleanString(state.ownerUuid) === cleanString(ownerUuid));
    });
  }

  async #promptConfiguration(owner, context) {
    if (typeof this.options.promptConfiguration === "function") {
      return this.options.promptConfiguration(owner, context);
    }
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2;
    if (typeof DialogV2?.wait !== "function") return null;
    const bodies = Object.values(CRAFTSMAN_BODY_ASSEMBLIES);
    const skills = skillEntries();
    const bodyOptions = bodies.map((entry) => (
      `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`
    )).join("");
    const skillOptions = skills.map((entry) => (
      `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`
    )).join("");
    const assembly = await DialogV2.wait({
      window: { title: "Сборка Конструкта" },
      content: `<form><div class="form-group"><label>Сборка тела</label><select name="body">${bodyOptions}</select></div><div class="form-group"><label>Первый навык</label><select name="skill-1">${skillOptions}</select></div><div class="form-group"><label>Второй навык</label><select name="skill-2">${skillOptions}</select></div></form>`,
      buttons: [{
        action: "next",
        label: "Далее",
        default: true,
        callback: (_event, button) => ({
          bodyId: cleanString(button?.form?.elements?.body?.value),
          skillIds: [
            cleanString(button?.form?.elements?.["skill-1"]?.value),
            cleanString(button?.form?.elements?.["skill-2"]?.value)
          ]
        })
      }, { action: "cancel", label: "Отмена", callback: () => null }],
      close: () => null
    });
    if (!assembly || new Set(assembly.skillIds).size !== 2) {
      if (assembly) this.#notify("warn", "Выберите два разных навыка Конструкта.");
      return null;
    }

    const modeOptions = Object.values(CRAFTSMAN_COMBAT_MODES).map((entry) => (
      `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`
    )).join("");
    const mode = await DialogV2.wait({
      window: { title: "Боевой режим Конструкта" },
      content: `<form><div class="form-group"><label>Боевой режим</label><select name="mode">${modeOptions}</select></div></form>`,
      buttons: [{
        action: "assemble",
        label: "Собрать",
        default: true,
        callback: (_event, button) => cleanString(button?.form?.elements?.mode?.value)
      }, { action: "cancel", label: "Отмена", callback: () => null }],
      close: () => null
    });
    return mode ? { ...assembly, combatModeId: mode } : null;
  }

  async #updateTokenState(token, state) {
    const flags = {
      ...(token?.flags ?? {}),
      [MODULE_ID]: {
        ...(token?.flags?.[MODULE_ID] ?? {}),
        craftsmanConstruct: clone(state)
      }
    };
    if (typeof token?.update === "function") await token.update({ flags });
    else token.flags = flags;
    return state;
  }

  #worldTime() {
    const value = this.options.worldTime?.() ?? globalThis.game?.time?.worldTime ?? 0;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  #notify(level, message) {
    const notifier = this.options.notify ?? globalThis.ui?.notifications;
    notifier?.[level]?.(message);
  }
}
