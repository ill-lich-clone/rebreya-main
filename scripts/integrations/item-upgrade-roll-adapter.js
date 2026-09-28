import { evaluateSimpleUpgradeRoll } from "../automation/item-upgrade-roll-modifiers.js?v=1.4.254";
const MARKER = "rebreyaSimpleUpgradeDamage";
const targetData = token => {
  const actor = token?.actor ?? token?.document?.actor ?? token;
  return actor?.system ? { type: actor.system.details?.type?.value, passivePerception: actor.system.skills?.prc?.passive } : null;
};
const weaponActivity = activity => activity?.item?.type === "weapon" && (["mwak", "rwak"].includes(activity.actionType)
  || (activity.attack?.type?.classification === "weapon" && ["melee", "ranged"].includes(activity.attack.type.value)));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function resolveSimpleUpgradeAttackRoll(config, message = {}, game = globalThis.game) {
  const id = message.data?.flags?.dnd5e?.originatingMessage ?? message.data?.["flags.dnd5e.originatingMessage"]
    ?? config.event?.target?.closest?.("[data-message-id]")?.dataset?.messageId;
  const origin = game?.messages?.get?.(id), activityUuid = config.subject?.uuid;
  if (!origin || !activityUuid) return null;
  const candidates = (origin.getFlag("dnd5e", "roll.type") === "attack" ? [origin] : Array.from(origin.getAssociatedRolls?.("attack") ?? []))
    .filter(entry => entry.getFlag("dnd5e", "activity.uuid") === activityUuid);
  return candidates.length === 1 && candidates[0].rolls?.length === 1 ? candidates[0].rolls[0] : null;
}

/** Modifier adapter called by CombatAttackService. It owns no rolls, hooks or durable game state. */
export class SimpleUpgradeRollAdapter {
  constructor(service, { targets = () => globalThis.game?.user?.targets ?? [], getWorkflow = () => null,
    warn = message => globalThis.ui?.notifications?.warn?.(message) } = {}) {
    Object.assign(this, { service, targets, getWorkflow, warn });
    this.attackRolls = new WeakSet(); this.damageRolls = new WeakSet(); this.warned = new WeakSet();
  }
  evaluate(host, attack, target) {
    return evaluateSimpleUpgradeRoll({ host, attack, target: targetData(target), contributions: this.service.project(host.actor, host).contributions });
  }
  context(config, primary, message = {}) {
    const activity = config.subject, workflow = config.workflow ?? this.getWorkflow(activity);
    const targets = Array.from(config.targets ?? workflow?.targets ?? this.targets());
    const roll = workflow?.attackRoll ?? config.attackRoll ?? resolveSimpleUpgradeAttackRoll(config, message);
    const mode = roll?.options?.advantageMode;
    const advantage = [-1, 0, 1].includes(mode) ? mode === 1
      : typeof roll?.hasAdvantage === "boolean" ? roll.hasAdvantage : null;
    const results = (targets.length ? targets : [null]).map(target => this.evaluate(activity.item, { primary, advantage }, target));
    const signature = result => primary ? result.damageParts : { attackBonus: result.attackBonus, advantage: result.advantage };
    if (results.some(result => !same(signature(result), signature(results[0])))) {
      this.warnOnce(config, "Усовершенствования дают разные бонусы против выбранных целей. Выполните отдельные броски.");
      return null;
    }
    if (results.some(result => result.diagnostics.length)) this.warnOnce(config, "Часть усовершенствований не применена: неизвестны данные цели или преимущество конкретной атаки.");
    return results[0];
  }
  warnOnce(config, message) {
    if (!this.warned.has(config)) { this.warned.add(config); this.warn(message); }
  }
  preRollAttack(config = {}) {
    if (!weaponActivity(config.subject)) return true;
    const modifiers = this.context(config, false); if (!modifiers) return false;
    for (const roll of config.rolls ?? []) {
      if (this.attackRolls.has(roll)) continue; this.attackRolls.add(roll);
      if (modifiers.attackBonus) { roll.parts ??= []; roll.parts.push(String(modifiers.attackBonus)); }
      if (modifiers.advantage) { roll.options ??= {}; roll.options.advantage = true; }
    }
    return true;
  }
  preRollDamage(config = {}, message = {}) {
    if (!weaponActivity(config.subject)) return true;
    const base = config.rolls?.find(roll => roll.base === true);
    if (!base || this.damageRolls.has(base)) return true;
    const modifiers = this.context(config, true, message); if (!modifiers) return false;
    this.damageRolls.add(base);
    for (const part of modifiers.damageParts) {
      if (part.type == null) { base.parts ??= []; base.parts.push(part.formula); continue; }
      if (config.rolls.some(roll => roll.options?.[MARKER] === part.key)) continue;
      config.rolls.push({ parts: [part.formula], data: base.data ?? {}, options: { ...base.options,
        type: part.type, types: [part.type], ...(base.options?.critical ? { critical: { ...base.options.critical } } : {}), [MARKER]: part.key } });
    }
    return true;
  }
}
