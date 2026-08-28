import { MODULE_ID } from "../constants.js";
import {
  buildActorHandReservationsUpdate,
  getActorHandReservations,
  getFreeHandSlots
} from "../integrations/held-items.js";
import { getNaturalReachFeet } from "./natural-reach.js";
import { tokenFootprint, validateGrapplePlacement } from "./grapple-geometry.js";

export const GRAPPLE_LINK_FLAG = "grappleLink";
export const GRAPPLE_BYPASS_OPTION = "grappleBypass";
export const MAX_GRAPPLE_OPERATION_FINGERPRINTS = 256;

const GRAPPLE_EFFECT_NAME = "Схваченный";
const GRAPPLED_STATUS_ID = "grappled";

function codedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clean(value) {
  return String(value ?? "").trim();
}

function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw codedError("invalid-position", `${name} must be finite`);
  return number;
}

function values(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  if (collection && typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return [];
}

function flag(document, key) {
  if (typeof document?.getFlag === "function") return document.getFlag(MODULE_ID, key);
  return document?.flags?.[MODULE_ID]?.[key];
}

function scopedFlag(document, scope, key) {
  if (typeof document?.getFlag === "function") return document.getFlag(scope, key);
  return document?.flags?.[scope]?.[key];
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function tokenUpdateForLink(link) {
  return link
    ? { [`flags.${MODULE_ID}.${GRAPPLE_LINK_FLAG}`]: clone(link) }
    : { [`flags.${MODULE_ID}.-=${GRAPPLE_LINK_FLAG}`]: null };
}

function bypassOptions({ ignoreTokenCollisionsFor = [] } = {}) {
  const options = { [MODULE_ID]: { [GRAPPLE_BYPASS_OPTION]: true } };
  if (ignoreTokenCollisionsFor.length) {
    options.movement = Object.fromEntries(ignoreTokenCollisionsFor.map((id) => [
      id,
      { constrainOptions: { ignoreTokens: true } }
    ]));
  }
  return options;
}

function tokenUuid(token) {
  return clean(token?.uuid);
}

function tokenId(token) {
  return clean(token?.id ?? token?._id);
}

function isToken(document) {
  return document?.documentName === "Token" || (
    document?.actor && Number.isFinite(Number(document?.x)) && Number.isFinite(Number(document?.y))
  );
}

function effectLink(effect) {
  if (flag(effect, "managed") !== true) return null;
  const link = flag(effect, GRAPPLE_LINK_FLAG);
  return link && typeof link === "object" ? link : null;
}

function findManagedEffects(actor, linkId) {
  return values(actor?.effects).filter((effect) => clean(effectLink(effect)?.linkId) === clean(linkId));
}

function effectHasStatus(effect, statusId) {
  const statuses = effect?.statuses;
  if (statuses instanceof Set) return statuses.has(statusId);
  return Array.isArray(statuses) && statuses.includes(statusId);
}

async function defaultGrappledStatusEffectDataFactory() {
  const ActiveEffectClass = globalThis.getDocumentClass?.("ActiveEffect")
    ?? globalThis.CONFIG?.ActiveEffect?.documentClass
    ?? globalThis.ActiveEffect;
  if (typeof ActiveEffectClass?.fromStatusEffect !== "function") {
    throw codedError("grapple-status-unavailable");
  }
  const effect = await ActiveEffectClass.fromStatusEffect(GRAPPLED_STATUS_ID);
  const data = typeof effect?.toObject === "function" ? effect.toObject() : null;
  if (!data || typeof data !== "object") throw codedError("grapple-status-unavailable");
  return data;
}

function effectSource(effect) {
  const source = typeof effect?.toObject === "function" ? effect.toObject() : clone(effect);
  if (!source || typeof source !== "object") return null;
  delete source.id;
  delete source._id;
  delete source.parent;
  return source;
}

function sceneGrid(scene) {
  return {
    size: Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? globalThis.canvas?.dimensions?.size),
    distance: Number(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance ?? globalThis.canvas?.dimensions?.distance)
  };
}

function defaultSceneRect(scene) {
  const dimensions = scene?.dimensions ?? globalThis.canvas?.dimensions;
  return {
    x: Number(dimensions?.sceneX ?? 0),
    y: Number(dimensions?.sceneY ?? 0),
    width: Number(dimensions?.sceneWidth ?? scene?.width ?? dimensions?.width),
    height: Number(dimensions?.sceneHeight ?? scene?.height ?? dimensions?.height)
  };
}

function sameScene(left, right) {
  return left?.parent === right?.parent || clean(left?.parent?.id) === clean(right?.parent?.id);
}

export class GrappleAutomationService {
  #checkCollision;
  #commandBus;
  #coordinator;
  #fromUuid;
  #gameProvider;
  #grappledStatusEffectDataFactory;
  #isActiveGmClient;
  #operationFingerprints = new Map();
  #placementPreview;
  #randomId;
  #sceneRectProvider;

  constructor({
    coordinator,
    commandBus = null,
    placementPreview = null,
    fromUuid = (uuid) => globalThis.fromUuid?.(uuid),
    randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto?.randomUUID?.(),
    grappledStatusEffectDataFactory = defaultGrappledStatusEffectDataFactory,
    isActiveGmClient = () => false,
    gameProvider = () => globalThis.game,
    sceneRectProvider = defaultSceneRect,
    checkCollision = ({ targetToken, targetPoint }) => (
      (targetToken?.object ?? targetToken)?.checkCollision?.(targetPoint, { type: "move", mode: "any" }) === true
    )
  } = {}) {
    if (typeof coordinator?.runIdempotent !== "function") throw new TypeError("coordinator.runIdempotent is required");
    this.#coordinator = coordinator;
    this.#commandBus = commandBus;
    this.#placementPreview = placementPreview;
    this.#fromUuid = fromUuid;
    this.#randomId = randomId;
    this.#grappledStatusEffectDataFactory = grappledStatusEffectDataFactory;
    this.#isActiveGmClient = isActiveGmClient;
    this.#gameProvider = gameProvider;
    this.#sceneRectProvider = sceneRectProvider;
    this.#checkCollision = checkCollision;
  }

  toggle({ sourceTokenUuid, targetTokenUuid, operationId } = {}) {
    const payload = this.#normalizePairPayload({ sourceTokenUuid, targetTokenUuid, operationId });
    return this.#runOperation("toggle", `grapple-source:${payload.sourceTokenUuid}`, payload.operationId, payload, async () => {
      const source = await this.#resolveToken(payload.sourceTokenUuid);
      const target = await this.#resolveToken(payload.targetTokenUuid);
      this.#assertPair(source, target);
      const existing = flag(target, GRAPPLE_LINK_FLAG);
      if (existing) {
        if (clean(existing.sourceTokenUuid) !== payload.sourceTokenUuid) {
          throw codedError("target-grappled-by-another-source", "Цель уже удерживает другой захватчик");
        }
        await this.#releaseResolved(source, target, existing);
        return { action: "released", linkId: clean(existing.linkId) };
      }
      const validation = this.#validatePlacement(source, target, { x: Number(target.x), y: Number(target.y) });
      if (!validation.valid) throw codedError(validation.reason);
      return this.#createResolved(source, target);
    });
  }

  place({ sourceTokenUuid, targetTokenUuid, x, y, operationId } = {}) {
    const payload = {
      ...this.#normalizePairPayload({ sourceTokenUuid, targetTokenUuid, operationId }),
      x: finite(x, "x"),
      y: finite(y, "y")
    };
    return this.#runOperation("place", `grapple-source:${payload.sourceTokenUuid}`, payload.operationId, payload, async () => {
      const source = await this.#resolveToken(payload.sourceTokenUuid);
      const target = await this.#resolveToken(payload.targetTokenUuid);
      this.#assertPair(source, target);
      this.#assertLiveLink(source, target);
      const validation = this.#validatePlacement(source, target, { x: payload.x, y: payload.y });
      if (!validation.valid) throw codedError(validation.reason);
      const previousPosition = { x: Number(target.x), y: Number(target.y) };
      try {
        await target.update({ x: validation.x, y: validation.y }, bypassOptions());
      }
      catch (error) {
        await this.#rollback(error, [() => target.update(previousPosition, bypassOptions())]);
      }
      return { moved: true, x: validation.x, y: validation.y };
    });
  }

  drag({ sourceTokenUuid, x, y, operationId } = {}) {
    const payload = {
      sourceTokenUuid: this.#required(sourceTokenUuid, "sourceTokenUuid"),
      x: finite(x, "x"),
      y: finite(y, "y"),
      operationId: this.#required(operationId, "operationId")
    };
    return this.#runOperation("drag", `grapple-source:${payload.sourceTokenUuid}`, payload.operationId, payload, async () => {
      const source = await this.#resolveToken(payload.sourceTokenUuid);
      const scene = source.parent;
      if (typeof scene?.updateEmbeddedDocuments !== "function") throw codedError("invalid-scene");
      const delta = { x: payload.x - Number(source.x), y: payload.y - Number(source.y) };
      const sourcePosition = { x: payload.x, y: payload.y };
      const sourceValidation = this.#validateTranslation(source, sourcePosition);
      if (!sourceValidation.valid) throw codedError(sourceValidation.reason);
      const updates = [{ _id: tokenId(source), x: payload.x, y: payload.y }];
      const rollbackUpdates = [{ _id: tokenId(source), x: Number(source.x), y: Number(source.y) }];
      for (const reservation of getActorHandReservations(source.actor)) {
        if (reservation.kind !== "grapple" || reservation.sourceTokenUuid !== payload.sourceTokenUuid) continue;
        const target = await this.#resolveToken(reservation.targetTokenUuid);
        if (!sameScene(source, target)) throw codedError("stale-link");
        const liveLink = this.#assertLiveLink(source, target, reservation.linkId);
        if (!findManagedEffects(target.actor, liveLink.linkId).length) throw codedError("stale-link");
        const position = { x: Number(target.x) + delta.x, y: Number(target.y) + delta.y };
        const validation = this.#validateTranslation(target, position);
        if (!validation.valid) throw codedError(validation.reason);
        updates.push({ _id: tokenId(target), x: validation.x, y: validation.y });
        rollbackUpdates.push({ _id: tokenId(target), x: Number(target.x), y: Number(target.y) });
      }
      const movementTokenIds = updates.map((update) => update._id);
      try {
        await scene.updateEmbeddedDocuments("Token", updates, bypassOptions({
          ignoreTokenCollisionsFor: movementTokenIds
        }));
      }
      catch (error) {
        await this.#rollback(error, [() => scene.updateEmbeddedDocuments("Token", rollbackUpdates, bypassOptions({
          ignoreTokenCollisionsFor: movementTokenIds
        }))]);
      }
      return { moved: true, updates: clone(updates) };
    });
  }

  releaseAndMove({ targetTokenUuid, linkId, x, y, operationId } = {}) {
    const payload = {
      targetTokenUuid: this.#required(targetTokenUuid, "targetTokenUuid"),
      linkId: this.#required(linkId, "linkId"),
      x: finite(x, "x"),
      y: finite(y, "y"),
      operationId: this.#required(operationId, "operationId")
    };
    return this.#runOperation("release-and-move", `grapple-link:${payload.linkId}`, payload.operationId, payload, async () => {
      const target = await this.#resolveToken(payload.targetTokenUuid);
      const liveLink = flag(target, GRAPPLE_LINK_FLAG);
      if (clean(liveLink?.linkId) !== payload.linkId) throw codedError("stale-link");
      const source = await this.#resolveToken(liveLink.sourceTokenUuid);
      const snapshot = this.#snapshotLink(source, target, liveLink);
      await this.#releaseResolved(source, target, liveLink);
      try {
        await target.update({ x: payload.x, y: payload.y }, bypassOptions());
      }
      catch (error) {
        await this.#rollback(error, [() => this.#restoreSnapshot(snapshot)]);
      }
      return { released: true, moved: true, x: payload.x, y: payload.y };
    });
  }

  async choosePlacement({ sourceTokenUuid, targetTokenUuid } = {}) {
    if (typeof this.#placementPreview?.choose !== "function") throw codedError("crosshairs-unavailable");
    const source = await this.#resolveToken(this.#required(sourceTokenUuid, "sourceTokenUuid"));
    const target = await this.#resolveToken(this.#required(targetTokenUuid, "targetTokenUuid"));
    this.#assertPair(source, target);
    this.#assertLiveLink(source, target);
    return this.#placementPreview.choose({
      sourceToken: source,
      targetToken: target,
      reachFeet: getNaturalReachFeet(source.actor)
    });
  }

  requestDragFromTokenUpdate(payload) {
    if (this.#isActiveGmClient(this.#gameProvider())) return this.drag(payload);
    return this.#request("combat.grapple.drag", payload);
  }

  requestReleaseAndMove(payload) {
    if (this.#isActiveGmClient(this.#gameProvider())) return this.releaseAndMove(payload);
    return this.#request("combat.grapple.release-and-move", payload);
  }

  async handleManagedEffectDeleted(effect) {
    const link = effectLink(effect);
    if (!link) return { handled: false };
    const operationId = `effect-delete:${clean(link.linkId)}:${this.#required(this.#randomId(), "randomId")}`;
    return this.#runOperation("effect-delete", `grapple-link:${clean(link.linkId)}`, operationId, link, async () => {
      const source = await this.#resolveToken(link.sourceTokenUuid);
      const target = await this.#resolveToken(link.targetTokenUuid);
      await this.#releaseResolved(source, target, link);
      return { handled: true };
    });
  }

  async handleTokenDeleted(token) {
    const deletedUuid = tokenUuid(token);
    if (!deletedUuid) return { removed: 0 };
    const targetLink = flag(token, GRAPPLE_LINK_FLAG);
    if (targetLink) {
      const source = await this.#fromUuid(targetLink.sourceTokenUuid);
      await this.#removeLinkFragments({ source, target: token, link: targetLink, targetDeleted: true });
      return { removed: 1 };
    }
    const reservations = getActorHandReservations(token.actor).filter((row) => row.sourceTokenUuid === deletedUuid);
    for (const link of reservations) {
      const target = await this.#fromUuid(link.targetTokenUuid);
      await this.#removeLinkFragments({ source: token, target, link });
    }
    return { removed: reservations.length };
  }

  async reconcileScene(scene) {
    let removed = 0;
    const tokens = values(scene?.tokens);
    const byUuid = new Map(tokens.map((token) => [tokenUuid(token), token]));
    for (const source of tokens) {
      const current = getActorHandReservations(source.actor);
      const kept = [];
      for (const reservation of current) {
        if (reservation.kind !== "grapple" || reservation.sourceTokenUuid !== tokenUuid(source)) {
          kept.push(reservation);
          continue;
        }
        const target = byUuid.get(reservation.targetTokenUuid);
        const targetLink = target && flag(target, GRAPPLE_LINK_FLAG);
        const effect = target && await this.#collapseLegacyDaeDuplicate(target.actor, reservation);
        const placement = target
          ? this.#validatePlacement(source, target, { x: Number(target.x), y: Number(target.y) })
          : null;
        if (
          target
          && effect
          && placement?.valid
          && clean(targetLink?.linkId) === reservation.linkId
          && clean(targetLink?.sourceTokenUuid) === tokenUuid(source)
        ) {
          kept.push(reservation);
          continue;
        }
        removed += 1;
        if (target && clean(targetLink?.linkId) === reservation.linkId) await target.update(tokenUpdateForLink(null), bypassOptions());
        for (const orphanEffect of findManagedEffects(target?.actor, reservation.linkId)) await orphanEffect.delete();
      }
      if (kept.length !== current.length) await this.#writeReservations(source.actor, kept);
    }
    for (const target of tokens) {
      const link = flag(target, GRAPPLE_LINK_FLAG);
      if (!link) continue;
      const source = byUuid.get(clean(link.sourceTokenUuid));
      const reservation = getActorHandReservations(source?.actor).find((row) => row.linkId === clean(link.linkId));
      const effect = findManagedEffects(target.actor, link.linkId)[0];
      if (source && reservation && effect) continue;
      await target.update(tokenUpdateForLink(null), bypassOptions());
      for (const orphanEffect of findManagedEffects(target.actor, link.linkId)) await orphanEffect.delete();
      removed += 1;
    }
    for (const target of tokens) {
      for (const effect of [...values(target.actor?.effects)]) {
        const link = effectLink(effect);
        if (!link || link.targetTokenUuid !== tokenUuid(target)) continue;
        const targetLink = flag(target, GRAPPLE_LINK_FLAG);
        if (clean(targetLink?.linkId) === clean(link.linkId)) continue;
        await effect.delete();
        removed += 1;
      }
    }
    return { removed };
  }

  #normalizePairPayload({ sourceTokenUuid, targetTokenUuid, operationId }) {
    return {
      sourceTokenUuid: this.#required(sourceTokenUuid, "sourceTokenUuid"),
      targetTokenUuid: this.#required(targetTokenUuid, "targetTokenUuid"),
      operationId: this.#required(operationId, "operationId")
    };
  }

  #required(value, name) {
    const normalized = clean(value);
    if (!normalized) throw codedError("invalid-request", `${name} is required`);
    return normalized;
  }

  #runOperation(action, queueKey, operationId, payload, operation) {
    const fingerprint = JSON.stringify({ action, payload });
    const previous = this.#operationFingerprints.get(operationId);
    if (previous && previous !== fingerprint) throw codedError("operation-fingerprint-mismatch");
    if (!previous) {
      this.#operationFingerprints.set(operationId, fingerprint);
      while (this.#operationFingerprints.size > MAX_GRAPPLE_OPERATION_FINGERPRINTS) {
        this.#operationFingerprints.delete(this.#operationFingerprints.keys().next().value);
      }
    }
    return this.#coordinator.runIdempotent(queueKey, `grapple:${operationId}`, operation);
  }

  async #resolveToken(uuid) {
    const token = await this.#fromUuid(uuid);
    if (!isToken(token) || tokenUuid(token) !== clean(uuid)) throw codedError("stale-token");
    return token;
  }

  #assertPair(source, target) {
    if (source === target || tokenUuid(source) === tokenUuid(target)) throw codedError("invalid-target");
    if (!sameScene(source, target)) throw codedError("scene-mismatch");
  }

  #assertLiveLink(source, target, expectedLinkId = "") {
    const link = flag(target, GRAPPLE_LINK_FLAG);
    if (
      !link
      || clean(link.sourceTokenUuid) !== tokenUuid(source)
      || clean(link.targetTokenUuid) !== tokenUuid(target)
      || (expectedLinkId && clean(link.linkId) !== clean(expectedLinkId))
    ) throw codedError("stale-link");
    const reservation = getActorHandReservations(source.actor).find((row) => row.linkId === clean(link.linkId));
    if (!reservation) throw codedError("stale-link");
    return link;
  }

  async #createResolved(source, target) {
    const freeHands = getFreeHandSlots(source.actor);
    if (!freeHands.length) throw codedError("no-free-hand", "Захват невозможен: нет свободной руки");
    const linkId = this.#required(this.#randomId(), "linkId");
    const link = {
      linkId,
      kind: "grapple",
      handSlot: freeHands[0],
      sourceTokenUuid: tokenUuid(source),
      targetTokenUuid: tokenUuid(target)
    };
    const reservations = getActorHandReservations(source.actor);
    const oldTargetFlag = clone(flag(target, GRAPPLE_LINK_FLAG));
    try {
      await this.#writeReservations(source.actor, [...reservations, link]);
      await target.update(tokenUpdateForLink(link), bypassOptions());
      await this.#createEffect(target.actor, link);
      return { action: "created", linkId, handSlot: link.handSlot };
    }
    catch (error) {
      await this.#rollback(error, [
        () => this.#deleteEffects(target.actor, linkId),
        () => target.update(tokenUpdateForLink(oldTargetFlag), bypassOptions()),
        () => this.#writeReservations(source.actor, reservations)
      ]);
    }
  }

  #snapshotLink(source, target, link) {
    return {
      sourceActor: source.actor,
      target,
      targetActor: target.actor,
      reservations: clone(getActorHandReservations(source.actor)),
      targetFlag: clone(flag(target, GRAPPLE_LINK_FLAG)),
      position: { x: Number(target.x), y: Number(target.y) },
      effectSources: findManagedEffects(target.actor, link.linkId).map(effectSource).filter(Boolean)
    };
  }

  async #releaseResolved(source, target, link) {
    const snapshot = this.#snapshotLink(source, target, link);
    try {
      await this.#deleteEffects(target.actor, link.linkId);
      await target.update(tokenUpdateForLink(null), bypassOptions());
      await this.#writeReservations(source.actor, snapshot.reservations.filter((row) => row.linkId !== clean(link.linkId)));
    }
    catch (error) {
      await this.#rollback(error, [() => this.#restoreSnapshot(snapshot)]);
    }
  }

  async #restoreSnapshot(snapshot) {
    await this.#writeReservations(snapshot.sourceActor, snapshot.reservations);
    await snapshot.target.update({
      ...snapshot.position,
      ...tokenUpdateForLink(snapshot.targetFlag)
    }, bypassOptions());
    const linkId = clean(snapshot.targetFlag?.linkId);
    await this.#deleteEffects(snapshot.targetActor, linkId);
    if (snapshot.effectSources.length) {
      await snapshot.targetActor.createEmbeddedDocuments("ActiveEffect", clone(snapshot.effectSources));
    }
  }

  async #rollback(originalError, operations) {
    const failures = [];
    for (const operation of operations) {
      try { await operation(); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError([originalError, ...failures], "Grapple rollback failed", { cause: originalError });
    throw originalError;
  }

  async #writeReservations(actor, reservations) {
    if (typeof actor?.update !== "function") throw codedError("stale-actor");
    await actor.update(buildActorHandReservationsUpdate(reservations));
  }

  async #createEffect(actor, link) {
    if (typeof actor?.createEmbeddedDocuments !== "function") throw codedError("stale-actor");
    const providesGrappledStatus = values(actor?.effects).some((effect) => effectHasStatus(effect, GRAPPLED_STATUS_ID));
    const statusData = providesGrappledStatus
      ? { name: GRAPPLE_EFFECT_NAME, img: null, icon: null, statuses: [] }
      : await this.#grappledStatusEffectDataFactory();
    const flags = clone(statusData?.flags ?? {});
    flags[MODULE_ID] = {
      ...(flags[MODULE_ID] ?? {}),
      managed: true,
      [GRAPPLE_LINK_FLAG]: clone(link)
    };
    const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
      ...clone(statusData),
      flags
    }], { keepId: !providesGrappledStatus });
    return effect;
  }

  async #collapseLegacyDaeDuplicate(actor, link) {
    const managedEffects = findManagedEffects(actor, link.linkId);
    const legacy = managedEffects.find((effect) => effectHasStatus(effect, GRAPPLED_STATUS_ID));
    if (!legacy) return managedEffects[0] ?? null;

    const canonical = values(actor?.effects).find((effect) => (
      effect !== legacy
      && effectHasStatus(effect, GRAPPLED_STATUS_ID)
      && scopedFlag(effect, "dae", "autoCreated") === true
    ));
    if (!canonical || typeof canonical.update !== "function" || typeof legacy.delete !== "function") {
      return legacy;
    }

    await canonical.update({
      [`flags.${MODULE_ID}.managed`]: true,
      [`flags.${MODULE_ID}.${GRAPPLE_LINK_FLAG}`]: clone(link),
      "flags.dae.-=autoCreated": null
    }, bypassOptions());
    await legacy.delete(bypassOptions());
    return canonical;
  }

  async #deleteEffects(actor, linkId) {
    for (const effect of [...findManagedEffects(actor, linkId)]) {
      if (typeof effect?.delete !== "function") throw codedError("stale-effect");
      await effect.delete(bypassOptions());
    }
  }

  #validatePlacement(source, target, position) {
    const scene = target.parent;
    return validateGrapplePlacement({
      sourceToken: source,
      targetToken: target,
      position,
      grid: sceneGrid(scene),
      reachFeet: getNaturalReachFeet(source.actor),
      sceneRect: this.#sceneRectProvider(scene),
      checkCollision: this.#checkCollision
    });
  }

  #validateTranslation(token, position) {
    const scene = token.parent;
    const grid = sceneGrid(scene);
    const current = tokenFootprint(token);
    const target = tokenFootprint(token, position);
    try {
      this.#assertInsideScene(token, scene, position);
    }
    catch (error) {
      if (error?.code === "outside-scene") return { valid: false, reason: error.code, x: target.x, y: target.y };
      throw error;
    }
    const sourcePoint = {
      x: current.x + ((current.width * grid.size) / 2),
      y: current.y + ((current.height * grid.size) / 2)
    };
    const targetPoint = {
      x: target.x + ((target.width * grid.size) / 2),
      y: target.y + ((target.height * grid.size) / 2)
    };
    if (this.#checkCollision({ sourceToken: token, targetToken: token, position: target, sourcePoint, targetPoint })) {
      return { valid: false, reason: "wall-collision", x: target.x, y: target.y };
    }
    return { valid: true, reason: null, x: target.x, y: target.y };
  }

  #assertInsideScene(token, scene, position = null) {
    const footprint = tokenFootprint(token, position);
    const grid = sceneGrid(scene);
    const rect = this.#sceneRectProvider(scene);
    const right = footprint.x + (footprint.width * grid.size);
    const bottom = footprint.y + (footprint.height * grid.size);
    if (
      footprint.x < rect.x
      || footprint.y < rect.y
      || right > rect.x + rect.width
      || bottom > rect.y + rect.height
    ) throw codedError("outside-scene");
  }

  async #request(command, payload) {
    if (typeof this.#commandBus?.request !== "function") throw codedError("active-gm-unavailable");
    return this.#commandBus.request(command, clone(payload), { requestId: clean(payload?.operationId) });
  }

  async #removeLinkFragments({ source, target, link, targetDeleted = false }) {
    if (target?.actor) await this.#deleteEffects(target.actor, link.linkId);
    if (target && !targetDeleted && clean(flag(target, GRAPPLE_LINK_FLAG)?.linkId) === clean(link.linkId)) {
      await target.update(tokenUpdateForLink(null), bypassOptions());
    }
    if (source?.actor) {
      const reservations = getActorHandReservations(source.actor).filter((row) => row.linkId !== clean(link.linkId));
      await this.#writeReservations(source.actor, reservations);
    }
  }
}
