import { createStableGearDocumentId } from "./gear-document-ids.js";
import { itemInstanceFingerprint } from "../application/item-instance-workflow.js?v=1.5.17";
import { buildHeldItemWornUpdate } from "../integrations/held-items.js?v=1.5.27";
import { collectItemSourceUuids, preserveItemSourceUuid } from "./item-source-reference.js?v=1.4.377";
const MODULE_ID = "rebreya-main";
export const RUNTIME_ITEM_GRAPH_FLAG = "runtimeItemGraph";
const conflict = () => { const error = new Error("Состав предмета изменился или перенесён частично; нужна сверка экземпляров."); error.code = "graph-manual-review"; throw error; };
const clone = value => structuredClone(value);
const snapshotKey = data => { const copy = clone(data); delete copy._stats; return itemInstanceFingerprint(copy); };
const matchesPreparedValue = (actual, expected) => {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value,i) => matchesPreparedValue(actual[i],value));
  if (expected && typeof expected === "object") return actual && typeof actual === "object"
    && Object.entries(expected).every(([key,value]) => matchesPreparedValue(actual[key],value));
  return actual === expected;
};

/** Physical links only: unsupported/custom rules remain transferable without granting effects. */
export function getRuntimeWeaponModChildren(host,items) {
  const data=host.toObject?.() ?? host,hostId=host.id ?? host._id,flags=data.flags?.[MODULE_ID],state=flags?.weaponMods;
  if(flags?.weaponModShot?.phase==="consumed"){
    const error=new Error("Сначала восстановите карточку выстрела гранатомёта; затем оружие можно переносить или изменять.");
    error.code="pending-weapon-mod-shot";throw error;
  }
  const actorId=host.actor?.id ?? host.parent?.id,children=[],seen=new Set(),sources=new Set(),mounts=new Set();
  if(state!=null) {
    if(state.version!==1 || !Array.isArray(state.attachments) || !Array.isArray(state.modernizedParts)
      || data.system?.quantity!==1)conflict();
    for(const [field,kind] of [["attachments","weaponAttachment"],["modernizedParts","modernizedPart"]])for(const entry of state[field]) {
      const child=items.find(item=>(item.id ?? item._id)===entry.itemId),childData=child?.toObject?.() ?? child,childFlags=childData?.flags?.[MODULE_ID],link=childFlags?.installedWeaponMod;
      const selected=field==="attachments"?entry.mountIds:[];
      if(!child || !entry.sourceId || seen.has(entry.itemId) || sources.has(entry.sourceId) || childData.system?.quantity!==1
        || childData.system?.container!==hostId || childFlags?.gearId!==entry.sourceId || link?.version!==1
        || link.kind!==kind || link.hostItemId!==hostId || (actorId && link.hostActorId!==actorId)
        || !Array.isArray(selected) || !Array.isArray(link.mountIds) || selected.length!==link.mountIds.length
        || new Set(selected).size!==selected.length || selected.some(mount=>!link.mountIds.includes(mount) || mounts.has(mount))
        || (field==="attachments" && !selected.length))conflict();
      seen.add(entry.itemId);sources.add(entry.sourceId);selected.forEach(mount=>mounts.add(mount));children.push(child);
    }
  }
  for(const child of items) {
    const childFlags=(child.flags ?? child.toObject?.()?.flags)?.[MODULE_ID];
    if(childFlags?.installedWeaponMod?.hostItemId===hostId && !seen.has(child.id ?? child._id))conflict();
  }
  return children;
}

/** Detached transport snapshot of live Documents, not a catalogue rebuild or another world repository. */
export function captureRuntimeItemGraph(actor, root) {
  const items = Array.from(actor.items.contents ?? actor.items.values());
  const nodes = [], visited = new Set(), sourceUuidsByItemId = {};
  const visit = item => {
    if (!item || visited.has(item.id) || nodes.length >= 200) conflict();
    visited.add(item.id); const data = item.toObject(); nodes.push(data);
    const [sourceUuid] = collectItemSourceUuids(data);
    if (sourceUuid) sourceUuidsByItemId[item.id] = sourceUuid;
    const installed = data.flags?.[MODULE_ID]?.itemUpgrades?.installed ?? [];
    const childIds = new Set(installed.map(entry => entry.itemId));
    for(const child of getRuntimeWeaponModChildren(item,items))childIds.add(child.id ?? child._id);
    for (const child of items) if (child.system?.container === item.id) childIds.add(child.id);
    for (const id of childIds) visit(actor.items.get(id));
  };
  visit(root);
  return { version: 1, rootId: root.id, nodes, ...(Object.keys(sourceUuidsByItemId).length ? { sourceUuidsByItemId } : {}) };
}

