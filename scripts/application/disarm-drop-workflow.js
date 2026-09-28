import { captureRuntimeItemGraph } from "../data/runtime-item-graph.js?v=1.4.252";
import { ItemInstanceDocuments } from "../infrastructure/foundry/item-instance-documents.js";
import { planItemInstanceMutation } from "../data/item-instance-rules.js";
import { itemInstanceFingerprint as fingerprint } from "./item-instance-workflow.js";
import { buildHeldItemWornUpdate } from "../integrations/held-items.js";
import { DisarmError } from "../combat/disarm-rules.js?v=1.4.252";
const MODULE_ID = "rebreya-main";
const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const same = (left, right) => fingerprint(left ?? null) === fingerprint(right ?? null);
const conflict = message => { throw new DisarmError("manual-review", message); };
const itemData = item => { const data = item?.toObject?.(); if (data) delete data._stats; return data; };

/** Internal worker of StorageCommandService; no socket route or independent storage. */
export async function runDisarmDrop(owner, operationId, context) {
  const journal = owner.inventoryService.mutationJournal, id = `disarm-drop:${operationId}`;
  const write = async action => { await context.assertAuthority(); const result = await action(); await context.assertAuthority(); return result; };
  const phase = (record, next, patch = {}) => write(() => journal.checkpoint(id, record.phase, next, patch));
  let record = await journal.find(id);
  if (record?.terminal) return record.result.value;
  const attack = await journal.find(`disarm:${operationId}`);
  if (!attack?.dropped || !["drop-prepared", "drop-committed", "completed"].includes(attack.phase)) conflict("Нет подтверждённого провала спасброска.");
  const actor = await owner.resolveDocument(attack.targetActorUuid);
  if (!actor) conflict("Персонаж больше недоступен.");
  if (!record) {
    await owner.validateDisarmDestination?.(attack);
    const source = await owner.resolveDocument(attack.intent.targetItemUuid);
    if (!source || source.parent?.uuid !== actor.uuid) conflict("Предмет больше не принадлежит цели.");
    const sourceDescription = await new ItemInstanceDocuments().readSource({ sourceItemId: source.id }, { sourceActor: actor, targetActor: actor });
    // A held stack represents one held unit and an unequipped remainder. All other R3 complex-state checks remain.
    const plan = planItemInstanceMutation({ source: { ...sourceDescription, isHeld: false, isEquipped: false }, quantity: 1, sameActor: false, sameFolder: false, forHeroSlot: false });
    const graph = captureRuntimeItemGraph(actor, source);
    const snapshots = graph.nodes.map(node => { const data = structuredClone(node); delete data._stats; return data; });
    const rootData = structuredClone(graph.nodes[0]); rootData.system.quantity = 1;
    const row = { rowKind: "item", rowId: id, sourceType: "runtime-instance", sourceId: id, name: source.name,
      img: source.img ?? rootData.img, quantity: 1, itemData: rootData,
      // The full snapshot travels only in an authoritative storage row. It is never trusted from an Item flag.
      runtimeGraph: { ...graph, nodes: graph.nodes.map((node, index) => index === 0 ? rootData : node) } };
    const placement = await owner.prepareDisarmPlacement?.(actor, source) ?? [];
    record = await write(() => journal.start({ id, kind: "disarm-drop", phase: "prepared", operationId, actorUuid: actor.uuid,
      sourceItemId: source.id, snapshots, sourceBefore: sourceDescription.quantity, sourceRemaining: plan.sourceRemaining,
      sourcePatch: { ...buildHeldItemWornUpdate(false, source), "system.quantity": plan.sourceRemaining,
        [`flags.${MODULE_ID}.disarmDebit`]: { id, before: sourceDescription.quantity, after: plan.sourceRemaining } },
      row, placement, point: { sceneId: attack.sceneId, x: attack.destination.x, y: attack.destination.y, mutationId: id } }));
  }
  const assertOriginal = () => {
    for (const data of record.snapshots) if (!same(itemData(actor.items.get(data._id)), data)) conflict("Исходный предмет изменился до списания.");
  };
  if (record.phase === "prepared") {
    assertOriginal(); await owner.validateDisarmDestination?.(attack);
    record = await phase(record, "ground-creating");
    let result;
    try { result = await write(() => owner.groundPileService.transferToScene({ ...record.point, row: record.row, quantity: 1 })); }
    catch (error) {
      await context.assertAuthority();
      result = await owner.groundPileService.findProcessedMutationAtPoint(record.point);
      if (!result) throw error;
    }
    record = await phase(record, "ground-created", { ground: { tokenUuid: result.token?.uuid ?? result.tokenUuid ?? "" } });
  } else if (record.phase === "ground-creating") {
    const result = await owner.groundPileService.findProcessedMutationAtPoint(record.point);
    if (!result) conflict("Создание наземного предмета не подтверждено. Повторная выдача запрещена.");
    record = await phase(record, "ground-created", { ground: { tokenUuid: result.token?.uuid ?? result.tokenUuid ?? "" } });
  }
  if (record.phase === "ground-created") {
    assertOriginal(); record = await phase(record, "source-debit-started");
  }
  if (record.phase === "source-debit-started") {
    if (record.sourceRemaining > 0) {
      const source = actor.items.get(record.sourceItemId);
      if (!source) conflict("Остаток исходного стака исчез.");
      const receipt = source.getFlag(MODULE_ID, "disarmDebit");
      if (!(same(receipt, record.sourcePatch[`flags.${MODULE_ID}.disarmDebit`]) && source.system.quantity === record.sourceRemaining)) {
        if (source.system.quantity !== record.sourceBefore) conflict("Остаток исходного стака изменён.");
        assertOriginal();
        try { await write(() => source.update(record.sourcePatch)); }
        catch (error) { await context.assertAuthority(); if (!same(source.getFlag(MODULE_ID, "disarmDebit"), record.sourcePatch[`flags.${MODULE_ID}.disarmDebit`]) || source.system.quantity !== record.sourceRemaining) throw error; }
      }
    } else {
      const remaining = record.snapshots.filter(data => actor.items.get(data._id));
      if (remaining.some(data => !same(itemData(actor.items.get(data._id)), data))) conflict("Состав исходного предмета изменён.");
      try {
        if (remaining.length && actor.deleteEmbeddedDocuments) await write(() => actor.deleteEmbeddedDocuments("Item", remaining.map(data => data._id)));
        else for (const data of remaining.toReversed()) await write(() => actor.items.get(data._id).delete());
      } catch (error) { await context.assertAuthority(); if (record.snapshots.some(data => actor.items.get(data._id))) throw error; }
    }
    record = await phase(record, "source-debited");
  }
  if (record.phase === "source-debited") {
    const patch = {};
    for (const step of record.placement) {
      const current = get(actor.toObject(), step.path);
      if (same(current, step.after)) continue;
      if (!same(current, step.before)) conflict("Ячейка героя занята другим предметом.");
      const parts = step.path.split("."); const key = parts.pop();
      patch[`${parts.join(".")}.${step.after == null ? "-=" : ""}${key}`] = step.after;
    }
    if (Object.keys(patch).length) {
      try { await write(() => actor.update(patch)); }
      catch (error) { await context.assertAuthority(); if (record.placement.some(step => !same(get(actor.toObject(), step.path), step.after))) throw error; }
    }
    record = await phase(record, "committed");
  }
  await write(() => journal.finish(id, { ok: true, value: record.ground }));
  return record.ground;
}
