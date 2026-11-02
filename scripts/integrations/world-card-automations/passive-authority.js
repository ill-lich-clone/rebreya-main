import { cardId, onlyKeys, resolveCard } from "./card-effect-authority.js";

const running = new Set();
const kinds = {
  wardingBondTarget: ["wardingBond", "wardingBondSource", "wardingBond", "bondUuids"],
  compelledDuelCompelled: ["compelledDuel", "compelledDuelSource", "compelledDuel", "targetUuids"]
};
const flags = (doc) => doc?.flags?.["chris-premades"];
const tokenDoc = (token) => token?.document ?? token;
const same = (a, b) => Boolean(a?.uuid && a.uuid === b?.uuid);
const resolve = (uuid) => globalThis.fromUuid(uuid);
function damageFor(entries, target) {
  const rows = Array.from(entries ?? []);
  const result =
    rows.find((d) => d.tokenUuid === target.uuid || d.tokenId === target.id) ??
    rows.find((d) => !d.tokenUuid && !d.tokenId && d.actorId === target.actor.id);
  if (!Array.isArray(result?.damageDetail)) return null;
  return Math.floor(result.damageDetail.reduce((sum, entry) => sum + Number(entry.value), 0));
}

async function linkedPassive(kind, target, effect, lookup) {
  if (
    !Object.hasOwn(kinds, kind) ||
    !target?.actor ||
    !same(effect?.parent, target.actor) ||
    effect.disabled ||
    effect.isSuppressed
  )
    return null;
  const [rootId, parentId, flag, key] = kinds[kind];
  if (cardId(effect) !== (kind === "compelledDuelCompelled" ? "compelledDuelTarget" : kind)) return null;
  const parentUuid = flags(effect)?.parentEntityUuid;
  if (typeof parentUuid !== "string" || parentUuid.length > 400 || !/^(?:Actor|Scene)\./u.test(parentUuid)) return null;
  const parent = await lookup(parentUuid),
    item = await resolveCard(parent?.origin, lookup);
  if (
    cardId(parent) !== parentId ||
    cardId(item) !== rootId ||
    !same(parent?.parent, item?.actor) ||
    parent.disabled ||
    parent.isSuppressed
  )
    return null;
  if (!flags(parent)?.[flag]?.[key]?.includes(target.uuid)) return null;
  const origin = await resolveCard(effect.origin, lookup);
  if (!same(origin, item)) return null;
  const sourceUuid = flags(effect)?.[flag]?.[kind === "wardingBondTarget" ? "bondUuid" : "sourceUuid"];
  if (typeof sourceUuid !== "string" || !/^Scene\.[\w-]+\.Token\.[\w-]+$/u.test(sourceUuid)) return null;
  const source = await lookup(sourceUuid);
  if (!same(source?.actor, item.actor) || !same(source?.parent, target.parent) || same(source, target)) return null;
  return { source, parent, item };
}

// These two incoming phases mutate only the current workflow. They never execute a document-supplied callback.
export async function applyPassiveModifier(kind, { workflow, trigger, ditem }, lookup = resolve) {
  const target = tokenDoc(trigger.token),
    effect = trigger.entity;
  if (!same(effect?.parent, target?.actor) || effect.disabled || effect.isSuppressed) return;
  if (kind === "blurEffect") {
    const item = await resolveCard(effect.origin, lookup);
    if (cardId(effect) !== "blurEffect" || cardId(item) !== "blur" || !same(item.actor, target.actor)) return;
    const concentration = globalThis.MidiQOL?.getConcentrationEffect?.(item.actor, item);
    if (
      !concentration ||
      !(effect.origin === concentration.uuid || flags(effect)?.concentrationEffectUuid === concentration.uuid)
    )
      return;
    const { definitions } = await import("./registry.js");
    const attacked = definitions.modern.blurEffect.midi.actor.find(
      (row) => row.pass === "targetPreAttackRollConfig"
    ).macro;
    return attacked({ workflow, trigger });
  }
  if (kind === "hexbladesCurseTarget") {
    const id = flags(effect)?.parentEntityUuid;
    if (typeof id !== "string" || !/^(?:Actor|Scene)\./u.test(id)) return;
    const item = await resolveCard(effect.origin, lookup),
      parent = await lookup(id);
    if (
      cardId(effect) !== kind ||
      cardId(item) !== "hexbladesCurse" ||
      !same(item.actor, workflow.actor) ||
      cardId(parent) !== "hexbladesCurse" ||
      !same(parent?.parent, item.actor) ||
      flags(parent)?.hexbladesCurse?.target !== target.id
    )
      return;
    const { definitions } = await import("./registry.js");
    const damageApplication = definitions.legacy.hexbladesCurseTarget.midi.actor.find(
      (row) => row.pass === "targetApplyDamage"
    ).macro;
    return damageApplication({ workflow, trigger, ditem });
  }
}

