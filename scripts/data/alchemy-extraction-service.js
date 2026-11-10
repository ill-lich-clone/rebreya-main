import { MODULE_ID } from "../constants.js";
import { canonicalCatalogId } from "../shared/canonical-catalog-id.js";
import { escapeFoundryHtml } from "../shared/foundry-values.js";
import { isValidAlchemyExtractionIntent } from "../application/alchemy-extraction-commands.js";
import { ALCHEMY_CRAFT_JOURNAL } from "./alchemy-crafting-service.js?v=1.5.72";
import { ALCHEMY_ASPECTS, calculateAspectExtraction, createAlchemyAspectItemData, getAlchemyAspectKind, readPlantAspectYield } from "./alchemy-aspects.js";
import { resolveAlchemyToolRank } from "./alchemy-crafting-rules.js?v=1.5.72";
import { captureInventoryItemQuantityState, isInventoryMaterialItemData, readInventoryItemQuantity } from "./inventory-material-quantity.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";

const flagsOf = (item) => item?.flags?.[MODULE_ID] ?? {};
const dataOf = (item) => item?.toObject?.() ?? item;
const rowsOf = (collection) => collection?.contents ?? Array.from(collection?.values?.() ?? []);
const itemKey = ({ actorId, itemId }) => JSON.stringify([actorId, itemId]);
const actorKey = (actorId) => `extract-actor:${actorId}`;
const grantPath = `flags.${MODULE_ID}.alchemyAspectCredit`;
const debitPath = `flags.${MODULE_ID}.alchemyPlantDebit`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function getPlantExtractionData(item, materialById) {
  const data = dataOf(item);
  if (data?.type !== "loot" || !isInventoryMaterialItemData(data)) return null;
  const flags = flagsOf(data);
  const materialId = canonicalCatalogId(flags.materialId ?? flags.sourceId);
  const material = materialById.get(materialId);
  const baseYield = readPlantAspectYield(material);
  return baseYield ? { materialId, baseYield, available: Math.floor(readInventoryItemQuantity(data)) } : null;
}

export class AlchemyExtractionService {
  constructor({ moduleApi, craftingService, gameProvider = () => globalThis.game,
    rollDie = async () => (await new globalThis.Roll("1d6").evaluate()).total }) {
    this.moduleApi = moduleApi;
    this.craftingService = craftingService;
    this.gameProvider = gameProvider;
    this.rollDie = rollDie;
  }

  async context(intent, sender) {
    if (!this.craftingService.authorize(intent, sender)) throw new Error("Алхимик недоступен в этой группе.");
    const { actor, group } = this.craftingService.scope(intent);
    const { materialById } = await this.moduleApi.getModel();
    const plants = [actor, group].flatMap((holder) => rowsOf(holder.items).flatMap((item) => {
      if (flagsOf(item).alchemyPlantDebit) return [];
      const source = getPlantExtractionData(item, materialById);
      return source?.available > 0 ? [{ ...source, actorId: holder.id, actorName: holder.name, itemId: item.id, name: item.name }] : [];
    }));
    const tool = rowsOf(actor.items).map((item) => ({ item, rank: resolveAlchemyToolRank(item) }))
      .filter(({ rank }) => rank !== null).sort((a, b) => b.rank - a.rank)[0];
    return { actor, plants, tool };
  }

  pending(actorId) {
    const brewing = this.craftingService;
    const key = brewing.read(actorKey(actorId));
    const record = key ? brewing.read(key) : null;
    return record && !["finalized", "aborted"].includes(record.phase) ? record : null;
  }

  async preview(intent) {
    const { actor, plants, tool } = await this.context(intent, this.gameProvider().user);
    return {
      plants, tool: tool ? { id: tool.item.id, rank: tool.rank, name: tool.item.name } : null,
      pending: this.pending(actor.id)?.intent ?? null,
      available: plants.reduce((sum, row) => sum + row.available, 0)
    };
  }

