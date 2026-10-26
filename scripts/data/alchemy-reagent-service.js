import { MODULE_ID } from "../constants.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";
import { buildAlchemyActivities } from "./alchemy-automation.js?v=1.5.11";
import { getActiveGm, isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const USE_FLAG = "alchemyPotionUse";
const EFFECT_FLAG = "alchemyReagent";
const OPERATIONS_FLAG = "alchemyReagentOperations";
export const ALCHEMY_REAGENT_JOURNAL = "alchemyReagentJournal";

export function registerAlchemyReagentSettings(game = globalThis.game) {
  game.settings.register(MODULE_ID, ALCHEMY_REAGENT_JOURNAL, {
    scope: "world", config: false, type: Object, default: { version: 1, records: {} }
  });
}

function normalizeReservationJournal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { version: 1, records: {} };
  if (value.version !== 1 || !value.records || typeof value.records !== "object" || Array.isArray(value.records)) {
    throw new Error("Неподдерживаемый журнал применений зелий.");
  }
  return value;
}

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  return typeof collection?.values === "function" ? Array.from(collection.values()) : [];
}

function fixedDuration(duration) {
  if (duration === "Мгновенно") return 0;
  const match = /^(\d+)\s+(минут\S*|час\S*)$/u.exec(String(duration ?? "").trim());
  return match ? Number(match[1]) * (match[2].startsWith("час") ? 3600 : 60) : null;
}

function validLevel(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000;
}

function validDuration(product, seconds) {
  const duration = String(product?.duration ?? "").trim();
  const fixed = fixedDuration(duration);
  if (fixed !== null) return seconds === fixed;
  if (duration === "1к4 часа") return [3600, 7200, 10800, 14400].includes(seconds);
  if (duration === "Мгновенно или 1 час") return seconds === 0 || seconds === 3600;
  return false;
}

export function getActiveAlchemyReagentEffects(actor, worldTime = globalThis.game?.time?.worldTime ?? 0) {
  const now = Number(worldTime);
  return collectionValues(actor?.effects).filter((effect) => {
    const data = effect?.flags?.[MODULE_ID]?.[EFFECT_FLAG];
    if (effect?.disabled || effect?.isSuppressed || !validLevel(data?.level)
      || !Number.isFinite(data?.expiresAt) || !Number.isFinite(now) || now >= data.expiresAt) return false;
    return true;
  });
}

export function calculateActiveReagentTotal(actor, worldTime = globalThis.game?.time?.worldTime ?? 0) {
  return getActiveAlchemyReagentEffects(actor, worldTime).reduce(
    (total, effect) => total + effect.flags[MODULE_ID][EFFECT_FLAG].level, 0
  );
}

async function defaultChooseDuration() {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.wait) throw new Error("Не удалось выбрать длительность зелья.");
  const result = await DialogV2.wait({
    window: { title: "Длительность зелья" },
    content: "<p>Выберите применяемый эффект.</p>",
    buttons: [
      { action: "instant", label: "Мгновенно", callback: () => 0 },
      { action: "hour", label: "1 час", callback: () => 3600 },
      { action: "cancel", label: "Отмена", type: "button", callback: () => null }
    ]
  });
  return result === "cancel" ? null : result;
}

async function defaultAskReagentLevel() {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.wait) throw new Error("Не удалось запросить уровень реагентов.");
  const result = await DialogV2.wait({
    window: { title: "Уровень реагентов" },
    content: '<p>Укажите уровень реагентов из правил зелья.</p><input name="level" type="number" min="0" max="1000" step="1" required>',
    buttons: [
      { action: "save", label: "Применить", callback: (_event, button) => {
        const value = button?.form?.elements?.namedItem?.("level")?.value;
        return value === "" || value == null ? null : Number(value);
      } },
      { action: "cancel", label: "Отмена", type: "button", callback: () => null }
    ]
  });
  return result === "cancel" ? null : result;
}

async function defaultRollHours() {
  const roll = await new globalThis.Roll("1d4").evaluate();
  await roll.toMessage?.({ flavor: "Длительность действия зелья (часы)" });
  return roll.total;
}

