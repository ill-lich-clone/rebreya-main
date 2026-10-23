import { MODULE_ID } from "../constants.js";

export const WHIRLWIND_ACTIVITY_ID = "lchWhirlAttack01";
const values = collection => Array.isArray(collection) ? collection
  : typeof collection?.values === "function" ? Array.from(collection.values()) : Object.values(collection ?? {});
const clone = value => globalThis.foundry?.utils?.deepClone?.(value) ?? structuredClone(value);
const marker = activity => activity?.flags?.[MODULE_ID]?.whirlwindAttack;
const hasProperty = item => Array.from(item?.system?.properties ?? []).includes("lchWhirl");
const isMelee = (activity, item) => activity?.type === "attack" && (activity.attack?.type?.value || item?.system?.attackType || "melee") === "melee";

export function isWhirlwindActivity(activity) {
  return Boolean(marker(activity)) && activity?.item?.type === "weapon" && hasProperty(activity.item);
}

export function buildWhirlwindActivity(item, baseActivity) {
  if (item?.type !== "weapon" || !hasProperty(item)) return null;
  const base = baseActivity?.toObject?.() ?? baseActivity ?? {
    type: "attack", activation: { type: "action", value: 1 },
    attack: { type: { value: "melee", classification: "weapon" } },
    damage: { includeBase: true, parts: [] }
  };
  if (!isMelee(baseActivity ?? base, item)) return null;
  const result = clone(base);
  result.attack ??= {};
  result.attack.type = { value: "melee", classification: baseActivity?.attack?.type?.classification || base.attack?.type?.classification || "weapon" };
  result._id = WHIRLWIND_ACTIVITY_ID;
  result.name = "Круговая атака";
  result.attackRollPerTarget = "never";
  result.flags ??= {};
  result.flags[MODULE_ID] = { ...result.flags[MODULE_ID], whirlwindAttack: { version: 1, sourceActivityId: base._id ?? "" } };
  result.target = { ...result.target, affects: { count: "", type: "creature", choice: false }, template: { type: "" }, prompt: false, override: true };
  return result;
}

export function collectWhirlwindTargets(source, tokens, reachFeet, measure) {
  const sourceId = source.document?.uuid ?? source.uuid ?? source.id;
  return values(tokens).filter(token => {
    const document = token.document ?? token;
    if (!document.actor || (document.uuid ?? document.id) === sourceId) return false;
    const distance = measure(source, token);
    return Number.isFinite(distance) && distance >= 0 && distance <= reachFeet + 1e-9;
  });
}

export function whirlwindHitTargets(targets, roll) {
  if (!roll || roll.isFumble) return [];
  return Array.from(targets).filter(target => roll.isCritical
    || Number(roll.total) >= Number(target.actor?.system?.attributes?.ac?.value ?? Infinity));
}

const HALF_PROPERTY = "rebreyaWhirlHalf";
const TARGET_PROPERTY = "rebreyaWhirlTarget:";
const processedDamage = new WeakSet();

export function whirlwindEffectTargets(workflow) {
  if (!isWhirlwindActivity(workflow?.activity)) return null;
  const selected = workflow.rebreyaWhirlwind?.selectedTargetUuid;
  return [...(workflow.hitTargets ?? []), ...(workflow.hitTargetsEC ?? [])]
    .filter(token => (token.document?.uuid ?? token.uuid) === selected);
}

export function markWhirlwindDamageRolls(config, targetUuid) {
  for (const roll of config.rolls ?? []) {
    roll.options ??= {};
    const properties = new Set(roll.options.properties ?? []);
    properties.add(HALF_PROPERTY);
    if (targetUuid !== undefined) properties.add(`${TARGET_PROPERTY}${targetUuid ?? ""}`);
    roll.options.properties = [...properties];
  }
}

export function buildWhirlwindDamagePackets({ baseDamage = [], extraDamage = [], selectedTargetUuid, targetUuid }) {
  return [...baseDamage, ...(selectedTargetUuid && selectedTargetUuid === targetUuid ? extraDamage : [])]
    .map(entry => ({ ...entry, value: entry.value * 0.5 }));
}

/** Before native resistance/rounding; serializable properties also survive MIDI aggregation. */
export function applyWhirlwindDamage(_actor, damages, options = {}) {
  if (options.midi?.noCalc) return true;
  const targetUuid = options.midi?.targetUuid ?? options.rebreyaWhirlwindTargetUuid;
  for (const damage of damages ?? []) {
    if (processedDamage.has(damage)) continue;
    const properties = new Set(damage.properties ?? []);
    if (!properties.has(HALF_PROPERTY)) continue;
    const addressed = [...properties].find(property => property.startsWith(TARGET_PROPERTY));
    const packets = buildWhirlwindDamagePackets(addressed
      ? { extraDamage: [damage], selectedTargetUuid: addressed.slice(TARGET_PROPERTY.length), targetUuid }
      : { baseDamage: [damage] });
    damage.value = packets[0]?.value ?? 0;
    if (damage.damage !== undefined) damage.damage = damage.value;
    processedDamage.add(damage);
  }
  return true;
}