  async planExtraction(intent, execution) {
    const { actor, plants, tool } = await this.context(intent, execution.sender);
    if (!tool) throw new Error("Нужны исправные инструменты алхимика.");
    const stock = new Map(plants.map((row) => [itemKey(row), row]));
    const used = new Set();
    const baseYield = {};
    let portionCount = 0;
    const selected = intent.ingredients.map((row) => {
      const key = itemKey(row);
      const plant = stock.get(key);
      if (!plant || used.has(key) || plant.available < row.quantity) throw new Error("Порции растения больше недоступны или выбраны дважды.");
      used.add(key);
      portionCount += row.quantity;
      for (const [kind, quantity] of Object.entries(plant.baseYield)) {
        baseYield[kind] = (baseYield[kind] ?? 0) + row.quantity * quantity;
        if (!Number.isSafeInteger(baseYield[kind]) || !Number.isSafeInteger(portionCount)) throw new Error("Партия слишком велика.");
      }
      return { ...row, name: plant.name, materialId: plant.materialId };
    });
    const brewing = this.craftingService;
    const key = `extract:${intent.operationId}`;
    const receipts = brewing.prepareReceipts(selected, 0, actor.id).map((receipt) => ({
      ...receipt, marker: key, materialId: stock.get(itemKey(receipt)).materialId,
      patch: { ...receipt.patch, [debitPath]: key }
    }));
    let record = await brewing.repository.mutateObject(ALCHEMY_CRAFT_JOURNAL, (state) => {
      const pointer = actorKey(actor.id);
      const current = state[state[pointer]];
      if (current && !["finalized", "aborted"].includes(current.phase)) throw new Error("Сначала завершите предыдущую партию.");
      const value = { operationId: key, intent: structuredClone(intent), phase: "rolling", selected, receipts };
      state[key] = value;
      state[pointer] = key;
      return structuredClone(value);
    });
    execution.assertActiveGm();
    const rolls = await actor.rollToolCheck({ tool: tool.item.system.type?.baseItem || "rebreyaAlchemy", ability: "int" },
      { configure: false }, { create: false });
    const total = rolls?.[0]?.total;
    if (!Number.isFinite(total)) {
      await brewing.save({ ...record, phase: "aborted" });
      throw new Error("Проверка алхимика не завершилась.");
    }
    const d6 = (total >= 10 && total <= 14) || total >= 25 ? await this.rollDie() : null;
    const aspects = calculateAspectExtraction({ baseYield, portionCount, total, d6 });
    const credits = Object.entries(aspects).map(([kind, quantity]) => this.planCredit(actor, key, kind, quantity));
    record = await brewing.save({ ...record, phase: "prepared", credits,
      result: { operationId: intent.operationId, total, d6, aspects, portionCount } });
    return record;
  }

  checkDebit(receipt) {
    const item = this.craftingService.getActor(receipt.actorId)?.items.get(receipt.itemId);
    const flags = flagsOf(item);
    const current = item && captureInventoryItemQuantityState(dataOf(item));
    const expected = flags.alchemyPlantDebit === receipt.marker ? receipt.projected : receipt.previous;
    if (!item || canonicalCatalogId(flags.materialId ?? flags.sourceId) !== receipt.materialId
      || (flags.alchemyPlantDebit && flags.alchemyPlantDebit !== receipt.marker) || !same(current, expected)) {
      throw new Error("Запас растения изменился. Восстановите выбранные порции или обратитесь к Мастеру.");
    }
  }

  planCredit(actor, operationId, kind, quantity) {
    const stack = rowsOf(actor.items).find((item) => getAlchemyAspectKind(item) === kind && !flagsOf(item).alchemyAspectCredit
      && Number.isSafeInteger(item.system?.quantity) && item.system.quantity > 0);
    const itemId = stack?.id ?? createStableGearDocumentId(`${operationId}:aspect:${kind}`);
    const before = stack?.system.quantity ?? 0;
    if (!Number.isSafeInteger(before + quantity)) throw new Error("Стопка аспектов слишком велика.");
    return { kind, itemId, before, after: before + quantity, marker: `${operationId}:${kind}` };
  }

  *extractionItems(actor) {
    const { actors, scenes } = this.gameProvider();
    const holders = new Set([actor, ...rowsOf(actors)]);
    for (const scene of rowsOf(scenes)) {
      for (const token of rowsOf(scene.tokens)) if (!token.actorLink && token.actor) holders.add(token.actor);
    }
    for (const holder of holders) {
      for (const item of rowsOf(holder.items)) yield { holder, item };
    }
  }

  findCredit(actor, credit, searchMoved) {
    const local = actor.items.get(credit.itemId);
    if (flagsOf(local).alchemyAspectCredit === credit.marker) return local;
    if (searchMoved) {
      for (const { item } of this.extractionItems(actor)) if (flagsOf(item).alchemyAspectCredit === credit.marker) return item;
    }
    return null;
  }