export async function resolveAlchemyPotionUse(product, {
  chooseDuration = defaultChooseDuration,
  askReagentLevel = defaultAskReagentLevel,
  rollHours = defaultRollHours
} = {}) {
  const duration = String(product?.duration ?? "").trim();
  let durationSeconds = fixedDuration(duration);
  if (duration === "1к4 часа") {
    const hours = await rollHours();
    if (!Number.isInteger(hours) || hours < 1 || hours > 4) throw new Error("Некорректный бросок длительности зелья.");
    durationSeconds = hours * 3600;
  }
  else if (duration === "Мгновенно или 1 час") {
    durationSeconds = await chooseDuration();
    if (durationSeconds == null) return null;
  }
  if (!validDuration(product, durationSeconds)) throw new Error("Неизвестная длительность зелья.");
  let reagentLevel = product?.reagentLevel ?? null;
  if (durationSeconds > 0 && reagentLevel === null) {
    reagentLevel = await askReagentLevel();
    if (reagentLevel == null) return null;
  }
  if (reagentLevel !== null && !validLevel(reagentLevel)) throw new Error("Некорректный уровень реагентов.");
  return { reagentLevel, durationSeconds };
}

function selectedTarget(game) {
  const targets = collectionValues(game?.user?.targets);
  if (targets.length !== 1 || !targets[0]?.actor) return null;
  return { actor: targets[0].actor, tokenUuid: targets[0].document?.uuid ?? targets[0].uuid ?? "" };
}

function ownsActor(actor, sender) {
  if (sender?.isGM) return true;
  if (typeof actor?.testUserPermission === "function") return actor.testUserPermission(sender, "OWNER");
  return Number(actor?.ownership?.[sender?.id] ?? actor?.ownership?.default ?? 0) >= 3;
}

function consumedItem(message, actor, itemId) {
  const consumed = message?.flags?.dnd5e?.use?.consumed;
  const deleted = consumed?.deleted?.find?.((item) => String(item?._id ?? item?.id) === itemId);
  if (deleted) return deleted;
  const changes = consumed?.item?.[itemId];
  const spent = Array.isArray(changes) && changes.some(({ keyPath, delta }) => (
    (keyPath === "system.quantity" && Number(delta) < 0)
    || (keyPath === "system.uses.spent" && Number(delta) > 0)
  ));
  if (!spent) return null;
  return actor?.items?.get?.(itemId) ?? collectionValues(actor?.items).find((item) => String(item?.id ?? item?._id) === itemId);
}

