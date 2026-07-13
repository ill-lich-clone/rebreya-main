import { MODULE_ID } from "../constants.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_EVENT_RACE_AUTOMATION = "race-automation";

const EFFECT_MODE_ADD = 2;
const EFFECT_MODE_UPGRADE = 4;
const EFFECT_MODE_OVERRIDE = 5;

const RACE_AUTOMATION_FLAG = "automation";
const RACE_ACTIVITY_RUNTIME_FLAG = "runtime";

const DAMAGE_REDUCTION_FLAG = `flags.${MODULE_ID}.raceAutomation`;

const SIZE_ORDER = {
  tiny: 0,
  sm: 1,
  med: 2,
  lg: 3,
  huge: 4,
  grg: 5
};

function getSocketUser(senderId) {
  const safeSenderId = cleanText(senderId);
  if (!safeSenderId) {
    return null;
  }

  return game.users?.get?.(safeSenderId)
    ?? game.users?.contents?.find?.((user) => user?.id === safeSenderId)
    ?? null;
}

function canProcessRaceAutomationSocket(senderId) {
  if (!game.user?.isGM) {
    return false;
  }

  const sender = getSocketUser(senderId);
  return sender?.isGM === true;
}

function getDialogRoot(html) {
  if (html instanceof HTMLElement) {
    return html;
  }

  if (html?.[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || String(fallback ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getProperty(source, path, fallback = undefined) {
  const value = foundry.utils.getProperty(source, path);
  return value === undefined ? fallback : value;
}

function setProperty(source, path, value) {
  foundry.utils.setProperty(source, path, value);
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(cleanText(value));
}

function actorProficiency(actor) {
  return toNumber(actor?.system?.attributes?.prof, 0);
}

function actorLevel(actor) {
  const classes = Object.values(actor?.system?.classes ?? {});
  const classLevels = classes.reduce((sum, cls) => sum + toNumber(cls?.levels, 0), 0);
  return Math.max(1, toNumber(actor?.system?.details?.level, classLevels || 1));
}

function featureAutomation(item) {
  return item?.getFlag?.(MODULE_ID, RACE_AUTOMATION_FLAG) ?? null;
}

function activityRuntime(activity) {
  return activity?.getFlag?.(MODULE_ID, RACE_ACTIVITY_RUNTIME_FLAG)
    ?? activity?.flags?.[MODULE_ID]?.[RACE_ACTIVITY_RUNTIME_FLAG]
    ?? getProperty(activity, `flags.${MODULE_ID}.${RACE_ACTIVITY_RUNTIME_FLAG}`, null);
}

function isRaceFeatureItem(item) {
  const automation = featureAutomation(item);
  return item?.type === "feat" && automation && typeof automation === "object";
}

function hasMechanic(item, mechanic) {
  const mechanics = featureAutomation(item)?.mechanics ?? [];
  return Array.isArray(mechanics) && mechanics.includes(mechanic);
}

function createFormulaRoll(formula, actor) {
  return new Roll(cleanText(formula) || "0", actor?.getRollData?.() ?? {});
}

function extractD20(rolls) {
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  const die = roll?.dice?.find((entry) => Number(entry.faces) === 20);
  const active = die?.results?.find((result) => result.active !== false);
  return {
    roll,
    result: Number(active?.result ?? NaN)
  };
}

function isRangedWeaponItem(item) {
  if (!item || item.type !== "weapon") {
    return false;
  }

  const actionType = cleanText(item.system?.actionType);
  if (["rwak", "rsak"].includes(actionType)) {
    return true;
  }

  const type = cleanText(item.system?.type?.value).toLowerCase();
  const classification = cleanText(item.system?.type?.subtype).toLowerCase();
  return type.includes("ranged") || type.includes("firearm") || classification.includes("firearm");
}

function damageTypesFromOptions(options = {}) {
  const types = new Set();
  const addType = (value) => {
    const text = cleanText(value).toLowerCase();
    if (text) {
      types.add(text);
    }
  };

  addType(options.type);
  addType(options.damageType);
  addType(options.midi?.damageType);

  for (const part of options.damage ?? []) {
    addType(part?.type);
    for (const type of part?.types ?? []) {
      addType(type);
    }
  }

  for (const detail of options.midi?.damageDetail ?? []) {
    addType(detail?.type);
    for (const type of detail?.types ?? []) {
      addType(type);
    }
  }

  return types;
}

function resolveUuidSync(uuid) {
  if (!uuid) {
    return null;
  }

  try {
    return fromUuidSync(uuid);
  }
  catch (error) {
    return null;
  }
}

function resolveActorFromTarget(target) {
  if (target instanceof Actor) {
    return target;
  }

  return target?.actor ?? target?.document?.actor ?? null;
}

function resolveTokenFromActor(actor) {
  return actor?.getActiveTokens?.(true, true)?.[0] ?? actor?.getActiveTokens?.()[0] ?? null;
}

function resolveTokenFromTarget(target) {
  if (!target) {
    return null;
  }

  if (target instanceof Actor) {
    return resolveTokenFromActor(target);
  }

  return target.object
    ?? target.document?.object
    ?? target.token
    ?? (target.actor || target.document?.actor ? target : null)
    ?? resolveTokenFromActor(resolveActorFromTarget(target));
}

function resolveSourceTokenFromWorkflow(workflow, actor) {
  return workflow?.token?.object
    ?? workflow?.token
    ?? workflow?.tokenDocument?.object
    ?? workflow?.tokenDocument
    ?? resolveTokenFromActor(actor);
}

function speakerForActor(actor) {
  return ChatMessage.getSpeaker({ actor });
}

function targetListFromWorkflow(workflow) {
  const targets = Array.from(workflow?.hitTargets ?? workflow?.targets ?? []);
  if (targets.length) {
    return targets;
  }

  return Array.from(game.user?.targets ?? []);
}

function defaultDamageTypeFromWorkflow(workflow, fallback = "") {
  const parts = workflow?.damageDetail ?? workflow?.damageRolls?.flatMap((roll) => roll?.terms ?? []) ?? [];
  for (const part of parts) {
    const type = cleanText(part?.options?.flavor ?? part?.options?.type).toLowerCase();
    if (type) {
      return type;
    }
  }

  return fallback;
}

function isActorLarger(targetActor, sourceActor) {
  const targetSize = SIZE_ORDER[targetActor?.system?.traits?.size] ?? 2;
  const sourceSize = SIZE_ORDER[sourceActor?.system?.traits?.size] ?? 2;
  return targetSize > sourceSize;
}

function isTargetUnactedThisCombat(target) {
  const combat = game.combat;
  const tokenId = target?.id ?? target?.document?.id;
  if (!combat || !tokenId) {
    return true;
  }

  const combatant = combat.combatants.find((entry) => entry.tokenId === tokenId || entry.token?.id === tokenId);
  if (!combatant) {
    return true;
  }

  const currentIndex = combat.turn ?? 0;
  const targetIndex = combat.turns.findIndex((entry) => entry.id === combatant.id);
  return combat.round <= 1 && (targetIndex < 0 || targetIndex > currentIndex);
}

function tokenDistanceFeet(left, right) {
  if (!left || !right) {
    return Infinity;
  }

  try {
    if (canvas?.grid?.measureDistance) {
      return canvas.grid.measureDistance(left, right);
    }
  }
  catch (error) {
    // Fallback below.
  }

  const size = canvas?.dimensions?.size || 100;
  const distance = canvas?.dimensions?.distance || 5;
  const dx = (left.center?.x ?? left.x ?? 0) - (right.center?.x ?? right.x ?? 0);
  const dy = (left.center?.y ?? left.y ?? 0) - (right.center?.y ?? right.y ?? 0);
  return (Math.hypot(dx, dy) / size) * distance;
}

function tokenDisposition(token) {
  return token?.document?.disposition ?? token?.disposition ?? 0;
}

function isHostile(left, right) {
  const leftDisposition = tokenDisposition(left);
  const rightDisposition = tokenDisposition(right);
  if (!leftDisposition || !rightDisposition) {
    return false;
  }

  return leftDisposition !== rightDisposition;
}

function isHealingWorkflow(workflow) {
  const typeHints = [
    workflow?.activity?.type,
    workflow?.activity?.actionType,
    workflow?.activity?.system?.actionType,
    workflow?.item?.system?.actionType,
    workflow?.damageType,
    workflow?.defaultDamageType
  ].map((entry) => cleanText(entry).toLowerCase());
  if (typeHints.some((entry) => entry === "heal" || entry === "healing")) {
    return true;
  }

  const healingRollCount = workflow?.healingRolls?.length ?? workflow?.healingRolls?.size ?? 0;
  if (workflow?.healingRoll || healingRollCount > 0) {
    return true;
  }

  const detailRows = [
    ...(Array.isArray(workflow?.damageDetail) ? workflow.damageDetail : []),
    ...(Array.isArray(workflow?.damageList) ? workflow.damageList : [])
  ];
  return detailRows.some((row) => {
    const type = cleanText(row?.type ?? row?.damageType).toLowerCase();
    if (type === "healing") {
      return true;
    }

    const types = Array.isArray(row?.types) ? row.types : [row?.types];
    return types.some((entry) => cleanText(entry).toLowerCase() === "healing");
  });
}

function activeEffectData(name, changes = [], options = {}) {
  const statusId = cleanText(options.statusId);
  const flags = {
    [MODULE_ID]: {
      managed: true,
      automation: "race-runtime-effect",
      source: cleanText(options.source)
    }
  };

  if (statusId) {
    flags.core = { statusId };
  }

  if (options.specialDuration) {
    flags.dae = {
      specialDuration: Array.isArray(options.specialDuration) ? options.specialDuration : [options.specialDuration]
    };
  }

  return {
    name,
    type: "base",
    img: cleanText(options.img, "icons/svg/aura.svg"),
    origin: cleanText(options.origin),
    disabled: false,
    duration: {
      seconds: options.seconds ?? null,
      rounds: options.rounds ?? null,
      turns: options.turns ?? null,
      startRound: null,
      startTurn: null,
      combat: null,
      startTime: null
    },
    transfer: options.transfer === true,
    statuses: statusId ? [statusId] : [],
    changes,
    flags,
    description: cleanText(options.description)
  };
}

export class RaceAutomationService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this._turnDamageKeys = new Set();
  }

  async initialize() {
    return true;
  }

  async handleSocketMessage(payload = {}, { senderId = "" } = {}) {
    if (!canProcessRaceAutomationSocket(senderId)) {
      return false;
    }

    const action = cleanText(payload.action);
    if (action === "applyTargetDamage") {
      const actor = resolveUuidSync(payload.actorUuid);
      const sourceActor = resolveUuidSync(payload.sourceActorUuid);
      await this.#applyDamage(actor, payload.formula, payload.damageType, {
        sourceActor,
        sourceItemUuid: payload.sourceItemUuid,
        label: payload.label
      });
      return true;
    }

    if (action === "createActorEffect") {
      const actor = resolveUuidSync(payload.actorUuid);
      if (actor instanceof Actor && payload.effect) {
        await this.#createEffect(actor, payload.effect);
      }
      return true;
    }

    if (action === "healActor") {
      const actor = resolveUuidSync(payload.actorUuid);
      await this.#healActor(actor, payload.formula, { label: payload.label });
      return true;
    }

    return false;
  }

  applyDnd5eAttackRollConfig(rollConfig, dialogConfig, messageConfig) {
    const activity = rollConfig?.subject;
    const actor = activity?.actor ?? activity?.item?.actor ?? rollConfig?.actor;
    if (!(actor instanceof Actor) || !this.#hasMechanic(actor, "conditional-attack-advantage")) {
      return true;
    }

    const target = Array.from(game.user?.targets ?? [])[0];
    if (!target || !this.#targetHasAdjacentAlly(actor, target)) {
      return true;
    }

    for (const roll of rollConfig.rolls ?? [rollConfig]) {
      roll.advantage = true;
      roll.options ??= {};
      roll.options.advantage = true;
    }

    const note = "Тактика стаи: цель имеет союзника атакующего в 5 футах, атака получает преимущество.";
    messageConfig.data ??= {};
    messageConfig.data.flavor = [messageConfig.data.flavor, note].filter(Boolean).join("<br>");
    return true;
  }

  async applyDnd5ePostUseActivity(activity, usageConfig, results) {
    const actor = activity?.actor ?? activity?.item?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const runtime = activityRuntime(activity) ?? {};
    const action = cleanText(runtime.action);

    if (action === "applyItemEffects") {
      await this.#applyLinkedActivityEffects(activity, actor);
      return true;
    }

    if (action === "promptCustomEffect") {
      await this.#promptAndApplyCustomEffect(actor, activity?.item, runtime);
      return true;
    }

    if (action === "chooseElementalAwakening") {
      await this.#chooseElementalAwakening(actor, activity?.item);
      return true;
    }

    if (action === "chooseDemonicSpellcasting") {
      await this.#chooseDemonicSpellcasting(actor, activity?.item);
      return true;
    }

    if (action === "ignoreHostileSpaces") {
      await this.#createEffect(actor, activeEffectData("Ловкие движения", [{
        key: `${DAMAGE_REDUCTION_FLAG}.ignoreHostileMovementBlocks`,
        mode: EFFECT_MODE_OVERRIDE,
        value: "1",
        priority: 20
      }], {
        origin: activity?.item?.uuid,
        rounds: 1,
        specialDuration: "turnEndSource",
        description: "До конца хода вражеские пространства не блокируют перемещение."
      }));
      return true;
    }

    const effectCount = activity?.effects?.size ?? activity?.effects?.length ?? 0;
    if (activity?.item && isRaceFeatureItem(activity.item) && activity.type === "utility" && effectCount) {
      await this.#applyLinkedActivityEffects(activity, actor);
    }

    return true;
  }

  applyDnd5ePreApplyDamage(actor, amount, updates, options = {}) {
    if (!(actor instanceof Actor) || amount <= 0) {
      return true;
    }

    const reduction = this.#damageReduction(actor, amount, options);
    if (reduction <= 0) {
      return true;
    }

    const hp = actor.system?.attributes?.hp;
    if (!hp) {
      return true;
    }

    const finalAmount = Math.max(0, amount - reduction);
    const deltaTemp = finalAmount > 0 ? Math.min(toNumber(hp.temp, 0), finalAmount) : 0;
    const deltaHP = clamp(finalAmount - deltaTemp, -toNumber(hp.damage, 0), toNumber(hp.value, 0));
    updates["system.attributes.hp.temp"] = toNumber(hp.temp, 0) - deltaTemp;
    updates["system.attributes.hp.value"] = toNumber(hp.value, 0) - deltaHP;

    this.#postChat(actor, "Расовое уменьшение урона", `${actor.name}: входящий урон уменьшен на ${reduction}.`);
    return true;
  }

  async applyDnd5eApplyDamage(actor, amount, options = {}) {
    if (!(actor instanceof Actor) || amount <= 0) {
      return true;
    }

    await this.#handleRelentlessEndurance(actor);
    return true;
  }

  async handleSkillRoll(rolls, context) {
    await this.#handleRollAftermath(rolls, context, "skill");
  }

  async handleToolRoll(rolls, context) {
    await this.#handleRollAftermath(rolls, context, "tool");
  }

  async handleAbilityCheckRoll(rolls, context) {
    await this.#handleRollAftermath(rolls, context, "ability");
  }

  async handleSavingThrowRoll(rolls, context) {
    await this.#handleRollAftermath(rolls, context, "save");
  }

  async handleRestCompleted(actor, result, config) {
    if (!(actor instanceof Actor) || result?.type !== "long") {
      return true;
    }

    if (this.#hasMechanic(actor, "proficiency-swap")) {
      await this.#promptSkillProficiencySwap(actor);
    }

    if (this.#hasMechanic(actor, "spell-slot-scaling")) {
      await this.#restoreHighElfSpellSlot(actor);
    }

    return true;
  }

  applyDnd5ePreLongRest(actor, config) {
    if (!(actor instanceof Actor)) {
      return true;
    }

    if (this.#hasMechanic(actor, "rest-rules")) {
      if (this.#hasRuntimeFlag(actor, "tranceRest")) {
        config.duration = Math.min(toNumber(config.duration, 480), 240);
      }
      if (this.#hasRuntimeFlag(actor, "sentryRest")) {
        config.duration = Math.min(toNumber(config.duration, 480), 360);
      }
    }

    return true;
  }

  async applyMidiRollComplete(workflow) {
    const actor = workflow?.actor;
    if (!(actor instanceof Actor)) {
      return true;
    }

    const hitTargets = targetListFromWorkflow(workflow);
    if (!hitTargets.length) {
      return true;
    }

    await this.#handleKeenEye(actor, workflow, hitTargets);
    await this.#handleFuryOfTheSmall(actor, workflow, hitTargets);
    await this.#handleSurpriseAttack(actor, workflow, hitTargets);
    await this.#handleCelestialDamage(actor, workflow, hitTargets);
    return true;
  }

  handleMovementBlocking(gridSpace, token, options, found) {
    const actor = token?.actor;
    if (!(actor instanceof Actor)) {
      return;
    }

    if (!this.#hasRuntimeFlag(actor, "ignoreHostileMovementBlocks")) {
      return;
    }

    for (const blocker of Array.from(found ?? [])) {
      if (isHostile(token, blocker)) {
        found.delete(blocker);
      }
    }
  }

  handleCombatTurnChange(combat) {
    const round = combat?.round ?? 0;
    const turn = combat?.turn ?? 0;
    this._turnDamageKeys = new Set(Array.from(this._turnDamageKeys).filter((key) => key.startsWith(`${round}:${turn}:`)));
  }

  async #handleRollAftermath(rolls, context, kind) {
    const actor = context?.subject ?? context?.actor;
    if (!(actor instanceof Actor)) {
      return;
    }

    await this.#maybePostLuckyReroll(actor, rolls, kind);
  }

  async #maybePostLuckyReroll(actor, rolls, kind) {
    if (!this.#hasMechanic(actor, "d20-reroll")) {
      return false;
    }

    const { roll, result } = extractD20(rolls);
    if (result !== 1 || !roll || !this.#canPrompt(actor)) {
      return false;
    }

    const confirmed = await this.#confirm(actor, "Везучий", "На d20 выпала 1. Перебросить по расовой черте?");
    if (!confirmed) {
      return false;
    }

    const modifier = toNumber(roll.total, result) - result;
    const reroll = await new Roll(`1d20 + ${modifier}`, actor.getRollData?.() ?? {}).evaluate();
    await reroll.toMessage({
      speaker: speakerForActor(actor),
      flavor: `Везучий: переброс d20 (${kind})`
    });
    return true;
  }

  async #handleRelentlessEndurance(actor) {
    if (toNumber(actor.system?.attributes?.hp?.value, 0) > 0) {
      return false;
    }

    const feature = this.#findFeature(actor, "zero-hp-recovery");
    if (!feature || !this.#canPrompt(actor)) {
      return false;
    }

    const confirmed = await this.#confirm(
      actor,
      "Непоколебимая стойкость",
      "Персонаж упал до 0 хитов. Использовать расовую черту и восстановить хиты?"
    );
    if (!confirmed) {
      return false;
    }

    const consumed = await this.#consumeFeatureUse(feature);
    if (!consumed) {
      return false;
    }

    const healAmount = Math.max(1, actorLevel(actor) * 2);
    await actor.update({ "system.attributes.hp.value": healAmount });
    await this.#postChat(actor, "Непоколебимая стойкость", `${actor.name} восстанавливает ${healAmount} хитов.`);
    return true;
  }

  async #handleKeenEye(actor, workflow, hitTargets) {
    if (!this.#hasMechanic(actor, "keen-eye-damage")) {
      return false;
    }

    if (!this.#workflowIsRangedAttack(workflow)) {
      return false;
    }

    const key = this.#turnKey(actor, "keen-eye");
    if (this._turnDamageKeys.has(key) || !this.#canPrompt(actor)) {
      return false;
    }

    const feature = this.#findFeature(actor, "keen-eye-damage");
    if (!feature) {
      return false;
    }

    const confirmed = await this.#confirm(actor, "Зоркий глаз", "Добавить расовый урон к попаданию дальнобойной атакой?");
    if (!confirmed || !(await this.#consumeFeatureUse(feature))) {
      return false;
    }

    this._turnDamageKeys.add(key);
    const target = resolveActorFromTarget(hitTargets[0]);
    await this.#applyDamage(target, "@prof", defaultDamageTypeFromWorkflow(workflow), {
      sourceActor: actor,
      sourceItemUuid: feature.uuid,
      label: "Зоркий глаз"
    });
    return true;
  }

  async #handleFuryOfTheSmall(actor, workflow, hitTargets) {
    if (!this.#hasMechanic(actor, "fury-small")) {
      return false;
    }

    if (isHealingWorkflow(workflow)) {
      return false;
    }

    const sourceToken = resolveSourceTokenFromWorkflow(workflow, actor);
    const targetToken = hitTargets.find((entry) => (
      isActorLarger(resolveActorFromTarget(entry), actor)
      && isHostile(sourceToken, resolveTokenFromTarget(entry))
    ));
    const target = resolveActorFromTarget(targetToken);
    if (!(target instanceof Actor)) {
      return false;
    }

    const key = this.#turnKey(actor, "fury-small");
    if (this._turnDamageKeys.has(key) || !this.#canPrompt(actor)) {
      return false;
    }

    const feature = this.#findFeature(actor, "fury-small");
    const confirmed = await this.#confirm(actor, "Ярость мелкого", `Добавить ${actorProficiency(actor) * 2} урона цели большего размера?`);
    if (!confirmed || !(await this.#consumeFeatureUse(feature))) {
      return false;
    }

    this._turnDamageKeys.add(key);
    await this.#applyDamage(target, "2 * @prof", defaultDamageTypeFromWorkflow(workflow), {
      sourceActor: actor,
      sourceItemUuid: feature?.uuid,
      label: "Ярость мелкого"
    });
    return true;
  }

  async #handleSurpriseAttack(actor, workflow, hitTargets) {
    if (!this.#hasMechanic(actor, "surprise-attack")) {
      return false;
    }

    const targetToken = hitTargets.find((entry) => isTargetUnactedThisCombat(entry));
    const target = resolveActorFromTarget(targetToken);
    if (!(target instanceof Actor) || this.#targetHasSurpriseImmunity(target, actor)) {
      return false;
    }

    const key = this.#turnKey(actor, "surprise-attack");
    if (this._turnDamageKeys.has(key) || !this.#canPrompt(actor)) {
      return false;
    }

    const confirmed = await this.#confirm(actor, "Внезапность", "Цель ещё не ходила в этом бою. Добавить 2d6 урона и выдать иммунитет на 1 минуту?");
    if (!confirmed) {
      return false;
    }

    this._turnDamageKeys.add(key);
    await this.#applyDamage(target, "2d6", defaultDamageTypeFromWorkflow(workflow), {
      sourceActor: actor,
      label: "Внезапность"
    });
    await this.#createEffect(target, activeEffectData("Иммунитет к Внезапности", [{
      key: `${DAMAGE_REDUCTION_FLAG}.surpriseAttackImmunity.${actor.id}`,
      mode: EFFECT_MODE_OVERRIDE,
      value: "1",
      priority: 20
    }], {
      seconds: 60,
      description: `Иммунитет к Внезапности от ${actor.name} на 1 минуту.`
    }));
    return true;
  }

  async #handleCelestialDamage(actor, workflow, hitTargets) {
    if (!this.#hasRuntimeFlag(actor, "celestialRevelationDamage")) {
      return false;
    }

    const key = this.#turnKey(actor, "celestial-revelation");
    if (this._turnDamageKeys.has(key) || !this.#canPrompt(actor)) {
      return false;
    }

    const confirmed = await this.#confirm(actor, "Небесное откровение", `Добавить ${actorLevel(actor)} урона излучением к попаданию?`);
    if (!confirmed) {
      return false;
    }

    this._turnDamageKeys.add(key);
    await this.#applyDamage(resolveActorFromTarget(hitTargets[0]), "@details.level", "radiant", {
      sourceActor: actor,
      label: "Небесное откровение"
    });
    return true;
  }

  #damageReduction(actor, amount, options) {
    let reduction = 0;

    if (this.#hasMechanic(actor, "damage-reduction")) {
      reduction += actorProficiency(actor);
    }

    if (this.#hasMechanic(actor, "conditional-damage-reduction") && this.#isStoneSkinDamage(options)) {
      reduction += actorProficiency(actor);
    }

    return Math.min(amount, reduction);
  }

  #isStoneSkinDamage(options = {}) {
    const sourceItem = resolveUuidSync(options.sourceItemUuid ?? options.itemUuid ?? options.midi?.itemUuid);
    const types = damageTypesFromOptions(options);
    const isPhysical = !types.size || types.has("piercing") || types.has("slashing");
    return isPhysical && isRangedWeaponItem(sourceItem);
  }

  #workflowIsRangedAttack(workflow) {
    const item = workflow?.item;
    if (isRangedWeaponItem(item)) {
      return true;
    }

    const actionType = cleanText(workflow?.activity?.actionType ?? workflow?.activity?.system?.actionType);
    return ["rwak", "rsak"].includes(actionType);
  }

  #targetHasAdjacentAlly(actor, target) {
    const targetToken = target?.object ?? target;
    const sourceToken = resolveTokenFromActor(actor);
    if (!sourceToken || !targetToken || !canvas?.tokens?.placeables?.length) {
      return false;
    }

    const sourceDisposition = tokenDisposition(sourceToken);
    return canvas.tokens.placeables.some((token) => {
      if (token === sourceToken || token === targetToken || !token.actor) {
        return false;
      }

      if (tokenDisposition(token) !== sourceDisposition) {
        return false;
      }

      return tokenDistanceFeet(token, targetToken) <= 5;
    });
  }

  #targetHasSurpriseImmunity(target, sourceActor) {
    return Boolean(getProperty(target, `${DAMAGE_REDUCTION_FLAG}.surpriseAttackImmunity.${sourceActor.id}`));
  }

  #turnKey(actor, key) {
    const combat = game.combat;
    return `${combat?.round ?? 0}:${combat?.turn ?? 0}:${actor.id}:${key}`;
  }

  #getRaceFeatures(actor) {
    return Array.from(actor?.items ?? []).filter(isRaceFeatureItem);
  }

  #findFeature(actor, mechanic) {
    return this.#getRaceFeatures(actor).find((item) => hasMechanic(item, mechanic)) ?? null;
  }

  #hasMechanic(actor, mechanic) {
    return Boolean(this.#findFeature(actor, mechanic));
  }

  #hasRuntimeFlag(actor, flag) {
    return Boolean(getProperty(actor, `${DAMAGE_REDUCTION_FLAG}.${flag}`));
  }

  #canPrompt(actor) {
    return Boolean(game.user?.isGM || actor?.isOwner);
  }

  async #confirm(actor, title, content) {
    if (!this.#canPrompt(actor)) {
      return false;
    }

    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (typeof DialogV2?.confirm === "function") {
      return DialogV2.confirm({
        window: { title },
        content: `<p>${escapeHtml(content)}</p>`
      });
    }

    return Dialog.confirm({
      title,
      content: `<p>${escapeHtml(content)}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
  }

  async #choice(actor, title, choices) {
    if (!this.#canPrompt(actor) || !choices.length) {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const options = choices.map((choice) => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join("");
      const dialog = new Dialog({
        title,
        content: `
          <form>
            <div class="form-group">
              <label>${escapeHtml(title)}</label>
              <select data-choice>${options}</select>
            </div>
          </form>
        `,
        buttons: {
          confirm: {
            label: "Применить",
            callback: (html) => {
              const root = getDialogRoot(html);
              settled = true;
              resolve(root?.querySelector("[data-choice]")?.value ?? choices[0].value);
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        },
        default: "confirm",
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      });
      dialog.render(true);
    });
  }

  async #promptText(actor, title, fields) {
    if (!this.#canPrompt(actor)) {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const content = fields.map((field) => `
        <div class="form-group">
          <label>${escapeHtml(field.label)}</label>
          <input type="text" data-field="${escapeHtml(field.name)}" value="${escapeHtml(field.value ?? "")}">
        </div>
      `).join("");

      const dialog = new Dialog({
        title,
        content: `<form>${content}</form>`,
        buttons: {
          confirm: {
            label: "Применить",
            callback: (html) => {
              const root = getDialogRoot(html);
              const result = {};
              for (const field of fields) {
                result[field.name] = root?.querySelector(`[data-field="${CSS.escape(field.name)}"]`)?.value ?? "";
              }
              settled = true;
              resolve(result);
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        },
        default: "confirm",
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      });
      dialog.render(true);
    });
  }

  async #promptSkillProficiencySwap(actor) {
    if (!this.#canPrompt(actor)) {
      return false;
    }

    const skills = Object.entries(CONFIG.DND5E.skills ?? {}).map(([value, config]) => ({
      value,
      label: config.label ?? value
    }));
    const oldSkill = await this.#choice(actor, "Людская натура: убрать владение", skills);
    if (!oldSkill) {
      return false;
    }

    const newSkill = await this.#choice(actor, "Людская натура: добавить владение", skills.filter((entry) => entry.value !== oldSkill));
    if (!newSkill) {
      return false;
    }

    await actor.update({
      [`system.skills.${oldSkill}.value`]: 0,
      [`system.skills.${newSkill}.value`]: Math.max(1, toNumber(actor.system?.skills?.[newSkill]?.value, 0))
    });
    await this.#postChat(actor, "Людская натура", `${actor.name}: владение навыком заменено после длительного отдыха.`);
    return true;
  }

  async #restoreHighElfSpellSlot(actor) {
    const slots = [];
    for (let level = 1; level <= 9; level += 1) {
      const path = `system.spells.spell${level}`;
      const data = getProperty(actor, path);
      if (toNumber(data?.max, 0) > 0) {
        slots.push({ level, value: toNumber(data.value, 0), max: toNumber(data.max, 0) });
      }
    }

    const highest = slots.at(-1);
    if (!highest || highest.level <= 1) {
      return false;
    }

    const targetLevel = highest.level - 1;
    const target = getProperty(actor, `system.spells.spell${targetLevel}`);
    if (!target || toNumber(target.value, 0) >= toNumber(target.max, 0)) {
      return false;
    }

    await actor.update({ [`system.spells.spell${targetLevel}.value`]: toNumber(target.value, 0) + 1 });
    await this.#postChat(actor, "Эльфийская магия", `${actor.name}: восстановлена 1 ячейка ${targetLevel} уровня.`);
    return true;
  }

  async #chooseElementalAwakening(actor, item) {
    const choice = await this.#choice(actor, "Стихийное пробуждение", [
      { value: "acid", label: "Кислота" },
      { value: "cold", label: "Холод" },
      { value: "fire", label: "Огонь" },
      { value: "lightning", label: "Молния" },
      { value: "thunder", label: "Звук" },
      { value: "poison", label: "Яд" }
    ]);
    if (!choice) {
      return false;
    }

    await this.#createEffect(actor, activeEffectData("Стихийное пробуждение", [{
      key: "system.traits.dr.value",
      mode: EFFECT_MODE_ADD,
      value: choice,
      priority: null
    }, {
      key: `${DAMAGE_REDUCTION_FLAG}.elementalAwakening`,
      mode: EFFECT_MODE_OVERRIDE,
      value: choice,
      priority: 20
    }], {
      origin: item?.uuid,
      description: "Выбранная стихия сохранена и добавлена как сопротивление."
    }));
    return true;
  }

  async #chooseDemonicSpellcasting(actor, item) {
    const data = await this.#promptText(actor, "Демоническое колдовство", [
      { name: "cantrip", label: "Заговор" },
      { name: "ability", label: "Заклинательная характеристика", value: "cha" }
    ]);
    if (!data) {
      return false;
    }

    await actor.setFlag(MODULE_ID, "raceAutomation.demonicSpellcasting", {
      cantrip: cleanText(data.cantrip),
      ability: cleanText(data.ability)
    });
    await this.#postChat(actor, "Демоническое колдовство", `${actor.name}: выбор заговора сохранён во flags.${MODULE_ID}.raceAutomation.demonicSpellcasting.`);
    return true;
  }

  async #promptAndApplyCustomEffect(actor, item, runtime = {}) {
    const confirmed = await this.#confirm(
      actor,
      cleanText(runtime.title, item?.name ?? "Расовая автоматизация"),
      cleanText(runtime.prompt, "Применить эффект этой расовой особенности сейчас?")
    );
    if (!confirmed) {
      return false;
    }

    const data = await this.#promptText(actor, "Параметры эффекта", [
      { name: "label", label: "Название эффекта", value: item?.name ?? "Расовый эффект" },
      { name: "key", label: "Active Effect key", value: `${DAMAGE_REDUCTION_FLAG}.custom` },
      { name: "value", label: "Value", value: "1" },
      { name: "rounds", label: "Rounds", value: "" }
    ]);
    if (!data) {
      return false;
    }

    const rounds = toNumber(data.rounds, 0);
    await this.#createEffect(actor, activeEffectData(cleanText(data.label, item?.name ?? "Расовый эффект"), [{
      key: cleanText(data.key),
      mode: EFFECT_MODE_OVERRIDE,
      value: cleanText(data.value),
      priority: 20
    }], {
      origin: item?.uuid,
      rounds: rounds > 0 ? rounds : null,
      description: "Эффект создан runtime-автоматизацией rebreya-main."
    }));
    return true;
  }

  async #applyLinkedActivityEffects(activity, actor) {
    const refs = Array.isArray(activity.effects)
      ? activity.effects
      : Array.from(activity.effects?.values?.() ?? activity.effects ?? []);
    for (const ref of refs) {
      const effectId = cleanText(ref?._id ?? ref?.id ?? ref);
      const effect = activity.item?.effects?.get(effectId);
      if (!effect) {
        continue;
      }

      const targetActors = this.#activityTargetActors(activity, actor);
      for (const target of targetActors) {
        const data = effect.toObject();
        data.origin = activity.item.uuid;
        data.transfer = false;
        delete data._id;
        await this.#createEffect(target, data);
      }
    }
  }

  #activityTargetActors(activity, actor) {
    if (activity?.target?.affects?.type && activity.target.affects.type !== "self") {
      const targets = Array.from(game.user?.targets ?? []).map(resolveActorFromTarget).filter(Boolean);
      if (targets.length) {
        return targets;
      }
    }

    return [actor];
  }

  async #consumeFeatureUse(item) {
    if (!item) {
      return true;
    }

    const uses = item.system?.uses;
    if (!uses) {
      return true;
    }

    const max = await this.#evaluateFormula(uses.max, item.actor);
    if (!max) {
      return true;
    }

    const spent = toNumber(uses.spent, 0);
    if (spent >= max) {
      ui.notifications.warn(`${item.name}: нет доступных использований.`);
      return false;
    }

    await item.update({ "system.uses.spent": spent + 1 });
    return true;
  }

  async #evaluateFormula(formula, actor) {
    const text = cleanText(formula);
    if (!text) {
      return 0;
    }

    const roll = createFormulaRoll(text, actor);
    await roll.evaluate();
    return toNumber(roll.total, 0);
  }

  async #applyDamage(actor, formula, damageType = "", options = {}) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (!this.#canUpdate(actor)) {
      await this.#emitAsGM("applyTargetDamage", {
        actorUuid: actor.uuid,
        formula,
        damageType,
        sourceActorUuid: options.sourceActor?.uuid,
        sourceItemUuid: options.sourceItemUuid,
        label: options.label
      });
      return true;
    }

    const roll = createFormulaRoll(formula, options.sourceActor ?? actor);
    await roll.evaluate();
    const damage = {
      value: Math.max(0, toNumber(roll.total, 0)),
      type: cleanText(damageType)
    };
    await actor.applyDamage([damage], {
      sourceActorUuid: options.sourceActor?.uuid,
      sourceItemUuid: options.sourceItemUuid
    });
    await roll.toMessage({
      speaker: speakerForActor(options.sourceActor ?? actor),
      flavor: cleanText(options.label, "Расовый урон")
    });
    return true;
  }

  async #healActor(actor, formula, options = {}) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (!this.#canUpdate(actor)) {
      await this.#emitAsGM("healActor", {
        actorUuid: actor.uuid,
        formula,
        label: options.label
      });
      return true;
    }

    const roll = createFormulaRoll(formula, actor);
    await roll.evaluate();
    const hp = actor.system?.attributes?.hp;
    const value = Math.min(toNumber(hp?.max, 0), toNumber(hp?.value, 0) + Math.max(0, toNumber(roll.total, 0)));
    await actor.update({ "system.attributes.hp.value": value });
    await roll.toMessage({
      speaker: speakerForActor(actor),
      flavor: cleanText(options.label, "Расовое исцеление")
    });
    return true;
  }

  async #createEffect(actor, effectData) {
    if (!(actor instanceof Actor)) {
      return false;
    }

    if (!this.#canUpdate(actor)) {
      await this.#emitAsGM("createActorEffect", {
        actorUuid: actor.uuid,
        effect: effectData
      });
      return true;
    }

    const data = foundry.utils.deepClone(effectData);
    delete data._id;
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    return true;
  }

  #canUpdate(document) {
    return Boolean(game.user?.isGM || document?.isOwner);
  }

  async #emitAsGM(action, payload = {}) {
    if (!game.user?.isGM) {
      return false;
    }

    game.socket?.emit?.(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_RACE_AUTOMATION,
      payload: {
        ...payload,
        action
      },
      senderId: game.user?.id ?? ""
    });
    return true;
  }

  async #postChat(actor, title, content) {
    return ChatMessage.create({
      speaker: speakerForActor(actor),
      flavor: title,
      content: `<p>${escapeHtml(content)}</p>`
    });
  }
}

export { SOCKET_EVENT_RACE_AUTOMATION };
