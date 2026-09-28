import { captureRuntimeItemGraph, buildRuntimeGraphDocuments, materializeRuntimeItemGraph } from "../data/runtime-item-graph.js?v=1.4.267-native-schema";
import { itemInstanceFingerprint } from "./item-instance-workflow.js";

export const INVENTORY_GRAPH_TRANSFER_KIND = "inventory-graph-transfer-v1";
export function isInventoryGraphItem(source, item) {
  return Boolean(item && (item.type === "container" || item.flags?.["rebreya-main"]?.itemUpgrades?.installed?.length
    || Array.from(source.items.contents ?? source.items.values()).some(child => child.system?.container === item.id)));
}
const fail = message => { const error = new Error(message); error.code = "graph-manual-review"; throw error; };
const snapshotKey = data => {
  const copy = structuredClone(data); delete copy._stats;
  return itemInstanceFingerprint(copy);
};

/** Called only inside InventoryService's existing inventory queue and authorization boundary. */
export async function transferInventoryGraph({ source, target, itemId, quantity, operationId, fingerprint, journal, assertAuthority, record = null }) {
  const write = async operation => { assertAuthority(); const result = await operation(); assertAuthority(); return result; };
  if (record && (record.fingerprint !== fingerprint || record.sourceActorId !== source.id || record.targetActorId !== target.id)) fail("Запрос переноса дерева изменился.");
  if (record?.terminal) {
    if (record.result?.ok) return structuredClone(record.result.value);
    fail("Перенос дерева завершился ошибкой; нужна сверка.");
  }
  if (!record) {
    const root = source.items.get(itemId);
    if (!root || root.system.quantity !== 1 || quantity !== 1) fail("Предмет с содержимым или усовершенствованиями переносится целиком, по одному экземпляру.");
    if (root.flags?.["rebreya-main"]?.installedUpgrade?.hostItemId) fail("Сначала снимите усовершенствование с предмета.");
    if (root.system.equipped || root.flags?.["rebreya-main"]?.heldHands?.length) fail("Сначала освободите руки и снимите переносимый предмет.");
    const graph = captureRuntimeItemGraph(source, root);
    const targetData = structuredClone(graph.nodes[0]); targetData.flags ??= {}; targetData.flags["rebreya-main"] ??= {};
    targetData.flags["rebreya-main"].inventoryMutation = { id: operationId, kind: "take" };
    const plan = buildRuntimeGraphDocuments(graph, operationId, targetData, { actorId: target.id });
    record = await write(() => journal.start({ id: operationId, kind: INVENTORY_GRAPH_TRANSFER_KIND, phase: "prepared", fingerprint,
      sourceActorId: source.id, targetActorId: target.id, graph, targetData, createdItemId: plan.rootItemId, itemName: root.name }));
  }
  const expected = new Map(record.graph.nodes.map(data => [data._id, data]));
  const verifySource = allowMissing => {
    for (const [id, data] of expected) {
      const item = source.items.get(id);
      if (!item && allowMissing) continue;
      if (!item || snapshotKey(item.toObject()) !== snapshotKey(data)) fail("Исходное дерево изменилось во время переноса.");
    }
    for (const item of source.items.contents ?? source.items.values()) {
      if (!expected.has(item.id) && (expected.has(item.system?.container) || expected.has(item.flags?.["rebreya-main"]?.installedUpgrade?.hostItemId))) fail("В исходное дерево добавлен новый предмет.");
    }
  };
  if (record.phase === "prepared") {
    verifySource(false);
    await write(() => materializeRuntimeItemGraph(target, record.graph, operationId, record.targetData, { recoverMissing: true }));
    record = await write(() => journal.checkpoint(operationId, "prepared", "target-created"));
  }
  if (["target-created", "source-debit-started"].includes(record.phase)) {
    // After a verified grant, a missing target belongs to manual review, never regeneration.
    const plan = buildRuntimeGraphDocuments(record.graph, operationId, record.targetData, { actorId: target.id });
    if (plan.documents.some(data => !target.items.get(data._id))) fail("Полученное дерево удалено или изменено; повторная выдача запрещена.");
    await write(() => materializeRuntimeItemGraph(target, record.graph, operationId, record.targetData, { recoverMissing: true }));
    verifySource(record.phase === "source-debit-started");
    if (record.phase === "target-created") record = await write(() => journal.checkpoint(operationId, "target-created", "source-debit-started"));
    for (const id of [...expected.keys()].reverse()) {
      verifySource(true);
      const item = source.items.get(id);
      if (item) await write(() => item.delete());
    }
    if ([...expected.keys()].some(id => source.items.get(id))) fail("Не подтверждено удаление исходного дерева.");
    record = await write(() => journal.checkpoint(operationId, "source-debit-started", "source-debited"));
  }
  if (record.phase === "source-debited") record = await write(() => journal.checkpoint(operationId, "source-debited", "committed"));
  if (record.phase !== "committed") fail("Неизвестная фаза переноса дерева.");
  const value = { itemName: record.itemName, quantity: 1, actorId: target.id, createdItemId: record.createdItemId };
  await write(() => journal.finish(operationId, { ok: true, value }));
  return value;
}