/** Keep native Activity Uses on the authored source activity, including native refund deltas. */
export function routeWhirlwindConsumption(activity, updates) {
  if (!isWhirlwindActivity(activity)) return true;
  const sourceId = marker(activity)?.sourceActivityId;
  const spent = updates.activity?.["uses.spent"] ?? updates.activity?.uses?.spent;
  if (!sourceId || spent === undefined) return true;
  updates.item ??= [];
  let itemUpdate = updates.item.find(update => update._id === activity.item.id);
  if (!itemUpdate) updates.item.push(itemUpdate = { _id: activity.item.id });
  itemUpdate[`system.activities.${sourceId}.uses.spent`] = spent;
  delete updates.activity["uses.spent"];
  if (updates.activity.uses) {
    delete updates.activity.uses.spent;
    if (!Object.keys(updates.activity.uses).length) delete updates.activity.uses;
  }
  return true;
}

/** Native damage-application has token UUID here, while calculateDamage receives only an Actor. */
export function registerWhirlwindNativeTargetOptions(ElementClass = globalThis.customElements?.get?.("damage-application")) {
  const prototype = ElementClass?.prototype;
  const key = Symbol.for("rebreya-main.whirlwind-target-options");
  if (!prototype?.getTargetOptions || prototype[key]) return;
  const original = prototype.getTargetOptions;
  const buildTargetsList = prototype.buildTargetsList;
  const buildTargetListEntry = prototype.buildTargetListEntry;
  const calculateDamage = prototype.calculateDamage;
  const applyDamage = prototype._onApplyDamage;
  Object.defineProperty(prototype, key, { value: true });
  prototype.getTargetOptions = function(uuid) {
    const tokenUuid = this.rebreyaWhirlwindBuildingToken ?? uuid;
    const options = original.call(this, tokenUuid);
    options.rebreyaWhirlwindTargetUuid = tokenUuid;
    return options;
  };
  const targets = tray => tray.chatMessage?.getFlag?.(MODULE_ID, "whirlwindAttack")
    ? tray.chatMessage.getFlag("dnd5e", "targets") : null;
  if (buildTargetsList && buildTargetListEntry && calculateDamage && applyDamage) {
    prototype.buildTargetsList = function() {
      const descriptors = targets(this);
      if (!descriptors?.every(target => target.tokenUuid)) return buildTargetsList.call(this);
      if (this.shouldBuildTargetList === false) return;
      this.targetList.replaceChildren(...descriptors.map(target => this.buildTargetListEntry(target)).filter(Boolean));
    };
    prototype.buildTargetListEntry = function(descriptor) {
      if (!descriptor.tokenUuid || !targets(this)) return buildTargetListEntry.call(this, descriptor);
      this.rebreyaWhirlwindBuildingToken = descriptor.tokenUuid;
      try {
        const entry = buildTargetListEntry.call(this, descriptor);
        if (entry) entry.dataset.targetUuid = descriptor.tokenUuid;
        return entry;
      } finally { delete this.rebreyaWhirlwindBuildingToken; }
    };
    prototype.calculateDamage = function(actor, options) {
      return calculateDamage.call(this, actor?.actor ?? actor, options);
    };
    prototype._onApplyDamage = async function(event) {
      if (!targets(this)) return applyDamage.call(this, event);
      event.preventDefault();
      for (const entry of this.targetList.querySelectorAll("[data-target-uuid]")) {
        const document = globalThis.fromUuidSync?.(entry.dataset.targetUuid);
        const actor = document?.actor ?? document;
        if (actor?.isOwner) await actor.applyDamage(this.damages, { ...this.getTargetOptions(entry.dataset.targetUuid), isDelta: true });
      }
      if (globalThis.game?.settings?.get?.("dnd5e", "autoCollapseChatTrays") !== "manual") this.open = false;
    };
  }
}

/** Dotted updates preserve every unrelated activity and authored field. */
export function whirlwindActivityUpdates(item) {
  const activities = values(item?.system?.activities);
  const current = activities.find(activity => (activity.id ?? activity._id) === WHIRLWIND_ACTIVITY_ID);
  if (current && !marker(current)) return {};
  const sourceId = marker(current)?.sourceActivityId;
  const base = activities.find(activity => !marker(activity) && isMelee(activity, item) && (!sourceId || (activity.id ?? activity._id) === sourceId))
    ?? activities.find(activity => !marker(activity) && isMelee(activity, item));
  const desired = base ? buildWhirlwindActivity(item, base) : null;
  if (!desired) return marker(current) ? { [`system.activities.-=${WHIRLWIND_ACTIVITY_ID}`]: null } : {};
  // Compare only projected fields: Foundry adds schema defaults when preparing an activity.
  const actual = current?.toObject?.() ?? current;
  const matches = (left, right) => Object.entries(right).every(([key, value]) => value && typeof value === "object" && !Array.isArray(value)
    ? matches(left?.[key], value) : JSON.stringify(left?.[key]) === JSON.stringify(value));
  return actual && matches(actual, desired) ? {} : { [`system.activities.${WHIRLWIND_ACTIVITY_ID}`]: desired };
}
