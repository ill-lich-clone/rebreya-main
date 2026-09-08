import { MODULE_ID } from "../../constants.js";
import { ItemInstanceError } from "../../data/item-instance-rules.js";
import { itemInstanceFingerprint as fingerprint } from "../../application/item-instance-workflow.js";
import { createStableGearDocumentId } from "../../data/gear-document-ids.js";

const prefix = `flags.${MODULE_ID}`;
const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const equal = (a, b) => fingerprint(a) === fingerprint(b);
const conflict = () => { throw new ItemInstanceError("manual-review", "Затронутые поля предмета изменены; нужна ручная сверка."); };
const clone = value => value === undefined ? undefined : structuredClone(value);

function cleanClone(data) {
  const next = clone(data);
  for (const key of ["_id", "_stats", "folder", "sort", "ownership"]) delete next[key];
  const flags = next.flags?.[MODULE_ID];
  if (flags) for (const key of ["inventoryMutation", "inventoryFolderDrag", "inventoryTransfer", "itemInstanceOrigin", "itemInstanceDebit", "itemInstancePlacement"]) delete flags[key];
  return next;
}

/** Compares only fields owned by the operation; unrelated fields are never restored. */
export class ItemInstanceDocuments {
  constructor({ resolveActor = uuid => globalThis.fromUuid(uuid) } = {}) { this.resolveActor = resolveActor; }

  async readActors(intent) {
    const sourceActor = await this.resolveActor(intent.sourceActorUuid);
    const targetActor = intent.sourceActorUuid === intent.destinationActorUuid ? sourceActor : await this.resolveActor(intent.destinationActorUuid);
    if (!sourceActor || !targetActor) throw new ItemInstanceError("actor-not-found", "Персонаж или группа не найдены.");
    return { sourceActor, targetActor };
  }

  async readSource(intent, actors) {
    const sourceItem = actors.sourceActor.items.get(intent.sourceItemId);
    if (!sourceItem) throw new ItemInstanceError("item-not-found", "Исходный предмет больше не существует.");
    const data = sourceItem.toObject();
    const flags = data.flags?.[MODULE_ID] ?? {};
    const material = flags.sourceType === "material";
    const slots = actors.sourceActor.getFlag(MODULE_ID, "heroDoll")?.slots ?? {};
    const uses = [data.system?.uses, ...Object.values(data.system?.activities ?? {}).map(activity => activity?.uses)];
    const limitedUses = uses.some(value => Number(value?.spent) > 0
      || (String(value?.max ?? "").trim() !== "" && Number(value.max) !== 0));
    return { ...actors, sourceItem, data, quantity: data.system?.quantity ?? 1, step: material ? 0.00001 : 1,
      folderId: actors.sourceActor.getFlag(MODULE_ID, "inventoryFolders")?.itemFolderIds?.[sourceItem.id] ?? null,
      hasContents: ["container", "backpack"].includes(data.type) || Boolean(flags.storageContainer)
        || actors.sourceActor.items.contents.some(item => item.system?.container === sourceItem.id),
      hasInstalledUpgrades: Boolean(flags.itemUpgrades?.installed?.length || flags.installedUpgrade?.hostItemId),
      hasIndependentState: Boolean((data.effects?.length ?? 0) > 0 || limitedUses || data.system?.attuned === true
        || flags.curseEater || flags.curseUpgrade || flags.itemInstanceDebit?.pending
        || (flags.durability && (flags.durability.state !== "intact" || flags.durability.hp?.value !== flags.durability.hp?.max))),
      isEquipped: Boolean(data.system?.equipped || Object.values(slots).some(slot => slot.itemId === sourceItem.id)),
      isHeld: Boolean(flags.heldHands?.length)
    };
  }

