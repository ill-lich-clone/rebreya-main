import { MODULE_ID } from "../constants.js";
import { collectionValues, finiteNumber as toNumber } from "../shared/foundry-values.js";
import { isAvailableD20BonusEffect } from "./d20-bonus-roll.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { BARDIC_INSPIRATION_GRANT_COMMAND, isValidBardicInspirationGrant } from "../infrastructure/foundry/bardic-inspiration-command.js";

export const LAARU_BARDIC_INSPIRATION_SOURCE_UUID = "Compendium.laaru-dnd5-hw.classfeatures.Item.hpLNiGq7y67d2EHA";
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
  const level = Number(actor?.classes?.bard?.system?.levels
    ?? collectionValues(actor?.items).find(entry => entry.type === "class" && entry.system?.identifier === "bard")?.system?.levels ?? 1);
  const fallback = `d${level >= 15 ? 12 : level >= 10 ? 10 : level >= 5 ? 8 : 6}`;
  const rollActivity = item.system?.activities?.get?.("2Enk7AiD901iQmfz");
  const authored = cleanText(item.system?.formula || rollActivity?.roll?.formula, "1@scale.bard.inspiration");
  const formula = authored.replace(/@([A-Za-z0-9_.-]+)/gu, (_match, path) => {
    const value = getProperty(data, path);
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
  constructor(moduleApi = null) {
    this.moduleApi = moduleApi;
    this._usageOperations = new Map();
  }

  findBardicInspirationItem(actor) {
    return collectionValues(actor?.items).find((item) => isLaaruBardicInspirationItem(item)) ?? null;
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
