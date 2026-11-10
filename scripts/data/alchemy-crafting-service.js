import { ALCHEMY_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";
import { getAlchemyAspectKind } from "./alchemy-aspects.js";
import { createAlchemyItemData } from "./alchemy-compendium.js?v=1.5.72";
import {
  buildInventoryItemQuantityPatch, buildInventoryItemQuantityRestorePatch,
  captureInventoryItemQuantityState, isInventoryMaterialItemData, readInventoryItemQuantity,
  withInventoryItemQuantity
} from "./inventory-material-quantity.js";
import {
  applyCraftedPotionHealing, buildPotionCraftQuote, canUseCraftedPotion, describePotionOption, normalizePotionRecipeCatalog, planPotionStock,
  resolveAlchemyToolRank, resolveCraftedPotionProduct
} from "./alchemy-crafting-rules.js?v=1.5.72";

const JOURNAL = "alchemyCraftJournal";
export { JOURNAL as ALCHEMY_CRAFT_JOURNAL };
const CURRENCY = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
const flagsOf = (item) => item?.flags?.[MODULE_ID] ?? {};
const dataOf = (item) => item?.toObject?.() ?? item;
const itemsOf = (actor) => actor?.items?.contents ?? Array.from(actor?.items?.values?.() ?? []);
const clone = (value) => structuredClone(value);
const round = (value) => Number(value.toFixed(12));
const copper = (wallet) => Object.entries(CURRENCY).reduce((total, [coin, value]) => total + (Number(wallet[coin]) || 0) * value, 0);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const escapeHtml = (value) => String(value).replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

function walletOf(actor) {
  return Object.fromEntries(Object.keys(CURRENCY).map((coin) => [coin, Number(actor.system?.currency?.[coin] ?? 0)]));
}

function adjustWallet(wallet, difference) {
  if (copper(wallet) + difference < 0) throw new Error("У персонажа недостаточно золота.");
  const next = { ...wallet };
  let remaining = -difference;
  for (const [coin, value] of Object.entries(CURRENCY)) {
    if (remaining <= 0) break;
    const spent = Math.min(next[coin], Math.ceil(remaining / value));
    next[coin] -= spent;
    remaining -= spent * value;
  }
  for (const coin of ["gp", "sp", "cp"]) {
    if (remaining >= 0) break;
    const change = Math.floor(-remaining / CURRENCY[coin]);
    next[coin] += change;
    remaining += change * CURRENCY[coin];
  }
  return next;
}

export function registerAlchemyCraftingSettings(game = globalThis.game) {
  game.settings.register(MODULE_ID, JOURNAL, { scope: "world", config: false, type: Object, default: {} });
}

export { canUseCraftedPotion };

export function buildCraftedPotion(product, { operationId, catalyst, expiresAt = null, lifetimeSeconds = 86400, source = null, pending = false }) {
  const variant = resolveCraftedPotionProduct(product, catalyst);
  const projection = createAlchemyItemData(variant);
  const data = source ? clone(source) : projection;
  data._id = createStableGearDocumentId(`alchemy-craft:${operationId}`);
  data.folder = null;
  data.system.quantity = 1;
  data.system.activities ??= {};
  for (const [id, canonical] of Object.entries(projection.system.activities)) {
    const activity = data.system.activities[id] ??= canonical;
    if (variant.duration !== product.duration) activity.duration = canonical.duration;
    if (variant.activation !== product.activation) activity.activation = canonical.activation;
    if (variant.duration !== product.duration || variant.reagentLevel !== product.reagentLevel) {
      activity.flags ??= {};
      activity.flags[MODULE_ID] ??= {};
      activity.flags[MODULE_ID].alchemyReagent = canonical.flags[MODULE_ID].alchemyReagent;
    }
    applyCraftedPotionHealing(activity, catalyst);
  }
  if (variant.reagentLevel !== product.reagentLevel) data.flags[MODULE_ID].reagentLevel = variant.reagentLevel;
  data.flags[MODULE_ID].alchemyCraft = { operationId, expiresAt, catalyst: catalyst ?? null, pending };
  if (catalyst) data.system.description.value += `<p><strong>Катализатор: ${escapeHtml(catalyst.name)}.</strong> ${escapeHtml(catalyst.effect)}</p>`;
  if (expiresAt !== null) data.system.description.value += `<p><strong>Нестабильное зелье.</strong> Срок хранения: ${lifetimeSeconds / 3600} ч. с завершения варки.</p>`;
  return data;
}

export class AlchemyCraftingService {
  constructor({ moduleApi, repository, gameProvider = () => globalThis.game, fetcher = (...args) => fetch(...args) }) {
    this.moduleApi = moduleApi;
    this.repository = repository;
    this.gameProvider = gameProvider;
    this.fetcher = fetcher;
  }

  getActor(actorId) {
    return this.gameProvider().actors?.get(actorId);
  }

  scope({ groupId, actorId }) {
    const group = this.moduleApi.groupContextService?.resolveReferenceForGroup(groupId);
    const actor = this.getActor(actorId);
    if (!actor || actor.type !== "character" || group?.groupActor?.id !== groupId) return null;
    return group.memberActorIds?.includes(actorId) ? { actor, group: group.groupActor } : null;
  }

  authorize(intent, sender) {
    const scope = this.scope(intent);
    return Boolean(scope && sender && (sender.isGM || scope.actor.testUserPermission(sender, "OWNER")));
  }

  async catalog() {
    if (!this.catalogLoad) {
      this.catalogLoad = Promise.all([
        this.moduleApi.getModel(),
        this.fetcher(`modules/${MODULE_ID}/data/alchemy-potion-recipes.json?v=1.5.71`).then((response) => {
          if (!response.ok) throw new Error("Каталог рецептов алхимии недоступен.");
          return response.json();
        })
      ]).then(([model, rows]) => normalizePotionRecipeCatalog(rows, { products: model.alchemyProducts, materials: model.materials }))
        .catch((error) => { this.catalogLoad = null; throw error; });
    }
    return this.catalogLoad;
  }

  async laboratoryTerms(groupId) {
    const activity = await this.laboratoryActivity(groupId);
    return activity?.targetActions?.find((row) => row.id === "alchemy-resources")?.resources?.rankCosts ?? [];
  }

  async laboratoryActivity(groupId) {
    const actions = this.moduleApi.downtimeService.getSnapshot({}, { groupId }).actionCatalog
      ?? await this.moduleApi.getDowntimeActionCatalog();
    return actions.find((row) => (row.downtimeId ?? row.id) === "laboratory-alchemy");
  }

  async context(intent) {
    const scope = this.scope(intent);
    if (!scope) throw new Error("Персонаж недоступен в этой группе.");
    const [recipes, model] = await Promise.all([this.catalog(), this.moduleApi.getModel()]);
    const recipe = recipes.get(intent.productId);
    const product = model.alchemyProductById.get(intent.productId);
    const stock = [scope.actor, scope.group].flatMap((actor) => itemsOf(actor).flatMap((item) => {
      const flags = flagsOf(item);
      if (flags.alchemyAspectCredit || flags.alchemyPlantDebit) return [];
      const data = dataOf(item);
      const aspect = getAlchemyAspectKind(item);
      const isMaterial = isInventoryMaterialItemData(data);
      const materialId = isMaterial ? flags.materialId ?? flags.sourceId : null;
      const productId = flags.alchemyProductId;
      if (!aspect && !isMaterial && !productId) return [];
      const quantity = readInventoryItemQuantity(data);
      return quantity > 0 ? [{ actorId: actor.id, actorName: actor.name, itemId: item.id, name: item.name,
        quantity, materialId, productId, aspect, isMaterial, rank: flags.rank, unmodified: !flags.alchemyCraft?.catalyst
          && canUseCraftedPotion(item, this.gameProvider().time?.worldTime ?? 0) }] : [];
    }));
    const tools = itemsOf(scope.actor).map((item) => ({ item, rank: resolveAlchemyToolRank(item) }))
      .filter(({ rank }) => rank !== null).sort((a, b) => b.rank - a.rank);
    return { ...scope, model, recipes, recipe, product, stock, tool: tools[0] };
  }

  async quote(intent, context = null) {
    context ??= await this.context(intent);
    const result = buildPotionCraftQuote({
      ...context, mode: intent.mode, selection: intent.selection,
      laboratory: intent.mode === "laboratory" ? await this.laboratoryTerms(intent.groupId) : []
    });
    if (result.goldGp > 0 && copper(walletOf(context.actor)) < Math.round(result.goldGp * 100)) {
      result.errors.push({ code: "gold-shortage", message: "У персонажа недостаточно золота." });
    }
    return result;
  }

  async view(intent) {
    const context = await this.context(intent);
    const plan = planPotionStock({ ...context, mode: intent.mode,
      optionIndex: intent.selection?.optionIndex, catalystKey: intent.catalystKey });
    const selection = { ...intent.selection, items: intent.selection?.items ?? plan.items };
    if (plan.catalystIndex !== undefined) selection.catalystIndex = plan.catalystIndex;
    const snapshot = this.moduleApi.downtimeService.getSnapshot({ actorId: intent.actorId }, { groupId: intent.groupId });
    const field = this.fieldSnapshot(context.actor);
    const aspectStock = {};
    for (const { aspect, quantity } of context.stock) {
      if (aspect && Number.isSafeInteger(quantity)) aspectStock[aspect] = (aspectStock[aspect] ?? 0) + quantity;
    }
    return {
      recipes: [...context.recipes.keys()].map((id) => {
        const { name, rank, icon } = context.model.alchemyProductById.get(id);
        return { id, name, rank, icon };
      }),
      options: context.recipe?.options.map((option) => ({ ...option, label: describePotionOption(option, context.recipe) })) ?? [],
      ...plan, selection, aspectStock,
      quote: context.product ? await this.quote({ ...intent, selection }, context) : null,
      toolRank: context.tool?.rank ?? null,
      availableWeeks: snapshot.balance.availableWeeks,
      laboratoryRequests: snapshot.requests.filter((row) => row.actorId === intent.actorId && row.alchemyCraft
        && ["pending", "approved", "completed"].includes(row.status) && !row.alchemyCraft.itemId),
      field,
      restMessageUuid: this.findRestMessage(context.actor, field)?.uuid ?? null
    };
  }

  read(operationId) {
    return this.repository.readObject(JOURNAL)[operationId] ?? null;
  }

  save(record) {
    return this.repository.mutateObject(JOURNAL, (state) => { state[record.operationId] = clone(record); return clone(record); });
  }

  prepareReceipts(rows, goldGp, actorId) {
    const itemTotals = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.actorId, row.itemId]);
      itemTotals.set(key, { ...row, quantity: round((itemTotals.get(key)?.quantity ?? 0) + row.quantity) });
    }
    const receipts = [];
    for (const row of itemTotals.values()) {
      const item = this.getActor(row.actorId)?.items?.get(row.itemId);
      if (!item) throw new Error(`Запас недоступен: ${row.name}.`);
      const data = dataOf(item);
      const before = readInventoryItemQuantity(data);
      if (before < row.quantity) throw new Error(`Недостаточно: ${row.name}.`);
      const after = round(before - row.quantity);
      const previous = captureInventoryItemQuantityState(data);
      const projected = captureInventoryItemQuantityState(withInventoryItemQuantity(data, after));
      receipts.push({ actorId: row.actorId, itemId: row.itemId, previous, projected, quantity: row.quantity,
        patch: buildInventoryItemQuantityPatch(data, after) });
    }
    if (goldGp > 0) {
      const previous = walletOf(this.getActor(actorId));
      const amount = Math.round(goldGp * 100);
      receipts.push({ actorId, previous, projected: adjustWallet(previous, -amount), copper: amount });
    }
    return receipts;
  }

  async applyReceipt(receipt, execution, reverse = false) {
    const actor = this.getActor(receipt.actorId);
    const item = receipt.itemId ? actor?.items?.get(receipt.itemId) : null;
    if (!actor || (receipt.itemId && !item)) throw new Error("Исходный запас больше недоступен.");
    const current = item ? captureInventoryItemQuantityState(dataOf(item)) : walletOf(actor);
    const expected = reverse ? receipt.projected : receipt.previous;
    const target = reverse ? receipt.previous : receipt.projected;
    if (equal(current, target)) return;
    if (!equal(current, expected)) throw new Error("Запас изменился во время варки. Требуется сверка Мастером.");
    execution.assertActiveGm();
    if (item) await item.update(reverse ? buildInventoryItemQuantityRestorePatch(target) : receipt.patch);
    else await actor.update({ "system.currency": target });
    execution.assertActiveGm();
  }

  findCraftedPotion(operationId, outputActorId, searchMoved = false) {
    const actor = this.getActor(outputActorId);
    const itemId = createStableGearDocumentId(`alchemy-craft:${operationId}`);
    const existing = actor?.items.get(itemId);
    if (existing) {
      if (flagsOf(existing).alchemyCraft?.operationId !== operationId) throw new Error("ID результата уже используется.");
      return existing;
    }
    if (!searchMoved) return null;
    const { actors, scenes } = this.gameProvider();
    const holders = [...(actors?.contents ?? actors?.values?.() ?? [])];
    for (const scene of scenes?.contents ?? []) {
      for (const token of scene.tokens?.contents ?? []) if (token.actor && !token.actorLink) holders.push(token.actor);
    }
    for (const holder of holders) {
      const item = itemsOf(holder).find((row) => flagsOf(row).alchemyCraft?.operationId === operationId);
      if (item) return item;
    }
    return null;
  }

  async unlockCraftedPotion(operationId, outputActorId, execution) {
    const item = this.findCraftedPotion(operationId, outputActorId, true);
    if (!flagsOf(item).alchemyCraft?.pending) return;
    execution.assertActiveGm();
    await item.update({ [`flags.${MODULE_ID}.alchemyCraft.pending`]: false });
  }

  async createCraftedPotionOnce({ operationId, outputActorId, output, expiresAt, searchMoved = false }, execution) {
    const existing = this.findCraftedPotion(operationId, outputActorId, searchMoved);
    if (existing) return existing.id;
    const actor = this.getActor(outputActorId);
    if (!actor) throw new Error("Получатель зелья недоступен.");
    const product = (await this.moduleApi.getModel()).alchemyProductById.get(output.productId);
    const pack = this.gameProvider().packs?.get(`world.${ALCHEMY_COMPENDIUM_NAME}`);
    const source = await pack?.getDocument(createStableGearDocumentId(`alchemy-product:${product.id}`));
    const item = buildCraftedPotion(product, {
      operationId, expiresAt, catalyst: output.catalyst, lifetimeSeconds: output.lifetimeSeconds, pending: true,
      source: flagsOf(source).alchemyProductId === product.id ? dataOf(source) : null
    });
    execution.assertActiveGm();
    const [created] = await actor.createEmbeddedDocuments("Item", [item], { keepId: true });
    execution.assertActiveGm();
    if (created?.id !== item._id) throw new Error("Foundry не подтвердил ID созданного зелья.");
    return created.id;
  }

  async applyCraft({ operationId, quote, outcome, outputActorId, expiresAt = null }, execution) {
    let record = this.read(operationId);
    if (record && (record.outputActorId !== outputActorId || record.outcome !== outcome
      || record.output.productId !== quote.output.productId)) throw new Error("Операция варки уже используется.");
    if (!record || (record.phase === "compensated" && Array.isArray(quote.errors))) {
      if (quote.errors.length) throw new Error(quote.errors[0].message);
      const failed = outcome === "field-failure";
      const receipts = this.prepareReceipts(failed ? quote.failureDebits : quote.debits, failed ? 0 : quote.goldGp, outputActorId);
      record = await this.save({ operationId, outputActorId, outcome, output: quote.output, expiresAt, phase: "prepared", receipts });
    }
    if (record.phase === "prepared") {
      try {
        for (const receipt of record.receipts) await this.applyReceipt(receipt, execution);
      } catch (error) {
        // The recorded before/after states make a failed rollback recoverable without a second debit.
        await this.rollbackCraft(record, execution);
        throw error;
      }
      record = await this.save({ ...record, phase: "debited" });
    }
    if (record.phase === "debited") {
      let itemId = null;
      if (outcome === "field-success") {
        const searchMoved = record.outputStarted === true;
        if (!searchMoved) record = await this.save({ ...record, outputStarted: true });
        itemId = await this.createCraftedPotionOnce({ ...record, searchMoved }, execution);
      }
      record = await this.save({ ...record, phase: "committed", itemId });
    }
    if (record.phase === "committed" && record.itemId) await this.unlockCraftedPotion(operationId, outputActorId, execution);
    return record;
  }

  async rollbackCraft(record, execution) {
    try {
      for (const receipt of [...record.receipts].reverse()) await this.applyReceipt(receipt, execution, true);
    } catch (error) {
      await this.save({ ...record, phase: "reconciliation-required" });
      throw error;
    }
    return this.save({ ...record, phase: "compensated" });
  }

  async reconcileCraft(operationId, execution) {
    const record = this.read(operationId);
    if (!record) throw new Error("Варка не найдена.");
    if (record.phase === "reconciliation-required") {
      return this.rollbackCraft(record, execution);
    }
    return this.applyCraft({ ...record, quote: { output: record.output } }, execution);
  }

  async submitLaboratory(intent, execution) {
    const { groupId, actorId, productId, selection, operationId } = intent;
    const existing = this.moduleApi.downtimeService.getSnapshot({ actorId }, { groupId }).requests
      .find((row) => row.actorId === actorId && row.alchemyCraft?.operationId === operationId);
    if (existing) {
      if (existing.alchemyCraft.productId !== productId || !equal(existing.alchemyCraft.selection, selection)) {
        throw new Error("Операция уже использована для другой заявки.");
      }
      return existing;
    }
    const quote = await this.quote({ ...intent, mode: "laboratory" });
    if (quote.errors.length) throw new Error(quote.errors[0].message);
    const activity = await this.laboratoryActivity(groupId);
    if (!activity) throw new Error("Шаблон лабораторной алхимии недоступен.");
    const product = (await this.moduleApi.getModel?.())?.alchemyProductById.get(productId);
    execution.assertActiveGm();
    return this.moduleApi.downtimeService.createRequest({
      groupId, actorId, actionId: activity.id,
      title: product?.name, weeks: quote.weeks,
      description: `Изготовление зелья. ${quote.weeks} нед., ${quote.goldGp} зм. Нужна алхимическая лаборатория.`,
      alchemyCraft: { operationId, productId, selection, weeks: quote.weeks, goldGp: quote.goldGp },
      submittedByUserId: execution.sender.id
    });
  }

  async refundLaboratory(record, processed, workdays, execution) {
    const operationId = `${record.operationId}:refund`;
    let refund = this.read(operationId);
    if (!refund) {
      const fraction = Math.max(0, (workdays - processed) / workdays);
      const receipts = [];
      for (const row of record.receipts) {
        if (row.itemId) {
          const item = this.getActor(row.actorId)?.items?.get(row.itemId);
          if (!item) throw new Error("Исходный запас недоступен для возврата.");
          const data = dataOf(item);
          const count = isInventoryMaterialItemData(data) ? round(row.quantity * fraction) : Math.floor(row.quantity * fraction);
          if (count > 0) {
            const next = round(readInventoryItemQuantity(data) + count);
            receipts.push({
              actorId: row.actorId, itemId: row.itemId, previous: captureInventoryItemQuantityState(data),
              projected: captureInventoryItemQuantityState(withInventoryItemQuantity(data, next)),
              patch: buildInventoryItemQuantityPatch(data, next)
            });
          }
        } else {
          const previous = walletOf(this.getActor(row.actorId));
          receipts.push({ actorId: row.actorId, previous, projected: adjustWallet(previous, Math.floor(row.copper * fraction)) });
        }
      }
      refund = await this.save({ operationId, receipts, phase: "prepared" });
    }
    if (refund.phase === "prepared") {
      for (const receipt of refund.receipts) await this.applyReceipt(receipt, execution);
      await this.save({ ...refund, phase: "committed" });
    }
  }

  async laboratoryStatus({ groupId, actorId, requestId, status, result = "" }, execution) {
    if (!execution.sender.isGM) throw new Error("Лабораторную заявку подтверждает Мастер.");
    if (!["approved", "completed", "rejected", "returned", "cancelled"].includes(status)) {
      throw new Error("Этот статус недоступен для лабораторной варки.");
    }
    const downtime = this.moduleApi.downtimeService;
    const snapshot = downtime.getSnapshot({ actorId }, { groupId });
    const request = snapshot.requests.find((row) => row.id === requestId && row.actorId === actorId);
    const craft = request?.alchemyCraft;
    if (!craft) throw new Error("Заявка на варку не найдена.");
    const operationId = `lab:${craft.operationId}`;
    const setStatus = (nextStatus, message, refundPending = false) => {
      execution.assertActiveGm();
      return downtime.setRequestStatus(requestId, nextStatus, {
        groupId, result: message, alchemyCraftManaged: true, alchemyCraftRefundPending: refundPending
      });
    };
    let reservation = this.read(operationId);
    if (status === "approved") {
      if (request.status === "approved") return request;
      if (request.status !== "pending") throw new Error("Эту заявку уже обработали.");
      if (!reservation || reservation.phase === "compensated") {
        const quote = await this.quote({ groupId, actorId, productId: craft.productId, mode: "laboratory", selection: craft.selection });
        if (quote.errors.length) throw new Error(quote.errors[0].message);
        if (quote.weeks !== request.weeks || quote.goldGp !== craft.goldGp) throw new Error("Срок или цена изменились. Создайте новую заявку.");
        reservation = await this.applyCraft({ operationId, quote, outcome: "laboratory-reserve", outputActorId: actorId }, execution);
      } else if (reservation.phase !== "committed") {
        reservation = await this.reconcileCraft(operationId, execution);
      }
      if (reservation.phase !== "committed") throw new Error("Резерв не подтверждён. Требуется сверка запасов.");
      try {
        return await setStatus("approved", result);
      } catch (error) {
        const saved = downtime.getSnapshot({ actorId }, { groupId }).requests.find((row) => row.id === requestId);
        if (saved?.status === "approved") return saved;
        if (saved?.status === "pending") await this.rollbackCraft(reservation, execution);
        throw error;
      }
    }
    if (status === "completed") {
      if (request.status !== "completed") throw new Error("Дождитесь завершения срока по календарю простоя.");
      if (!reservation || reservation.phase !== "committed") throw new Error("Резерв варки не подтверждён.");
      if (craft.itemId) return request;
      const outputId = `${operationId}:result`;
      let itemId = reservation.itemId;
      if (!itemId) {
        const searchMoved = reservation.outputStarted === true;
        if (!searchMoved) reservation = await this.save({ ...reservation, outputStarted: true });
        itemId = await this.createCraftedPotionOnce({ ...reservation, operationId: outputId, expiresAt: null, searchMoved }, execution);
        await this.save({ ...reservation, itemId });
      }
      await this.unlockCraftedPotion(outputId, actorId, execution);
      execution.assertActiveGm();
      return downtime.recordAlchemyCraftOutput({ groupId, requestId, actorId, itemId });
    }
    if (request.status === "completed") throw new Error("Срок работы завершён. Подтвердите выдачу.");
    const closed = ["rejected", "returned"].includes(request.status);
    if (closed && !craft.refundPending) return request;
    if (reservation && ["prepared", "debited", "reconciliation-required"].includes(reservation.phase)) {
      reservation = await this.rollbackCraft(reservation, execution);
    }
    const processed = snapshot.scheduleSlots.filter((slot) => slot.requestId === requestId && slot.status === "processed").length;
    const refund = reservation?.phase === "committed";
    const next = closed ? request : await setStatus(status === "cancelled" ? "rejected" : status, result, refund);
    if (!refund) return next;
    await this.refundLaboratory(reservation, processed, request.workdays || request.weeks * 5, execution);
    execution.assertActiveGm();
    return downtime.recordAlchemyCraftRefund({ groupId, requestId, actorId });
  }

  async prepareField(intent, execution) {
    const { actor } = await this.context(intent);
    const key = `field:${intent.operationId}`;
    const existing = this.read(key);
    if (existing && !equal(existing.intent, intent)) {
      throw new Error("Операция уже используется.");
    }
    const quote = await this.quote({ ...intent, mode: "field" });
    if (!existing && quote.errors.length) throw new Error(quote.errors[0].message);
    const record = existing ?? await this.repository.mutateObject(JOURNAL, (state) => {
      const pointer = `field-actor:${actor.id}`;
      if (state[state[pointer]]?.status === "prepared") throw new Error("Уже подготовлена одна варка.");
      const prepared = { operationId: key, intent: clone(intent), status: "prepared", preparedAt: Date.now() };
      state[key] = prepared;
      state[pointer] = key;
      return clone(prepared);
    });
    if (record.status === "prepared") await this.syncFieldFlag(actor, record, execution);
    return { operationId: intent.operationId, status: record.status };
  }

  async cancelField({ groupId, actorId, operationId }, execution) {
    const key = `field:${operationId}`;
    let record = this.read(key);
    if (!record || record.intent.actorId !== actorId || record.intent.groupId !== groupId
      || record.restMessageUuid || !["prepared", "cancelled"].includes(record.status)) throw new Error("Эту варку уже нельзя отменить.");
    if (record.status !== "cancelled") record = await this.save({ ...record, status: "cancelled" });
    await this.syncFieldFlag(this.getActor(actorId), record, execution);
    return { status: "cancelled" };
  }

  async syncFieldFlag(actor, record, execution) {
    const current = flagsOf(actor).alchemyCraftField;
    if (record.status !== "prepared" && current?.operationId !== record.intent.operationId) return;
    const next = this.fieldState(record);
    if (equal(current, next)) return;
    execution.assertActiveGm();
    await actor.setFlag(MODULE_ID, "alchemyCraftField", next);
  }

  fieldState(record) {
    const { operationId, groupId, productId } = record.intent;
    const next = { status: record.status, operationId, groupId, productId, preparedAt: record.preparedAt };
    if (record.status === "completed") {
      next.success = record.result.outcome === "field-success";
      next.total = record.roll.total;
      next.dc = record.roll.dc;
      next.expiresAt = next.success ? record.expiresAt : null;
    }
    return next;
  }

  fieldSnapshot(actor) {
    const state = this.repository.readObject(JOURNAL);
    const record = state[state[`field-actor:${actor.id}`]];
    return record ? this.fieldState(record) : flagsOf(actor).alchemyCraftField ?? null;
  }

  findRestMessage(actor, pending = this.fieldSnapshot(actor)) {
    if (pending?.status !== "prepared") return null;
    return (this.gameProvider().messages?.contents ?? []).find((message) => this.isCraftRest(message, actor.id, pending.preparedAt)) ?? null;
  }

  isCraftRest(message, actorId, preparedAt) {
    return message?.type === "rest" && message.system?.type === "short" && message.speaker?.actor === actorId
      && Number(message._stats?.createdTime ?? message.timestamp ?? 0) > preparedAt;
  }

  async publishFieldOutcome(record, message) {
    if (!message || !globalThis.ChatMessage?.create) return;
    const id = createStableGearDocumentId(`alchemy-chat:${record.operationId}`);
    if (this.gameProvider().messages?.get(id)) return;
    const success = record.result.outcome === "field-success";
    const hours = record.quote.output.lifetimeSeconds / 3600;
    const summary = success ? `Зелье готово. Срок хранения: ${hours} ч.` : "Варка не удалась.";
    try {
      await globalThis.ChatMessage.create({
        _id: id, speaker: message.speaker, whisper: [...(message.whisper ?? [])], blind: message.blind,
        content: `<p><strong>Полевая алхимия.</strong> ${record.roll.total} против Сл ${record.roll.dc}. ${summary}</p>`
      }, { keepId: true });
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not publish field alchemy result`, error);
    }
  }

  async completeField({ groupId, actorId, operationId, restMessageUuid }, execution) {
    const key = `field:${operationId}`;
    let record = this.read(key);
    if (!record || record.intent.actorId !== actorId || record.intent.groupId !== groupId || record.status === "cancelled") {
      throw new Error("Подготовленная варка не найдена.");
    }
    const actor = this.getActor(actorId);
    const message = this.gameProvider().messages?.get(restMessageUuid.split(".")[1]);
    if (record.status === "completed" && record.restMessageUuid === restMessageUuid) {
      await this.syncFieldFlag(actor, record, execution);
      await this.publishFieldOutcome(record, message);
      return record.result;
    }
    if (!this.isCraftRest(message, actorId, record.preparedAt)
      || (!execution.sender.isGM && message.author?.id !== execution.sender.id)
      || (record.restMessageUuid && record.restMessageUuid !== restMessageUuid)) {
      throw new Error("Нужна карточка завершённого короткого отдыха персонажа.");
    }
    if (!record.roll) {
      const intent = { ...record.intent, mode: "field" };
      const quote = await this.quote(intent);
      if (quote.errors.length) throw new Error(quote.errors[0].message);
      const { tool } = await this.context(intent);
      if (!tool) throw new Error("Алхимические инструменты недоступны.");
      execution.assertActiveGm();
      const rolls = await actor.rollToolCheck({
        tool: tool.item.system.type.baseItem, ability: record.intent.selection.ability, target: quote.dc, subject: tool.item
      }, { configure: false }, { create: false });
      const total = rolls?.[0]?.total;
      if (!Number.isFinite(total)) throw new Error("Проверка алхимических инструментов не завершилась.");
      const expiresAt = (this.gameProvider().time?.worldTime ?? 0) + quote.output.lifetimeSeconds;
      record = await this.save({ ...record, restMessageUuid, roll: { total, dc: quote.dc }, quote, expiresAt });
    }
    const success = record.roll.total >= record.roll.dc;
    const resultKey = `${key}:result`;
    if (this.read(resultKey)?.phase === "reconciliation-required") await this.reconcileCraft(resultKey, execution);
    const result = await this.applyCraft({
      operationId: resultKey, quote: record.quote, outcome: success ? "field-success" : "field-failure",
      outputActorId: actorId, expiresAt: success ? record.expiresAt : null
    }, execution);
    if (result.phase !== "committed") throw new Error("Варке требуется сверка запасов Мастером.");
    const completed = await this.save({ ...record, status: "completed", result });
    await this.syncFieldFlag(actor, completed, execution);
    await this.publishFieldOutcome(completed, message);
    return result;
  }
}
