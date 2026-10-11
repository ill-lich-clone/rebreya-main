import { TreatWoundsError } from "./treat-wounds-rules.js?v=1.4.372";
const SCOPE = "rebreya-main";
const reject = (code, text) => { throw new TreatWoundsError(code, text); };

/** Runs only through InventoryService's existing inventory queue and durable journal. */
export function consumeTreatWoundsKitOnce(owner, payload, context, { adapter, resolve = uuid => globalThis.fromUuid(uuid) }) {
  return owner.mutationCoordinator.run("inventory", async () => {
    const { operationId, sourceActorUuid, kitItemUuid, groupActorId } = payload;
    const sender = context.sender;
    await context.assertAuthority();
    const actor = groupActorId ? await owner.getInventoryActor({ create: false, groupActorId }) : await resolve(sourceActorUuid);
    if (!actor || !sender || (!sender.isGM && (groupActorId
      ? !owner.moduleApi.groupContextService.canManageGroupForUser(groupActorId, sender)
      : actor.testUserPermission?.(sender, "OWNER") !== true))) reject("unauthorized", "Нет доступа к источнику комплекта целителя.");
    if (!kitItemUuid.startsWith(`${actor.uuid}.Item.`)) reject("invalid-kit", "Комплект не принадлежит выбранному инвентарю.");
    const id = `treat-wounds-kit:${operationId}`, fingerprint = JSON.stringify([context.operationSenderId ?? sender.id, operationId, sourceActorUuid, kitItemUuid, groupActorId]);
    let record = await owner.mutationJournal.find(id);
    if (record && record.fingerprint !== fingerprint) reject("operation-conflict", "Источник расхода изменён.");
    if (record?.terminal) return record;
    const itemId = kitItemUuid.split(".").at(-1), item = actor.items.get(itemId);
    if (!record) {
      const state = adapter.kitState(item);
      if (!state.eligible) reject("invalid-kit", state.reason);
      // Never silently discard a contained/assembled graph when spending a kit.
      if (Array.from(actor.items.values()).some(child => child.id !== itemId && child.system?.container === itemId)) reject("invalid-kit", "Сначала выньте содержимое из комплекта.");
      record = await owner.mutationJournal.start({ id, kind: "treat-wounds-kit", fingerprint, phase: "prepared", actorUuid: actor.uuid,
        itemId, before: state.quantity, after: state.quantity - 1, uses: JSON.stringify(item.system.uses ?? null) });
    }
    const receipt = item?.getFlag?.(SCOPE, "treatWoundsKitReceipt") ?? item?.flags?.[SCOPE]?.treatWoundsKitReceipt;
    const observed = record.after === 0 ? !item : receipt === operationId && Number(item?.system?.quantity) === record.after;
    if (!observed) {
      if (!item || Number(item.system.quantity) !== record.before || JSON.stringify(item.system.uses ?? null) !== record.uses) reject("manual-review", "Комплект изменился во время расхода. Нужна проверка Мастера.");
      await context.assertAuthority();
      try {
        if (record.after === 0) await item.delete();
        else await item.update({ "system.quantity": record.after, [`flags.${SCOPE}.treatWoundsKitReceipt`]: operationId });
      } catch (error) {
        const current = actor.items.get(itemId);
        const applied = record.after === 0 ? !current : Number(current?.system?.quantity) === record.after
          && (current?.getFlag?.(SCOPE, "treatWoundsKitReceipt") ?? current?.flags?.[SCOPE]?.treatWoundsKitReceipt) === operationId;
        if (!applied) throw error;
      }
    }
    await context.assertAuthority();
    if (record.phase === "prepared") record = await owner.mutationJournal.checkpoint(id, "prepared", "debited");
    return owner.mutationJournal.finish(id, { consumed: 1 });
  });
}
