import { MODULE_ID } from "../constants.js";
import { getFighterManeuverAutomation, normalizeFighterAutomationKey } from "../data/fighter-automation.js";

const ATTACK_ROLL_BOOST_FLAG = "attackRollBoosts";
const CHECKED_WORKFLOW_FLAG = `_${MODULE_ID}AttackRollBoostChecked`;
const WEAPON_ATTACK_TYPES = new Set(["mwak", "rwak", "fwak"]);
const FIGHTER_CLASS_IDENTIFIER = "fighter-rework-v028";
const FIGHTER_DOMINANCE_FEATURE_ID = "fighter-dominance";
const SCALE_REFERENCE_PATTERN = /@scale\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/giu;
const FIGHTER_DOMINANCE_DIE_PROGRESSION = [
  { level: 1, formula: "1d4" },
  { level: 9, formula: "1d6" },
  { level: 16, formula: "1d8" }
];
const FIGHTER_DOMINANCE_DICE_PROGRESSION = [
  { level: 1, formula: "2" },
  { level: 5, formula: "3" },
  { level: 9, formula: "4" },
  { level: 13, formula: "5" },
  { level: 17, formula: "6" }
];

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function escapeHtml(value) {
  return globalThis.foundry?.utils?.escapeHTML instanceof Function
    ? foundry.utils.escapeHTML(value)
    : String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;");
}

function getProperty(source, path, fallback = undefined) {
  const value = globalThis.foundry?.utils?.getProperty instanceof Function
    ? foundry.utils.getProperty(source, path)
    : String(path ?? "").split(".").reduce((current, key) => current?.[key], source);
  return value === undefined ? fallback : value;
}

function setProperty(source, path, value) {
  if (globalThis.foundry?.utils?.setProperty instanceof Function) {
    return foundry.utils.setProperty(source, path, value);
  }

  const keys = String(path ?? "").split(".").filter(Boolean);
  let cursor = source;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
  return true;
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  if (collection instanceof Set) {
    return Array.from(collection);
  }

  if (typeof collection === "object") {
    return Object.values(collection);
  }

  return [];
}

function normalizeBoostEntries(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === "object");
  }

  if (value && typeof value === "object") {
    return [value];
  }

  return [];
}

function targetUuid(target) {
  return cleanText(
    target?.document?.uuid
    ?? target?.uuid
    ?? target?.actor?.uuid
    ?? target?.id
  );
}

function getDialogButtonForm(button) {
  if (typeof HTMLElement !== "undefined" && button?.form instanceof HTMLElement) {
    return button.form;
  }

  if (typeof button?.closest === "function") {
    return button.closest("form") ?? null;
  }

  return button?.form ?? null;
}

function parseMaxFormulaTotal(formula) {
  const text = cleanText(formula).replace(/\s+/gu, "");
  if (!text) {
    return 0;
  }

  if (/[^\d+\-]/u.test(text.replace(/\d*d\d+/giu, ""))) {
    return NaN;
  }

  const replaced = text.replace(/(\d*)d(\d+)/giu, (_match, count, faces) => {
    const diceCount = Math.max(1, Math.floor(toNumber(count || 1, 1)));
    return String(diceCount * Math.max(0, Math.floor(toNumber(faces, 0))));
  });

  if (!/^[+-]?\d+(?:[+-]\d+)*$/u.test(replaced)) {
    return NaN;
  }

  return (replaced.match(/[+-]?\d+/gu) ?? [])
    .map(Number)
    .reduce((sum, value) => sum + value, 0);
}

