const uuid = token => String(token?.document?.uuid ?? token?.uuid ?? "");
const actorOf = token => token?.actor ?? token?.document?.actor;

export function isCurseRangedWeaponAttack(activity, item = activity?.item) {
  if (item?.type !== "weapon") return false;
  const actionType = activity?.actionType ?? activity?.system?.actionType ?? item?.system?.actionType;
  if (actionType) return actionType === "rwak";
  const attack = activity?.attack ?? activity?.system?.attack;
  return attack?.type?.value === "ranged" && attack?.type?.classification === "weapon";
}

/** Pure workflow/config projection; durable curse ownership remains in the injected service. */
export class CurseUpgradeAttackAdapter {
  constructor(service, { tokens = () => globalThis.canvas?.tokens?.placeables ?? [], distance,
    selectRedirect = async ({ candidates }) => candidates[0]?.token ?? null,
    warn = message => globalThis.ui?.notifications?.warn?.(message) } = {}) {
    this.service = service;
    this.tokens = tokens;
    this.distance = distance ?? (() => Infinity);
    this.selectRedirect = selectRedirect;
    this.warn = warn;
    this.redirectedWorkflows = new WeakSet();
    this.modifiedAttackRolls = new WeakSet();
    this.activityWorkflows = new WeakMap();
  }

  /** Native dnd5e.preRollAttack(config, dialog, message). Only targets sharing the roll may receive its modifiers. */
  preRollAttack(config = {}) {
    const activity = config.subject;
    const item = activity?.item;
    const actor = activity?.actor ?? item?.actor;
    if (item?.type !== "weapon" || !this.service.sources(actor, "mourning").some(source => source.host === item
      || (item.uuid && source.host?.uuid === item.uuid))) return true;
    const activeWorkflows = this.activityWorkflows.get(activity);
    if (activeWorkflows?.size > 1 && !config.workflow && !config.targets) return true;
    const workflow = config.workflow ?? (activeWorkflows?.size === 1 ? [...activeWorkflows][0] : null);
    const targets = Array.from(config.targets ?? workflow?.targets ?? globalThis.game?.user?.targets ?? []);
    const surrounded = targets.filter(target => actorOf(target)?.statuses?.has?.("rebreya-surrounded"));
    if (surrounded.length && surrounded.length !== targets.length) {
      this.warn("Проклятье Скорбящего прошлого: совершите атаки по окружённым и остальным целям отдельно, чтобы правильно применить преимущество и штраф −2.");
      return false;
    }
    if (!surrounded.length) return true;
    config.advantage = true;
    for (const roll of config.rolls ?? []) {
      roll.options ??= {};
      roll.options.advantage = true;
      if (this.modifiedAttackRolls.has(roll)) continue;
      this.modifiedAttackRolls.add(roll);
      roll.parts ??= [];
      roll.parts.push("-2");
    }
    return true;
  }

  /** Awaited midi-qol.preAttackRoll(workflow), before normal hit determination. */
  async midiPreAttackRoll(workflow) {
    if (workflow?.activity && typeof workflow.activity === "object") {
      const active = this.activityWorkflows.get(workflow.activity) ?? new Set();
      active.add(workflow);
      this.activityWorkflows.set(workflow.activity, active);
    }
    if (!workflow || this.redirectedWorkflows.has(workflow)
      || !isCurseRangedWeaponAttack(workflow.activity, workflow.item)) return true;
    // Mark before awaiting a selection: duplicate callbacks cannot race a second redirect.
    this.redirectedWorkflows.add(workflow);
    const targets = Array.from(workflow.targets ?? []);
    const redirects = [];
    for (const target of targets) {
      const candidates = this.tokens().filter(token => uuid(token) && uuid(token) !== uuid(target)
        && this.service.sources(actorOf(token), "shield").length > 0)
        .map(token => ({ token, distance: Number(this.distance(target, token)) }))
        .filter(entry => Number.isFinite(entry.distance) && entry.distance <= 10 && entry.distance >= 0)
        .sort((a, b) => a.distance - b.distance || uuid(a.token).localeCompare(uuid(b.token)));
      if (!candidates.length) continue;
      const selected = await this.selectRedirect({ workflow, target, candidates });
      const choice = candidates.find(entry => uuid(entry.token) === uuid(selected));
      if (!choice || !this.service.sources(actorOf(choice.token), "shield").length
        || this.distance(target, choice.token) > 10) continue;
      redirects.push({ from: target, to: choice.token });
    }
    workflow.targets = new Set(targets.map(target => redirects.find(entry => entry.from === target)?.to ?? target));
    workflow.rebreyaCurseShieldRedirects = redirects.map(entry => ({ from: uuid(entry.from), to: uuid(entry.to) }));
    return true;
  }

  /** midi-qol.RollComplete / Workflow cleanup: do not retain target context into the next attack. */
  releaseWorkflow(workflow) {
    if (workflow?.activity) this.activityWorkflows.get(workflow.activity)?.delete(workflow);
  }
}