export function buildRuntimeGraphDocuments(graph, operationId, rootData, { actorId = null, parentContainerId = null } = {}) {
  if (graph?.version !== 1 || !Array.isArray(graph.nodes) || !graph.nodes.length || graph.nodes.length > 200
    || graph.nodes[0]?._id !== graph.rootId || typeof operationId !== "string" || !operationId) conflict();
  const ids = new Map(graph.nodes.map(node => [node._id, createStableGearDocumentId(`${operationId}:${node._id}`)]));
  if (ids.size !== graph.nodes.length || graph.nodes.some(node => typeof node._id !== "string" || !node._id)) conflict();
  for(const node of graph.nodes)getRuntimeWeaponModChildren(node,graph.nodes);
  const documents = graph.nodes.map(node => {
    const sourceId = node._id;
    const input = node._id === graph.rootId ? rootData ?? node : node;
    const sourceUuid = graph.sourceUuidsByItemId?.[sourceId];
    const data = sourceUuid ? preserveItemSourceUuid(input, { sourceUuid }) : clone(input);
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
    for(const entry of [...(flags.weaponMods?.attachments ?? []),...(flags.weaponMods?.modernizedParts ?? [])]) {
      if(!ids.has(entry.itemId))conflict();entry.itemId=ids.get(entry.itemId);
    }
    if(flags.installedWeaponMod?.hostItemId) {
      if(!ids.has(flags.installedWeaponMod.hostItemId))conflict();
      flags.installedWeaponMod.hostItemId=ids.get(flags.installedWeaponMod.hostItemId);
      if(actorId!==null)flags.installedWeaponMod.hostActorId=actorId;
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
      if(itemInstanceFingerprint(actual.flags?.[MODULE_ID]?.weaponMods ?? null)!==itemInstanceFingerprint(data.flags[MODULE_ID].weaponMods ?? null)
        || itemInstanceFingerprint(actual.flags?.[MODULE_ID]?.installedWeaponMod ?? null)!==itemInstanceFingerprint(data.flags[MODULE_ID].installedWeaponMod ?? null))conflict();
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

/** Native transfers keep their snapshots in memory and use one source batch. */
export function runtimeItemGraphMatchesSource(actor, graph) {
  try {
    const live = captureRuntimeItemGraph(actor, actor.items.get(graph.rootId));
    return live.nodes.length === graph.nodes.length && live.nodes.every((node, index) => snapshotKey(node) === snapshotKey(graph.nodes[index]));
  } catch { return false; }
}

export async function deleteRuntimeItemGraph(actor, graph, { assertAuthority = () => {} } = {}) {
  assertAuthority();
  if (!runtimeItemGraphMatchesSource(actor, graph)) conflict();
  const ids = graph.nodes.map(node => node._id).reverse();
  try { await actor.deleteEmbeddedDocuments("Item", ids); }
  catch (error) { if (ids.some(id => actor.items.get(id))) throw error; }
  if (ids.some(id => actor.items.get(id))) conflict();
}

export async function rollbackRuntimeItemGraph(actor, graph, operationId, rootData, snapshot = null) {
  const plan = buildRuntimeGraphDocuments(graph, operationId, rootData, { actorId: actor.id });
  const present = plan.documents.filter(data => actor.items.get(data._id));
  if (!present.length) return;
  if (present.some(data => !matchesPreparedValue(actor.items.get(data._id).toObject(), data))) conflict();
  if (snapshot && present.some(data => snapshotKey(actor.items.get(data._id).toObject()) !== snapshotKey(snapshot.find(node => node._id === data._id)))) conflict();
  const expectedIds = new Set(plan.documents.map(data => data._id));
  if (Array.from(actor.items.contents ?? actor.items.values()).some(item => !expectedIds.has(item.id)
    && (expectedIds.has(item.system?.container) || expectedIds.has(item.flags?.[MODULE_ID]?.installedUpgrade?.hostItemId)
      || expectedIds.has(item.flags?.[MODULE_ID]?.installedWeaponMod?.hostItemId)))) conflict();
  const ids = present.map(data => data._id).reverse();
  try { await actor.deleteEmbeddedDocuments("Item", ids); }
  catch (error) { if (ids.some(id => actor.items.get(id))) throw error; }
  if (ids.some(id => actor.items.get(id))) conflict();
}