function scaleValueToFormula(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "string") {
    return cleanText(value);
  }

  const candidates = [
    value,
    typeof value.toObject === "function" ? value.toObject() : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    const explicitFormula = cleanText(candidate.formula);
    if (explicitFormula) {
      return explicitFormula;
    }

    const dieFormula = cleanText(candidate.die ?? candidate.denom);
    if (/^(?:\d*)d\d+/iu.test(dieFormula)) {
      const number = Math.max(1, Math.floor(toNumber(candidate.number, 1)));
      return /^\d/iu.test(dieFormula) ? dieFormula : `${number}${dieFormula}`;
    }

    const faces = Math.floor(toNumber(candidate.faces, NaN));
    if (Number.isFinite(faces) && faces > 0) {
      const number = Math.max(1, Math.floor(toNumber(candidate.number, 1)));
      const modifiers = Array.isArray(candidate.modifiers)
        ? candidate.modifiers.join("")
        : typeof candidate.modifiers?.values === "function"
          ? Array.from(candidate.modifiers.values()).join("")
          : "";
      return `${number}d${faces}${modifiers}`;
    }

    const numericValue = toNumber(candidate.value, NaN);
    if (Number.isFinite(numericValue)) {
      return String(numericValue);
    }
  }

  return "";
}

function progressionFormulaForLevel(entries, level) {
  const actorLevel = Math.max(1, Math.floor(toNumber(level, 1)));
  let selected = entries[0]?.formula ?? "";
  for (const entry of entries) {
    if (actorLevel >= entry.level) {
      selected = entry.formula;
    }
  }
  return selected;
}

function isTokenInSet(set, target) {
  if (!set?.has) {
    return false;
  }

  if (set.has(target)) {
    return true;
  }

  const uuid = targetUuid(target);
  return collectionValues(set).some((entry) => targetUuid(entry) === uuid);
}

export class AttackRollBoostService {
  constructor(moduleApi = {}, options = {}) {
    this.moduleApi = moduleApi;
    this._options = options;
  }

  async initialize() {
    return true;
  }