  async prepare(intent, plan, source, context, operation) {
    if (plan.kind === "move" && !context.moveWhole) throw new ItemInstanceError("unsupported-transfer", "Для целого предмета требуется штатный перенос группы.");
    const itemId = plan.preserveSourceId ? intent.sourceItemId : plan.kind === "move" ? "$target" : createStableGearDocumentId(operation.id);
    const targetData = cleanClone(source.data);
    targetData._id = itemId;
    targetData.system ??= {};
    targetData.system.quantity = plan.quantity;
    if (intent.sourceActorUuid !== intent.destinationActorUuid) targetData.system.container = null;
    targetData.flags ??= {}; targetData.flags[MODULE_ID] ??= {};
    targetData.flags[MODULE_ID].itemInstanceOrigin = { id: operation.id, fingerprint: operation.fingerprint };
    context.prepareTargetData?.(targetData, source);
    const placement = plan.kind === "noop" ? [] : await context.preparePlacement({ ...source, intent, plan, itemId });
    return { itemId, targetData, sourceBefore: source.quantity,
      sourceMarkerBefore: clone(source.data.flags?.[MODULE_ID]?.itemInstanceDebit ?? null),
      sourceMarkerAfter: { id: operation.id, fingerprint: operation.fingerprint, before: source.quantity, after: plan.sourceRemaining },
      placement: clone(placement) };
  }

