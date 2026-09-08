import { evaluateUpgradeActivation } from "../data/item-upgrade-rules.js?v=1.4.250";
import { SIMPLE_UPGRADE_ROLL_PROFILES } from "./item-upgrade-roll-modifiers.js?v=1.4.254";
import { validateUpgradeChoices } from "../data/item-upgrade-choices.js?v=1.4.255";

const actor = (path, value) => ({ scope: "actor", operation: "add", path, value });
const host = (operation, value) => ({ scope: "host", operation, value });
const ac = actor("system.attributes.ac.bonus", 1), saves = actor("system.bonuses.abilities.save", 1);
const absorption = (type, delta = -1, nonmagical = false) => ({ scope: "damage", operation: "flat-damage", type, delta, nonmagical });
export const SIMPLE_UPGRADE_PROFILES = Object.freeze({
  ...SIMPLE_UPGRADE_ROLL_PROFILES,
  "svyashchennaya-stal": [host("radiant-double-base", true)],
  "fragment-pantsirya-chudovishcha": [absorption("slashing")],
  "pantsir-chudovishcha": [absorption("slashing"), absorption("piercing")],
  "shkura-chudovishcha": [absorption("bludgeoning")],
  "zakalyonnaya-cheshuya": [absorption("piercing")],
  "khrebet-chudovishcha": [absorption("slashing", -1, true), absorption("bludgeoning", 1, true)],
  "oskolok-kosti-chudovishcha": [absorption("bludgeoning", -1, true), absorption("piercing", 1, true)],
  "cheshuya-monstra": [absorption("choice", -2)],
  "zacharovanie-pogloshcheniya": [absorption("choice")],
  "dushevnoe-zacharovanie": [actor("system.skills.per.bonuses.check", 1), actor("system.skills.prf.bonuses.check", 1)],
  "oskolok-cherepa-chudovishcha": [actor("system.skills.itm.bonuses.check", 1)],
  "koren-drakonego-dereva": [actor("system.attributes.hp.bonuses.overall", 5)],
  "maloe-zacharovanie-stoykosti": [saves], "maloe-zacharovanie-zashchity": [ac],
  "zacharovanie-zashchity": [ac, saves],
  "poroshok-drokhuby": [actor("system.attributes.movement.walk", 10)],
  "sherst-griffona": [actor("system.attributes.movement.walk", 5)],
  "khitinovoe-pokrytie": [host("remove-stealth-disadvantage", true)],
  "mifrilovaya-peredelka-dospekha": [host("remove-stealth-disadvantage", true), host("remove-strength-requirement", true)],
  "lunnyy-metall": [host("remove-stealth-disadvantage", true), { ...actor("system.skills.ste.roll.mode", 1), condition: "original-no-stealth-disadvantage" }],
  "zacharovanie-lyogkosti": [host("reduce-weight-lb", 10)]
});

export function buildUpgradeContributionKey({ actorUuid, hostItemId, upgradeItemId, effectKey, projectionVersion = 1 }) {
  return JSON.stringify([actorUuid, hostItemId, upgradeItemId, effectKey, projectionVersion]);
}

/** Input is detached source data and verified installed links. No writes or derived totals are read here. */
export function buildSimpleUpgradeContributions({ actor: actorData, hosts, manifest = null, capabilities = null }) {
  const contributions = [], unavailable = [];
  for (const item of hosts) for (const upgrade of item.upgrades) {
    const effects = SIMPLE_UPGRADE_PROFILES[upgrade.sourceId];
    const entry = manifest?.find(row => row.productId === upgrade.sourceId);
    if (!effects || !upgrade.valid || (manifest && entry?.decision !== "simple-implemented")) continue;
    const activation = entry?.activation ?? (SIMPLE_UPGRADE_ROLL_PROFILES[upgrade.sourceId] || upgrade.sourceId === "svyashchennaya-stal" ? "held" : upgrade.sourceId === "zacharovanie-lyogkosti" ? "carried" : "equipped");
    if (!evaluateUpgradeActivation(item.descriptor, actorData, { activation, worksWhenBroken: entry?.worksWhenBroken ?? false }).active) continue;
    if (capabilities && effects.some(effect => !capabilities.has(effect.scope))) {
      unavailable.push({ hostItemId: item.id, upgradeItemId: upgrade.id, reason: "Нет поддержанного native modifier adapter." }); continue;
    }
    if (effects.some(effect => effect.operation === "reduce-weight-lb")
      && (!Number.isFinite(item.source.system?.weight?.value) || !["lb", "kg"].includes(item.source.system.weight.units))) {
      unavailable.push({ hostItemId: item.id, upgradeItemId: upgrade.id, reason: "Неизвестные значение или единицы веса предмета." }); continue;
    }
    if (effects.some(effect => effect.operation === "radiant-double-base")) {
      const damage = item.source.system?.damage;
      if (!Number.isSafeInteger(damage?.base?.number) || damage.base.number <= 0
        || [damage.base, damage.versatile].some(part => part?.custom?.enabled || /\d+d\d+/iu.test(part?.bonus ?? ""))) {
        unavailable.push({ hostItemId: item.id, upgradeItemId: upgrade.id, reason: "Святая сталь требует выделенных базовых костей оружия без custom-формулы." }); continue;
      }
    }
    let choices;
    try { choices = validateUpgradeChoices(upgrade.sourceId, upgrade.choices); }
    catch (error) { unavailable.push({ hostItemId: item.id, upgradeItemId: upgrade.id, reason: error.message }); continue; }
    for (const [index, effect] of effects.entries()) {
      if (effect.condition === "original-no-stealth-disadvantage" && new Set(item.source.system?.properties ?? []).has("stealthDisadvantage")) continue;
      const prepared = { ...effect };
      if (effect.type === "choice") prepared.type = choices.damageType;
      if (effect.path === "system.attributes.hp.bonuses.overall"
        && (actorData.type !== "character" || actorData.source?.system?.attributes?.hp?.max != null)) prepared.path = "system.attributes.hp.max";
      const effectKey = String(index);
      contributions.push({ ...prepared, sourceId: upgrade.sourceId, hostItemId: item.id, upgradeItemId: upgrade.id, effectKey,
        key: buildUpgradeContributionKey({ actorUuid: actorData.uuid, hostItemId: item.id, upgradeItemId: upgrade.id, effectKey }) });
    }
  }
  return { contributions, unavailable };
}

/** Called once during each native Item active-effect preparation; system is fresh derived data, never _source. */
export function projectSimpleUpgradeItem(system, contributions) {
  let radiantBaseApplied = false;
  for (const contribution of contributions.filter(c => c.scope === "host")) {
    if (contribution.operation === "remove-stealth-disadvantage") system.properties?.delete?.("stealthDisadvantage");
    if (contribution.operation === "remove-strength-requirement") system.strength = 0;
    if (contribution.operation === "reduce-weight-lb" && system.weight && Number.isFinite(system.weight.value)) {
      const factor = { lb: 1, kg: 0.45359237 }[system.weight.units];
      if (factor) system.weight.value = Math.max(0, system.weight.value - contribution.value * factor);
    }
    if (contribution.operation === "radiant-double-base" && !radiantBaseApplied) {
      radiantBaseApplied = true;
      for (const part of [system.damage?.base, system.damage?.versatile]) {
        if (!part || !Number.isSafeInteger(part.number) || part.number <= 0) continue;
        part.number *= 2;
        part.types = new Set(["radiant"]);
      }
    }
  }
  return system;
}
