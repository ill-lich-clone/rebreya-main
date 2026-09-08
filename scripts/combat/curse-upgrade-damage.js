import { isCurseRangedWeaponAttack } from "./curse-upgrade-attacks.js";

/** Numeric curse damage follows Глоссарий pp.13–14, not MIDI absorption/healing. */
const BLOOD_ROLL = "rebreyaCurseBlood";
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const ignored = (options, category, type) => options.ignore === true
  || options.ignore?.[category] === true || options.ignore?.[category]?.has?.(type);
const resolveSourceItem = options => {
  if (options.sourceItem ?? options.activity?.item) return options.sourceItem ?? options.activity.item;
  const sourceUuid = options.sourceItemUuid ?? options.itemUuid ?? options.midi?.itemUuid;
  return sourceUuid ? globalThis.fromUuidSync?.(sourceUuid) : null;
};

/** One flat adjustment per type/eligibility group, preserving separate native damage properties. */
export function calculateFlatDamageRatios(entries, rules) {
  const amounts = entries.map(entry => Math.max(0, finite(entry.value)));
  const grouped = new Map();
  for (const rule of rules) {
    const key = JSON.stringify([rule.type, Boolean(rule.nonmagical)]);
    const group = grouped.get(key) ?? { ...rule, delta: 0 };
    group.delta += rule.delta; grouped.set(key, group);
  }
  // Restricted absorption is spent only on eligible components, then whole-type absorption.
  for (const rule of [...grouped.values()].sort((a,b) => Number(Boolean(b.nonmagical)) - Number(Boolean(a.nonmagical)))) {
    const indices = entries.flatMap((entry, i) => {
      const properties = entry.properties;
      const knownNonmagical = (properties instanceof Set || Array.isArray(properties)) && !new Set(properties).has("mgc");
      return entry.type === rule.type && !entry.ignoreModification && amounts[i] > 0
        && (!rule.nonmagical || knownNonmagical) ? [i] : [];
    });
    const total = indices.reduce((sum,i) => sum + amounts[i], 0);
    if (!total || !rule.delta) continue;
    const changed = rule.delta < 0 ? Math.max(Math.min(1,total), total + rule.delta) : total + rule.delta;
    for (const i of indices) amounts[i] *= changed / total;
  }
  return entries.map((entry,i) => entry.value > 0 ? amounts[i] / entry.value : 1);
}

export class CurseUpgradeDamageAdapter {
  constructor(service, { getSaveDROrder = () => globalThis.MidiQOL?.configSettings?.()?.saveDROrder ?? "SaveDRDr",
    resolveDamageSource = options => ({
      item: resolveSourceItem(options),
      activity: options.activity
    }) } = {}) {
    this.service = service;
    this.getSaveDROrder = getSaveDROrder;
    this.resolveDamageSource = resolveDamageSource;
    this.processedPackets = new WeakSet();
    this.finalizedDamageItems = new WeakSet();
  }

  /** dnd5e.calculateDamage; skip the native outer callback for a MIDI packet. */
  calculateDamage(actor, damages, options = {}) {
    if (options.midi) return true;
    return this.applyShieldResistance(actor, damages, options);
  }

  /** midi-qol.dnd5eCalculateDamage, after MIDI custom trait adjustments. */
  midiCalculateDamage(actor, damages, options = {}) {
    return this.applyShieldResistance(actor, damages, options);
  }

  applyShieldResistance(actor, damages, options = {}) {
    if (!Array.isArray(damages) || options.midi?.noCalc || options.ignore === true
      || !this.service.sources(actor, "shield").length) return true;
    const source = this.resolveDamageSource(options, actor);
    if (!isCurseRangedWeaponAttack(source?.activity, source?.item)) return true;
    let changed = false;
    for (const entry of damages) {
      if (entry.value <= 0 || entry.active?.inlined || entry.type === "temphp" || entry.type === "healing"
        || entry.active?.resistance || entry.active?.type?.resistance || ignored(options, "resistance", entry.type)) continue;
      entry.value *= 0.5;
      entry.active ??= {};
      entry.active.resistance = true;
      entry.active.multiplier = finite(entry.active.multiplier, 1) * 0.5;
      changed = true;
    }
    if (changed) {
      const amount = damages.filter(entry => entry.type !== "temphp" && !entry.active?.inlined)
        .reduce((sum, entry) => sum + finite(entry.value), 0);
      damages.amount = amount > 0 ? Math.floor(amount) : Math.ceil(amount);
      const threshold = finite(actor.system?.attributes?.hp?.dt, 0);
      if (!options.ignore?.threshold && damages.amount > 0 && damages.amount < threshold) {
        damages.amount = 0;
        for (const entry of damages) { entry.value = 0; entry.active ??= {}; entry.active.threshold = true; }
      }
    }
    return true;
  }