function productQuantity(actor, productId, excludedItemId = "") {
  return collectionValues(actor?.items).reduce((total, item) => {
    if (String(item?.id ?? item?._id) === excludedItemId
      || item?.flags?.[MODULE_ID]?.alchemyProductId !== productId) return total;
    const quantity = Number(item?.system?.quantity);
    return total + (Number.isInteger(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
}

export class AlchemyReagentService {
  #pending = new Map();
  #midiUses = new WeakMap();

  constructor(options = {}) {
    this.game = options.game ?? globalThis.game;
    this.fromUuid = options.fromUuid ?? globalThis.fromUuid;
    this.getProduct = options.getProduct ?? (async () => null);
    this.mutationRequester = options.mutationRequester;
    this.reservationRequester = options.reservationRequester;
    this.cancellationRequester = options.cancellationRequester;
    this.reservationRepository = options.reservationRepository;
    this.receiptWaitMs = options.receiptWaitMs ?? 3000;
    this.operationIdFactory = options.operationIdFactory ?? (() => (
      globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    ));
    this.chooseDuration = options.chooseDuration ?? defaultChooseDuration;
    this.askReagentLevel = options.askReagentLevel ?? defaultAskReagentLevel;
    this.rollHours = options.rollHours ?? defaultRollHours;
    this.notify = options.notify ?? ((message) => globalThis.ui?.notifications?.warn?.(message));
    this.schedule = options.schedule ?? ((operation) => {
      Promise.resolve().then(operation).catch((error) => this.notify(error?.message ?? "Не удалось использовать зелье."));
    });
  }

  handlePreUse(activity, usageConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const flags = activity?.flags?.[MODULE_ID];
    if (flags?.alchemyAutomation?.kind !== "potion") return true;
    const actor = activity.actor ?? activity.item?.actor;
    const selection = selectedTarget(this.game);
    const target = selection?.actor;
    if (!actor?.uuid || !target?.uuid) {
      this.notify("Выберите ровно одно существо, которое выпьет зелье.");
      return false;
    }
    const productId = flags.alchemyAutomation.productId;
    const itemFlags = activity.item?.flags?.[MODULE_ID] ?? {};
    const data = { ...(flags.alchemyReagent ?? {}) };
    if (Object.hasOwn(itemFlags, "reagentLevel")) data.reagentLevel = itemFlags.reagentLevel;
    const resume = usageConfig?.[MODULE_ID]?.alchemyPotionResume;
    if (resume && (resume.productId !== productId || resume.targetActorUuid !== target.uuid)) {
      if (resume.reservationId && this.cancellationRequester) this.schedule(() => this.cancellationRequester(resume.reservationId));
      this.notify("Цель зелья изменилась; применение отменено.");
      return false;
    }
    const fixed = fixedDuration(data.duration);
    let details = resume?.productId === productId && resume?.targetActorUuid === target.uuid ? resume : null;
    if (!details && fixed !== null && (fixed === 0 || validLevel(data.reagentLevel))) {
      details = { durationSeconds: fixed, reagentLevel: data.reagentLevel ?? null };
    }
    const foreignTarget = target.isOwner === false && this.game?.user?.isGM !== true;
    if (foreignTarget && details?.durationSeconds > 0 && !getActiveGm(this.game)) {
      this.notify("Для применения зелья к другому существу требуется активный Мастер.");
      return false;
    }
    const needsReservation = foreignTarget && details?.durationSeconds > 0 && !details?.reservationId;
    if (!details || needsReservation) {
      this.schedule(async () => {
        const result = details ?? await resolveAlchemyPotionUse(data, this);
        if (!result) return;
        let reservationId = "";
        if (foreignTarget && result.durationSeconds > 0) {
          if (!getActiveGm(this.game)) throw new Error("Для применения зелья к другому существу требуется активный Мастер.");
          reservationId = this.operationIdFactory();
          if (!reservationId || !selection.tokenUuid || typeof this.reservationRequester !== "function") {
            throw new Error("Не удалось подготовить применение зелья к другой цели.");
          }
          await this.reservationRequester({
            operationId: reservationId,
            sourceActorUuid: actor.uuid,
            sourceItemId: String(activity.item?.id ?? ""),
            targetActorUuid: target.uuid,
            targetTokenUuid: selection.tokenUuid,
            productId,
            durationSeconds: result.durationSeconds,
            reagentLevel: result.reagentLevel
          });
        }
        try {
          const sourceItem = actor.items?.get?.(activity.item?.id);
          const sourceActivity = sourceItem?.system?.activities?.get?.(activity.id)
            ?? sourceItem?.system?.activities?.[activity.id];
          if (typeof sourceActivity?.use !== "function") throw new Error("Зелье больше недоступно.");
          const nextUsage = { ...usageConfig, [MODULE_ID]: { ...(usageConfig[MODULE_ID] ?? {}),
            alchemyPotionResume: { ...result, productId, targetActorUuid: target.uuid, ...(reservationId ? { reservationId } : {}) } } };
          delete nextUsage.workflow;
          const nextMessage = { ...messageConfig };
          delete nextMessage.workflow;
          const used = await sourceActivity.use(nextUsage, dialogConfig, nextMessage);
          if (!used && reservationId && this.cancellationRequester) await this.cancellationRequester(reservationId);
        }
        catch (error) {
          if (reservationId && this.cancellationRequester) await this.cancellationRequester(reservationId);
          throw error;
        }
      });
      return false;
    }
    messageConfig.data ??= {};
    messageConfig.data.flags ??= {};
    messageConfig.data.flags[MODULE_ID] ??= {};
    messageConfig.data.flags[MODULE_ID][USE_FLAG] = {
      sourceActorUuid: actor.uuid,
      targetActorUuid: target.uuid,
      productId,
      durationSeconds: details.durationSeconds,
      reagentLevel: details.reagentLevel,
      ...(details.reservationId ? { reservationId: details.reservationId } : {})
    };
    return true;
  }

  handlePreConsumption(activity) {
    if (activity?.flags?.[MODULE_ID]?.alchemyConsumeOwnQuantity !== true) return true;
    const targets = collectionValues(activity?.consumption?.targets).filter((target) => target?.type === "material");
    const itemId = activity?.item?.id;
    if (targets.length !== 1 || !itemId) {
      this.notify("Не удалось определить расходуемый экземпляр зелья.");
      return false;
    }
    if (typeof targets[0].updateSource === "function") targets[0].updateSource({ target: itemId });
    else targets[0].target = itemId;
    return true;
  }

  async #inspectReservation(payload, sender) {
    if (!isActiveGmClient(this.game) || !payload || !/^[a-zA-Z0-9]{1,64}$/u.test(String(payload.operationId ?? ""))) {
      throw new Error("Недоступна проверка применения зелья Мастером.");
    }
    const actor = await this.fromUuid(payload.sourceActorUuid);
    const target = await this.fromUuid(payload.targetActorUuid);
    const token = await this.fromUuid(payload.targetTokenUuid);
    if (!actor || actor.uuid !== payload.sourceActorUuid || !ownsActor(actor, sender)
      || !target || target.uuid !== payload.targetActorUuid || token?.uuid !== payload.targetTokenUuid
      || token?.actor?.uuid !== target.uuid) throw new Error("Источник или цель зелья не авторизованы.");
    const scene = token.parent;
    if (!scene || (!sender?.isGM && (sender?.viewedScene !== scene.id || token.hidden === true
      || !collectionValues(scene.tokens).some((entry) => entry?.actor?.uuid === actor.uuid)))) {
      throw new Error("Цель зелья недоступна на сцене персонажа.");
    }
    const selected = collectionValues(sender?.targets);
    if (!sender?.isGM && selected.length && !selected.some((entry) => (entry?.document?.uuid ?? entry?.uuid) === token.uuid)) {
      throw new Error("Цель зелья не выбрана отправителем.");
    }
    const item = actor.items?.get?.(payload.sourceItemId);
    const itemFlags = item?.flags?.[MODULE_ID];
    const product = await this.getProduct(payload.productId);
    const expectedActivities = product ? buildAlchemyActivities(product) : {};
    const activityId = Object.keys(expectedActivities)[0];
    const activity = item?.system?.activities?.get?.(activityId) ?? item?.system?.activities?.[activityId];
    const level = Object.hasOwn(itemFlags ?? {}, "reagentLevel") ? itemFlags.reagentLevel : product?.reagentLevel;
    if (item?.type !== "consumable" || itemFlags?.managed !== true || itemFlags.sourceType !== "alchemyProduct"
      || itemFlags.alchemyProductId !== payload.productId || !product || product.productType !== "Зелье"
      || itemFlags.sourceNumber !== product.sourceNumber || itemFlags.productType !== product.productType
      || !activity || productQuantity(actor, product.id) < 1 || !validDuration(product, payload.durationSeconds)
      || payload.durationSeconds <= 0 || (level == null ? !validLevel(payload.reagentLevel) : level !== payload.reagentLevel)) {
      throw new Error("Зелье или его параметры не подтверждены.");
    }
    return { actor, target, item, product };
  }

  async authorizeReservation(payload, sender) {
    try { await this.#inspectReservation(payload, sender); return true; }
    catch { return false; }
  }

  async reserveUse(payload, { sender } = {}) {
    const { actor, item, product } = await this.#inspectReservation(payload, sender);
    const snapshot = { type: item.type, flags: structuredClone(item.flags ?? {}) };
    const quantity = productQuantity(actor, product.id);
    return this.#mutateReservations((journal) => {
      for (const [id, entry] of Object.entries(journal)) {
        if (entry?.expiresAt <= Date.now()) delete journal[id];
      }
      const existing = journal[payload.operationId];
      if (existing) {
        if (existing.senderId === sender?.id && JSON.stringify(existing.payload) === JSON.stringify(payload)) return { status: "reserved" };
        throw new Error("Идентификатор применения зелья уже используется.");
      }
      if (Object.values(journal).some((entry) => !entry.consumed
        && entry.payload?.sourceActorUuid === payload.sourceActorUuid && entry.payload?.sourceItemId === payload.sourceItemId)) {
        throw new Error("Дождитесь завершения предыдущего применения этого зелья.");
      }
      journal[payload.operationId] = {
        payload: structuredClone(payload), senderId: sender.id, itemSnapshot: snapshot,
        quantity, expiresAt: Date.now() + 1800000, consumed: false, claimedMessageUuid: null
      };
      return { status: "reserved" };
    });
  }

  async cancelReservation(operationId, { sender } = {}) {
    return this.#mutateReservations((journal) => {
      const reservation = journal[operationId];
      if (!reservation || (reservation.senderId !== sender?.id && !sender?.isGM)) return false;
      delete journal[operationId];
      return true;
    });
  }

  canCancelReservation(operationId, sender) {
    const reservation = this.#readReservations()[operationId];
    return Boolean(reservation && (reservation.senderId === sender?.id || sender?.isGM));
  }

  async observeItemConsumption(item, changed = {}, userId, { deleted = false } = {}) {
    if (!isActiveGmClient(this.game)) return;
    if (!deleted && !Object.hasOwn(changed, "system.quantity") && changed?.system?.quantity === undefined) return;
    const actor = item?.parent ?? item?.actor;
    const itemId = String(item?.id ?? item?._id ?? "");
    const now = Date.now();
    const productId = item?.flags?.[MODULE_ID]?.alchemyProductId;
    if (!actor?.uuid || !itemId || !productId) return;
    const pending = Object.values(this.#readReservations()).some((reservation) => (
      !reservation.consumed && reservation.expiresAt > now
      && reservation.payload.sourceActorUuid === actor.uuid && reservation.payload.productId === productId
    ));
    if (!pending) return;
    const quantity = productQuantity(actor, productId, deleted ? itemId : "");
    await this.#mutateReservations((journal) => {
      const candidates = Object.values(journal).filter((reservation) => (
        !reservation.consumed && reservation.expiresAt > now
        && reservation.payload.sourceActorUuid === actor.uuid && reservation.payload.productId === productId
      ));
      const matched = candidates.find((reservation) => reservation.senderId === userId
        && reservation.payload.sourceItemId === itemId && quantity < reservation.quantity);
      for (const reservation of candidates) reservation.quantity = quantity;
      if (matched) matched.consumed = true;
    });
  }

  #readReservations() {
    if (typeof this.reservationRepository?.readObject !== "function") throw new Error("Журнал применений зелий недоступен.");
    return this.reservationRepository.readObject(ALCHEMY_REAGENT_JOURNAL, { normalize: normalizeReservationJournal }).records;
  }

  #mutateReservations(mutator) {
    if (typeof this.reservationRepository?.mutateObject !== "function") throw new Error("Журнал применений зелий недоступен.");
    return this.reservationRepository.mutateObject(ALCHEMY_REAGENT_JOURNAL,
      (journal) => mutator(journal.records), { normalize: normalizeReservationJournal });
  }

  async #waitForReceipt(operationId) {
    const deadline = Date.now() + Math.max(0, this.receiptWaitMs);
    while (true) {
      const reservation = this.#readReservations()[operationId];
      if (!reservation || reservation.expiresAt <= Date.now()) return null;
      if (reservation.consumed) return reservation;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)));
    }
  }

  async handleUse(_activity, usageConfig = {}, results = {}) {
    const message = results?.message;
    if (!message?.flags?.[MODULE_ID]?.[USE_FLAG]) return;
    const workflow = usageConfig?.workflow;
    if (workflow && typeof workflow === "object") {
      this.#midiUses.set(workflow, message);
      return;
    }
    await this.#dispatch(message);
  }

  async handleMidiComplete(workflow) {
    const message = workflow && this.#midiUses.get(workflow);
    if (!message) return;
    this.#midiUses.delete(workflow);
    await this.#dispatch(message);
  }

  async handleMidiAbort(workflow) {
    const message = workflow && this.#midiUses.get(workflow);
    if (!message) return;
    this.#midiUses.delete(workflow);
    const reservationId = message.flags?.[MODULE_ID]?.[USE_FLAG]?.reservationId;
    if (reservationId && this.cancellationRequester) await this.cancellationRequester(reservationId);
  }

  async #dispatch(message) {
    const use = message.flags[MODULE_ID][USE_FLAG];
    if (use.durationSeconds === 0) return;
    const target = await this.fromUuid(use.targetActorUuid);
    if (target?.isOwner) return this.applyRecordedUse(message, { sender: this.game?.user });
    if (typeof this.mutationRequester !== "function") throw new Error("Недоступен Мастер для учёта реагентов.");
    return this.mutationRequester({ messageUuid: message.uuid });
  }

  async #inspect(message, sender) {
    const use = message?.flags?.[MODULE_ID]?.[USE_FLAG];
    const dnd = message?.flags?.dnd5e;
    const authorId = message?.author?.id ?? message?.user?.id ?? message?.user;
    if (!use || !message?.uuid || !/^[a-zA-Z0-9]{1,64}$/u.test(String(message.id ?? ""))
      || String(authorId ?? "") !== String(sender?.id ?? "")) throw new Error("Неверное сообщение применения зелья.");
    const actor = await this.fromUuid(use.sourceActorUuid);
    const target = await this.fromUuid(use.targetActorUuid);
    if (!actor || actor.uuid !== use.sourceActorUuid || !ownsActor(actor, sender)
      || !target || target.uuid !== use.targetActorUuid) throw new Error("Применение зелья не авторизовано.");
    if (!Array.isArray(dnd?.targets) || dnd.targets.length !== 1 || dnd.targets[0]?.uuid !== target.uuid) {
      throw new Error("Цель зелья не совпадает с выбранным существом.");
    }
    const itemId = String(dnd?.item?.id ?? "");
    if (!itemId || dnd.item.uuid !== `${actor.uuid}.Item.${itemId}`) throw new Error("Источник зелья не совпадает с персонажем.");
    const operations = target.getFlag?.(MODULE_ID, OPERATIONS_FLAG) ?? target.flags?.[MODULE_ID]?.[OPERATIONS_FLAG] ?? {};
    const existingEffect = collectionValues(target.effects).find((effect) => effect?.flags?.[MODULE_ID]?.[EFFECT_FLAG]?.operationId === message.uuid);
    const alreadyHandled = Boolean(operations[String(message.id)] || existingEffect);
    let reservation = null;
    if (!ownsActor(target, sender) && !sender?.isGM && !alreadyHandled) {
      reservation = await this.#waitForReceipt(use.reservationId);
      const expected = reservation?.payload;
      if (!reservation || reservation.expiresAt <= Date.now() || reservation.senderId !== sender.id
        || expected.sourceActorUuid !== actor.uuid || expected.sourceItemId !== itemId
        || expected.targetActorUuid !== target.uuid || expected.productId !== use.productId
        || expected.durationSeconds !== use.durationSeconds || expected.reagentLevel !== use.reagentLevel
        || (reservation.claimedMessageUuid && reservation.claimedMessageUuid !== message.uuid)) throw new Error("Расход зелья не подтверждён Мастером.");
    }
    const item = reservation?.itemSnapshot ?? consumedItem(message, actor, itemId);
    const itemFlags = item?.flags?.[MODULE_ID];
    const product = await this.getProduct(use.productId);
    if (!item || item.type !== "consumable" || itemFlags?.managed !== true
      || itemFlags.sourceType !== "alchemyProduct" || itemFlags.alchemyProductId !== use.productId
      || !product || product.productType !== "Зелье" || product.id !== use.productId
      || itemFlags.sourceNumber !== product.sourceNumber || itemFlags.productType !== product.productType
      || !Object.hasOwn(buildAlchemyActivities(product), dnd?.activity?.id ?? "")) {
      throw new Error("Расход зелья не подтверждён.");
    }
    const authoredLevel = Object.hasOwn(itemFlags, "reagentLevel") ? itemFlags.reagentLevel : product.reagentLevel;
    if (!validDuration(product, use.durationSeconds)
      || (authoredLevel == null
        ? (use.durationSeconds > 0 ? !validLevel(use.reagentLevel) : use.reagentLevel !== null)
        : use.reagentLevel !== authoredLevel)) throw new Error("Параметры реагентов не совпадают с предметом.");
    return { target, product, use, reservation };
  }

  async authorizeRecordedUse(message, sender) {
    try { await this.#inspect(message, sender); return true; }
    catch { return false; }
  }

  async applyRecordedUse(message, { sender } = {}) {
    const key = message?.uuid;
    if (this.#pending.has(key)) return this.#pending.get(key);
    const pending = this.#applyRecordedUse(message, sender);
    this.#pending.set(key, pending);
    try { return await pending; }
    finally { this.#pending.delete(key); }
  }

  async #applyRecordedUse(message, sender) {
    const { target, product, use, reservation } = await this.#inspect(message, sender);
    if (reservation) {
      await this.#mutateReservations((journal) => {
        const current = journal[use.reservationId];
        if (!current?.consumed || (current.claimedMessageUuid && current.claimedMessageUuid !== message.uuid)) {
          throw new Error("Расход зелья уже использован.");
        }
        current.claimedMessageUuid = message.uuid;
      });
    }
    if (use.durationSeconds === 0) return { status: "instant" };
    const operationId = String(message.id);
    const operations = target.getFlag?.(MODULE_ID, OPERATIONS_FLAG) ?? target.flags?.[MODULE_ID]?.[OPERATIONS_FLAG] ?? {};
    if (operations[operationId]) return { status: "already-applied" };
    const existing = collectionValues(target.effects).find((effect) => effect?.flags?.[MODULE_ID]?.[EFFECT_FLAG]?.operationId === message.uuid);
    if (!existing) {
      const startTime = Number(this.game?.time?.worldTime ?? 0);
      if (!Number.isFinite(startTime)) throw new Error("Недоступно игровое время.");
      await target.createEmbeddedDocuments("ActiveEffect", [{
        _id: createStableGearDocumentId(`alchemy-reagent:${message.uuid}:${target.uuid}`),
        name: product.name,
        img: product.icon ? `modules/${MODULE_ID}/${product.icon}` : "icons/svg/potion.svg",
        disabled: false,
        transfer: false,
        changes: [],
        duration: { seconds: use.durationSeconds, startTime },
        flags: { [MODULE_ID]: { [EFFECT_FLAG]: {
          level: use.reagentLevel, expiresAt: startTime + use.durationSeconds,
          operationId: message.uuid, productId: product.id
        } } }
      }], { keepId: true });
    }
    await target.setFlag(MODULE_ID, `${OPERATIONS_FLAG}.${operationId}`, true);
    if (reservation) await this.#mutateReservations((journal) => {
      if (journal[use.reservationId]?.claimedMessageUuid === message.uuid) delete journal[use.reservationId];
    });
    return { status: existing ? "recovered" : "applied" };
  }

  refreshOpenSheets() {
    const v2Apps = new Set(collectionValues(globalThis.foundry?.applications?.instances));
    const apps = new Set([...Object.values(globalThis.ui?.windows ?? {}), ...v2Apps]);
    for (const app of apps) {
      const actor = app?.actor ?? (app?.document?.documentName === "Actor" ? app.document : null);
      if (!actor || !collectionValues(actor.effects).some((effect) => effect?.flags?.[MODULE_ID]?.[EFFECT_FLAG])) continue;
      try {
        Promise.resolve(app.render?.(v2Apps.has(app) ? { force: false } : false))
          .catch((error) => this.notify(error?.message ?? "Не удалось обновить счётчик реагентов."));
      }
      catch (error) {
        this.notify(error?.message ?? "Не удалось обновить счётчик реагентов.");
      }
    }
  }
}