  async applyMidiHitsChecked(workflow) {
    if (!workflow || workflow[CHECKED_WORKFLOW_FLAG]) {
      return true;
    }
    workflow[CHECKED_WORKFLOW_FLAG] = true;

    const actor = workflow.actor ?? workflow.activity?.actor ?? workflow.item?.actor ?? null;
    if (!actor || !this.#canPrompt(actor) || !this.#isAttackWorkflow(workflow)) {
      return true;
    }

    const attackTotal = this.#attackTotal(workflow);
    if (!Number.isFinite(attackTotal) || workflow.isFumble === true) {
      return true;
    }

    const missedTargets = this.#missedTargets(workflow, attackTotal);
    if (!missedTargets.length) {
      return true;
    }

    const sources = await this.#availableSources(actor, workflow);
    if (!sources.length) {
      return true;
    }

    const maxTotal = sources.reduce((sum, source) => sum + Math.max(0, source.maxTotal), 0);
    const closestMiss = missedTargets.slice().sort((left, right) => left.needed - right.needed)[0];
    if (!closestMiss || maxTotal < closestMiss.needed) {
      return true;
    }

    const details = {
      actor,
      item: workflow.item ?? workflow.activity?.item ?? null,
      workflow,
      attackTotal,
      needed: closestMiss.needed,
      target: closestMiss,
      targets: missedTargets,
      options: sources.map((source) => ({
        id: source.id,
        label: source.label,
        formula: source.formula,
        sourceName: source.sourceName,
        maxTotal: source.maxTotal,
        itemUuid: source.item?.uuid ?? ""
      }))
    };

    const selectedIds = this.#normalizeSelectedIds(await this.promptAttackRollBoosts(details));
    if (!selectedIds.size) {
      return true;
    }

    const selectedSources = sources.filter((source) => selectedIds.has(source.id));
    const applied = [];
    let bonusTotal = 0;
    for (const source of selectedSources) {
      if ((await this.#consumeSource(actor, source)) === false) {
        continue;
      }

      const roll = await this.#rollSource(source, actor);
      const rollTotal = Math.max(0, Math.floor(toNumber(roll?.total, 0)));
      bonusTotal += rollTotal;
      applied.push({
        id: source.id,
        label: source.label,
        formula: source.formula,
        rollTotal,
        sourceName: source.sourceName,
        itemUuid: source.item?.uuid ?? ""
      });
      await this.#postRollMessage(actor, source, roll, workflow);
    }

    if (!applied.length) {
      return true;
    }

    const newTotal = attackTotal + bonusTotal;
    this.#setAttackTotal(workflow, newTotal);
    const hitTargets = this.#applyHitUpdates(workflow, missedTargets, newTotal);
    for (const entry of applied) {
      entry.targetNames = hitTargets.map((target) => cleanText(target?.name ?? target?.actor?.name));
    }
    this.#recordWorkflowBoosts(workflow, applied, {
      attackTotal,
      newTotal,
      hitTargets
    });
    return true;
  }

  async applyDnd5eRollAttack(rolls, context = {}) {
    const attackRoll = collectionValues(rolls)[0] ?? rolls ?? null;
    if (attackRoll?.options?.workflow || attackRoll?.options?.midiOptions || context?.workflow) {
      return true;
    }
    if (attackRoll?.[CHECKED_WORKFLOW_FLAG]) {
      return true;
    }
    if (attackRoll) {
      attackRoll[CHECKED_WORKFLOW_FLAG] = true;
    }

    const subject = context?.subject ?? context?.activity ?? null;
    const actor = subject?.actor ?? subject?.item?.actor ?? context?.actor ?? context?.item?.actor ?? null;
    const item = subject?.item ?? context?.item ?? null;
    const targets = collectionValues(context?.targets).length
      ? collectionValues(context.targets)
      : collectionValues(globalThis.game?.user?.targets);

    if (!attackRoll || !actor || !targets.length) {
      return true;
    }

    return this.applyMidiHitsChecked({
      actor,
      item,
      activity: subject,
      attackRoll,
      attackTotal: toNumber(attackRoll?.total, NaN),
      isFumble: attackRoll?.isFumble === true,
      targets: new Set(targets),
      hitTargets: new Set(),
      hitTargetsEC: new Set(),
      hitDisplayData: {}
    });
  }

  async promptAttackRollBoosts(details) {
    if (typeof this._options.promptAttackRollBoosts === "function") {
      return this._options.promptAttackRollBoosts(details);
    }

    if (!this.#canPrompt(details?.actor)) {
      return [];
    }

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.input !== "function") {
      return [];
    }

    const content = this.#dialogContent(details);
    const selected = await DialogV2.input({
      window: { title: "Доброс к атаке" },
      content,
      ok: {
        label: "Добавить к броску",
        callback: (_event, button) => {
          const root = getDialogButtonForm(button);
          return Array.from(root?.querySelectorAll?.("[data-attack-roll-boost]:checked") ?? [])
            .map((input) => cleanText(input.value))
            .filter(Boolean);
        }
      },
      rejectClose: false,
      modal: true
    });
    return Array.isArray(selected) ? selected : [];
  }

  #isAttackWorkflow(workflow) {
    if (!workflow?.attackRoll) {
      return false;
    }

    const activity = workflow.activity ?? null;
    if (activity?.hasAttack === true || activity?.attack === true) {
      return true;
    }

    return ["weapon", "spell"].includes(cleanText(workflow.item?.type));
  }

  #attackTotal(workflow) {
    const directTotal = toNumber(workflow?.attackTotal, NaN);
    if (Number.isFinite(directTotal)) {
      return directTotal;
    }

    return toNumber(workflow?.attackRoll?.total, NaN);
  }

  #missedTargets(workflow, attackTotal) {
    return collectionValues(workflow?.targets)
      .map((target) => {
        if (!target || isTokenInSet(workflow.hitTargets, target) || isTokenInSet(workflow.hitTargetsEC, target)) {
          return null;
        }

        const ac = this.#targetAc(workflow, target);
        if (!Number.isFinite(ac) || attackTotal >= ac) {
          return null;
        }

        return {
          token: target,
          uuid: targetUuid(target),
          name: cleanText(target?.name ?? target?.actor?.name, "цель"),
          ac,
          needed: Math.max(1, Math.ceil(ac - attackTotal))
        };
      })
      .filter(Boolean);
  }

  #targetAc(workflow, target) {
    const uuid = targetUuid(target);
    const displayData = workflow?.hitDisplayData?.[uuid]
      ?? workflow?.hitDisplayData?.[target?.actor?.uuid]
      ?? workflow?.hitDisplayData?.[target?.id];
    const displayedAc = toNumber(displayData?.ac, NaN);
    if (Number.isFinite(displayedAc)) {
      return displayedAc;
    }

    return toNumber(target?.actor?.system?.attributes?.ac?.value, NaN);
  }

  async #availableSources(actor, workflow) {
    const sources = [];
    const seen = new Set();
    for (const item of collectionValues(actor?.items)) {
      for (const rawBoost of this.#itemBoostEntries(item)) {
        const source = await this.#normalizeSource(actor, item, rawBoost);
        if (!source || !this.#sourceMatchesWorkflow(source, workflow)) {
          continue;
        }

        const key = source.id;
        if (seen.has(key) || (source.consumption && !(await this.#hasConsumptionAvailable(actor, source)))) {
          continue;
        }

        seen.add(key);
        sources.push(source);
      }
    }
    return sources;
  }

  #itemBoostEntries(item) {
    const entries = [
      ...normalizeBoostEntries(getProperty(item, `flags.${MODULE_ID}.${ATTACK_ROLL_BOOST_FLAG}`)),
      ...normalizeBoostEntries(getProperty(item, `flags.${MODULE_ID}.attackRollBoost`)),
      ...normalizeBoostEntries(getProperty(item, `flags.${MODULE_ID}.fighterAutomation.attackRollBoost`))
    ];

    for (const activity of collectionValues(item?.system?.activities)) {
      entries.push(
        ...normalizeBoostEntries(getProperty(activity, `flags.${MODULE_ID}.${ATTACK_ROLL_BOOST_FLAG}`)),
        ...normalizeBoostEntries(getProperty(activity, `flags.${MODULE_ID}.attackRollBoost`)),
        ...normalizeBoostEntries(getProperty(activity, `flags.${MODULE_ID}.fighterAutomation.attackRollBoost`))
      );
    }
    entries.push(...this.#inferFighterManeuverBoostEntries(item));
    return entries;
  }

  #inferFighterManeuverBoostEntries(item) {
    if (!this.#isFighterManeuverItem(item)) {
      return [];
    }

    const classIdentifier = cleanText(getProperty(item, `flags.${MODULE_ID}.classIdentifier`), FIGHTER_CLASS_IDENTIFIER);
    const fighterAutomation = getFighterManeuverAutomation(item?.name, classIdentifier);
    return normalizeBoostEntries(fighterAutomation.attackRollBoost);
  }

  #isFighterManeuverItem(item) {
    if (cleanText(getProperty(item, `flags.${MODULE_ID}.sourceType`)) === "fighterManeuver") {
      return true;
    }

    if (cleanText(getProperty(item, `flags.${MODULE_ID}.automation.type`)) === "fighterManeuver") {
      return true;
    }

    if (cleanText(getProperty(item, "system.type.subtype")) === "fighterManeuver") {
      return true;
    }

    if (normalizeFighterAutomationKey(item?.name) === "точная атака") {
      return true;
    }

    return collectionValues(item?.system?.activities).some((activity) => (
      cleanText(getProperty(activity, `flags.${MODULE_ID}.automation`)) === "fighter-dominance-maneuver"
      || cleanText(getProperty(activity, `flags.${MODULE_ID}.fighterAutomation.kind`)) === "maneuver"
    ));
  }

  async #normalizeSource(actor, item, rawBoost) {
    const formula = cleanText(rawBoost?.formula);
    if (!formula) {
      return null;
    }

    const id = cleanText(rawBoost?.id, item?.id ?? item?.name);
    if (!id) {
      return null;
    }

    const maxTotal = await this.#maxFormulaTotal(formula, actor);
    if (!Number.isFinite(maxTotal) || maxTotal <= 0) {
      return null;
    }

    return {
      id,
      label: cleanText(rawBoost?.label, item?.name ?? id),
      sourceName: cleanText(item?.name, rawBoost?.label ?? id),
      formula,
      maxTotal,
      weaponOnly: rawBoost?.weaponOnly === true,
      attackTypes: Array.isArray(rawBoost?.attackTypes) ? rawBoost.attackTypes.map(cleanText).filter(Boolean) : [],
      consumption: rawBoost?.consumption && typeof rawBoost.consumption === "object"
        ? { ...rawBoost.consumption }
        : null,
      item
    };
  }

  #sourceMatchesWorkflow(source, workflow) {
    const actionType = cleanText(workflow?.activity?.actionType);
    if (source.weaponOnly && !WEAPON_ATTACK_TYPES.has(actionType) && cleanText(workflow?.item?.type) !== "weapon") {
      return false;
    }

    if (source.attackTypes.length && !source.attackTypes.includes(actionType)) {
      return false;
    }

    return true;
  }

  async #maxFormulaTotal(formula, actor) {
    const parsed = parseMaxFormulaTotal(formula);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    const resolvedFormula = this.#resolveScaleFormula(formula, actor);
    if (resolvedFormula !== cleanText(formula)) {
      const resolvedMax = parseMaxFormulaTotal(resolvedFormula);
      if (Number.isFinite(resolvedMax)) {
        return resolvedMax;
      }
    }

    try {
      const roll = this.#createRoll(resolvedFormula, actor);
      if (typeof roll?.evaluate === "function") {
        await roll.evaluate({ maximize: true, async: true });
      }
      else if (typeof roll?.roll === "function") {
        await roll.roll({ maximize: true, async: true });
      }
      return toNumber(roll?.total, NaN);
    }
    catch (_error) {
      return NaN;
    }
  }

  #resolveScaleFormula(formula, actor) {
    const text = cleanText(formula);
    if (!text.includes("@scale.")) {
      return text;
    }

    return text.replace(SCALE_REFERENCE_PATTERN, (match, classIdentifier, scaleIdentifier) => {
      const scaleFormula = this.#scaleReferenceFormula(actor, classIdentifier, scaleIdentifier);
      return scaleFormula || match;
    });
  }

  #scaleReferenceFormula(actor, classIdentifier, scaleIdentifier) {
    const classKey = cleanText(classIdentifier);
    const scaleKey = cleanText(scaleIdentifier);
    if (!classKey || !scaleKey) {
      return "";
    }

    const candidates = [
      getProperty(actor, `system.scale.${classKey}.${scaleKey}`)
    ];

    for (const options of [{ deterministic: true }, undefined]) {
      try {
        const rollData = typeof actor?.getRollData === "function"
          ? actor.getRollData(options)
          : null;
        candidates.push(getProperty(rollData, `scale.${classKey}.${scaleKey}`));
      }
      catch (_error) {
        // Some actor implementations do not accept deterministic roll-data options.
      }
    }

    for (const item of collectionValues(actor?.items)) {
      const itemIdentifier = cleanText(item?.identifier ?? item?.system?.identifier);
      if (itemIdentifier !== classKey) {
        continue;
      }

      candidates.push(
        getProperty(item, `scaleValues.${scaleKey}`),
        getProperty(item, `system.scale.${scaleKey}`)
      );
    }

    for (const candidate of candidates) {
      const scaleFormula = scaleValueToFormula(candidate);
      if (scaleFormula) {
        return scaleFormula;
      }
    }

    return this.#fallbackScaleFormula(actor, classKey, scaleKey);
  }

  #fallbackScaleFormula(actor, classIdentifier, scaleIdentifier) {
    if (classIdentifier !== FIGHTER_CLASS_IDENTIFIER) {
      return "";
    }

    const level = this.#actorClassLevel(actor, classIdentifier);
    if (scaleIdentifier === "dominance-die") {
      return progressionFormulaForLevel(FIGHTER_DOMINANCE_DIE_PROGRESSION, level);
    }

    if (scaleIdentifier === "dominance-dice") {
      return progressionFormulaForLevel(FIGHTER_DOMINANCE_DICE_PROGRESSION, level);
    }

    return "";
  }

  #actorClassLevel(actor, classIdentifier) {
    const classItem = collectionValues(actor?.items).find((item) => (
      cleanText(item?.type) === "class"
      && cleanText(item?.identifier ?? item?.system?.identifier) === classIdentifier
    ));
    const classLevel = toNumber(classItem?.system?.levels, NaN);
    if (Number.isFinite(classLevel) && classLevel > 0) {
      return classLevel;
    }

    const actorLevel = toNumber(actor?.system?.details?.level, NaN);
    if (Number.isFinite(actorLevel) && actorLevel > 0) {
      return actorLevel;
    }

    return 1;
  }

  #normalizeSelectedIds(selection) {
    if (selection instanceof Set) {
      return new Set(Array.from(selection).map(cleanText).filter(Boolean));
    }

    if (Array.isArray(selection)) {
      return new Set(selection.map(cleanText).filter(Boolean));
    }

    if (selection && typeof selection === "object" && Array.isArray(selection.selectedIds)) {
      return new Set(selection.selectedIds.map(cleanText).filter(Boolean));
    }

    const single = cleanText(selection);
    return single ? new Set([single]) : new Set();
  }

  async #rollSource(source, actor) {
    const roll = this.#createRoll(source.formula, actor);
    if (typeof roll?.evaluate === "function") {
      return roll.evaluate({ async: true });
    }

    if (typeof roll?.roll === "function") {
      return roll.roll({ async: true });
    }

    return roll;
  }

  #createRoll(formula, actor) {
    const rollFormula = this.#resolveScaleFormula(formula, actor);
    if (typeof this._options.rollFactory === "function") {
      return this._options.rollFactory(rollFormula, actor);
    }

    return new Roll(rollFormula || "0", actor?.getRollData?.() ?? {});
  }

  async #postRollMessage(actor, source, roll, workflow) {
    if (typeof roll?.toMessage !== "function") {
      return false;
    }

    await roll.toMessage({
      speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? {},
      flavor: `${cleanText(source.label)}: доброс к атаке ${cleanText(workflow?.item?.name)}`
    });
    return true;
  }

  #setAttackTotal(workflow, total) {
    workflow.attackTotal = total;
    if (workflow.attackRoll) {
      try {
        workflow.attackRoll._total = total;
      }
      catch (_error) {
        // Some roll implementations expose total as read-only.
      }
      try {
        workflow.attackRoll.total = total;
      }
      catch (_error) {
        // Some roll implementations expose total as read-only.
      }
      setProperty(workflow.attackRoll, `flags.${MODULE_ID}.attackRollBoostTotal`, total);
    }
  }

  #applyHitUpdates(workflow, missedTargets, newTotal) {
    const hitTargets = [];
    workflow.hitTargets ??= new Set();
    workflow.hitTargetsEC ??= new Set();

    for (const targetEntry of missedTargets) {
      const isHit = newTotal >= targetEntry.ac;
      if (isHit) {
        workflow.hitTargets.add(targetEntry.token);
        workflow.hitTargetsEC.delete?.(targetEntry.token);
        hitTargets.push(targetEntry.token);
      }
      this.#updateHitDisplayData(workflow, targetEntry, newTotal, isHit);
    }

    return hitTargets;
  }

  #updateHitDisplayData(workflow, targetEntry, attackTotal, isHit) {
    const displayData = workflow?.hitDisplayData?.[targetEntry.uuid];
    if (!displayData) {
      return;
    }

    displayData.attackTotal = attackTotal;
    displayData.hitResultNumeric = `${attackTotal}/${Math.abs(attackTotal - targetEntry.ac)}`;
    displayData.isHit = isHit;
    displayData.hitClass = isHit ? "success" : "failure";
    displayData.hitStyle = isHit ? "color: green;" : "color: red;";
    displayData.hitSymbol = isHit ? "fa-tick" : "fa-xmark";
  }

  #recordWorkflowBoosts(workflow, applied, result) {
    const records = applied.map((entry) => ({
      ...entry,
      attackTotalBefore: result.attackTotal,
      attackTotalAfter: result.newTotal
    }));
    workflow.rebreyaAttackRollBoosts = records;
    workflow.flags ??= {};
    setProperty(workflow, `flags.${MODULE_ID}.${ATTACK_ROLL_BOOST_FLAG}`, records);
  }

  async #hasConsumptionAvailable(actor, source) {
    const consumption = source?.consumption;
    if (!consumption) {
      return true;
    }

    if (cleanText(consumption.type) !== "itemUses") {
      return false;
    }

    const item = this.#findConsumptionItem(actor, consumption.target);
    if (!item) {
      return false;
    }

    const amount = Math.max(1, Math.floor(toNumber(consumption.value, 1)));
    const spent = Math.max(0, Math.floor(toNumber(item?.system?.uses?.spent, 0)));
    const max = await this.#resolveUsesMax(item, actor);
    return !Number.isFinite(max) || spent + amount <= max;
  }

  async #consumeSource(actor, source) {
    const consumption = source?.consumption;
    if (!consumption) {
      return true;
    }

    if (cleanText(consumption.type) !== "itemUses") {
      return false;
    }

    const item = this.#findConsumptionItem(actor, consumption.target);
    if (!item) {
      globalThis.ui?.notifications?.warn(`${cleanText(source.label)}: не найден ресурс для расхода.`);
      return false;
    }

    const amount = Math.max(1, Math.floor(toNumber(consumption.value, 1)));
    const spent = Math.max(0, Math.floor(toNumber(item?.system?.uses?.spent, 0)));
    const max = await this.#resolveUsesMax(item, actor);
    if (Number.isFinite(max) && spent + amount > max) {
      globalThis.ui?.notifications?.warn(`${cleanText(source.label)}: ресурс уже израсходован.`);
      return false;
    }

    if (typeof item.update === "function") {
      await item.update({ "system.uses.spent": spent + amount });
    }
    else {
      setProperty(item, "system.uses.spent", spent + amount);
    }
    return true;
  }

  #findConsumptionItem(actor, target) {
    const targetText = cleanText(target);
    if (!targetText) {
      return null;
    }

    return collectionValues(actor?.items).find((item) => {
      if (
        targetText === FIGHTER_DOMINANCE_FEATURE_ID
        && normalizeFighterAutomationKey(item?.name) === "стиль доминирования"
      ) {
        return true;
      }

      const identifiers = [
        item?.id,
        item?._id,
        item?.uuid,
        item?.system?.identifier,
        getProperty(item, `flags.${MODULE_ID}.featureId`)
      ].map(cleanText);
      return identifiers.some((identifier) => identifier === targetText || identifier.endsWith(`::${targetText}`));
    }) ?? null;
  }

  async #resolveUsesMax(item, actor) {
    const rawMax = item?.system?.uses?.max;
    const numericMax = toNumber(rawMax, NaN);
    if (Number.isFinite(numericMax)) {
      return numericMax;
    }

    if (!cleanText(rawMax)) {
      return Infinity;
    }

    try {
      const roll = this.#createRoll(rawMax, actor);
      if (typeof roll?.evaluate === "function") {
        await roll.evaluate({ async: true });
      }
      else if (typeof roll?.roll === "function") {
        await roll.roll({ async: true });
      }
      const rollTotal = toNumber(roll?.total, NaN);
      return Number.isFinite(rollTotal) ? rollTotal : Infinity;
    }
    catch (_error) {
      return Infinity;
    }
  }

  #dialogContent(details) {
    const options = details.options.map((option) => `
      <label class="rebreya-attack-roll-boost-option" style="display: grid; grid-template-columns: auto 1fr; gap: 0.5rem; align-items: start; padding: 0.45rem; border: 1px solid var(--color-border-light-tertiary); border-radius: 4px;">
        <input type="checkbox" name="attackRollBoost" value="${escapeHtml(option.id)}" data-attack-roll-boost>
        <span>
          <strong>${escapeHtml(option.label)}</strong>
          <span style="display: block; margin-top: 0.2rem;">${escapeHtml(option.formula)}${option.sourceName ? ` · ${escapeHtml(option.sourceName)}` : ""}</span>
        </span>
      </label>
    `).join("");

    return `
      <form>
        <p>Бросок атаки <strong>${escapeHtml(details.attackTotal)}</strong> не пробивает КД ${escapeHtml(details.target?.ac)} цели <strong>${escapeHtml(details.target?.name)}</strong>. Нужно минимум +${escapeHtml(details.needed)}.</p>
        <div class="rebreya-attack-roll-boost-options" style="display: grid; gap: 0.5rem; max-height: min(24rem, 50vh); overflow-y: auto; overscroll-behavior: contain; padding-right: 0.25rem;">
          ${options}
        </div>
      </form>
    `;
  }

  #canPrompt(actor) {
    return Boolean(globalThis.game?.user?.isGM || actor?.isOwner);
  }
}
