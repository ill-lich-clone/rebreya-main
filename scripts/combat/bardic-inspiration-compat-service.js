import { MODULE_ID } from "../constants.js";
import { collectionValues, escapeFoundryHtml, finiteNumber as toNumber } from "../shared/foundry-values.js";
import { isAvailableD20BonusEffect } from "./d20-bonus-roll.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { sha256Hex } from "../shared/sha256.js?v=1.4.268";
import { BARDIC_INSPIRATION_GRANT_COMMAND, BLADE_FLOURISH_COMMAND, BLADE_FLOURISH_SPEED_COMMAND, isValidBardicInspirationGrant, isValidBladeFlourishRequest, isValidBladeFlourishSpeedRequest } from "../infrastructure/foundry/bardic-inspiration-command.js?v=1.5.56";

export const LAARU_BARDIC_INSPIRATION_SOURCE_UUID = "Compendium.laaru-dnd5-hw.classfeatures.Item.hpLNiGq7y67d2EHA";
const LAARU_ALTERNATE_BARD_SOURCE_UUID = "Compendium.laaru-dnd5-hw.classes.Item.vrPvEIDrd72klJBL";
const LAARU_BLADE_FLOURISH_SOURCE_UUID = "Compendium.laaru-dnd5-hw.classfeatures.Item.qDRuySW6197wSH4l";
const LAARU_MASTERS_FLOURISH_SOURCE_UUID = "Compendium.laaru-dnd5-hw.classfeatures.Item.2CBi1sXX75w4yXTb";
const GRANT_ACTIVITY_ID = "jADU6PX5XlK4kOq8";
const BARDIC_KIND = "bardicInspiration";
const RECEIPT = `flags.${MODULE_ID}.bardicInspirationGrant`;

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty instanceof Function
    ? foundry.utils.getProperty(source, path)
    : String(path ?? "").split(".").reduce((current, key) => current?.[key], source);
  return value === undefined ? fallback : value;
}

function setProperty(source, path, value) {
  if (globalThis.foundry?.utils?.setProperty instanceof Function) {
    return foundry.utils.setProperty(source, path, value);
  }

  const keys = String(path ?? "").split(".").filter(Boolean);
  let cursor = source;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
  return true;
}

