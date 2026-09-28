import { normalizeReputation, applyReputationChange, ReputationError } from "../data/reputation-rules.js?v=1.4.251";
import { REPUTATION_UPDATE_COMMAND, isValidReputationPayload, authorizeReputationUpdate, reputationTransportId } from "../infrastructure/foundry/reputation-command-contract.js?v=1.4.251";
export class ReputationService {
  constructor({ resolveActor, coordinator, mutationGateway, refresh = () => {}, gameProvider = () => globalThis.game, timestamp = Date.now }) {
    Object.assign(this, { resolveActor, coordinator, mutationGateway, refresh, gameProvider, timestamp });
  }
  async read(actorUuid) {
    const actor = await this.resolveActor(actorUuid), user = this.gameProvider()?.user;
    if (!actor || actor.type !== "character") throw new ReputationError("invalid-actor");
    if (!user || (!user.isGM && !actor.testUserPermission?.(user, "OBSERVER"))) throw new ReputationError("unauthorized");
    return { actorUuid: actor.uuid, name: actor.name, canEdit: user.isGM === true,
      ...normalizeReputation(actor.getFlag("rebreya-main", "reputation")) };
  }
  async requestUpdate(request) {
    if (!isValidReputationPayload(request)) throw new ReputationError("invalid-request");
    const payload = structuredClone(request);
    const operationId = await reputationTransportId(payload, this.gameProvider()?.user?.id);
    const outcome = await this.mutationGateway.mutate(REPUTATION_UPDATE_COMMAND, payload, { operationId });
    await this.#refresh(payload.actorUuid);
    return outcome;
  }
  async update(request, context) {
    if (!isValidReputationPayload(request)) throw new ReputationError("invalid-request");
    if (!authorizeReputationUpdate(request, { sender: context?.sender, game: this.gameProvider() })) throw new ReputationError("unauthorized");
    const { actorUuid, ...change } = structuredClone(request);
    const outcome = await this.mutationGateway.commit(`reputation:${actorUuid}`, async ({ assertActiveGm }) => {
      context.assertActiveGm(); assertActiveGm();
      const actor = await this.resolveActor(actorUuid);
      if (!actor || actor.type !== "character" || actor.uuid !== actorUuid) throw new ReputationError("invalid-actor");
      const state = normalizeReputation(actor.getFlag("rebreya-main", "reputation"));
      const next = applyReputationChange(state, change, { gmId: context.sender.id, timestamp: this.timestamp() });
      if (state.recentChanges.some(r => r.operationId === change.operationId)) return next;
      context.assertActiveGm(); assertActiveGm();
      try { await actor.update({ "flags.rebreya-main.reputation": next }); }
      catch {
        // The Document can be persisted even when its update promise rejects. Never apply a second delta.
        let confirmed;
        try {
          const fresh = await this.resolveActor(actorUuid);
          const readback = normalizeReputation(fresh?.getFlag("rebreya-main", "reputation"));
          if (readback.recentChanges.some(r => r.operationId === change.operationId)) {
            confirmed = applyReputationChange(readback, change, { gmId: context.sender.id, timestamp: this.timestamp() });
          }
        } catch { /* A mismatched/corrupt receipt is not proof of this write. */ }
        if (!confirmed) throw new ReputationError("ambiguous-outcome");
        context.assertActiveGm(); assertActiveGm();
        return confirmed;
      }
      context.assertActiveGm(); assertActiveGm();
      return next;
    });
    await this.#refresh(actorUuid);
    // History stays on the Actor. Fifty long Unicode reasons can exceed the typed result envelope.
    return { version: outcome.version, fame: outcome.fame, infamy: outcome.infamy, revision: outcome.revision };
  }
  async #refresh(actorUuid) {
    try { await this.refresh(actorUuid); }
    catch (error) { console.warn("rebreya-main | Reputation saved; projection refresh failed.", error); }
  }
}
