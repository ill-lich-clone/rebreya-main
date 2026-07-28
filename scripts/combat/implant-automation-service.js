import { MODULE_ID } from "../constants.js";

const GRAPPLE_SHOVE_TERMS = Object.freeze([
  "grapple",
  "shove",
  "grappling",
  "захват",
  "толкнуть",
  "толчок"
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function moduleFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    const value = document.getFlag(MODULE_ID, key);
    if (value !== undefined) return value;
  }
  return document?.flags?.[MODULE_ID]?.[key];
}

function actorDocument(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.documentName === "Actor" || candidate.uuid || candidate.id || candidate._id) {
    return candidate;
  }
  return null;
}

function contextActor(...contexts) {
  for (const context of contexts) {
    const candidates = [
      context?.actor,
      context?.subject?.actor,
      context?.subject,
      context?.item?.actor,
      context?.item?.parent,
      context?.activity?.actor,
      context?.activity?.item?.actor,
      context?.data?.actor
    ];
    for (const candidate of candidates) {
      const actor = actorDocument(candidate);
      if (actor) return actor;
    }
  }
  return null;
}

function contextItem(...contexts) {
  for (const context of contexts) {
    const item = context?.item
      ?? context?.activity?.item
      ?? context?.subject?.item
      ?? context?.data?.item
      ?? null;
    if (item) return item;
  }
  return null;
}

function capabilityOf(actor, type) {
  return getActorImplantCapabilities(actor).find((capability) => capability.type === type) ?? null;
}

function isGrappleOrShoveContext(...contexts) {
  const values = [];
  for (const context of contexts) {
    values.push(
      context?.identifier,
      context?.id,
      context?.name,
      context?.label,
      context?.action,
      context?.actionType,
      context?.item?.identifier,
      context?.item?.name,
      context?.activity?.identifier,
      context?.activity?.name,
      context?.activity?.type,
      context?.data?.identifier,
      context?.data?.label
    );
  }
  return values
    .map(normalizeText)
    .filter(Boolean)
    .some((value) => GRAPPLE_SHOVE_TERMS.some((term) => value.includes(term)));
}

