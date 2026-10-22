import { MODULE_ID } from "../constants.js";
import { buildCombatTurnGroups, planGroupTransition, buildPhaseStepKey, combatantsOf } from "../combat/turn-group-rules.js";
import { describeInitiative } from "../integrations/grouped-combat-effects.js?v=1.4.398";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { isValidGroupedCombatStartPayload, isValidGroupedCombatTransitionPayload, isValidGroupedCombatResolvePayload } from "../infrastructure/foundry/grouped-combat-command-contract.js";

const rejection = (code, details = {}) => ({ ok: false, code, details });
export class GroupedCombatService {
  constructor({ repository, effects, coordinator, resolveToken = uuid => globalThis.fromUuid(uuid), gameProvider = () => globalThis.game,
    isAuthority = () => isActiveGmClient(gameProvider()), isStorageActor = actor => actor?.getFlag?.(MODULE_ID, "storage")?.enabled === true } = {}) {
    Object.assign(this, { repository, effects, coordinator, resolveToken, gameProvider, isAuthority, isStorageActor });
    this.tickets = new Map();
  }
  isManaged(combat) { return Boolean(this.repository.readState(combat)); }
  async save(combat, state) {
    if (!this.isAuthority()) throw new Error("active-gm-changed");
    if (!this.repository.getCombat(combat.id)) throw new Error("combat-unavailable");
    return this.repository.writeState(combat, state, { expectedRevision: state.revision ?? 0 });
  }
  members(combat) {
    return combatantsOf(combat).filter(c => this.eligible(c.token?.document ?? c.token, combat.scene?.id ?? combat.sceneId)).map(c => {
      const token = c.token?.document ?? c.token, actor = c.actor;
      const profile = describeInitiative(actor);
      return { combatantId: c.id, tokenUuid: token?.uuid, actorUuid: actor?.uuid, baseActorId: token?.baseActor?.id ?? token?.actorId,
        disposition: token?.disposition, initiative: c.initiative, initiativeKey: profile.key,
        groupable: actor?.type === "npc" && token?.actorLink !== true && profile.canShare, defeated: c.isDefeated === true };
    });
  }
  eligible(token, sceneId) {
    const actor = token?.actor;
    return token?.parent?.id === sceneId && ["character", "npc"].includes(actor?.type) && !this.isStorageActor(actor)
      && !token.flags?.[MODULE_ID]?.mapObjectToken && !actor.flags?.[MODULE_ID]?.mapObjectToken
      && actor.system?.details?.type?.value !== "object";
  }
  async start(request, { sender } = {}) {
    if (!sender?.isGM || !this.isAuthority()) return rejection("forbidden");
    if (!isValidGroupedCombatStartPayload(request)) return rejection("invalid-combat-request");
    return this.coordinator.runIdempotent(`grouped-scene:${request.sceneId}`, request.operationId, async () => {
      if (!sender?.isGM || !this.isAuthority()) return rejection("forbidden");
      const support = this.effects.inspect();
      if (!support.supported) return rejection("unsupported-combat-effects", { issues: support.issues });
      const tokens = [];
      for (const uuid of new Set(request.tokenUuids ?? [])) {
        const resolved = await this.resolveToken(uuid), token = resolved?.document ?? resolved;
        if (this.eligible(token, request.sceneId)) tokens.push(token);
      }
      if (!tokens.length) return rejection("no-creatures");
      const combat = this.repository.getActiveCombat(request.sceneId) ?? await this.repository.createCombat(request.sceneId);
      return this.coordinator.run(`grouped-combat:${combat.id}`, async () => {
        if (!this.isAuthority()) return rejection("forbidden");
        let state = this.repository.readState(combat);
        if (state?.pendingTransition) return this.recoverPending(combat, state);
        if (state?.mode === "blocked") return rejection("combat-blocked", { combatId: combat.id, state });
        const previousActiveId = combat.combatant?.id;
        await this.repository.createMissingCombatants(combat, tokens);
        const oldGroups = state?.groups ?? [];
        let groups = buildCombatTurnGroups(this.members(combat), oldGroups);
        for (const group of groups) {
          const members = combatantsOf(combat).filter(c => group.memberIds.includes(c.id));
          const missing = members.filter(c => !Number.isFinite(c.initiative));
          if (!missing.length) continue;
          let rolledId = null;
          if (group.initiative === null) {
            const roll = () => combat.rollInitiative([missing[0].id], { updateTurn: true });
            if (this.repository.withNativeChanges) await this.repository.withNativeChanges(combat, roll); else await roll();
            rolledId = missing[0].id;
            group.initiative = missing[0].initiative;
            if (!Number.isFinite(group.initiative)) return rejection("initiative-cancelled");
          }
          const patches = missing.filter(c => c.initiative !== group.initiative).map(c => ({ _id: c.id, initiative: group.initiative }));
          if (patches.length) {
            const update = () => combat.updateEmbeddedDocuments("Combatant", patches, { turnEvents: false });
            if (this.repository.withNativeChanges) await this.repository.withNativeChanges(combat, update); else await update();
          }
          for (const c of missing) if (c.id !== rolledId) await c.recoverCombatUses?.(["initiative"]);
        }
        groups = buildCombatTurnGroups(this.members(combat), groups);
        if (!state) {
          state = { version: 1, mode: combat.started ? "pending" : "active", activateAtRound: combat.started ? combat.round + 1 : 1,
            revision: 0, groups, current: null, receipts: {}, memberStarts: {} };
          if (combat.started) state.current = { round: combat.round, groupId: groups.find(g => g.memberIds.includes(combat.combatant?.id))?.id ?? groups[0].id };
        } else state.groups = groups;
        await this.save(combat, state);
        combat.setupTurns?.();
        if (combat.started) {
          const wanted = state.mode === "pending" ? [previousActiveId] : groups.find(g => g.id === state.current?.groupId)?.memberIds ?? [];
          const turn = combat.turns.findIndex(c => wanted.includes(c.id));
          if (turn >= 0 && turn !== combat.turn) await this.repository.commitNativePosition(combat, { round: combat.round, turn }, { turnEvents: false, worldTime: { delta: 0 } });
        }
        if (!combat.started) {
          const group = groups.find(g => !combat.settings?.skipDefeated || g.memberIds.some(id => !combatantsOf(combat).find(c => c.id === id)?.isDefeated)) ?? groups[0];
          return this.runPipeline(combat, state, planGroupTransition({ current: null }, { round: 1, groupId: group.id }, groups), { round: 1, groupId: group.id }, request.operationId, true);
        }
        if (state.mode === "active") {
          const group = groups.find(g => g.id === state.current?.groupId);
          const started = state.memberStarts[JSON.stringify(state.current)] ?? [];
          const newIds = group?.memberIds.filter(id => !started.includes(id) && !oldGroups.some(g => g.memberIds.includes(id))) ?? [];
          if (newIds.length) return this.runPipeline(combat, state, [{ kind: "turn-start", ...state.current, memberIds: newIds }], state.current, request.operationId);
        }
        return { ok: true, combatId: combat.id, revision: state.revision, pending: state.mode === "pending" };
      });
    });
  }
  async transition(request, { sender } = {}) {
    const combat = this.repository.getCombat(request.combatId);
    if (!combat || !this.isAuthority()) return rejection("forbidden");
    if (!isValidGroupedCombatTransitionPayload(request)) return rejection("invalid-combat-request");
    return this.coordinator.runIdempotent(`grouped-combat:${combat.id}`, request.operationId, async () => {
      const state = this.repository.readState(combat);
      if (!state || !this.isAuthority()) return rejection("forbidden");
      const liveIds = new Set(combatantsOf(combat).map(c => c.id));
      state.groups = state.groups.map(g => ({ ...g, memberIds: g.memberIds.filter(id => liveIds.has(id)) })).filter(g => g.memberIds.length);
      const active = state.groups.find(g => g.id === state.current?.groupId);
      const member = combatantsOf(combat).find(c => c.id === active?.memberIds[0]);
      if (!sender?.isGM && !(active?.memberIds.length === 1 && member?.actor?.type === "character" && member.actor.testUserPermission?.(sender, "OWNER"))) return rejection("forbidden");
      if (state.revision !== request.expectedRevision) return rejection("stale-combat");
      if (state.pendingTransition) return this.recoverPending(combat, state);
      if (state.mode === "blocked") return rejection("combat-blocked", { combatId: combat.id, state });
      const support = this.effects.inspect();
      if (!support.supported) return rejection("unsupported-combat-effects", { issues: support.issues });
      const target = { round: request.targetRound, groupId: request.targetGroupId };
      if (!Number.isSafeInteger(target.round) || target.round < 1 || !state.groups.some(g => g.id === target.groupId)) return rejection("invalid-combat-target");
      if (!sender?.isGM) {
        const groups = state.groups.filter(g => !combat.settings?.skipDefeated || g.memberIds.some(id => combatantsOf(combat).some(c => c.id === id && !c.isDefeated)));
        const next = groups.findIndex(g => g.id === active.id) + 1;
        if (!groups.length || target.groupId !== groups[next % groups.length].id || target.round !== state.current.round + (next === groups.length ? 1 : 0)) return rejection("forbidden");
      }
      let phases;
      if (state.mode === "pending" && target.round < state.activateAtRound) return rejection("combat-pending");
      if (state.mode === "pending") {
        state.mode = "active";
        const all = state.groups.flatMap(g => g.memberIds), incoming = state.groups.find(g => g.id === target.groupId);
        phases = [{ kind: "turn-end", ...state.current, memberIds: [combat.combatant?.id].filter(Boolean), legacy: true },
          { kind: "round-end", round: state.current.round, groupId: null, memberIds: all },
          { kind: "round-start", round: target.round, groupId: null, memberIds: all },
          { kind: "each-turn", ...target, memberIds: all }, { kind: "turn-start", ...target, memberIds: incoming.memberIds }];
      } else {
        const skipped = new Set(combat.settings?.skipDefeated ? state.groups.filter(g => g.memberIds.every(id => combatantsOf(combat).find(c => c.id === id)?.isDefeated)).map(g => g.id) : []);
        phases = planGroupTransition(state, target, state.groups, skipped);
      }
      return this.runPipeline(combat, state, phases, target, request.operationId);
    });
  }
  async runPipeline(combat, state, phases, target, operationId, begin = false) {
    let resolveTicket, rejectTicket;
    const promise = new Promise((resolve, reject) => { resolveTicket = resolve; rejectTicket = reject; });
    promise.catch(() => {});
    this.tickets.set(combat.id, promise);
    state.pendingTransition ??= { phases, target, operationId, begin, committedPositions: !begin && state.current ? [JSON.stringify(state.current)] : [], lastPosition: state.current };
    const pending = state.pendingTransition;
    const commit = async (position = target) => {
      const positionKey = JSON.stringify(position);
      if (pending.committedPositions.includes(positionKey)) return;
      const stepKey = buildPhaseStepKey(combat.id, { ...position, kind: "native-position" }, null, "native", `position:${pending.operationId}`);
      if (state.receipts[stepKey]?.status === "uncertain") throw new Error("uncertain-combat-step");
      if (state.receipts[stepKey]?.status === "done") {
        pending.committedPositions.push(positionKey); pending.lastPosition = position; return;
      }
      state.receipts[stepKey] = { status: "running", operationId, provider: "native", phase: "native-position" };
      state.executionPosition = position;
      await this.save(combat, state);
      const group = state.groups.find(g => g.id === position.groupId);
      combat.setupTurns?.();
      let turn = combat.turns.findIndex(c => group?.memberIds.includes(c.id) && (!combat.settings?.skipDefeated || !c.isDefeated));
      if (turn < 0) turn = combat.turns.findIndex(c => group?.memberIds.includes(c.id));
      if (turn < 0) throw new Error("combat-group-unavailable");
      if (pending.begin && !pending.committedPositions.length) await this.repository.beginCombat(combat, { round: position.round, turn });
      else {
        const from = pending.lastPosition;
        const fromIndex = Math.max(0, state.groups.findIndex(g => g.id === from?.groupId)), toIndex = state.groups.findIndex(g => g.id === position.groupId);
        const time = globalThis.CONFIG?.time ?? {};
        const delta = (position.round - (from?.round ?? position.round)) * (time.roundTime ?? 6) + (toIndex - fromIndex) * (time.turnTime ?? 0);
        await this.repository.commitNativePosition(combat, { round: position.round, turn }, { direction: Math.sign(delta || position.round - (from?.round ?? 0) || toIndex - fromIndex), worldTime: { delta } });
      }
      pending.committedPositions.push(positionKey); pending.lastPosition = position;
      state.receipts[stepKey].status = "done";
      await this.save(combat, state);
    };
    try {
      for (const [phaseIndex, phase] of phases.entries()) {
        if (["combat-start", "round-start", "each-turn", "turn-start"].includes(phase.kind)) {
          const groupId = phase.groupId ?? phases.slice(phaseIndex).find(p => p.kind === "each-turn" && p.round === phase.round)?.groupId ?? target.groupId;
          await commit({ round: phase.round, groupId });
        }
        const liveIds = new Set(combatantsOf(combat).map(c => c.id));
        let memberIds = phase.memberIds.filter(id => liveIds.has(id));
        if (phase.kind === "turn-end" && !phase.legacy) {
          const started = state.memberStarts[JSON.stringify({ round: phase.round, groupId: phase.groupId })] ?? [];
          memberIds = memberIds.filter(id => started.includes(id));
        }
        for (const step of this.effects.plan(combat, { ...phase, memberIds }, state)) {
          if (state.receipts[step.key]?.status === "done") continue;
          if (step.combatantId) {
            const member = combatantsOf(combat).find(c => c.id === step.combatantId);
            if (!member?.actor || (step.actorUuid && member.actor.uuid !== step.actorUuid) || (step.actorSourceId && member.token?.baseActor?.id !== step.actorSourceId)) {
              state.receipts[step.key] = { status: "done", operationId, reason: "member-unavailable" };
              await this.save(combat, state); continue;
            }
          }
          if (state.receipts[step.key]?.status === "uncertain") throw new Error("uncertain-combat-step");
          state.receipts[step.key] = { status: "running", operationId, provider: step.provider, combatantId: step.combatantId, effectUuid: step.effectUuid, phase: phase.kind };
          await this.save(combat, state);
          if (!this.isAuthority()) throw new Error("active-gm-changed");
          const outcome = await step.run();
          if (outcome?.status === "cancelled") throw new Error("combat-step-cancelled");
          state.receipts[step.key].status = "done";
          await this.save(combat, state);
        }
        if (phase.kind === "turn-start") {
          const key = JSON.stringify({ round: phase.round, groupId: phase.groupId });
          state.memberStarts[key] = [...new Set([...(state.memberStarts[key] ?? []), ...memberIds])];
        }
      }
      await commit();
      state.current = { ...target }; state.mode = "active"; delete state.pendingTransition; delete state.executionPosition;
      await this.save(combat, state);
      resolveTicket();
      return { ok: true, combatId: combat.id, revision: state.revision };
    } catch (error) {
      for (const receipt of Object.values(state.receipts)) if (receipt.status === "running") receipt.status = "uncertain";
      state.mode = "blocked"; state.error = String(error.message ?? error);
      try { if (this.isAuthority() && this.repository.getCombat(combat.id)) await this.save(combat, state); }
      catch (persistenceError) { state.error = `${state.error}; ${persistenceError.message}`; }
      rejectTicket(error);
      return rejection("combat-phase-failed", { combatId: combat.id, state });
    } finally { if (this.tickets.get(combat.id) === promise) this.tickets.delete(combat.id); }
  }
  observeNativeTransition(combat) { return this.tickets.get(combat.id) ?? Promise.resolve(); }
  async recoverPending(combat, state) {
    let changed = false;
    for (const receipt of Object.values(state.receipts)) if (receipt.status === "running") { receipt.status = "uncertain"; changed = true; }
    if (changed) { state.mode = "blocked"; await this.save(combat, state); }
    if (state.mode === "blocked") return rejection("combat-blocked", { combatId: combat.id, state });
    const pending = state.pendingTransition;
    return this.runPipeline(combat, state, pending.phases, pending.target, pending.operationId);
  }
  async reconcile(combat) {
    return this.coordinator.run(`grouped-combat:${combat.id}`, async () => {
      const state = this.repository.readState(combat);
      if (!state || !this.isAuthority()) return;
      if (state.pendingTransition) return this.recoverPending(combat, state);
    });
  }
  async resolveUncertainStep(request, { sender } = {}) {
    if (!sender?.isGM || !this.isAuthority()) return rejection("forbidden");
    if (!isValidGroupedCombatResolvePayload(request)) return rejection("invalid-combat-request");
    const combat = this.repository.getCombat(request.combatId);
    if (!combat) return rejection("missing-combat");
    return this.coordinator.run(`grouped-combat:${combat.id}`, async () => {
      const state = this.repository.readState(combat);
      if (state?.revision !== request.expectedRevision) return rejection("stale-combat");
      if (state.receipts[request.stepKey]?.status !== "uncertain" || !["completed", "retry"].includes(request.resolution)) return rejection("invalid-combat-step");
      if (request.resolution === "completed") state.receipts[request.stepKey].status = "done"; else delete state.receipts[request.stepKey];
      if (Object.values(state.receipts).some(r => r.status === "uncertain")) { await this.save(combat, state); return rejection("combat-blocked", { combatId: combat.id, state }); }
      state.mode = "active";
      const pending = state.pendingTransition;
      return this.runPipeline(combat, state, pending.phases, pending.target, request.operationId);
    });
  }
}
