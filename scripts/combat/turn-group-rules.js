export const GROUPED_COMBAT_FLAG = "groupedCombat";
export const combatantsOf = combat => Array.from(combat?.combatants?.contents ?? combat?.combatants ?? []);
export function combatantById(combat, id) {
  if (typeof combat?.combatants?.get === "function") return combat.combatants.get(id);
  return combatantsOf(combat).find(combatant => combatant.id === id);
}
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

export function isGroupTransitionWithinBudget(state, target, groups, skippedGroupIds = new Set()) {
  const from = state.current;
  if (!from || target.round < from.round) return true;
  const fromIndex = groups.findIndex(g => g.id === from.groupId);
  const toIndex = groups.findIndex(g => g.id === target.groupId);
  if (fromIndex < 0 || toIndex < 0) return true;
  const rounds = target.round - from.round;
  if (rounds > 1001) return false;
  const steps = rounds * groups.length + toIndex - fromIndex;
  if (steps <= 0) return true;
  if (steps > 1000) return false;
  const participants = groups.reduce((sum, group) => sum + group.memberIds.length, 0);
  const cycles = Math.floor(steps / groups.length), remainder = steps % groups.length;
  let eachTurns = 0, groupReferences = 0;
  for (let i = 0; i < groups.length; i++) {
    const size = groups[i].memberIds.length;
    const sourceOffset = (i - fromIndex + groups.length) % groups.length;
    groupReferences += size * (cycles + Number(sourceOffset < remainder));
    if (skippedGroupIds.has(groups[i].id)) continue;
    const distance = (i - fromIndex + groups.length - 1) % groups.length + 1;
    const visits = cycles + Number(distance <= remainder);
    eachTurns += visits; groupReferences += size * visits;
  }
  if (skippedGroupIds.has(target.groupId)) { eachTurns++; groupReferences += groups[toIndex].memberIds.length; }
  return participants * eachTurns <= Math.max(400, participants)
    && groupReferences + participants * (eachTurns + 2 * rounds) <= 1_000_000;
}

export function planGroupTransition(state, target, groups, skippedGroupIds = new Set()) {
  if (!isGroupTransitionWithinBudget(state, target, groups, skippedGroupIds)) throw new RangeError("combat-transition-too-large");
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
  const distance = (target.round - from.round) * groups.length + targetIndex - fromIndex;
  for (let offset = 0; offset < distance; offset++) {
    const relative = fromIndex + offset, round = from.round + Math.floor(relative / groups.length), index = relative % groups.length;
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
