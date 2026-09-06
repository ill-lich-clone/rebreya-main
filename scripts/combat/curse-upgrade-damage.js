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

  applyPacket(actor, damages, options = {}, midi = false) {
    if (!Array.isArray(damages) || options.midi?.noCalc || options.ignore === true
      || this.processedPackets.has(damages)) return true;
    // Workflow damage is split into default/bonus/other by MIDI. Finalize that complete
    // effect in preTargetDamageApplication instead of spending the flat bonus per slice.
    if (midi && options.midi?.applyDamage && !options.rebreyaCurseFinalize) return true;
    const sources = this.service.sources(actor, "fire");
    if (!sources.length) return true;
    this.processedPackets.add(damages);
    for (const [type, delta] of [["fire", -2 * sources.length], ["cold", 2 * sources.length]]) {
      if (ignored(options, "modification", type)) continue;
      const entries = damages.filter(d => d.type === type && finite(d.value) > 0);
      if (!entries.length) continue;
      const packetRatio = options.rebreyaCursePacketRatios?.[type];
      if (Number.isFinite(packetRatio)) {
        for (const entry of entries) entry.value *= packetRatio;
        continue;
      }
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
      if (pending <= 0) continue;
      const total = entries.reduce((sum, entry) => sum + finite(entry.value), 0);
      const prepared = total * pending;
      const changed = delta < 0 ? Math.max(Math.min(1, prepared), prepared + delta) : prepared + delta;
      // Proportional allocation preserves properties of separate same-type components.
      const ratio = changed / prepared;
      for (const entry of entries) entry.value *= ratio;
    }
    return true;
  }

  /** Awaited midi-qol.preTargetDamageApplication(token, { workflow, damageItem }).
   * Recalculate source descriptions (never rolls) using one flat adjustment across
   * the effect, then publish the result in MIDI's own damage/HP preview fields.
   */
  preTargetDamageApplication(token, { workflow, damageItem } = {}) {
    const actor = token?.actor ?? token?.document?.actor;
    if (!actor || !damageItem || this.finalizedDamageItems.has(damageItem)) return true;
    const hasFire = this.service.sources(actor, "fire").length > 0;
    const hasShield = this.service.sources(actor, "shield").length > 0
      && isCurseRangedWeaponAttack(workflow?.activity, workflow?.item);
    if (!hasFire && !hasShield) return true;
    this.finalizedDamageItems.add(damageItem);
    if (hasFire && typeof actor.calculateDamage === "function") {
      const details = damageItem.damageDetails ?? {};
      const categories = damageItem.damageSelector === "otherDamage" ? ["otherDamage"]
        : ["defaultDamage", "bonusDamage", ...(globalThis.MidiQOL?.configSettings?.()?.singleConcentrationRoll ? ["otherDamage"] : [])];
      let groups = categories.filter(category => Array.isArray(details[`raw${category}`]))
        .map(category => ({ raw: details[`raw${category}`], options: details.calcDamageOptions?.[category] ?? damageItem.calcDamageOptions ?? {} }));
      if (!groups.length && Array.isArray(damageItem.rawDamageDetail)) {
        groups = [{ raw: damageItem.rawDamageDetail, options: damageItem.calcDamageOptions ?? {} }];
      }
      const totals = { fire: 0, cold: 0 };
      for (const { raw, options } of groups) {
        for (const entry of raw) {
          if (!(entry.type in totals) || entry.value <= 0 || ignored(options, "modification", entry.type)) continue;
          const mo = options.midi ?? {};
          let factor = finite(options.multiplier, 1);
          if (mo.uncannyDodge && !ignored(options, "uncannyDodge", entry.type)) factor *= 0.5;
          const superSaver = mo.superSaver && !ignored(options, "superSaver", entry.type);
          if (mo.saved && !ignored(options, "saved", entry.type)) factor *= superSaver ? 0 : finite(mo.saveMultiplier, 1);
          else if (superSaver) factor *= finite(globalThis.MidiQOL?.configSettings?.()?.defaultSaveMultiplier, 0.5);
          totals[entry.type] += entry.value * factor;
        }
      }
      const count = this.service.sources(actor, "fire").length;
      const ratios = {
        fire: totals.fire > 0 ? Math.max(Math.min(1, totals.fire), totals.fire - 2 * count) / totals.fire : 1,
        cold: totals.cold > 0 ? (totals.cold + 2 * count) / totals.cold : 1
      };
      const next = [];
      for (const { raw, options } of groups) {
        const result = actor.calculateDamage(raw, { ...options, midi: { ...options.midi },
          rebreyaCurseFinalize: true, rebreyaCursePacketRatios: ratios });
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
