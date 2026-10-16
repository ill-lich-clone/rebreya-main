import { evaluateSimpleUpgradeRoll } from "../automation/item-upgrade-roll-modifiers.js?v=1.4.254";
import { evaluateWeaponModAttack } from "../automation/weapon-mod-roll-modifiers.js?v=1.4.386";
import { getWeaponModHostDescriptor } from "../data/weapon-mod-rules.js?v=1.4.389";
const MARKER = "rebreyaSimpleUpgradeDamage";
const targetData = token => {
  const actor = token?.actor ?? token?.document?.actor ?? token;
  return actor?.system ? { type: actor.system.details?.type?.value, passivePerception: actor.system.skills?.prc?.passive } : null;
};
const weaponActivity = activity => activity?.item?.type === "weapon" && (["mwak", "rwak", "fwak"].includes(activity.actionType)
  || (activity.attack?.type?.classification === "weapon" && ["melee", "ranged", "firearm"].includes(activity.attack.type.value)));
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
  evaluate(host, attack, target, activity = null, config = {}) {
    const contributions = this.service.project(host.actor, host).contributions;
    const result = evaluateSimpleUpgradeRoll({ host, attack, target: targetData(target), contributions });
    if (!attack.primary && contributions.some(c => c.scope === "weapon-mod" && c.hostItemId === host.id)) {
      const conditions = this.service.moduleApi?.combatAttackService?.getWeaponModAttackConditions(activity, target, config) ?? {};
      const descriptor=getWeaponModHostDescriptor(host,this.service.weaponModCatalog),isFirearm=Boolean(descriptor && descriptor.family!=="crossbow");
      result.weaponMods = evaluateWeaponModAttack({ host:{id:host.id,isFirearm}, attack: { ...attack, type: activity?.actionType === "mwak" || activity?.attack?.type?.value==="melee" ? "melee" : "ranged" },
        target: { uuid: target?.document?.uuid ?? target?.uuid ?? null }, contributions, conditions });
      const coverBonus = result.weaponMods.ignoreHalfCover ? this.halfCoverBonus(host,activity,target,config) : 0;
      result.attackBonus += result.weaponMods.attackBonus + coverBonus;
      if(result.weaponMods.rangeMultiplier!==1){
        const range=this.service.moduleApi?.combatAttackService?.getWeaponModRangeResolution?.(activity,target,result.weaponMods.rangeMultiplier);
        if(range){result.weaponMods.range=range;result.weaponMods.allowed&&=range.allowed;}
      }
    }
    return result;
  }
  halfCoverBonus(host,activity,target,config){
    const defender=target?.actor??target?.document?.actor??target,statuses=defender?.statuses;
    if(statuses?.has("coverTotal"))return 0;
    const statusBonus=Math.max(Number(defender?.system?.attributes?.ac?.cover)||0,statuses?.has("coverThreeQuarters")?5:statuses?.has("coverHalf")?2:0);
    let dynamic=0;
    if(globalThis.MidiQOL || globalThis.game?.modules?.get?.("midi-qol")?.active){
      const actor=host.actor??host.parent,tokens=Array.from(actor?.getActiveTokens?.(true,true)??[]),controlled=tokens.filter(token=>token.controlled??token.object?.controlled),
        source=actor?.token??(tokens.length===1?tokens[0]:controlled.length===1?controlled[0]:null);
      if(!source || !(target?.document??target)?.actor || typeof globalThis.MidiQOL?.computeCoverBonus!=="function"){
        this.warnOnce(config,"Укрытие для прицела должен проверить мастер: точные токены или расчёт укрытия MIDI недоступны.");return 0;
      }
      try{dynamic=globalThis.MidiQOL.computeCoverBonus(source.object??source,target.object??target,activity);}
      catch{dynamic=NaN;}
      if(typeof dynamic!=="number" || Number.isNaN(dynamic)){
        this.warnOnce(config,"Не удалось определить укрытие для прицела; требуется сверка мастера.");return 0;
      }
    }
    return Math.max(statusBonus,dynamic)===2?2:0;
  }
  context(config, primary, message = {}) {
    const activity = config.subject, workflow = config.workflow ?? this.getWorkflow(activity);
    const targets = Array.from(config.targets ?? workflow?.targets ?? this.targets());
    const roll = workflow?.attackRoll ?? config.attackRoll ?? resolveSimpleUpgradeAttackRoll(config, message);
    const mode = roll?.options?.advantageMode;
    const advantage = [-1, 0, 1].includes(mode) ? mode === 1
      : typeof roll?.hasAdvantage === "boolean" ? roll.hasAdvantage : null;
    const results = (targets.length ? targets : [null]).map(target => this.evaluate(activity.item, { primary, advantage }, target, activity, config));
    if (results.some(result => result.weaponMods && (!result.weaponMods.allowed || result.weaponMods.needsDecision.length))) {
      this.warnOnce(config, "Уточните условия обвесов: прицеливание недоступно либо цель вне дистанции."); return null;
    }
    const signature = result => primary ? result.damageParts : { attackBonus: result.attackBonus, advantage: result.advantage,
      ...(result.weaponMods ? { rangeMultiplier: result.weaponMods.rangeMultiplier,rangeDisadvantage:result.weaponMods.range?.disadvantage??false } : {}) };
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
      if (modifiers.weaponMods) { roll.options ??= {}; roll.options.rebreyaWeaponMods = { rangeMultiplier: modifiers.weaponMods.rangeMultiplier }; }
      if (modifiers.weaponMods?.range?.disadvantage) roll.options.disadvantage=true;
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