  /** Native dnd5e.preCalculateDamage(actor, descriptions, options). MIDI owns its nested callback. */
  preCalculateDamage(actor, damages, options = {}) {
    if (options.midi) return true;
    return this.applyPacket(actor, damages, options, false);
  }

  /** midi-qol.dnd5ePreCalculateDamage runs after MIDI save preparation, before native traits. */
  midiPreCalculateDamage(actor, damages, options = {}) {
    return this.applyPacket(actor, damages, options, true);
  }

  flatModifiers(actor) {
    const count = this.service.sources(actor, "fire").length;
    const simple = this.service.moduleApi?.itemUpgradeAutomationService?.project(actor).contributions ?? [];
    return [ ...(count ? [{ type: "fire", delta: -2 * count }, { type: "cold", delta: 2 * count }] : []),
      ...simple.filter(c => c.scope === "damage" && c.operation === "flat-damage") ];
  }

  applyPacket(actor, damages, options = {}, midi = false) {
    if (!Array.isArray(damages) || options.midi?.noCalc || options.ignore === true
      || this.processedPackets.has(damages)) return true;
    // Workflow damage is split into default/bonus/other by MIDI. Finalize that complete
    // effect in preTargetDamageApplication instead of spending the flat bonus per slice.
    if (midi && options.midi?.applyDamage && !options.rebreyaCurseFinalize) return true;
    const rules = this.flatModifiers(actor);
    if (!rules.length) return true;
    this.processedPackets.add(damages);
    const entries = damages.map(entry => {
      const type = entry.type;
      // Native multiplier is still pending. In MIDI DRSaveDr mode the save is pending too.
      // Divide the flat modifier by those pending factors so native damage keeps its own
      // immunities, resistance, vulnerability, rounding and threshold handling unchanged.
      let pending = finite(options.multiplier, 1);
      if (midi && this.getSaveDROrder() === "DRSaveDr") {
        const mo = options.midi ?? {};
        const saved = mo.saved && !ignored(options, "saved", type);
        const superSaver = mo.superSaver && !ignored(options, "superSaver", type);
        if (saved) pending *= superSaver ? 0 : finite(mo.saveMultiplier, 1);
        else if (superSaver) pending *= finite(globalThis.MidiQOL?.configSettings?.()?.defaultSaveMultiplier, 0.5);
      }
      return { ...entry, value: pending > 0 ? finite(entry.value) * pending : 0,
        ignoreModification: ignored(options, "modification", type) };
    });
    const ratios = options.rebreyaCursePacketRatios ?? calculateFlatDamageRatios(entries, rules);
    for (const [i,entry] of damages.entries()) if (Number.isFinite(ratios[i])) entry.value *= ratios[i];
    return true;
  }

