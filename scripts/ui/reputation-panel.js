import { validateReputationRequest, ReputationError } from "../data/reputation-rules.js?v=1.4.251";
export const REPUTATION_PANEL_TEMPLATE = "modules/rebreya-main/templates/reputation-panel.hbs";

export function buildReputationUpdateRequest(draft) {
  const number = value => typeof value === "string" && /^-?\d+$/u.test(value) ? Number(value) : NaN;
  return { actorUuid: draft.actorUuid, ...validateReputationRequest({ expectedRevision: draft.revision,
    operationId: draft.operationId, reason: draft.reason,
    change: { [draft.mode]: { fame: number(draft.fame), infamy: number(draft.infamy) } } }) };
}

export class ReputationPanel {
  constructor(moduleApi, { render = async () => {} } = {}) {
    this.moduleApi = moduleApi; this.render = render;
    this.selectedActorUuid = ""; this.reputationDraft = null; this.reputationRetry = null;
    this.reputationPending = false; this.reputationError = "";
  }
  async prepareContext(memberActors = []) {
    const selectedUuid = this.selectedActorUuid;
    const actors = memberActors.filter(actor => actor?.type === "character"
      && (game.user?.isGM || actor.testUserPermission?.(game.user, "OBSERVER")))
      .map(actor => ({ uuid: actor.uuid, name: actor.name, selected: actor.uuid === selectedUuid }))
      .sort((a, b) => a.name.localeCompare(b.name));
    let reputation = { selected: false, canEdit: false };
    if (selectedUuid && actors.some(actor => actor.uuid === selectedUuid)) {
      try {
        reputation = { ...await this.moduleApi.getReputation(selectedUuid), selected: true };
        reputation.canEdit = reputation.canEdit && game.user?.isGM === true;
      } catch (error) { this.reputationError = error.message; }
    } else if (selectedUuid) {
      this.selectedActorUuid = ""; this.reputationDraft = null; this.reputationRetry = null;
    }
    this.reputationView = reputation;
    return { ...reputation, actors, error: this.reputationError, pending: this.reputationPending,
      editing: Boolean(this.reputationDraft), retry: Boolean(this.reputationRetry), draft: this.reputationDraft,
      deltaMode: this.reputationDraft?.mode !== "set", locked: this.reputationPending || Boolean(this.reputationRetry),
      history: [...(reputation.recentChanges ?? [])].reverse().slice(0, 5) };
  }
  async renderContent(memberActors) {
    const reputation = await this.prepareContext(memberActors);
    return foundry.applications.handlebars.renderTemplate(REPUTATION_PANEL_TEMPLATE, { reputation });
  }
  async selectReputationActor(actorUuid) {
    this.selectedActorUuid = actorUuid;
    this.reputationDraft = null; this.reputationRetry = null; this.reputationError = "";
    await this.render({ force: true });
  }

  beginReputationEdit() {
    if (!game.user?.isGM || this.reputationPending || !this.reputationView?.canEdit
      || this.reputationView.actorUuid !== this.selectedActorUuid) return;
    const view = this.reputationView;
    this.reputationDraft = { actorUuid: view.actorUuid, name: view.name, revision: view.revision,
      mode: "delta", fame: "0", infamy: "0", reason: "", operationId: globalThis.crypto.randomUUID() };
    this.reputationRetry = null; this.reputationError = "";
    void this.render({ force: true });
  }

  cancelReputationEdit() {
    if (this.reputationPending) return;
    this.reputationDraft = null; this.reputationRetry = null; this.reputationError = "";
    void this.render({ force: true });
  }

  async submitReputationEdit() {
    if (!game.user?.isGM || this.reputationPending || !this.reputationDraft) return;
    let payload;
    try {
      payload = this.reputationRetry ?? buildReputationUpdateRequest(this.reputationDraft);
      if (payload.actorUuid !== this.selectedActorUuid) throw new ReputationError("invalid-actor");
    } catch (error) { this.reputationError = error.message; await this.render({ force: true }); return; }
    this.reputationPending = true; this.reputationError = "";
    void this.render({ force: true });
    try {
      await this.moduleApi.updateReputation(structuredClone(payload));
      if (this.selectedActorUuid === payload.actorUuid) { this.reputationDraft = null; this.reputationRetry = null; }
    } catch (error) {
      if (this.selectedActorUuid === payload.actorUuid) {
        this.reputationError = error.message;
        if (["ambiguous-outcome", "request-timeout"].includes(error.code)) this.reputationRetry = structuredClone(payload);
        else if (["stale-revision", "operation-conflict"].includes(error.code)) this.reputationDraft = null;
      } else ui.notifications?.error?.(`${payload.actorUuid}: ${error.message}`);
    } finally { this.reputationPending = false; await this.render({ force: true }); }
  }


  bind(element) {
    this.reputationListeners?.abort();
    this.reputationListeners = new AbortController();
    const listen = (selector, type, handler) => element?.querySelector(selector)?.addEventListener(type, handler, { signal: this.reputationListeners.signal });
    listen("[data-reputation-actor]", "change", event => { void this.selectReputationActor(event.currentTarget.value); });
    listen("[data-action='edit-reputation']", "click", () => this.beginReputationEdit());
    listen("[data-action='cancel-reputation']", "click", () => this.cancelReputationEdit());
    listen("[data-reputation-form]", "input", event => {
      const key = event.target?.name;
      if (this.reputationDraft && !this.reputationPending && !this.reputationRetry && ["mode", "fame", "infamy", "reason"].includes(key)) this.reputationDraft[key] = event.target.value;
    });
    listen("[data-reputation-form]", "submit", event => { event.preventDefault(); void this.submitReputationEdit(); });
  }
  close() {
    this.reputationListeners?.abort();
    this.reputationDraft = null; this.reputationRetry = null;
  }
}
