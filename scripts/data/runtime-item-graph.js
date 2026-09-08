import { createStableGearDocumentId } from "./gear-document-ids.js";
import { itemInstanceFingerprint } from "../application/item-instance-workflow.js";
import { buildHeldItemWornUpdate } from "../integrations/held-items.js";
const MODULE_ID = "rebreya-main";
export const RUNTIME_ITEM_GRAPH_FLAG = "runtimeItemGraph";
const conflict = () => { const error = new Error("Состав предмета изменился или перенесён частично; нужна сверка экземпляров."); error.code = "graph-manual-review"; throw error; };
const clone = value => structuredClone(value);
const matchesPreparedValue = (actual, expected) => {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value,i) => matchesPreparedValue(actual[i],value));
  if (expected && typeof expected === "object") return actual && typeof actual === "object"
    && Object.entries(expected).every(([key,value]) => matchesPreparedValue(actual[key],value));
  return actual === expected;
};

/** Detached transport snapshot of live Documents, not a catalogue rebuild or another world repository. */
export function captureRuntimeItemGraph(actor, root) {
  const items = Array.from(actor.items.contents ?? actor.items.values());
  const nodes = [], visited = new Set();
  const visit = item => {
    if (!item || visited.has(item.id) || nodes.length >= 200) conflict();
    visited.add(item.id); const data = item.toObject(); nodes.push(data);
    const installed = data.flags?.[MODULE_ID]?.itemUpgrades?.installed ?? [];
    const childIds = new Set(installed.map(entry => entry.itemId));
    for (const child of items) if (child.system?.container === item.id) childIds.add(child.id);
    for (const id of childIds) visit(actor.items.get(id));
  };
  visit(root);
  return { version: 1, rootId: root.id, nodes };
}

export function buildRuntimeGraphDocuments(graph, operationId, rootData, { actorId = null, parentContainerId = null } = {}) {
  if (graph?.version !== 1 || !Array.isArray(graph.nodes) || !graph.nodes.length || graph.nodes.length > 200
    || graph.nodes[0]?._id !== graph.rootId || typeof operationId !== "string" || !operationId) conflict();
  const ids = new Map(graph.nodes.map(node => [node._id, createStableGearDocumentId(`${operationId}:${node._id}`)]));
  if (ids.size !== graph.nodes.length || graph.nodes.some(node => typeof node._id !== "string" || !node._id)) conflict();
  const documents = graph.nodes.map(node => {
    const data = clone(node._id === graph.rootId ? rootData ?? node : node);
    const sourceId = node._id;
    for (const key of ["_id", "_stats", "folder", "sort", "ownership"]) delete data[key];
    data._id = ids.get(sourceId); data.system ??= {}; data.flags ??= {}; data.flags[MODULE_ID] ??= {};
    // dnd5e assigns a blank identifier during creation and discards fields absent from loot's schema.
    if (data.system.identifier === "") delete data.system.identifier;
    if (data.type === "loot") {
      delete data.system.attuned;
      delete data.system.equipped;
    }
    const flags = data.flags[MODULE_ID];
    for (const key of [RUNTIME_ITEM_GRAPH_FLAG, "lootgenComposition", "runtimeGraphOrigin", "itemInstanceOrigin", "itemInstanceDebit", "inventoryTransfer", "disarmDebit"]) delete flags[key];
    flags.runtimeGraphOrigin = { id: operationId, sourceItemId: sourceId };
    if (sourceId !== graph.rootId) delete flags.inventoryMutation;
    if (data.system.container) data.system.container = ids.get(data.system.container) ?? null;
    if (sourceId === graph.rootId) {
      data.system.quantity = 1; data.system.container = parentContainerId;
      // Keep the canonical held-item adapter responsible for versatile damage restoration.
      for (const [path, value] of Object.entries(buildHeldItemWornUpdate(false, data))) {
        const parts = path.split("."); const last = parts.pop(); let target = data;
        for (const part of parts) target = target[part] ??= {};
        if (last.startsWith("-=")) delete target[last.slice(2)]; else target[last] = clone(value);
      }
      flags.heldHands = [];
      if (data.type === "loot") delete data.system.equipped;
    }
    for (const entry of flags.itemUpgrades?.installed ?? []) {
      if (!ids.has(entry.itemId)) conflict(); entry.itemId = ids.get(entry.itemId);
    }
    if (flags.installedUpgrade?.hostItemId) {
      if (!ids.has(flags.installedUpgrade.hostItemId)) conflict();
      flags.installedUpgrade.hostItemId = ids.get(flags.installedUpgrade.hostItemId);
      if (actorId !== null) flags.installedUpgrade.hostActorId = actorId;
    }
    return data;
  });
  return { rootItemId: ids.get(graph.rootId), documents };
}

export async function materializeRuntimeItemGraph(actor, graph, operationId, rootData, { recoverMissing = false, parentContainerId = null } = {}) {
  const plan = buildRuntimeGraphDocuments(graph, operationId, rootData, { actorId: actor.id ?? "", parentContainerId });
  const existing = plan.documents.map(data => actor.items.get(data._id));
  const verify = (requireAll = true) => {
    for (const data of plan.documents) {
      const item = actor.items.get(data._id), actual = item?.toObject?.();
      if (!item && !requireAll) continue;
      if (!actual || itemInstanceFingerprint(actual.flags?.[MODULE_ID]?.runtimeGraphOrigin) !== itemInstanceFingerprint(data.flags[MODULE_ID].runtimeGraphOrigin)) conflict();
      if (actual.type !== data.type || actual.system?.quantity !== data.system?.quantity
        || (actual.system?.container ?? null) !== (data.system?.container ?? null)
        || itemInstanceFingerprint(actual.flags?.[MODULE_ID]?.itemUpgrades ?? null) !== itemInstanceFingerprint(data.flags[MODULE_ID].itemUpgrades ?? null)
        || itemInstanceFingerprint(actual.flags?.[MODULE_ID]?.installedUpgrade ?? null) !== itemInstanceFingerprint(data.flags[MODULE_ID].installedUpgrade ?? null)) conflict();
      if (recoverMissing && !matchesPreparedValue(actual, data)) conflict();
    }
    return actor.items.get(plan.rootItemId);
  };
  if (existing.every(Boolean)) return verify();
  if (existing.some(Boolean)) {
    if (!recoverMissing) return verify();
    verify(false);
  }
  const missing = plan.documents.filter(data => !actor.items.get(data._id));
  try { await actor.createEmbeddedDocuments("Item", missing, { keepId: true, renderSheet: false }); }
  catch (error) { if (!plan.documents.some(data => actor.items.get(data._id))) throw error; }
  return verify();
}