  async #write(context, operation) {
    await context.assertAuthority();
    const result = await operation();
    await context.assertAuthority();
    return result;
  }

  async createTarget(record, context) {
    if (record.plan.preserveSourceId) return {};
    if (record.plan.kind === "move") return context.moveWhole(record);
    const { targetActor } = await this.readActors(record.intent);
    const existing = targetActor.items.get(record.itemId);
    if (existing) {
      if (!equal(existing.getFlag(MODULE_ID, "itemInstanceOrigin"), record.targetData.flags[MODULE_ID].itemInstanceOrigin)) conflict();
      return {};
    }
    await this.#write(context, () => targetActor.createEmbeddedDocuments("Item", [clone(record.targetData)], { keepId: true, renderSheet: false }));
    const created = targetActor.items.get(record.itemId);
    if (!created || !equal(created.getFlag(MODULE_ID, "itemInstanceOrigin"), record.targetData.flags[MODULE_ID].itemInstanceOrigin)) conflict();
    return {};
  }

  async debitSource(record, context) {
    if (record.plan.preserveSourceId || record.plan.kind === "move") return;
    const { sourceActor, targetActor } = await this.readActors(record.intent);
    if (!targetActor.items.get(record.itemId)) conflict();
    const item = sourceActor.items.get(record.intent.sourceItemId);
    if (!item) conflict();
    const quantity = item.system.quantity, marker = item.getFlag(MODULE_ID, "itemInstanceDebit") ?? null;
    if (quantity === record.plan.sourceRemaining && equal(marker, record.sourceMarkerAfter)) return;
    if (quantity !== record.sourceBefore || !equal(marker, record.sourceMarkerBefore)) conflict();
    await this.#write(context, () => item.update({ "system.quantity": record.plan.sourceRemaining, [`${prefix}.==itemInstanceDebit`]: clone(record.sourceMarkerAfter) }));
  }

  #substitute(value, record) {
    if (value === "$target") return record.itemId;
    if (Array.isArray(value)) return value.map(entry => this.#substitute(entry, record));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key.replaceAll("$target", record.itemId), this.#substitute(entry, record)]));
    return value;
  }

  async #placementDocument(step, record) {
    const actors = await this.readActors(record.intent);
    const actor = step.actor === "source" ? actors.sourceActor : actors.targetActor;
    return step.itemId ? actor.items.get(step.itemId === "$target" ? record.itemId : step.itemId) : actor;
  }

  #readFields(document, fields) {
    const data = document.toObject();
    return Object.fromEntries(Object.keys(fields).map(path => [path, get(data, path) ?? null]));
  }

  #update(fields) {
    return Object.fromEntries(Object.entries(fields).map(([path, value]) => {
      if (value !== null) {
        const parts = path.split(".");
        if (typeof value === "object" && !Array.isArray(value)) parts[parts.length - 1] = `==${parts.at(-1)}`;
        return [parts.join("."), clone(value)];
      }
      const parts = path.split("."); parts[parts.length - 1] = `-=${parts.at(-1)}`;
      return [parts.join("."), null];
    }));
  }

  async writePlacement(record, context) {
    for (const raw of record.placement) {
      const step = this.#substitute(raw, record);
      const document = await this.#placementDocument(step, record);
      if (!document) conflict();
      const current = this.#readFields(document, step.before);
      if (equal(current, step.after)) continue;
      if (!equal(current, step.before)) conflict();
      await this.#write(context, () => document.update(this.#update(step.after)));
    }
  }

  async verifyCommitted(record, context) {
    const { sourceActor, targetActor } = await this.readActors(record.intent);
    if (!targetActor.items.get(record.itemId)) conflict();
    if (record.plan.kind === "split") {
      const item = sourceActor.items.get(record.intent.sourceItemId);
      if (item?.system.quantity !== record.plan.sourceRemaining || !equal(item.getFlag(MODULE_ID, "itemInstanceDebit"), record.sourceMarkerAfter)) conflict();
      if (targetActor.items.get(record.itemId).system.quantity !== record.plan.quantity) conflict();
    }
    if (record.plan.kind === "move") await context.verifyWhole(record);
    for (const raw of record.placement) {
      const step = this.#substitute(raw, record), document = await this.#placementDocument(step, record);
      if (!document || !equal(this.#readFields(document, step.after), step.after)) conflict();
    }
  }

  async compensate(record, context) {
    // The whole-transfer owner is the only owner of its debit and deletion receipts.
    if (record.plan.kind === "move") conflict();
    const { sourceActor, targetActor } = await this.readActors(record.intent);
    const source = sourceActor.items.get(record.intent.sourceItemId);
    const target = targetActor.items.get(record.itemId);
    if (!source) conflict();
    const sourceBefore = source.system.quantity === record.sourceBefore && equal(source.getFlag(MODULE_ID, "itemInstanceDebit") ?? null, record.sourceMarkerBefore);
    const sourceAfter = source.system.quantity === record.plan.sourceRemaining && equal(source.getFlag(MODULE_ID, "itemInstanceDebit"), record.sourceMarkerAfter);
    if (!sourceBefore && !sourceAfter) conflict();
    if (!record.plan.preserveSourceId && !target && !sourceBefore) conflict();
    const steps = [];
    for (const raw of record.placement) {
      const step = this.#substitute(raw, record), document = await this.#placementDocument(step, record);
      if (!document && step.itemId === record.itemId && !target && sourceBefore) continue;
      if (!document) conflict();
      const current = this.#readFields(document, step.before);
      if (!equal(current, step.before) && !equal(current, step.after)) conflict();
      steps.push({ step, document, applied: equal(current, step.after) });
    }
    if (target && !record.plan.preserveSourceId) {
      if (!equal(target.getFlag(MODULE_ID, "itemInstanceOrigin"), record.targetData.flags[MODULE_ID].itemInstanceOrigin)
        || target.system.quantity !== record.plan.quantity || target.name !== record.targetData.name) conflict();
      // Refuse to delete a target whose non-placement data changed after creation.
      const actual = cleanClone(target.toObject()), expected = cleanClone(record.targetData);
      for (const {step} of steps.filter(entry => entry.document === target)) for (const path of Object.keys(step.before)) {
        const remove = data => { const parts=path.split("."); const leaf=parts.pop(); const parent=parts.reduce((v,k)=>v?.[k],data); if(parent)delete parent[leaf]; };
        remove(actual);remove(expected);
      }
      if (!equal(actual, expected)) conflict();
    }
    for (const {step,document,applied} of steps.reverse()) if (applied) await this.#write(context, () => document.update(this.#update(step.before)));
    if (!record.plan.preserveSourceId && sourceAfter) await this.#write(context, () => source.update({ "system.quantity": record.sourceBefore,
      ...this.#update({ [`${prefix}.itemInstanceDebit`]: record.sourceMarkerBefore }) }));
    if (target && !record.plan.preserveSourceId) await this.#write(context, () => target.delete());
  }
}