  async applyCredit(actor, credit, execution, searchMoved) {
    if (this.findCredit(actor, credit, searchMoved)) return;
    const item = actor.items.get(credit.itemId);
    execution.assertActiveGm();
    if (credit.before > 0) {
      if (getAlchemyAspectKind(item) !== credit.kind || item.system.quantity !== credit.before || flagsOf(item).alchemyAspectCredit) {
        throw new Error("Стопка аспектов изменилась. Требуется сверка запасов.");
      }
      await item.update({ "system.quantity": credit.after, [grantPath]: credit.marker });
    } else {
      if (item) throw new Error("ID стопки аспектов уже используется.");
      const data = createAlchemyAspectItemData(credit.kind, credit.after);
      data._id = credit.itemId;
      data.flags[MODULE_ID].alchemyAspectCredit = credit.marker;
      const [created] = await actor.createEmbeddedDocuments("Item", [data], { keepId: true });
      if (created?.id !== credit.itemId) throw new Error("Foundry не подтвердил выдачу аспектов.");
    }
    execution.assertActiveGm();
  }

  async finish(record, execution) {
    const actor = this.craftingService.getActor(record.intent.actorId);
    const credits = new Set(record.credits.map(({ marker }) => marker));
    const debits = [];
    for (const { holder, item } of this.extractionItems(actor)) {
      const flags = flagsOf(item);
      if (credits.has(flags.alchemyAspectCredit)) {
        execution.assertActiveGm();
        await item.update({ [grantPath]: null });
      }
      if (flags.alchemyPlantDebit === record.operationId) debits.push({ holder, item });
    }
    await this.publish(record, actor, execution);
    const sources = new Set(record.receipts.map(itemKey));
    for (const { holder, item } of debits) {
      if (flagsOf(item).alchemyPlantDebit !== record.operationId) continue;
      execution.assertActiveGm();
      if (sources.has(itemKey({ actorId: holder.id, itemId: item.id })) && readInventoryItemQuantity(dataOf(item)) === 0) {
        await item.delete({ rebreyaAlchemyExtraction: true });
      }
      else await item.update({ [debitPath]: null });
    }
  }

  async publish(record, actor, execution) {
    const chat = globalThis.ChatMessage;
    if (!chat?.create) return;
    const id = createStableGearDocumentId(`alchemy-extraction-chat:${record.operationId}`);
    if (this.gameProvider().messages?.get(id)) return;
    const { total, d6, aspects } = record.result;
    const ingredients = record.selected.map(({ name, quantity }) => `${escapeFoundryHtml(name)} × ${quantity}`).join(", ");
    const output = Object.entries(aspects).map(([kind, quantity]) => `${quantity} ${ALCHEMY_ASPECTS[kind].code}`).join(", ") || "0";
    execution.assertActiveGm();
    await chat.create({ _id: id, speaker: chat.getSpeaker?.({ actor }),
      content: `<p><strong>Расщепление растений</strong> · 10 мин.</p><p>${ingredients}</p><p>Проверка: ${total}${d6 === null ? "" : ` · 1к6: ${d6}`}. Получено: ${output}.</p>`
    }, { keepId: true });
  }

  async extract(intent, execution) {
    const brewing = this.craftingService;
    if (!isValidAlchemyExtractionIntent(intent) || !brewing.authorize(intent, execution.sender)) throw new Error("Некорректная партия или недостаточно прав.");
    let record = brewing.read(`extract:${intent.operationId}`);
    if (record && !same(record.intent, intent)) throw new Error("Эта операция уже использована для другого состава.");
    if (record?.phase === "finalized") return record.result;
    if (record?.phase === "rolling") throw new Error("Результат проверки требует сверки Мастером.");
    if (!record || record.phase === "aborted") record = await this.planExtraction(intent, execution);
    if (record.phase === "prepared") {
      for (const receipt of record.receipts) this.checkDebit(receipt);
      for (const receipt of record.receipts) {
        this.checkDebit(receipt);
        await brewing.applyReceipt(receipt, execution);
      }
      record = await brewing.save({ ...record, phase: "debited" });
    }
    const searchMoved = record.creditStarted === true;
    if (record.phase === "debited") {
      const actor = brewing.getActor(intent.actorId);
      if (!searchMoved) record = await brewing.save({ ...record, creditStarted: true });
      for (const credit of record.credits) await this.applyCredit(actor, credit, execution, searchMoved);
      record = await brewing.save({ ...record, phase: "committed" });
    }
    await this.finish(record, execution);
    await brewing.save({ ...record, phase: "finalized" });
    return record.result;
  }
}
