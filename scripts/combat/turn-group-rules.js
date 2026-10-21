export const GROUPED_COMBAT_FLAG = "groupedCombat";
export const combatantsOf = combat => Array.from(combat?.combatants?.contents ?? combat?.combatants ?? []);
// Foundry expands every dotted object key, including keys inside arbitrary flags.
export const combatFlagKey = value => encodeURIComponent(JSON.stringify(value)).replaceAll(".", "%2E");

export function buildCombatTurnGroups(members, previousGroups = []) {
  const identity = member => member.groupable && member.initiativeKey && member.baseActorId
    ? JSON.stringify([member.baseActorId, member.disposition, member.initiativeKey]) : `single:${member.combatantId}`;
  const initiatives = new Map();
  for (const member of members) {
    if (!Number.isFinite(member.initiative)) continue;
    const key = identity(member);
    if (!initiatives.has(key)) initiatives.set(key, new Set());
    initiatives.get(key).add(member.initiative);
  }
  const buckets = new Map();
  for (const member of members) {
    const key = identity(member), established = initiatives.get(key);
    const initiative = Number.isFinite(member.initiative) ? member.initiative : established?.size === 1 ? [...established][0] : null;
    const bucketKey = JSON.stringify([key, initiative]);
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { memberIds: [], initiative });
    buckets.get(bucketKey).memberIds.push(member.combatantId);
  }
  const used = new Set();
  return [...buckets.values()].map(group => {
    group.memberIds.sort();
    const prior = previousGroups.find(g => !used.has(g.id) && g.memberIds.some(id => group.memberIds.includes(id)));
    group.id = prior?.id ?? `group:${group.memberIds[0]}`;
    used.add(group.id);
    return group;
  }).sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity) || a.id.localeCompare(b.id));
}

export function planGroupTransition(state, target, groups, skippedGroupIds = new Set()) {
  const all = groups.flatMap(g => g.memberIds), phases = [];
  const phase = (kind, round, group, memberIds = group?.memberIds ?? all) => phases.push({ kind, round, groupId: group?.id ?? null, memberIds: [...memberIds] });
  const targetIndex = groups.findIndex(g => g.id === target.groupId);
  if (targetIndex < 0 || target.round < 1) return phases;
  const from = state.current;
  if (!from) {
    phase("combat-start", target.round);
    phase("round-start", target.round);
    phase("each-turn", target.round, groups[targetIndex], all);
    phase("turn-start", target.round, groups[targetIndex]);
    return phases;
  }
  const fromIndex = groups.findIndex(g => g.id === from.groupId);
  if (fromIndex < 0) {
    if (target.round > from.round) { phase("round-end", from.round); phase("round-start", target.round); }
    phase("each-turn", target.round, groups[targetIndex], all);
    phase("turn-start", target.round, groups[targetIndex]);
    return phases;
  }
  const end = target.round * groups.length + targetIndex;
  for (let position = from.round * groups.length + fromIndex; position < end; position++) {
    const round = Math.floor(position / groups.length), index = position % groups.length;
    const nextIndex = (index + 1) % groups.length, nextRound = round + (nextIndex === 0 ? 1 : 0);
    phase("turn-end", round, groups[index]);
    if (nextRound !== round) { phase("round-end", round); phase("round-start", nextRound); }
    if (!skippedGroupIds.has(groups[nextIndex].id) || (nextRound === target.round && nextIndex === targetIndex)) {
      phase("each-turn", nextRound, groups[nextIndex], all);
      phase("turn-start", nextRound, groups[nextIndex]);
    }
  }
  return phases;
}

export function buildPhaseStepKey(combatId, phase, combatantId, provider, stepId) {
  return combatFlagKey([combatId, phase.round, phase.groupId, combatantId, phase.kind, provider, stepId]);
}

export function getActiveGroupMemberIds(state) {
  if (state?.mode !== "active") return [];
  return state.groups?.find(g => g.id === (state.executionPosition ?? state.current)?.groupId)?.memberIds ?? [];
}

export function isCombatActorActive(combat, actorOrToken, state = combat?.flags?.["rebreya-main"]?.[GROUPED_COMBAT_FLAG]) {
  const ids = getActiveGroupMemberIds(state);
  const active = state?.mode === "active" ? combatantsOf(combat).filter(c => ids.includes(c.id)) : [combat?.combatant].filter(Boolean);
  const uuid = typeof actorOrToken === "string" ? actorOrToken : actorOrToken?.uuid;
  return active.some(c => c.actor === actorOrToken || c.token === actorOrToken || c.actor?.uuid === uuid || c.token?.uuid === uuid);
}
