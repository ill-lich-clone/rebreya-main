/** dnd5e 6 stores usage evidence in the chat data model; dnd5e 5 used flags. */
export function usageCardData(message) {
  if (message?.type === "usage") return message.system ?? null;
  const legacy = message?.flags?.dnd5e;
  return legacy?.messageType === "usage" ? legacy : null;
}

export function cardHitEvidence(message, targetUuid) {
  if (!targetUuid) return false;
  if (message?.type === "usage") {
    return message.system?.midi?.sections?.hits?.data?.hits?.some(row => row.uuid === targetUuid && row.hitClass === "success") === true;
  }
  const midi = message?.flags?.["midi-qol"];
  return [...(midi?.hitTargetUuids ?? []), ...(midi?.hitECTargetUuids ?? [])].includes(targetUuid);
}

export function cardDamageRolls(message, {bonus = false} = {}) {
  const modern = message?.type === "usage";
  const midi = message?.flags?.["midi-qol"];
  const entries = modern ? message.rolls : bonus ? midi?.bonusDamageRolls : midi?.damageRolls;
  return Array.from(entries ?? []).flatMap(entry => {
    let roll = entry?.toJSON?.() ?? entry;
    if (typeof roll === "string") {
      try { roll = JSON.parse(roll); } catch { return []; }
    }
    return roll && (!modern || roll.options?.["midi-qol"]?.rollType === (bonus ? "bonusDamage" : "defaultDamage")) ? [roll] : [];
  });
}

export function flushCardDamage(workflow, message) {
  // Midi 14 displays damage after DamageRollComplete. Publish its evaluated rolls before GM validation.
  const update = message?.type === "usage" && Array.isArray(workflow.chatRolls) ? {rolls: workflow.chatRolls} : {};
  return workflow.performThrottledUpdate(message, update, true);
}