function isFallingDamage(options = {}) {
  if (
    options?.isFalling === true
    || options?.falling === true
    || options?.source?.isFalling === true
  ) {
    return true;
  }
  return [
    options?.sourceType,
    options?.source?.type,
    options?.source?.name,
    options?.label,
    options?.flavor
  ].map(normalizeText).some((value) => /(?:^| )(?:fall|falling|падение|падения)(?: |$)/u.test(value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function itemWeight(item) {
  const weight = item?.system?.weight;
  return finiteNumber(
    typeof weight === "object" ? weight?.value ?? weight?.total : weight,
    0
  );
}

function isAttendedItem(item) {
  const parent = item?.parent ?? item?.actor ?? null;
  if (parent?.documentName === "Actor" || parent?.type === "character" || parent?.type === "npc") {
    return true;
  }
  return Boolean(
    item?.system?.equipped === true
    || item?.system?.worn === true
    || item?.system?.carried === true
    || item?.flags?.itempiles?.item?.notForSale === true
  );
}

export function getActorImplantCapabilities(actor) {
  const aggregate = collectionValues(actor?.effects).find((effect) => (
    moduleFlag(effect, "implantAggregate") === true
  ));
  const capabilities = moduleFlag(aggregate, "automation")?.capabilities;
  if (!Array.isArray(capabilities)) return [];
  return capabilities
    .filter((capability) => capability && typeof capability === "object")
    .map((capability) => ({ ...capability }));
}

export class ImplantAutomationService {
  constructor(options = {}) {
    this.options = options;
    this.activeTurnActor = null;
    this.activeTurnDistance = 0;
    this.completedTurnDistances = new Map();
    this.boostedActor = null;
    this.tokenMovementOrigins = new WeakMap();
    this.processedRegenerationTurns = new Set();
  }

  hasCapability(actor, type) {
    return Boolean(capabilityOf(actor, type));
  }

  resolveCraftProgressBase(actor, { baseGold = 5, construct = false } = {}) {
    const base = Math.max(0, finiteNumber(baseGold, 5));
    if (construct) return base;
    const capability = capabilityOf(actor, "craftingInvestmentBonus");
    return base + Math.max(0, finiteNumber(capability?.ordinary, 0));
  }

  getPhysicalProfile(actor, { previousTurnDistance = null } = {}) {
    const impulseLegs = capabilityOf(actor, "impulseLegs");
    const impulseEngines = capabilityOf(actor, "impulseEngines");
    const previousDistance = Number(previousTurnDistance);
    const impulseLegsEligible = Boolean(
      impulseLegs
      && Number.isFinite(previousDistance)
      && previousDistance === 0
    );
    const fly = finiteNumber(actor?.system?.attributes?.movement?.fly, 0);
    return {
      impulseLegsEligible,
      speedMultiplier: impulseLegsEligible ? 2 : 1,
      jumpMultiplier: Math.max(1, finiteNumber(impulseEngines?.jumpMultiplier, 1)),
      fallAbsorption: Math.max(0, finiteNumber(impulseEngines?.fallAbsorption, 0)),
      climbWithoutFreeHand: this.hasCapability(actor, "climbingHand"),
      hover: fly > 0 && this.hasCapability(actor, "hover")
    };
  }

  recordMovement(actor, distance) {
    const activeKey = cleanText(this.activeTurnActor?.uuid ?? this.activeTurnActor?.id);
    const actorKey = cleanText(actor?.uuid ?? actor?.id);
    const numericDistance = finiteNumber(distance, 0);
    if (!activeKey || actorKey !== activeKey || numericDistance <= 0) return false;
    this.activeTurnDistance += numericDistance;
    return true;
  }

  handlePreUpdateToken(token, changed = {}) {
    if (!token || (!Object.hasOwn(changed, "x") && !Object.hasOwn(changed, "y"))) {
      return true;
    }
    this.tokenMovementOrigins.set(token, {
      x: finiteNumber(token?.x, 0),
      y: finiteNumber(token?.y, 0)
    });
    return true;
  }

  handleUpdateToken(token, changed = {}) {
    const origin = this.tokenMovementOrigins.get(token);
    this.tokenMovementOrigins.delete(token);
    if (!origin || (!Object.hasOwn(changed, "x") && !Object.hasOwn(changed, "y"))) {
      return true;
    }
    const distance = this.#measureTokenMovement(token, origin, changed);
    this.recordMovement(token?.actor, distance);
    return true;
  }

  async handleCombatTurnChange(combat) {
    const incomingActor = combat?.combatant?.actor ?? null;
    const incomingKey = cleanText(incomingActor?.uuid ?? incomingActor?.id);
    if (!incomingKey) return true;
    await this.#applyTurnRegeneration(combat, incomingActor, incomingKey);

    const previousActor = this.activeTurnActor;
    const previousKey = cleanText(previousActor?.uuid ?? previousActor?.id);
    if (previousKey) {
      this.completedTurnDistances.set(previousKey, this.activeTurnDistance);
    }
    if (this.boostedActor) {
      await this.#setMovementMultiplier(this.boostedActor, 1);
      this.boostedActor = null;
    }

    const previousTurnDistance = this.completedTurnDistances.get(incomingKey);
    this.activeTurnActor = incomingActor;
    this.activeTurnDistance = 0;
    if (
      previousTurnDistance !== 0
      || !this.hasCapability(incomingActor, "impulseLegs")
      || !this.#isResponsibleClient(incomingActor)
    ) {
      return true;
    }

    const accepted = await this.#promptImpulseLegs(incomingActor);
    if (!accepted) return true;
    await this.#setMovementMultiplier(incomingActor, 2);
    this.boostedActor = incomingActor;
    return true;
  }

  async handleCombatEnd() {
    if (this.boostedActor) {
      await this.#setMovementMultiplier(this.boostedActor, 1);
    }
    this.activeTurnActor = null;
    this.activeTurnDistance = 0;
    this.completedTurnDistances.clear();
    this.boostedActor = null;
    this.processedRegenerationTurns.clear();
    return true;
  }

  applyDnd5ePreRollAttack(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = contextActor(rollConfig, dialogConfig, messageConfig);
    const item = contextItem(rollConfig, dialogConfig, messageConfig);
    const capability = capabilityOf(actor, "weaponAttackBonus");
    if (
      !capability
      || item?.type !== "weapon"
      || rollConfig._rebreyaImplantWeaponAttack === true
    ) {
      return true;
    }

    const value = finiteNumber(capability.value, 0);
    if (value === 0) return true;
    const current = cleanText(rollConfig.bonus);
    rollConfig.bonus = current ? `${current} + ${value}` : String(value);
    rollConfig._rebreyaImplantWeaponAttack = true;
    return true;
  }

  applyDnd5ePreRollTool(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = contextActor(rollConfig, dialogConfig, messageConfig);
    const item = contextItem(rollConfig, dialogConfig, messageConfig);
    const capability = capabilityOf(actor, "artisanToolBonus");
    const selectedToolId = cleanText(capability?.toolItemId);
    const currentToolId = cleanText(item?.id ?? item?._id);
    if (
      !capability
      || !selectedToolId
      || selectedToolId !== currentToolId
      || item?.type !== "tool"
      || rollConfig._rebreyaImplantArtisanTool === true
    ) {
      return true;
    }

    const value = finiteNumber(capability.value, 0);
    if (value === 0) return true;
    const current = cleanText(rollConfig.bonus);
    rollConfig.bonus = current ? `${current} + ${value}` : String(value);
    rollConfig._rebreyaImplantArtisanTool = true;
    return true;
  }

  applyDnd5ePreRollD20Test(rollConfig = {}, dialogConfig = {}, messageConfig = {}) {
    const actor = contextActor(rollConfig, dialogConfig, messageConfig);
    const capability = capabilityOf(actor, "grappleShoveBonus");
    if (
      !capability
      || rollConfig._rebreyaImplantGrappleShove === true
      || !isGrappleOrShoveContext(rollConfig, dialogConfig, messageConfig)
    ) {
      return true;
    }

    const value = finiteNumber(capability.value, 0);
    if (value === 0) return true;
    const current = cleanText(rollConfig.bonus);
    rollConfig.bonus = current ? `${current} + ${value}` : String(value);
    rollConfig._rebreyaImplantGrappleShove = true;
    return true;
  }

  applyDnd5ePreApplyDamage(actor, amount, updates = {}, options = {}) {
    const absorption = this.getPhysicalProfile(actor).fallAbsorption;
    if (absorption <= 0 || finiteNumber(amount, 0) <= 0 || !isFallingDamage(options)) {
      return true;
    }

    const hp = actor?.system?.attributes?.hp;
    if (!hp) return true;
    const temporaryHitPoints = Math.max(0, finiteNumber(hp.temp, 0));
    const hitPoints = Math.max(0, finiteNumber(hp.value, 0));
    const hasPreparedUpdates = Object.hasOwn(updates, "system.attributes.hp.temp")
      || Object.hasOwn(updates, "system.attributes.hp.value");
    const preparedDamage = hasPreparedUpdates
      ? Math.max(
        0,
        temporaryHitPoints - finiteNumber(updates["system.attributes.hp.temp"], temporaryHitPoints)
          + hitPoints - finiteNumber(updates["system.attributes.hp.value"], hitPoints)
      )
      : finiteNumber(amount, 0);
    const finalAmount = Math.max(0, preparedDamage - absorption);
    const tempDamage = Math.min(temporaryHitPoints, finalAmount);
    const hitPointDamage = Math.max(0, finalAmount - tempDamage);
    updates["system.attributes.hp.temp"] = temporaryHitPoints - tempDamage;
    updates["system.attributes.hp.value"] = Math.max(0, hitPoints - hitPointDamage);
    return true;
  }

  validateMagneticPalmTarget(actor, item, { distance = Number.POSITIVE_INFINITY } = {}) {
    const capability = capabilityOf(actor, "magneticPalm");
    if (!capability) return { allowed: false, reason: "missing" };
    if (isAttendedItem(item)) return { allowed: false, reason: "attended" };
    if (finiteNumber(distance, Number.POSITIVE_INFINITY) > finiteNumber(capability.range, 30)) {
      return { allowed: false, reason: "range" };
    }
    if (itemWeight(item) > finiteNumber(capability.maximumWeight, 5)) {
      return { allowed: false, reason: "weight" };
    }
    return { allowed: true, reason: "" };
  }

  async #setMovementMultiplier(actor, multiplier) {
    if (typeof this.options?.setMovementMultiplier === "function") {
      return this.options.setMovementMultiplier(actor, multiplier);
    }
    if (typeof this.options?.implantService?.setMovementMultiplier === "function") {
      return this.options.implantService.setMovementMultiplier(actor, multiplier);
    }
    return false;
  }

  #measureTokenMovement(token, origin, changed) {
    if (typeof this.options?.measureTokenMovement === "function") {
      return finiteNumber(this.options.measureTokenMovement(token, origin, changed), 0);
    }
    const destination = {
      x: finiteNumber(token?.x ?? changed?.x, origin.x),
      y: finiteNumber(token?.y ?? changed?.y, origin.y)
    };
    const grid = globalThis.canvas?.grid;
    if (typeof grid?.measurePath === "function") {
      return finiteNumber(grid.measurePath([origin, destination])?.distance, 0);
    }
    if (typeof grid?.measureDistance === "function") {
      return finiteNumber(grid.measureDistance(origin, destination), 0);
    }
    return 0;
  }

  #isResponsibleClient(actor) {
    const game = this.options?.game ?? globalThis.game;
    const currentUser = game?.user;
    if (!currentUser) return true;
    const users = collectionValues(game?.users).filter((user) => user?.active !== false);
    const playerOwners = users
      .filter((user) => (
        user?.isGM !== true
        && (
          typeof actor?.testUserPermission === "function"
            ? actor.testUserPermission(user, "OWNER") === true
            : user?.id === currentUser.id && actor?.isOwner === true
        )
      ))
      .sort((left, right) => cleanText(left?.id).localeCompare(cleanText(right?.id), "en"));
    const responsible = playerOwners[0] ?? users.find((user) => user?.isGM === true) ?? currentUser;
    return cleanText(responsible?.id) === cleanText(currentUser?.id);
  }

  async #applyTurnRegeneration(combat, actor, actorKey) {
    const capability = capabilityOf(actor, "turnRegeneration");
    if (!capability || !this.#isResponsibleClient(actor)) return false;

    const turnKey = [
      cleanText(combat?.id ?? combat?._id ?? "combat"),
      Number.isFinite(Number(combat?.round)) ? Number(combat.round) : 0,
      Number.isFinite(Number(combat?.turn)) ? Number(combat.turn) : 0,
      actorKey
    ].join("/");
    if (this.processedRegenerationTurns.has(turnKey)) return false;
    this.processedRegenerationTurns.add(turnKey);
    if (this.processedRegenerationTurns.size > 512) {
      const oldest = this.processedRegenerationTurns.values().next().value;
      this.processedRegenerationTurns.delete(oldest);
    }

    const hitPoints = actor?.system?.attributes?.hp;
    const current = finiteNumber(hitPoints?.value, 0);
    const maximum = finiteNumber(hitPoints?.max, 0);
    const minimum = Math.max(1, finiteNumber(capability.minimumHitPoints, 2));
    const healing = Math.max(0, finiteNumber(capability.value, 1));
    if (
      current < minimum
      || current >= maximum
      || maximum <= 0
      || healing <= 0
      || typeof actor?.update !== "function"
    ) {
      return false;
    }
    await actor.update({
      "system.attributes.hp.value": Math.min(maximum, current + healing)
    });
    return true;
  }

  async #promptImpulseLegs(actor) {
    if (typeof this.options?.promptImpulseLegs === "function") {
      return this.options.promptImpulseLegs(actor);
    }
    if (!actor?.isOwner && !globalThis.game?.user?.isGM) return false;
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2;
    if (typeof DialogV2?.confirm !== "function") return false;
    return DialogV2.confirm({
      window: { title: "Импульсные ноги" },
      content: "<p>В предыдущий ход вы не перемещались. Удвоить скорость до конца текущего хода?</p>",
      yes: { label: "Удвоить" },
      no: { label: "Пропустить" },
      rejectClose: false
    });
  }
}