function getModuleFlags(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

function hasSourceUuid(item, uuid) {
  return [item?._stats?.compendiumSource, item?.flags?.core?.sourceId, item?.flags?.dnd5e?.sourceId].includes(uuid);
}

function matchesBladeFlourishIntent(record, payload) {
  return record?.operationId === payload.operationId && record.featureItemUuid === payload.featureItemUuid
    && record.weaponItemUuid === payload.weaponItemUuid && record.sourceTokenUuid === payload.sourceTokenUuid
    && record.targetTokenUuid === payload.targetTokenUuid && record.secondaryTokenUuid === payload.secondaryTokenUuid
    && record.turnKey === `${payload.combatId}:${payload.round}:${payload.turn}` && record.mode === payload.mode
    && record.damageType === payload.damageType && record.useMaster === payload.useMaster;
}

function bladeRequestFromRecord(item, record) {
  const [combatId, round, turn] = String(record?.turnKey ?? "").split(":");
  return { operationId: record?.operationId, sourceItemUuid: item?.uuid, featureItemUuid: record?.featureItemUuid,
    weaponItemUuid: record?.weaponItemUuid, sourceTokenUuid: record?.sourceTokenUuid, targetTokenUuid: record?.targetTokenUuid,
    secondaryTokenUuid: record?.secondaryTokenUuid, combatId, round: Number(round), turn: Number(turn), mode: record?.mode,
    damageType: record?.damageType, useMaster: record?.useMaster, actionConfirmed: true };
}

function hasConfirmedBladeFlourishHit(payload, sender, sourceToken) {
  const message = globalThis.game?.messages?.get?.(payload.operationId);
  const native = message?.flags?.dnd5e;
  const midi = message?.flags?.["midi-qol"];
  const recorded = message?.flags?.[MODULE_ID]?.bladeFlourishHit;
  const authorId = message?.author?.id ?? message?.user?.id ?? message?.user;
  return Boolean(message && (sender?.isGM || authorId === sender?.id)
    && native?.messageType === "usage" && native?.item?.uuid === payload.weaponItemUuid
    && native?.activity?.type === "attack" && message.speaker?.scene === sourceToken?.parent?.id
    && message.speaker?.token === sourceToken?.id
    && ([...collectionValues(midi?.hitTargetUuids), ...collectionValues(midi?.hitECTargetUuids)].includes(payload.targetTokenUuid)
      || (recorded?.targetTokenUuid === payload.targetTokenUuid && recorded?.sourceTokenUuid === payload.sourceTokenUuid)));
}

function hasBladeAttackCard(payload, sender, sourceToken) {
  const message = globalThis.game?.messages?.get?.(payload.operationId);
  const native = message?.flags?.dnd5e;
  const authorId = message?.author?.id ?? message?.user?.id ?? message?.user;
  return Boolean(message && (sender?.isGM || authorId === sender?.id) && native?.messageType === "usage"
    && native?.item?.uuid === payload.weaponItemUuid && native?.activity?.type === "attack"
    && message.speaker?.scene === sourceToken?.parent?.id && message.speaker?.token === sourceToken?.id);
}

function bladeDamageMarker(operationId, targetTokenUuid, targetActorUuid) {
  return `rebreya-blade:${operationId}:${targetTokenUuid}:${targetActorUuid}`;
}

function hasAttachedBladeFlourishRoll(payload, record, { markerOnly = false } = {}) {
  const message = globalThis.game?.messages?.get?.(payload.operationId);
  const matches = [...collectionValues(message?.flags?.["midi-qol"]?.damageRolls), ...collectionValues(message?.flags?.["midi-qol"]?.bonusDamageRolls)].flatMap(entry => {
    let roll = entry;
    if (typeof entry === "string") { try { roll = JSON.parse(entry); } catch { return []; } }
    return roll?.options?.rebreyaBladeFlourishOperationId === payload.operationId ? [roll] : [];
  });
  if (markerOnly) return matches.length > 0;
  if (matches.length !== 1) return false;
  const roll = matches[0], properties = roll?.options?.properties;
  if (!Array.isArray(properties) && !(properties instanceof Set)) return false;
  const marker = bladeDamageMarker(payload.operationId, payload.targetTokenUuid, record.targetActorUuid);
  const values = [...new Set(properties)];
  return values.includes(marker) && Number(roll.total) === Number(record.roll?.total) && roll.options.type === record.damageType
    && JSON.stringify(values.filter(value => value !== marker).sort()) === JSON.stringify(record.damageProperties);
}

function bladeAttackDamageRoll(operationId) {
  let roll = collectionValues(globalThis.game?.messages?.get?.(operationId)?.flags?.["midi-qol"]?.damageRolls)[0];
  if (typeof roll === "string") { try { roll = JSON.parse(roll); } catch { return null; } }
  return roll ?? null;
}

function bladeAttackDamageProperties(operationId) {
  const properties = bladeAttackDamageRoll(operationId)?.options?.properties;
  if (!Array.isArray(properties) && !(properties instanceof Set)) return null;
  const values = [...properties];
  return values.every(value => typeof value === "string") ? [...new Set(values)].sort() : null;
}

function bladeDefenseExpired(record, combat) {
  if (!combat?.started || combat.id !== record.combatId) return true;
  if (!Number.isSafeInteger(combat.round) || !Number.isSafeInteger(combat.turn)) return false;
  if (combat.round > record.round + 1) return true;
  if (combat.round <= record.round) return false;
  const turns = collectionValues(combat.turns);
  const sourceIndex = turns.findIndex(combatant => combatant?.token?.uuid === record.sourceTokenUuid);
  return combat.turn >= (sourceIndex >= 0 ? sourceIndex : record.turn);
}

function getItemDescriptionText(item) {
  const html = cleanText(item?.system?.description?.value);
  return html
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isBardicInspirationRestoreItem(item) {
  const flags = getModuleFlags(item);
  if (flags.restoreBardicInspiration === true || flags.bardicInspirationRestore === true) {
    return true;
  }

  const name = normalizeText(item?.name);
  const description = normalizeText(getItemDescriptionText(item));
  return name.startsWith("барабан задающего ритм")
    && description.includes("восстановить одну кость бардовского вдохновения");
}

export function isLaaruBardicInspirationItem(item) {
  if (!item) {
    return false;
  }

  return [item._stats?.compendiumSource, item.flags?.core?.sourceId, item.flags?.dnd5e?.sourceId]
    .includes(LAARU_BARDIC_INSPIRATION_SOURCE_UUID);
}

function isGrantActivity(activity) {
  return isLaaruBardicInspirationItem(activity?.item) && (activity.id ?? activity._id) === GRANT_ACTIVITY_ID;
}

function tokenDocument(value) { return value?.document?.documentName === "Token" ? value.document : value?.documentName === "Token" ? value : null; }
function sourceToken(actor) {
  if (actor?.token) return tokenDocument(actor.token);
  const controlled = collectionValues(globalThis.canvas?.tokens?.controlled).filter(token => token.actor?.uuid === actor?.uuid);
  if (controlled.length === 1) return tokenDocument(controlled[0]);
  const active = actor?.getActiveTokens?.() ?? [];
  return active.length === 1 ? tokenDocument(active[0]) : null;
}
function bardicEffect(effect) { return effect?.flags?.[MODULE_ID]?.d20Bonus?.kind === BARDIC_KIND; }
function resolveTarget(entry) {
  const value = typeof entry === "string" ? globalThis.fromUuidSync?.(entry) : globalThis.fromUuidSync?.(entry?.uuid) ?? entry;
  const token = tokenDocument(value);
  const actor = token?.actor ?? value?.actor ?? (value?.documentName === "Actor" ? value : null);
  return actor ? { actor, token } : null;
}

function validateRecipient(actor, target, originToken) {
  if (!target?.actor) throw new Error("Вдохновение: выберите ровно одну цель.");
  if (target.actor.uuid === actor?.uuid) throw new Error("Вдохновение нельзя выдать самому себе.");
  if (collectionValues(target.actor.effects).some(effect => bardicEffect(effect) && isAvailableD20BonusEffect(effect))) {
    throw new Error("У цели уже есть Бардовское вдохновение.");
  }
  const a = originToken, b = target.token;
  const scene = a?.parent;
  if (scene && b?.parent?.id === scene.id) {
    const size = Number(scene.grid?.size), distance = Number(scene.grid?.distance);
    if (!(size > 0 && distance > 0)) return false;
    const x = token => Number(token.x) + Number(token.width ?? 1) * size / 2;
    const y = token => Number(token.y) + Number(token.height ?? 1) * size / 2;
    const feet = Math.max(Math.abs(x(a) - x(b)), Math.abs(y(a) - y(b))) / size * distance;
    if (feet > 60) throw new Error("Вдохновение: цель дальше 60 футов.");
    return true;
  }
  return false;
}

function inspirationFormula(item) {
  const actor = item.actor ?? item.parent;
  const data = actor?.getRollData?.() ?? {};
  const alternateBard = collectionValues(actor?.items).find(entry => entry.type === "class"
    && [entry._stats?.compendiumSource, entry.flags?.core?.sourceId, entry.flags?.dnd5e?.sourceId].includes(LAARU_ALTERNATE_BARD_SOURCE_UUID));
  const level = Number(actor?.classes?.bard?.system?.levels
    ?? collectionValues(actor?.items).find(entry => entry.type === "class" && entry.system?.identifier === "bard")?.system?.levels
    ?? alternateBard?.system?.levels ?? 1);
  const fallback = `d${level >= 15 ? 12 : level >= 10 ? 10 : level >= 5 ? 8 : 6}`;
  const rollActivity = item.system?.activities?.get?.("2Enk7AiD901iQmfz");
  const authored = cleanText(item.system?.formula || rollActivity?.roll?.formula, "1@scale.bard.inspiration");
  const formula = authored.replace(/@([A-Za-z0-9_.-]+)/gu, (_match, path) => {
    let value = getProperty(data, path);
    if ((value == null || value === "") && path === "scale.bard.inspiration" && alternateBard) value = data?.scale?.["bard-"]?.inspiration;
    if (path === "scale.bard.inspiration" && (value == null || value === "")) return fallback;
    if (typeof value === "number" || typeof value === "string") return String(value);
    const die = value?.formula ?? value?.die ?? value?.denomination;
    if (die) return String(die);
    if (value?.faces > 0) return `d${value.faces}`;
    throw new Error("Вдохновение: не удалось разрешить авторскую формулу кости.");
  });
  if (!formula || formula.includes("@") || (globalThis.Roll?.validate && !Roll.validate(formula))) {
    throw new Error("Вдохновение: некорректная формула кости.");
  }
  return formula;
}

export class BardicInspirationCompatService {
  constructor(moduleApi = null, options = {}) {
    this.moduleApi = moduleApi;
    this.options = options;
    this._usageOperations = new Map();
    this._bladeWorkflowOperations = new Map();
    this._bladePromptOperations = new Map();
    this._bladeRecoveryPrompts = new Map();
  }

  findBardicInspirationItem(actor) {
    return collectionValues(actor?.items).find((item) => isLaaruBardicInspirationItem(item)) ?? null;
  }

  async canUseBladeFlourish(payload, { sender } = {}) {
    if (!isValidBladeFlourishRequest(payload) || !sender) return false;
    const item = await globalThis.fromUuid?.(payload.sourceItemUuid);
    const actor = item?.actor ?? item?.parent;
    if (!isLaaruBardicInspirationItem(item) || !actor || !(sender.isGM || actor.testUserPermission?.(sender, "OWNER"))) return false;
    if (payload.phase !== "reserve") {
      const record = getModuleFlags(item).bladeFlourish;
      return matchesBladeFlourishIntent(record, payload);
    }
    if (this.findBardicInspirationItem(actor) !== item) return false;
    const feature = await globalThis.fromUuid?.(payload.featureItemUuid);
    return hasSourceUuid(feature, LAARU_BLADE_FLOURISH_SOURCE_UUID) && (feature.actor ?? feature.parent)?.uuid === actor.uuid;
  }

  async attachBladeFlourishRoll(workflow, serialized, operationId, { targetTokenUuid, targetActorUuid } = {}) {
    if (typeof workflow?.setDamageRolls !== "function" || typeof workflow?.performThrottledUpdate !== "function"
      || !workflow.chatCard || !operationId || !targetTokenUuid || !targetActorUuid || !Number.isFinite(Number(serialized?.total))) {
      throw new Error("Цветение: бонусный урон недоступен.");
    }
    const rolls = [...(workflow.damageRolls ?? [])];
    const properties = workflow.damageRolls?.[0]?.options?.properties;
    const expectedProperties = [...new Set([...(Array.isArray(properties) || properties instanceof Set ? properties : []),
      bladeDamageMarker(operationId, targetTokenUuid, targetActorUuid)])].sort();
    const matches = [...rolls, ...(workflow.bonusDamageRolls ?? [])].filter(roll => roll?.options?.rebreyaBladeFlourishOperationId === operationId);
    if (matches.length) {
      const existing = matches[0], actual = existing?.options?.properties;
      if (matches.length !== 1 || Number(existing.total) !== Number(serialized.total)
        || (serialized.options?.type && existing.options?.type !== serialized.options.type)
        || (!Array.isArray(actual) && !(actual instanceof Set))
        || JSON.stringify([...new Set(actual)].sort()) !== JSON.stringify(expectedProperties)) throw new Error("Цветение: бросок атаки изменился.");
      await workflow.performThrottledUpdate(workflow.chatCard, {}, true);
      return { replayed: true };
    }
    const deserialize = this.options.deserializeBladeFlourish ?? (data => globalThis.Roll?.fromJSON?.(JSON.stringify(data)));
    const roll = await deserialize(structuredClone(serialized));
    if (!roll?._evaluated || Number(roll.total) !== Number(serialized.total)) throw new Error("Цветение: сохранённый бросок недоступен.");
    roll.options ??= {};
    roll.options.properties = expectedProperties;
    roll.options.rebreyaBladeFlourishOperationId = operationId;
    const previousProperties = rolls.map(existing => ({ existing, had: Object.hasOwn(existing.options ?? {}, "properties"),
      value: Array.isArray(existing.options?.properties) ? [...existing.options.properties]
        : existing.options?.properties instanceof Set ? new Set(existing.options.properties) : existing.options?.properties }));
    for (const entry of previousProperties) {
      if (entry.existing.options?.properties instanceof Set) entry.existing.options.properties = [...entry.existing.options.properties];
    }
    try { await workflow.setDamageRolls([...rolls, roll]); }
    finally {
      for (const entry of previousProperties) {
        if (!entry.existing.options) continue;
        if (entry.had) entry.existing.options.properties = entry.value;
        else delete entry.existing.options.properties;
      }
      roll.options.properties = expectedProperties;
    }
    workflow.damageRolls = workflow.damageRolls;
    await workflow.performThrottledUpdate(workflow.chatCard, {}, true);
    return { replayed: false };
  }

  async performBladeFlourish(workflow, payload) {
    const request = this.moduleApi?.socketCommandBus?.request?.bind(this.moduleApi.socketCommandBus);
    if (!request || !isValidBladeFlourishRequest({ ...payload, phase: "reserve" })
      || workflow?.chatCard?.id !== payload.operationId || typeof workflow?.performThrottledUpdate !== "function") {
      throw new Error("Цветение: карточка атаки или связь с мастером недоступна.");
    }
    const fingerprint = JSON.stringify(Object.keys(payload).sort().map(key => [key, payload[key]]));
    const current = this._bladeWorkflowOperations.get(payload.operationId);
    if (current) {
      if (current.fingerprint !== fingerprint) throw new Error("Цветение: операция уже запущена с другими параметрами.");
      return current.pending;
    }
    const pending = (async () => {
      await workflow.performThrottledUpdate(workflow.chatCard, {}, true);
      const message = globalThis.game?.messages?.get?.(payload.operationId);
      const midi = message?.flags?.["midi-qol"];
      const recorded = message?.flags?.[MODULE_ID]?.bladeFlourishHit;
      if (![...collectionValues(midi?.hitTargetUuids), ...collectionValues(midi?.hitECTargetUuids)].includes(payload.targetTokenUuid)
        && !(recorded?.targetTokenUuid === payload.targetTokenUuid && recorded?.sourceTokenUuid === payload.sourceTokenUuid)) {
        const hits = [...collectionValues(workflow.hitTargets), ...collectionValues(workflow.hitTargetsEC)].map(tokenDocument);
        if (!hits.some(token => token?.uuid === payload.targetTokenUuid) || typeof workflow.chatCard.update !== "function") {
          throw new Error("Цветение: попадание не подтверждено.");
        }
        await workflow.chatCard.update({ [`flags.${MODULE_ID}.bladeFlourishHit`]: {
          sourceTokenUuid: payload.sourceTokenUuid, targetTokenUuid: payload.targetTokenUuid
        } });
      }
      const reserved = await request(BLADE_FLOURISH_COMMAND, { ...payload, phase: "reserve" });
      if (reserved?.status === "committed") {
        return reserved;
      }
      if (payload.mode !== "defensive") {
        return request(BLADE_FLOURISH_COMMAND, { ...payload, phase: "commit" });
      }
      let committed;
      try {
        await this.attachBladeFlourishRoll(workflow, reserved?.roll, payload.operationId,
          { targetTokenUuid: payload.targetTokenUuid, targetActorUuid: reserved?.targetActorUuid });
        committed = await request(BLADE_FLOURISH_COMMAND, { ...payload, phase: "commit" });
      } catch (error) {
        workflow.aborted = true;
        globalThis.ui?.notifications?.warn?.("Применение урона остановлено: цветение не подтверждено. Мастер должен проверить карточку атаки.");
        throw error;
      }
      return committed;
    })();
    this._bladeWorkflowOperations.set(payload.operationId, { fingerprint, pending });
    try { return await pending; }
    finally { this._bladeWorkflowOperations.delete(payload.operationId); }
  }

  async canGrantBladeFlourishSpeed(payload, { sender } = {}) {
    if (!isValidBladeFlourishSpeedRequest(payload) || !sender) return false;
    const feature = await globalThis.fromUuid?.(payload.featureItemUuid);
    const actor = feature?.actor ?? feature?.parent;
    return Boolean(hasSourceUuid(feature, LAARU_BLADE_FLOURISH_SOURCE_UUID) && actor
      && (sender.isGM || actor.testUserPermission?.(sender, "OWNER")));
  }

  async #confirmBladeAttackAction(workflow) {
    const confirm = this.options.confirmBladeAttackAction ?? (async () => {
      const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
      if (typeof DialogV2?.wait !== "function") return false;
      return Boolean(await DialogV2.wait({
        window: { title: "Цветение клинков" },
        content: "<p>Эта атака входит в действие Атака в ваш ход?</p>",
        buttons: [
          { action: "attack", label: "Да, действие Атака", callback: () => true },
          { action: "other", label: "Нет", callback: () => false }
        ], rejectClose: false, modal: true
      }));
    });
    return Boolean(await confirm(workflow));
  }

  async applyMidiBladeFlourishPreAttack(workflow) {
    const actor = workflow?.actor;
    const feature = collectionValues(actor?.items).find(item => hasSourceUuid(item, LAARU_BLADE_FLOURISH_SOURCE_UUID));
    const token = tokenDocument(workflow?.token) ?? sourceToken(actor);
    const combat = globalThis.game?.combat;
    if (!feature || !actor || !token || !combat?.started || combat.combatant?.actor?.uuid !== actor.uuid
      || combat.combatant?.token?.uuid !== token.uuid || workflow?.activity?.type !== "attack"
      || workflow.itemUsesBonusAction || workflow.itemUsesReaction || workflow.workflowOptions?.isReaction
      || workflow.workflowOptions?.castUsesBonusAction || workflow.workflowOptions?.castUsesReaction
      || !workflow.chatCard?.id || typeof workflow.performThrottledUpdate !== "function") return true;
    workflow.rebreyaBladeFlourishAttackAction = await this.#confirmBladeAttackAction(workflow);
    if (!workflow.rebreyaBladeFlourishAttackAction) return true;
    const payload = { operationId: workflow.chatCard.id, featureItemUuid: feature.uuid, weaponItemUuid: workflow.item?.uuid,
      sourceTokenUuid: token.uuid, combatId: combat.id, round: combat.round, turn: combat.turn, actionConfirmed: true };
    if (!isValidBladeFlourishSpeedRequest(payload)) return true;
    workflow.rebreyaBladeFlourishAttackAction = true;
    const request = this.moduleApi?.socketCommandBus?.request?.bind(this.moduleApi.socketCommandBus);
    if (!request) throw new Error("Цветение: связь с мастером недоступна.");
    await workflow.performThrottledUpdate(workflow.chatCard, {}, true);
    await request(BLADE_FLOURISH_SPEED_COMMAND, payload);
    return true;
  }

  async applyMidiBladeFlourishDamage(workflow) {
    const actor = workflow?.actor, item = workflow?.item;
    const feature = collectionValues(actor?.items).find(entry => hasSourceUuid(entry, LAARU_BLADE_FLOURISH_SOURCE_UUID));
    const inspiration = this.findBardicInspirationItem(actor);
    const master = collectionValues(actor?.items).some(entry => hasSourceUuid(entry, LAARU_MASTERS_FLOURISH_SOURCE_UUID));
    const token = tokenDocument(workflow?.token) ?? sourceToken(actor), combat = globalThis.game?.combat;
    const hitTargets = [...new Map([...collectionValues(workflow?.hitTargets), ...collectionValues(workflow?.hitTargetsEC)]
      .map(tokenDocument).filter(target => target?.uuid).map(target => [target.uuid, target])).values()];
    const damageType = workflow?.damageRolls?.[0]?.options?.type ?? workflow?.defaultDamageType;
    const operationId = workflow?.chatCard?.id;
    if (!feature || !inspiration || item?.type !== "weapon" || !hitTargets.length
      || !token || !combat?.started || combat.combatant?.token?.uuid !== token.uuid
      || typeof damageType !== "string" || !operationId) return true;
    const unconfirmedCritical = workflow?.isCritical === true && workflow?.damageRolls?.[0]?.options?.isCritical !== true;
    const record = getModuleFlags(inspiration).bladeFlourish;
    if (record?.status === "reserved" && record.operationId === operationId) {
      if (record.mode === "defensive" && (hitTargets.length > 1 || unconfirmedCritical)) {
        globalThis.ui?.notifications?.warn?.("Оборонительный росчерк: урон не подтверждён; разрешите его вручную.");
        return true;
      }
      const request = bladeRequestFromRecord(inspiration, record);
      if (request.weaponItemUuid !== item.uuid || request.sourceTokenUuid !== token.uuid
        || !hitTargets.some(target => target.uuid === request.targetTokenUuid)
        || !isValidBladeFlourishRequest({ ...request, phase: "reserve" })) throw new Error("Цветение: исходная атака изменилась.");
      await this.performBladeFlourish(workflow, request);
      return true;
    }
    if (!master && !(Number(inspiration.system?.uses?.value) > 0)) return true;
    if (workflow.rebreyaBladeFlourishAttackAction === undefined) {
      if (workflow.itemUsesBonusAction || workflow.itemUsesReaction || workflow.workflowOptions?.isReaction
        || workflow.workflowOptions?.castUsesBonusAction || workflow.workflowOptions?.castUsesReaction) return true;
      workflow.rebreyaBladeFlourishAttackAction = await this.#confirmBladeAttackAction(workflow);
    }
    if (workflow.rebreyaBladeFlourishAttackAction !== true) return true;
    if (record?.status === "reserved" || (record?.turnKey === `${combat.id}:${combat.round}:${combat.turn}` && record.status !== "cancelled")) return true;
    if (this._bladePromptOperations.has(operationId)) return this._bladePromptOperations.get(operationId);
    const pending = (async () => {
      const prompt = this.options.promptBladeFlourish ?? (choices => this.#promptBladeFlourish(choices));
      const selection = await prompt({ actor, token, hitTargets, master, hasInspiration: Number(inspiration.system?.uses?.value) > 0 });
      if (!selection) return true;
      if (!hitTargets.some(target => target.uuid === selection.targetTokenUuid)) throw new Error("Цветение: цель попадания изменилась.");
      if (selection.mode === "defensive" && hitTargets.length > 1) {
        globalThis.ui?.notifications?.warn?.("Оборонительный росчерк при ударе по нескольким целям разрешите вручную: Midi заранее рассчитывает общую сумму для реакций.");
        return true;
      }
      if (selection.mode === "defensive" && unconfirmedCritical) {
        globalThis.ui?.notifications?.warn?.("Оборонительный росчерк: критический урон не подтверждён; разрешите его вручную.");
        return true;
      }
      const payload = { operationId, sourceItemUuid: inspiration.uuid, featureItemUuid: feature.uuid, weaponItemUuid: item.uuid,
        sourceTokenUuid: token.uuid, targetTokenUuid: selection.targetTokenUuid, secondaryTokenUuid: selection.secondaryTokenUuid ?? "",
        combatId: combat.id, round: combat.round, turn: combat.turn, mode: selection.mode, damageType,
        useMaster: selection.useMaster === true, actionConfirmed: true };
      if (!isValidBladeFlourishRequest({ ...payload, phase: "reserve" })) throw new Error("Цветение: неверный выбор.");
      await this.performBladeFlourish(workflow, payload);
      return true;
    })();
    this._bladePromptOperations.set(operationId, pending);
    try { return await pending; }
    finally { this._bladePromptOperations.delete(operationId); }
  }

  async #promptBladeFlourish({ token, hitTargets, master, hasInspiration }) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.wait !== "function") return null;
    const selected = await DialogV2.wait({
      window: { title: "Цветение клинков" },
      content: `<label>Цель попадания<select name="target">${hitTargets.map(target => `<option value="${escapeFoundryHtml(target.uuid)}">${escapeFoundryHtml(target.name ?? target.actor?.name ?? "Цель")}</option>`).join("")}</select></label>
        ${master ? `<label><input type="checkbox" name="master" ${hasInspiration ? "" : "checked disabled"}> Мастерское цветение: к6 без расхода</label>` : ""}`,
      buttons: [
        ...[["defensive", "Оборонительное"], ["mobile", "Мобильное"], ["slashing", "Режущее"]].map(([mode, label]) => ({
          action: mode, label, callback: (_event, button) => ({ mode, targetTokenUuid: button.form.elements.namedItem("target").value,
            useMaster: master && (!hasInspiration || button.form.elements.namedItem("master")?.checked === true) })
        })),
        { action: "cancel", label: "Не использовать", callback: () => null }
      ], rejectClose: false, modal: true
    });
    return selected ? { ...selected, secondaryTokenUuid: "" } : null;
  }

  async grantBladeFlourishSpeed(payload, { sender } = {}) {
    if (!isValidBladeFlourishSpeedRequest(payload) || !isActiveGmClient(globalThis.game)) throw new Error("Цветение: неверная операция или активный мастер недоступен.");
    const coordinator = this.moduleApi?.worldMutationCoordinator;
    if (!coordinator?.run) throw new Error("Цветение: недоступна очередь операций.");
    return coordinator.run(`blade-speed:${payload.featureItemUuid}`, async () => {
      const feature = await globalThis.fromUuid?.(payload.featureItemUuid);
      const actor = feature?.actor ?? feature?.parent;
      const item = await globalThis.fromUuid?.(payload.weaponItemUuid);
      const token = tokenDocument(await globalThis.fromUuid?.(payload.sourceTokenUuid));
      const combat = globalThis.game?.combat;
      if (!hasSourceUuid(feature, LAARU_BLADE_FLOURISH_SOURCE_UUID) || !actor
        || !(sender?.isGM || actor.testUserPermission?.(sender, "OWNER"))
        || (item?.actor ?? item?.parent)?.uuid !== actor.uuid || token?.actor?.uuid !== actor.uuid
        || !combat?.started || combat.id !== payload.combatId || combat.round !== payload.round || combat.turn !== payload.turn
        || combat.combatant?.actor?.uuid !== actor.uuid || combat.combatant?.token?.uuid !== token.uuid
        || token.parent?.tokens?.get?.(token.id) !== token || !hasBladeAttackCard(payload, sender, token)) {
        throw new Error("Цветение: действие, токен или ход боя не подтверждены.");
      }
      const existing = collectionValues(actor.effects).find(effect => {
        const record = effect?.flags?.[MODULE_ID]?.bladeFlourishSpeed;
        return record?.combatId === payload.combatId && record.round === payload.round && record.turn === payload.turn;
      });
      if (existing) return { applied: true, replayed: true };
      if (typeof actor.createEmbeddedDocuments !== "function" || !isActiveGmClient(globalThis.game)) throw new Error("Цветение: эффект скорости недоступен.");
      const unit = actor.system?.attributes?.movement?.units || "ft";
      const conversion = globalThis.CONFIG?.DND5E?.movementUnits?.[unit]?.conversion
        ?? { ft: 1, m: 10 / 3, km: 10000 / 3, mi: 5280 }[unit];
      if (!(conversion > 0)) throw new Error("Цветение: неизвестные единицы скорости.");
      const speedBonus = String(10 / conversion);
      const movement = actor.system?.attributes?.movement;
      const modes = movement ? ["walk", "fly", "swim", "climb", "burrow"].filter(mode => Number(movement[mode]) > 0) : ["walk"];
      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: "Цветение клинков: скорость", type: "base", system: {}, img: feature.img ?? "icons/svg/wing.svg",
        disabled: false, transfer: false, origin: feature.uuid,
        changes: modes.map(mode => ({ key: `system.attributes.movement.${mode}`, mode: 2, value: speedBonus, priority: 20 })),
        duration: { combat: payload.combatId, rounds: 0, turns: 1, startRound: payload.round, startTurn: payload.turn },
        flags: { dae: { specialDuration: ["turnEndSource", "combatEnd"] }, [MODULE_ID]: {
          bladeFlourishSpeed: { operationId: payload.operationId, sourceTokenUuid: payload.sourceTokenUuid, combatId: payload.combatId, round: payload.round, turn: payload.turn }
        } }
      }]);
      return { applied: true, replayed: false };
    });
  }

  async expireBladeFlourishSpeed(combat, actor, { ended = false, sourceTokenUuid = null } = {}) {
    if (!isActiveGmClient(globalThis.game) || !actor) return 0;
    let removed = 0;
    for (const effect of collectionValues(actor.effects)) {
      const record = effect?.flags?.[MODULE_ID]?.bladeFlourishSpeed;
      if (!record || record.combatId !== combat?.id || (sourceTokenUuid && record.sourceTokenUuid !== sourceTokenUuid)
        || (!ended && combat?.started && combat.round === record.round && combat.turn === record.turn)) continue;
      if (!collectionValues(actor.effects).includes(effect) || typeof effect.delete !== "function") continue;
      try { await effect.delete(); removed += 1; }
      catch (error) { if (collectionValues(actor.effects).includes(effect)) throw error; }
    }
    return removed;
  }

  async #runBladeFlourishOperation(payload, phase, sender, operation) {
    if (Object.hasOwn(payload ?? {}, "phase") || !isValidBladeFlourishRequest({ ...payload, phase })) throw new Error("Цветение: неверные параметры.");
    if (!isActiveGmClient(globalThis.game)) throw new Error("Цветение клинков обрабатывает активный мастер.");
    const coordinator = this.moduleApi?.worldMutationCoordinator;
    if (!coordinator?.run) throw new Error("Цветение: недоступна очередь операций.");
    return coordinator.run(`blade-flourish:${payload.sourceItemUuid}`, async () => {
      const item = await globalThis.fromUuid?.(payload.sourceItemUuid);
      const actor = item?.actor ?? item?.parent;
      if (!isLaaruBardicInspirationItem(item) || !actor) throw new Error("Цветение: источник способности не найден.");
      if (!sender || !(sender.isGM || actor.testUserPermission?.(sender, "OWNER"))) throw new Error("Цветение: требуются права владельца.");
      if (!isActiveGmClient(globalThis.game)) throw new Error("Цветение: активный мастер изменился. Повторите действие.");
      return operation(item, actor);
    });
  }

  async reserveBladeFlourish(payload, { sender } = {}) {
    return this.#runBladeFlourishOperation(payload, "reserve", sender, async (item, actor) => {
      const feature = await globalThis.fromUuid?.(payload?.featureItemUuid);
      if (this.findBardicInspirationItem(actor) !== item || !hasSourceUuid(feature, LAARU_BLADE_FLOURISH_SOURCE_UUID)
        || (feature.actor ?? feature.parent)?.uuid !== actor?.uuid) throw new Error("Цветение: источник способности не найден.");
      const turnKey = `${payload.combatId}:${payload.round}:${payload.turn}`;
      const previous = getModuleFlags(item).bladeFlourish;
      if (previous?.operationId === payload.operationId) {
        if (previous.status === "cancelled") throw new Error("Цветение: эта операция отменена.");
        if (!matchesBladeFlourishIntent(previous, payload)) {
          throw new Error("Цветение: операция уже использована с другими параметрами.");
        }
        return { roll: structuredClone(previous.roll), status: previous.status, effectTotal: previous.effectTotal, targetActorUuid: previous.targetActorUuid, replayed: true };
      }
      const combat = globalThis.game?.combat;
      if (!combat?.started || combat.id !== payload.combatId || combat.round !== payload.round || combat.turn !== payload.turn
        || combat.combatant?.actor?.uuid !== actor.uuid) throw new Error("Цветение: изменился ход боя.");
      const weapon = await globalThis.fromUuid?.(payload.weaponItemUuid);
      const sourceToken = tokenDocument(await globalThis.fromUuid?.(payload.sourceTokenUuid));
      const targetToken = tokenDocument(await globalThis.fromUuid?.(payload.targetTokenUuid));
      if (weapon?.type !== "weapon" || (weapon.actor ?? weapon.parent)?.uuid !== actor.uuid
        || !sourceToken || sourceToken.actor?.uuid !== actor.uuid || combat.combatant?.token?.uuid !== sourceToken.uuid
        || !targetToken?.actor || !sourceToken.parent?.id || sourceToken.parent.id !== targetToken.parent?.id
        || sourceToken.parent.tokens?.get?.(sourceToken.id) !== sourceToken || targetToken.parent.tokens?.get?.(targetToken.id) !== targetToken
        || payload.secondaryTokenUuid) {
        throw new Error("Цветение: оружие, токен или цель больше недоступны.");
      }
      if (!hasConfirmedBladeFlourishHit(payload, sender, sourceToken)) throw new Error("Цветение: подтверждённое попадание атаки не найдено.");
      const damageProperties = bladeAttackDamageProperties(payload.operationId);
      if (!damageProperties) throw new Error("Цветение: свойства урона атаки не подтверждены.");
      if (bladeAttackDamageRoll(payload.operationId)?.options?.type !== payload.damageType) throw new Error("Цветение: тип урона не совпадает с атакой.");
      const targetActorUuid = targetToken.actor.uuid;
      if (previous?.status === "reserved") throw new Error("Цветение: предыдущая операция ещё не завершена.");
      if (previous?.turnKey === turnKey && previous.status !== "cancelled") throw new Error("Цветение уже использовано в этом ходу.");
      if (payload.useMaster && !collectionValues(actor.items).some(entry => hasSourceUuid(entry, LAARU_MASTERS_FLOURISH_SOURCE_UUID))) {
        throw new Error("Цветение: мастерское цветение недоступно.");
      }
      if (!payload.useMaster && !(Number(item?.system?.uses?.value) > 0)) throw new Error("Цветение: кости вдохновения закончились.");
      const spentBefore = Number(item.system.uses.spent ?? 0);
      if (!Number.isSafeInteger(spentBefore) || spentBefore < 0) throw new Error("Цветение: некорректный расход вдохновения.");
      const previousFingerprint = JSON.stringify(previous ?? null);
      const formula = payload.useMaster ? "1d6" : inspirationFormula(item);
      const attackRoll = bladeAttackDamageRoll(payload.operationId);
      const attackCritical = attackRoll?.options?.isCritical === true;
      const critical = payload.mode === "defensive" && attackCritical;
      const attackCriticalOptions = structuredClone(attackRoll?.options?.critical ?? {});
      const attackFingerprint = JSON.stringify({ critical: attackCritical, criticalOptions: attackCriticalOptions });
      const criticalOptions = { ...attackCriticalOptions };
      delete criticalOptions.bonusDice;
      const simpleDie = /^([1-9][0-9]*)d([1-9][0-9]*)(?:(kh|kl)([1-9][0-9]*)?)?(?:\s*([+-])\s*([0-9]+(?:\.[0-9]+)?))?$/iu.exec(formula.trim());
      if (critical && !simpleDie) throw new Error("Цветение: при критическом попадании сложную формулу нужно разрешить вручную.");
      const roll = this.options.rollBladeFlourish
        ? await this.options.rollBladeFlourish(formula, payload.damageType, actor, { critical, criticalOptions })
        : await this.#rollBladeFlourish(formula, payload.damageType, actor, { critical, criticalOptions });
      const rollData = typeof roll?.toJSON === "function" ? roll.toJSON() : roll;
      const serialized = typeof rollData === "string" ? JSON.parse(rollData) : JSON.parse(JSON.stringify(rollData));
      if (!Number.isFinite(Number(serialized?.total))) throw new Error("Цветение: бросок не завершён.");
      const baseResults = critical ? roll?.dice?.[0]?.results?.slice(0, Number(simpleDie[1])) : [];
      if (critical && (!Array.isArray(baseResults) || baseResults.length !== Number(simpleDie[1])
        || baseResults.some(entry => !Number.isInteger(entry?.result) || entry.result < 1 || entry.result > Number(simpleDie[2])))) {
        throw new Error("Цветение: значение исходной кости не подтверждено.");
      }
      const modifier = critical && simpleDie[6] ? Number(simpleDie[6]) * (simpleDie[5] === "-" ? -1 : 1) : 0;
      let effectDice = critical ? baseResults.map(entry => entry.result) : [];
      if (critical && simpleDie[3]) {
        const count = Number(simpleDie[4] ?? 1);
        effectDice = effectDice.sort((a, b) => simpleDie[3].toLowerCase() === "kh" ? b - a : a - b).slice(0, count);
      }
      const effectTotal = critical ? effectDice.reduce((total, result) => total + result, modifier) : Number(serialized.total);
      if (!Number.isFinite(effectTotal)) throw new Error("Цветение: значение исходной кости не подтверждено.");
      if (!isActiveGmClient(globalThis.game)) throw new Error("Цветение: активный мастер изменился. Повторите действие.");
      if (await globalThis.fromUuid?.(payload.sourceItemUuid) !== item || await globalThis.fromUuid?.(payload.featureItemUuid) !== feature
        || await globalThis.fromUuid?.(payload.weaponItemUuid) !== weapon || await globalThis.fromUuid?.(payload.sourceTokenUuid) !== sourceToken
        || await globalThis.fromUuid?.(payload.targetTokenUuid) !== targetToken
        || !isActiveGmClient(globalThis.game)
        || !hasSourceUuid(feature, LAARU_BLADE_FLOURISH_SOURCE_UUID) || (feature.actor ?? feature.parent)?.uuid !== actor.uuid
        || weapon.type !== "weapon" || (weapon.actor ?? weapon.parent)?.uuid !== actor.uuid
        || sourceToken.actor?.uuid !== actor.uuid || targetToken.actor?.uuid !== targetActorUuid
        || JSON.stringify(bladeAttackDamageProperties(payload.operationId)) !== JSON.stringify(damageProperties)
        || bladeAttackDamageRoll(payload.operationId)?.options?.type !== payload.damageType
        || JSON.stringify({ critical: bladeAttackDamageRoll(payload.operationId)?.options?.isCritical === true,
          criticalOptions: bladeAttackDamageRoll(payload.operationId)?.options?.critical ?? {} }) !== attackFingerprint
        || !hasConfirmedBladeFlourishHit(payload, sender, sourceToken)
        || !(sender.isGM || actor?.testUserPermission?.(sender, "OWNER"))
        || Number(item.system.uses.spent ?? 0) !== spentBefore || JSON.stringify(getModuleFlags(item).bladeFlourish ?? null) !== previousFingerprint
        || (!payload.useMaster && (!(Number(item.system.uses.value) > 0) || inspirationFormula(item) !== formula))
        || (payload.useMaster && !collectionValues(actor.items).some(entry => hasSourceUuid(entry, LAARU_MASTERS_FLOURISH_SOURCE_UUID)))
        || globalThis.game?.combat !== combat || combat.round !== payload.round || combat.turn !== payload.turn
        || combat.combatant?.actor?.uuid !== actor.uuid || combat.combatant?.token?.uuid !== sourceToken.uuid
        || sourceToken.parent.tokens?.get?.(sourceToken.id) !== sourceToken || targetToken.parent.tokens?.get?.(targetToken.id) !== targetToken) {
        throw new Error("Цветение: источник или ход изменился. Повторите действие.");
      }
      const spentAfter = spentBefore + (payload.useMaster ? 0 : 1);
      await item.update({
        ...(payload.useMaster ? {} : { "system.uses.spent": spentAfter }),
        [`flags.${MODULE_ID}.bladeFlourish`]: { operationId: payload.operationId, featureItemUuid: payload.featureItemUuid,
          weaponItemUuid: payload.weaponItemUuid, sourceTokenUuid: payload.sourceTokenUuid, targetTokenUuid: payload.targetTokenUuid,
          secondaryTokenUuid: payload.secondaryTokenUuid, targetActorUuid, turnKey, mode: payload.mode,
          damageType: payload.damageType, damageProperties, attackFingerprint, useMaster: payload.useMaster, spentBefore, spentAfter, roll: serialized, effectTotal, status: "reserved" }
      });
      return { roll: structuredClone(serialized), effectTotal, targetActorUuid, replayed: false };
    });
  }

  async cancelBladeFlourish(payload, { sender } = {}) {
    return this.#runBladeFlourishOperation(payload, "cancel", sender, async (item) => {
      const previous = getModuleFlags(item).bladeFlourish;
      if (!matchesBladeFlourishIntent(previous, payload)) throw new Error("Цветение: операция не найдена или параметры изменились.");
      if (previous.status === "cancelled") return { cancelled: true, replayed: true };
      if (previous.status !== "reserved") throw new Error("Цветение уже завершено; отмена недоступна.");
      if (!globalThis.game?.messages?.get?.(payload.operationId)) throw new Error("Цветение: карточка атаки отсутствует; нужна проверка мастера.");
      if (hasAttachedBladeFlourishRoll(payload, previous, { markerOnly: true })) {
        throw new Error("Цветение: урон уже начат; для отмены нужна проверка мастера.");
      }
      if (!previous.useMaster && Number(item.system.uses.spent) !== previous.spentAfter) {
        throw new Error("Цветение: расход изменился, мастер должен проверить вдохновение.");
      }
      if (!isActiveGmClient(globalThis.game)) throw new Error("Цветение: активный мастер изменился. Повторите действие.");
      await item.update({
        ...(previous.useMaster ? {} : { "system.uses.spent": previous.spentBefore }),
        [`flags.${MODULE_ID}.bladeFlourish`]: { ...previous, status: "cancelled" }
      });
      return { cancelled: true, replayed: false };
    });
  }

  async commitBladeFlourish(payload, { sender } = {}) {
    return this.#runBladeFlourishOperation(payload, "commit", sender, async (item, actor) => {
      const previous = getModuleFlags(item).bladeFlourish;
      if (!matchesBladeFlourishIntent(previous, payload)) throw new Error("Цветение: операция не найдена или параметры изменились.");
      if (previous.status === "committed") return { committed: true, replayed: true };
      if (previous.status !== "reserved") throw new Error("Цветение: операция уже отменена.");
      if (!isActiveGmClient(globalThis.game)) throw new Error("Цветение: активный мастер изменился. Повторите действие.");
      const sourceToken = tokenDocument(await globalThis.fromUuid?.(payload.sourceTokenUuid));
      if (!sourceToken || !hasConfirmedBladeFlourishHit(payload, sender, sourceToken) || (payload.mode === "defensive" && !hasAttachedBladeFlourishRoll(payload, previous))
        || JSON.stringify(bladeAttackDamageProperties(payload.operationId)) !== JSON.stringify(previous.damageProperties)
        || bladeAttackDamageRoll(payload.operationId)?.options?.type !== payload.damageType
        || JSON.stringify({ critical: bladeAttackDamageRoll(payload.operationId)?.options?.isCritical === true,
          criticalOptions: bladeAttackDamageRoll(payload.operationId)?.options?.critical ?? {} }) !== previous.attackFingerprint) {
        throw new Error("Цветение: бросок урона не подтверждён или атака изменилась.");
      }
      let expired = false;
      if (payload.mode === "defensive") {
        const combat = globalThis.game?.combat;
        expired = bladeDefenseExpired(payload, combat);
        if (!expired && (combat.round < payload.round || (combat.round === payload.round && combat.turn < payload.turn))) {
          throw new Error("Цветение: порядок хода изменился, требуется проверка мастера.");
        }
        const existing = collectionValues(actor.effects).find(effect => effect?.flags?.[MODULE_ID]?.bladeFlourishDefense?.operationId === payload.operationId);
        if (!expired && !existing) {
          if (typeof actor.createEmbeddedDocuments !== "function") throw new Error("Цветение: эффект защиты недоступен.");
          await actor.createEmbeddedDocuments("ActiveEffect", [{
            name: "Оборонительное цветение", type: "base", system: {}, img: item.img ?? "icons/svg/shield.svg",
            disabled: false, transfer: false, origin: payload.featureItemUuid,
            changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: String(previous.effectTotal ?? previous.roll.total), priority: 20 }],
            duration: { combat: payload.combatId, rounds: 1, turns: 0, startRound: payload.round, startTurn: payload.turn },
            flags: { dae: { specialDuration: ["turnStartSource", "combatEnd"] }, [MODULE_ID]: {
              bladeFlourishDefense: { operationId: payload.operationId, sourceTokenUuid: payload.sourceTokenUuid, combatId: payload.combatId, round: payload.round, turn: payload.turn }
            } }
          }]);
        }
      }
      else {
        if (this.options.publishManualBladeFlourish) await this.options.publishManualBladeFlourish(payload, previous);
        else await this.#publishManualBladeFlourish(payload, previous);
      }
      if (!isActiveGmClient(globalThis.game)) throw new Error("Цветение: активный мастер изменился. Повторите действие.");
      const latest = getModuleFlags(item).bladeFlourish;
      if (!matchesBladeFlourishIntent(latest, payload) || latest.status !== "reserved") throw new Error("Цветение: операция изменилась; нужна проверка мастера.");
      await item.update({ [`flags.${MODULE_ID}.bladeFlourish`]: { ...latest, status: "committed" } });
      return { committed: true, replayed: false, expired };
    });
  }

  async #publishManualBladeFlourish(payload, record) {
    const id = sha256Hex(`rebreya-blade-flourish:${payload.operationId}`).slice(0, 16);
    const existing = () => globalThis.game?.messages?.get?.(id);
    const matches = message => message?.flags?.[MODULE_ID]?.bladeFlourishManual === payload.operationId;
    if (existing()) {
      if (!matches(existing())) throw new Error("Росчерк: идентификатор сообщения занят; нужна проверка мастера.");
      return;
    }
    const roll = globalThis.Roll?.fromJSON?.(JSON.stringify(record.roll));
    if (!roll?._evaluated || Number(roll.total) !== Number(record.effectTotal) || typeof roll.toMessage !== "function") {
      throw new Error("Росчерк: сохранённый бросок недоступен; нужна проверка мастера.");
    }
    const source = globalThis.game?.messages?.get?.(payload.operationId);
    const label = payload.mode === "mobile" ? "Мобильный" : "Режущий";
    const data = await roll.toMessage({ _id: id, flavor: `${label} росчерк — последствия применяются вручную.`,
      speaker: source?.speaker, flags: { [MODULE_ID]: { bladeFlourishManual: payload.operationId } } }, { create: false });
    if (Array.isArray(source?.whisper)) data.whisper = [...source.whisper];
    if (typeof source?.blind === "boolean") data.blind = source.blind;
    if (source?.author?.id) data.author = source.author.id;
    if (!isActiveGmClient(globalThis.game)) throw new Error("Росчерк: активный мастер изменился.");
    try { await globalThis.ChatMessage.create(data, { keepId: true }); }
    catch (error) { if (!matches(existing())) throw error; }
    if (!matches(existing())) throw new Error("Росчерк: сообщение не подтверждено; нужна проверка мастера.");
  }

  applyBladeFlourishPreCalculateDamage(actor, damages, options = {}) {
    if (!Array.isArray(damages)) return true;
    for (let index = damages.length - 1; index >= 0; index -= 1) {
      const properties = damages[index]?.properties;
      if (!Array.isArray(properties) && !(properties instanceof Set)) continue;
      const markers = [...properties].filter(value => typeof value === "string" && value.startsWith("rebreya-blade:"));
      if (!markers.length) continue;
      const parts = markers.length === 1 ? markers[0].split(":") : [];
      const targetTokenUuid = options?.midi?.targetUuid;
      const matches = parts.length === 4 && parts[1] && parts[2] && parts[3]
        && (targetTokenUuid ? targetTokenUuid === parts[2] : actor?.uuid === parts[3]);
      if (!matches) { damages.splice(index, 1); continue; }
      const remaining = [...properties].filter(value => value !== markers[0]);
      const key = JSON.stringify([...new Set(remaining)].sort()), current = damages[index];
      const mergeInto = damages.find((entry, otherIndex) => {
        if (otherIndex === index || entry?.type !== current?.type) return false;
        const other = entry?.properties;
        return (Array.isArray(other) || other instanceof Set)
          && ![...other].some(value => typeof value === "string" && value.startsWith("rebreya-blade:"))
          && JSON.stringify([...new Set(other)].sort()) === key;
      });
      if (mergeInto && Number.isFinite(Number(mergeInto.value)) && Number.isFinite(Number(current.value))) {
        mergeInto.value = Number(mergeInto.value) + Number(current.value);
        if (Object.hasOwn(mergeInto, "damage")) mergeInto.damage = mergeInto.value;
        if (current.formula) mergeInto.formula = [mergeInto.formula, current.formula].filter(Boolean).join(" + ");
        damages.splice(index, 1);
      } else current.properties = properties instanceof Set ? new Set(remaining) : remaining;
    }
    return true;
  }

  async expireBladeFlourishDefense(combat, actor, { ended = false, sourceTokenUuid = null } = {}) {
    if (!isActiveGmClient(globalThis.game) || !actor) return 0;
    let removed = 0;
    for (const effect of collectionValues(actor.effects)) {
      const record = effect?.flags?.[MODULE_ID]?.bladeFlourishDefense;
      if (!record || record.combatId !== combat?.id || (sourceTokenUuid && record.sourceTokenUuid !== sourceTokenUuid)
        || (!ended && !bladeDefenseExpired(record, combat))) continue;
      if (!collectionValues(actor.effects).includes(effect) || typeof effect.delete !== "function") continue;
      try { await effect.delete(); removed += 1; }
      catch (error) { if (collectionValues(actor.effects).includes(effect)) throw error; }
    }
    return removed;
  }

  async handleBladeFlourishCombatTurn(combat) {
    if (!isActiveGmClient(globalThis.game)) return 0;
    let removed = 0;
    const actors = [...collectionValues(combat?.combatants).map(combatant => combatant?.actor), combat?.combatant?.actor];
    const unique = new Map(actors.filter(actor => actor?.uuid).map(actor => [actor.uuid, actor]));
    for (const actor of unique.values()) {
      removed += await this.expireBladeFlourishDefense(combat, actor);
      removed += await this.expireBladeFlourishSpeed(combat, actor);
    }
    return removed;
  }

  async handleBladeFlourishCombatEnd(combat) {
    if (!isActiveGmClient(globalThis.game)) return 0;
    const actors = [...collectionValues(combat?.combatants).map(combatant => combatant?.actor), ...collectionValues(globalThis.game?.actors)];
    const unique = new Map(actors.filter(actor => actor?.uuid).map(actor => [actor.uuid, actor]));
    let removed = 0;
    for (const actor of unique.values()) {
      removed += await this.expireBladeFlourishDefense(combat, actor, { ended: true });
      removed += await this.expireBladeFlourishSpeed(combat, actor, { ended: true });
    }
    return removed;
  }

  async #recoverBladeFlourish(item, actor) {
    const record = getModuleFlags(item).bladeFlourish;
    if (record?.status !== "reserved" || !record.operationId || this._bladeWorkflowOperations.has(record.operationId)
      || this._bladePromptOperations.has(record.operationId)) return;
    const message = globalThis.game?.messages?.get?.(record.operationId);
    const author = message?.author;
    if (author?.active && author.id !== globalThis.game?.user?.id) return;
    if (this._bladeRecoveryPrompts.has(record.operationId)) return this._bladeRecoveryPrompts.get(record.operationId);
    const request = bladeRequestFromRecord(item, record);
    if (!isValidBladeFlourishRequest({ ...request, phase: "cancel" })) return;
    const canCancel = Boolean(message) && !hasAttachedBladeFlourishRoll(request, record, { markerOnly: true });
    const canResume = Boolean(message) && record.mode !== "defensive";
    const pending = (async () => {
      const prompt = this.options.promptBladeRecovery ?? (details => this.#promptBladeRecovery(details));
      const choice = await prompt({ actor, item, record, canCancel, canResume });
      if (choice === "cancel" && canCancel) await this.cancelBladeFlourish(request, { sender: globalThis.game.user });
      if (choice === "resume" && canResume) await this.commitBladeFlourish(request, { sender: globalThis.game.user });
    })();
    this._bladeRecoveryPrompts.set(record.operationId, pending);
    try { await pending; }
    finally { this._bladeRecoveryPrompts.delete(record.operationId); }
  }

  async #promptBladeRecovery({ actor, record, canCancel, canResume }) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.wait !== "function") {
      globalThis.ui?.notifications?.warn?.("Незавершённое цветение клинков: мастер должен проверить карточку атаки.");
      return null;
    }
    const description = canResume ? "Можно опубликовать сохранённый бросок или отменить операцию и вернуть кость."
      : canCancel ? "Урон цветения ещё не прикреплён к карточке. Можно отменить операцию и вернуть кость."
      : "Урон мог уже начаться. Проверьте карточку атаки и состояние персонажа вручную.";
    return DialogV2.wait({
      window: { title: "Незавершённое цветение клинков" },
      content: `<p>${escapeFoundryHtml(actor?.name ?? "Персонаж")}: ${description}</p><p>Карточка: ${escapeFoundryHtml(record.operationId)}</p>`,
      buttons: [
        ...(canCancel ? [{ action: "cancel", label: "Отменить и вернуть кость", callback: () => "cancel" }] : []),
        ...(canResume ? [{ action: "resume", label: "Опубликовать бросок", callback: () => "resume" }] : []),
        { action: "later", label: "Проверить позже", callback: () => null }
      ], rejectClose: false, modal: true
    });
  }

  async reconcileBladeFlourishEffects(actors) {
    if (!isActiveGmClient(globalThis.game) || !globalThis.game?.combats) return 0;
    let removed = 0;
    const unique = new Map(collectionValues(actors).filter(actor => actor?.uuid).map(actor => [actor.uuid, actor]));
    for (const actor of unique.values()) {
      const ids = new Set(collectionValues(actor.effects).flatMap(effect => [
        effect?.flags?.[MODULE_ID]?.bladeFlourishDefense?.combatId, effect?.flags?.[MODULE_ID]?.bladeFlourishSpeed?.combatId
      ]).filter(Boolean));
      for (const id of ids) {
        const combat = game.combats.get?.(id) ?? collectionValues(game.combats).find(entry => entry.id === id);
        const encounter = combat ?? { id, started: false };
        removed += await this.expireBladeFlourishDefense(encounter, actor, { ended: !combat });
        removed += await this.expireBladeFlourishSpeed(encounter, actor, { ended: !combat });
      }
      for (const item of collectionValues(actor.items).filter(isLaaruBardicInspirationItem)) await this.#recoverBladeFlourish(item, actor);
    }
    return removed;
  }

  async handleBladeFlourishCombatantRemoved(combatant) {
    if (!isActiveGmClient(globalThis.game) || !combatant?.parent || !combatant.actor || !combatant.token?.uuid) return 0;
    const combat = combatant.parent, actor = combatant.actor;
    const options = { ended: true, sourceTokenUuid: combatant.token.uuid };
    return await this.expireBladeFlourishDefense(combat, actor, options)
      + await this.expireBladeFlourishSpeed(combat, actor, options);
  }

  async #rollBladeFlourish(formula, damageType, actor, { critical = false, criticalOptions = {} } = {}) {
    const RollClass = globalThis.CONFIG?.Dice?.DamageRoll;
    if (typeof RollClass !== "function") throw new Error("Цветение: бросок урона недоступен.");
    const roll = new RollClass(`${formula}[${damageType}]`, actor.getRollData?.() ?? {}, { type: damageType, flavor: "Цветение клинков", isCritical: critical, critical: criticalOptions });
    if (!roll._evaluated) await roll.evaluate();
    return roll;
  }

  async restoreBardicInspiration(actor, { amount = 1 } = {}) {
    const item = this.findBardicInspirationItem(actor);
    if (!item) {
      return { restored: false, reason: "missing-bardic-inspiration" };
    }

    const spent = Math.max(0, Math.floor(toNumber(item?.system?.uses?.spent, 0)));
    const restoreAmount = Math.max(1, Math.floor(toNumber(amount, 1)));
    const nextSpent = Math.max(0, spent - restoreAmount);
    if (nextSpent === spent) {
      return { restored: false, reason: "already-full", item };
    }

    if (typeof item.update === "function") {
      await item.update({ "system.uses.spent": nextSpent });
    }
    else {
      setProperty(item, "system.uses.spent", nextSpent);
    }

    return {
      restored: true,
      item,
      previousSpent: spent,
      nextSpent
    };
  }

  async applyDnd5ePostUseActivity(activity, _usageConfig = {}, _results = {}) {
    const item = activity?.item ?? activity?.parent ?? null;
    if (isGrantActivity(activity)) {
      const message = _results.message;
      if (!message?.id) throw new Error("Вдохновение: требуется сообщение успешного использования с расходом заряда.");
      if (this._usageOperations.has(message.id)) return this._usageOperations.get(message.id);
      const target = this.#selectedTarget(_usageConfig, _results);
      const actor = activity.actor ?? item.actor;
      validateRecipient(actor, target, sourceToken(actor));
      const payload = {
        operationId: message.id, sourceItemUuid: item.uuid, activityId: activity.id ?? activity._id,
        targetActorUuid: target.actor.uuid, sourceTokenUuid: sourceToken(actor)?.uuid ?? "", targetTokenUuid: target.token?.uuid ?? ""
      };
      const pending = this.moduleApi?.socketCommandBus?.request
        ? this.moduleApi.socketCommandBus.request(BARDIC_INSPIRATION_GRANT_COMMAND, payload)
        : this.grantInspiration(payload, { sender: globalThis.game?.user });
      this._usageOperations.set(message.id, pending);
      try { await pending; }
      catch (error) { this._usageOperations.delete(message.id); throw error; }
      if (this._usageOperations.size > 64) this._usageOperations.delete(this._usageOperations.keys().next().value);
      return true;
    }
    if (!isBardicInspirationRestoreItem(item)) {
      return true;
    }

    const actor = activity?.actor ?? item?.actor ?? item?.parent ?? null;
    await this.restoreBardicInspiration(actor);
    return true;
  }

  #selectedTarget(usageConfig, results = {}) {
    const entries = usageConfig.targets != null ? collectionValues(usageConfig.targets)
      : collectionValues(results.message?.flags?.dnd5e?.targets).length ? collectionValues(results.message.flags.dnd5e.targets)
        : collectionValues(globalThis.game?.user?.targets);
    const targets = entries.map(resolveTarget).filter(Boolean);
    return targets.length === 1 ? targets[0] : null;
  }

  applyDnd5ePreUseActivity(activity, usageConfig = {}) {
    if (!isGrantActivity(activity)) return true;
    try {
      validateRecipient(activity.actor ?? activity.item.actor, this.#selectedTarget(usageConfig), sourceToken(activity.actor ?? activity.item.actor));
      return true;
    } catch (error) {
      globalThis.ui?.notifications?.warn(error.message);
      return false;
    }
  }

  async canGrantInspiration(payload, { sender } = {}) {
    if (!isValidBardicInspirationGrant(payload) || !sender) return false;
    const item = await globalThis.fromUuid?.(payload.sourceItemUuid);
    const actor = item?.actor ?? item?.parent;
    return Boolean(isLaaruBardicInspirationItem(item) && (sender.isGM || actor?.testUserPermission?.(sender, "OWNER")));
  }

  async grantInspiration(payload, context = {}) {
    if (!isValidBardicInspirationGrant(payload)) throw new Error("Вдохновение: недопустимые параметры источника или цели.");
    if (!isActiveGmClient(globalThis.game)) throw new Error("Вдохновение выдаёт активный GM.");
    const item = await globalThis.fromUuid?.(payload.sourceItemUuid);
    if (!isLaaruBardicInspirationItem(item)) throw new Error("Источник не является вдохновением Laaru.");
    if (!await this.canGrantInspiration(payload, context)) throw new Error("Требуются права владельца источника вдохновения.");
    const actor = item.actor ?? item.parent;
    const activity = item.system?.activities?.get?.(payload.activityId);
    if (!isGrantActivity(activity)) throw new Error("Активность не выдаёт Бардовское вдохновение.");
    const targetActor = await globalThis.fromUuid?.(payload.targetActorUuid);
    const origin = payload.sourceTokenUuid ? tokenDocument(await globalThis.fromUuid?.(payload.sourceTokenUuid)) : null;
    const token = payload.targetTokenUuid ? tokenDocument(await globalThis.fromUuid?.(payload.targetTokenUuid)) : null;
    if (!targetActor || (payload.sourceTokenUuid && origin?.actor?.uuid !== actor.uuid)
      || (payload.targetTokenUuid && token?.actor?.uuid !== targetActor.uuid)) throw new Error("Токен не соответствует источнику или цели вдохновения.");
    const message = globalThis.game?.messages?.get?.(payload.operationId);
    const native = message?.flags?.dnd5e;
    if (!message || native?.messageType !== "usage" || native.item?.uuid !== item.uuid || native.activity?.id !== payload.activityId) {
      throw new Error("Вдохновение: не найдено сообщение использования исходной активности.");
    }
    if (!collectionValues(native.targets).some(entry => entry.uuid === targetActor.uuid)) throw new Error("Цель не соответствует исходному использованию вдохновения.");
    if (!collectionValues(native.use?.consumed?.item?.[item.id]).some(delta => delta.keyPath === "system.uses.spent" && Number(delta.delta) >= 1)) {
      throw new Error("Вдохновение: использование не подтверждает расход заряда.");
    }
    const existing = getProperty(message, RECEIPT);
    const matching = collectionValues(targetActor.effects).find(effect => effect.flags?.[MODULE_ID]?.d20Bonus?.operationId === payload.operationId);
    const activate = async effect => {
      if (effect.flags?.[MODULE_ID]?.d20Bonus?.grantPending) {
        await effect.update({ disabled: false, [`flags.${MODULE_ID}.d20Bonus.grantPending`]: false });
      }
    };
    if (existing?.complete) {
      if (matching) await activate(matching);
      return { granted: false, reason: "already-granted" };
    }
    if (matching) {
      await message.update({ [RECEIPT]: { ...existing, complete: true } });
      await activate(matching);
      return { granted: false, reason: "already-granted" };
    }
    if (existing) throw new Error("Исход выдачи вдохновения не подтверждён: GM должен проверить расход и эффект перед повторной выдачей.");
    const measured = validateRecipient(actor, { actor: targetActor, token }, origin);
    const now = Number(globalThis.game?.time?.worldTime ?? 0);
    const startTime = existing?.startTime ?? now;
    if (now >= startTime + 600) { await message.update({ [RECEIPT]: { ...existing, complete: true } }); return { granted: false, reason: "expired" }; }
    const formula = inspirationFormula(item);
    await message.update({ [RECEIPT]: { startTime, complete: false, phase: "creating", targetActorUuid: targetActor.uuid } });
    const [effect] = await targetActor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Бардовское вдохновение", img: item.img ?? "icons/skills/trades/music-singing-voice-blue.webp",
      type: "base", system: {}, changes: [], disabled: true, transfer: false, origin: item.uuid,
      duration: { startTime, seconds: 600 },
      flags: { [MODULE_ID]: { d20Bonus: {
        kind: BARDIC_KIND, label: "Бардовское вдохновение", sourceName: "Бардовское вдохновение", formula,
        mode: "add", prompt: true, deleteOnUse: true, sourceItemUuid: item.uuid, operationId: payload.operationId, grantPending: true
      } } }
    }]);
    await message.update({ [RECEIPT]: { startTime, complete: true, targetActorUuid: targetActor.uuid } });
    await activate(effect);
    for (const old of collectionValues(targetActor.effects)) if (old !== effect && bardicEffect(old) && !isAvailableD20BonusEffect(old)) await old.delete();
    if (!measured) globalThis.ui?.notifications?.info("Вдохновение выдано: дистанцию 60 футов и слышимость проверьте вручную.");
    return { granted: true, effectUuid: effect.uuid };
  }
}