  /** Awaited midi-qol.preTargetDamageApplication(token, { workflow, damageItem }).
   * Recalculate source descriptions (never rolls) using one flat adjustment across
   * the effect, then publish the result in MIDI's own damage/HP preview fields.
   */
  preTargetDamageApplication(token, { workflow, damageItem } = {}) {
    const actor = token?.actor ?? token?.document?.actor;
    if (!actor || !damageItem || this.finalizedDamageItems.has(damageItem)) return true;
    const rules = this.flatModifiers(actor), hasFlat = rules.length > 0;
    const hasShield = this.service.sources(actor, "shield").length > 0
      && isCurseRangedWeaponAttack(workflow?.activity, workflow?.item);
    if (!hasFlat && !hasShield) return true;
    this.finalizedDamageItems.add(damageItem);
    if (hasFlat && typeof actor.calculateDamage === "function") {
      const details = damageItem.damageDetails ?? {};
      const categories = damageItem.damageSelector === "otherDamage" ? ["otherDamage"]
        : ["defaultDamage", "bonusDamage", ...(globalThis.MidiQOL?.configSettings?.()?.singleConcentrationRoll ? ["otherDamage"] : [])];
      let groups = categories.filter(category => Array.isArray(details[`raw${category}`]))
        .map(category => ({ raw: details[`raw${category}`], options: details.calcDamageOptions?.[category] ?? damageItem.calcDamageOptions ?? {} }));
      if (!groups.length && Array.isArray(damageItem.rawDamageDetail)) {
        groups = [{ raw: damageItem.rawDamageDetail, options: damageItem.calcDamageOptions ?? {} }];
      }
      const entries = [];
      for (const { raw, options } of groups) {
        for (const entry of raw) {
          const mo = options.midi ?? {};
          let factor = finite(options.multiplier, 1);
          if (mo.uncannyDodge && !ignored(options, "uncannyDodge", entry.type)) factor *= 0.5;
          const superSaver = mo.superSaver && !ignored(options, "superSaver", entry.type);
          if (mo.saved && !ignored(options, "saved", entry.type)) factor *= superSaver ? 0 : finite(mo.saveMultiplier, 1);
          else if (superSaver) factor *= finite(globalThis.MidiQOL?.configSettings?.()?.defaultSaveMultiplier, 0.5);
          entries.push({ ...entry, value: finite(entry.value) * Math.max(0,factor),
            ignoreModification: options.midi?.noCalc || ignored(options, "modification", entry.type) });
        }
      }
      const ratios = calculateFlatDamageRatios(entries, rules);
      const next = [];
      let offset = 0;
      for (const { raw, options } of groups) {
        const result = actor.calculateDamage(raw, { ...options, midi: { ...options.midi },
          rebreyaCurseFinalize: true, rebreyaCursePacketRatios: ratios.slice(offset, offset + raw.length) });
        offset += raw.length;
        if (!Array.isArray(result)) return true;
        next.push(...result);
      }
      if (groups.length) damageItem.damageDetail = next;
    }
    if (hasShield) {
      this.applyShieldResistance(actor, damageItem.damageDetail, { ...damageItem.calcDamageOptions,
        sourceItem: workflow.item, activity: workflow.activity });
    }
    this.updateDamagePreview(actor, damageItem);
    return true;
  }

  updateDamagePreview(actor, damageItem) {
    const hp = actor.system?.attributes?.hp;
    if (!hp || !Array.isArray(damageItem.damageDetail)) return;
    const details = damageItem.damageDetail.filter(entry => !entry.active?.inlined);
    const total = details.filter(entry => !["temphp", "midi-none", "vitality", "maximum"].includes(entry.type))
      .reduce((sum, entry) => sum + finite(entry.value), 0);
    const amount = total > 0 ? Math.floor(total) : Math.ceil(total);
    const temp = details.filter(entry => entry.type === "temphp").reduce((sum, entry) => sum + finite(entry.value), 0);
    const oldHP = finite(hp.value); const oldTempHP = finite(hp.temp);
    const deltaTemp = amount > 0 ? Math.min(oldTempHP, amount) : 0;
    const deltaHP = Math.min(oldHP, Math.max(-finite(hp.damage), amount - deltaTemp));
    const newTempHP = Math.floor(Math.max(0, oldTempHP - deltaTemp, temp));
    Object.assign(damageItem, { totalDamage: total, healingAdjustedTotalDamage: amount,
      oldHP, oldTempHP, newHP: oldHP - deltaHP, newTempHP,
      hpDamage: deltaHP, tempDamage: oldTempHP - newTempHP });
  }

  /** dnd5e.preRollDamage(config, dialog, message); safe to share with MIDI preDamageRoll config. */
  preRollDamage(config = {}) {
    const activity = config.subject;
    const host = activity?.item;
    const actor = activity?.actor ?? host?.actor;
    if (!actor || host?.type !== "weapon" || !Array.isArray(config.rolls)) return true;
    const sources = this.service.sources(actor, "blood").filter(source => source.host === host
      || (source.host?.uuid && source.host.uuid === host.uuid));
    for (const source of sources) {
      const sourceId = source.upgrade?.uuid ?? source.upgrade?.id;
      if (!sourceId || config.rolls.some(roll => roll.options?.[BLOOD_ROLL] === sourceId)) continue;
      const baseOptions = config.rolls.find(roll => roll.base)?.options ?? config.rolls[0]?.options ?? {};
      config.rolls.push({
        parts: ["1d6"], data: config.rolls[0]?.data ?? {},
        options: { ...baseOptions, type: "slashing", types: ["slashing"],
          ...(baseOptions.critical ? { critical: { ...baseOptions.critical } } : {}), [BLOOD_ROLL]: sourceId }
      });
    }
    return true;
  }

  /** Extract actual evaluated bonus, including native critical dice, without rerolling. */
  bloodDamageTotal(workflow, source) {
    const sourceId = source?.upgrade?.uuid ?? source?.upgrade?.id;
    return (workflow?.damageRolls ?? []).filter(roll => roll.options?.[BLOOD_ROLL] === sourceId)
      .reduce((sum, roll) => sum + Math.max(0, finite(roll.total)), 0);
  }
}