export async function routeIncomingPassive(kind, { workflow, trigger }, send, lookup = resolve) {
  const target = tokenDoc(trigger.token),
    effect = trigger.entity,
    attacker = tokenDoc(workflow.token);
  const pair = await linkedPassive(kind, target, effect, lookup);
  if (!pair || !attacker || !workflow.itemCardUuid) return;
  const data = {
    kind,
    target: target.uuid,
    effect: effect.uuid,
    attacker: attacker.uuid,
    message: workflow.itemCardUuid
  };
  if (kind === "wardingBondTarget") {
    if (!Array.from(workflow.hitTargets ?? []).some((t) => same(tokenDoc(t), target))) return;
    const damage = damageFor(workflow.damageList, target);
    if (!Number.isSafeInteger(damage) || damage <= 0) return;
    data.damage = damage;
  } else if (attacker.disposition === target.disposition || same(pair.source, attacker)) return;
  return send(kind === "wardingBondTarget" ? pair.item.actor : target.actor, data);
}

export async function receiveIncomingPassive(data, { game, sender, resolve: lookup, confirm, ownerFor, rollDamage }) {
  if (
    !onlyKeys(data, ["kind", "target", "effect", "attacker", "message", "damage"]) ||
    !Object.hasOwn(kinds, data.kind) ||
    !/^ChatMessage\.[\w-]+$/u.test(data.message) ||
    ![data.target, data.effect, data.attacker].every(
      (id) => typeof id === "string" && id.length < 400 && /^(?:Actor|Scene)\./u.test(id)
    )
  )
    throw Error("Некорректные данные входящей атаки.");
  const [target, effect, attacker, message] = await Promise.all(
    [data.target, data.effect, data.attacker, data.message].map(lookup)
  );
  const pair = await linkedPassive(data.kind, target, effect, lookup);
  const age = Date.now() - Number(message?.timestamp);
  const attackItem = message?.getAssociatedItem?.();
  if (
    !pair ||
    target?.documentName !== "Token" ||
    attacker?.documentName !== "Token" ||
    !same(target.parent, attacker.parent) ||
    message?.documentName !== "ChatMessage" ||
    !same(message.getAssociatedToken?.(), attacker) ||
    message.author?.id !== sender.id ||
    !same(attackItem?.actor, attacker.actor) ||
    !attacker.actor?.testUserPermission?.(sender, "OWNER") ||
    !Number.isFinite(age) ||
    age < -30000 ||
    age > 600000
  )
    throw Error("Не подтверждены источник атаки и пара эффектов.");
  const ward = data.kind === "wardingBondTarget";
  const actor = ward ? pair.item.actor : target.actor;
  if (
    ownerFor(actor)?.id !== game.user.id ||
    !actor.testUserPermission(game.user, "OWNER") ||
    (game.user.isGM && actor.hasPlayerOwner)
  )
    throw Error("Для входящей автоматизации требуется активный владелец.");
  if (!ward) {
    if (attacker.disposition === target.disposition || same(pair.source, attacker)) return;
    if (!(await confirm(sender, "Завершить эффект дуэли на цели", attacker.name + " → " + target.name))) return false;
    if (!(await linkedPassive(data.kind, target, await lookup(data.effect), lookup))) return false;
    await effect.delete();
    return true;
  }
  if (!Number.isSafeInteger(data.damage) || data.damage <= 0 || data.damage > 100000)
    throw Error("Некорректный итог урона.");
  const native = globalThis.MidiQOL?.Workflow?.getWorkflow?.(message.uuid);
  const available = damageFor(native?.damageList ?? message.flags?.["midi-qol"]?.damageList, target);
  if (available !== null && available !== data.damage)
    throw Error("Полученный урон расходится с результатом атаки у владельца.");
  const receipt = "worldCardBondDamage." + message.id + "_" + target.id,
    key = pair.parent.uuid + "|" + receipt;
  if (running.has(key) || pair.parent.getFlag("rebreya-main", receipt)) return false;
  running.add(key);
  try {
    const amount =
      available === null && !sender.isGM
        ? "заявленный итог " + data.damage + " HP. Сверьте бросок перед применением"
        : data.damage + " HP";
    if (
      !(await confirm(
        sender,
        "Передать урон Охранной связи",
        attackItem.name + " (" + message.id + ") · " + target.name + " → " + pair.source.name + " · " + amount
      ))
    )
      return false;
    if (
      !(await linkedPassive(data.kind, target, await lookup(data.effect), lookup)) ||
      pair.parent.getFlag("rebreya-main", receipt)
    )
      return false;
    const id = flags(pair.item)?.activityIdentifiers?.wardingBondDamage;
    const activity = pair.item.system.activities.get(id);
    if (!activity || !same(activity.item, pair.item)) throw Error("Отсутствует действие урона Охранной связи.");
    // Claim before rolling. An interrupted native roll must not cause a second damage application on retry.
    await pair.parent.setFlag("rebreya-main", receipt, true);
    if (rollDamage) await rollDamage(activity, data.damage, pair);
    else {
      const { activityUtils } = await import("./selected/lib/utilities/activityUtils.js");
      const { workflowUtils } = await import("./selected/lib/utilities/workflowUtils.js");
      const adjusted = activityUtils.withChangedDamage(activity, String(data.damage));
      await workflowUtils.syntheticActivityDataRoll(adjusted, pair.item, pair.item.actor, [pair.source.object]);
    }
    if (pair.item.actor.system.attributes.hp.value === 0) {
      const { genericUtils } = await import("./selected/lib/utilities/genericUtils.js");
      await genericUtils.remove(effect);
    }
    return true;
  } finally {
    running.delete(key);
  }
}
