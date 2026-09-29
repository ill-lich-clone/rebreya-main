import { MODULE_ID } from "../constants.js";
import { grappleReachOriginRect } from "./grapple-geometry.js";
import { createReachBoundaryOverlay } from "./grapple-placement-preview.js?v=1.4.356";

const BOMB_TOKEN_SIZE = 0.5;
export const BOMB_THROW_RANGE_FEET = 60;
const ALCHEMY_BOMB_FLAG = "alchemyBombRuntime";
const STICKY_REGION_SCRIPT = "await game.rebreyaMain?.alchemyBombRuntimeService?.handleStickyRegionEvent?.({ scene, region, event });";

function clean(value) {
  return String(value ?? "").trim();
}

function finite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`);
  return number;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function bombThrowDistanceFeet(source, point, grid) {
  const gridSize = finite(grid?.size, "grid size");
  const gridDistance = finite(grid?.distance, "grid distance");
  if (gridSize <= 0 || gridDistance <= 0) throw new RangeError("grid metrics must be positive");
  const origin = grappleReachOriginRect(source, { size: gridSize, distance: gridDistance });
  const x = finite(point?.x, "bomb center x");
  const y = finite(point?.y, "bomb center y");
  const horizontalGap = Math.max(origin.left - x, x - origin.right, 0);
  const verticalGap = Math.max(origin.top - y, y - origin.bottom, 0);
  return (Math.hypot(horizontalGap, verticalGap) / gridSize) * gridDistance;
}

function bombDefinition(workflow) {
  return workflow?.activity?.flags?.[MODULE_ID]?.alchemyBomb
    ?? workflow?.activity?.getFlag?.(MODULE_ID, "alchemyBomb")
    ?? null;
}

function sheetWasMinimized(sheet) {
  if (typeof sheet?.minimized === "boolean") return sheet.minimized;
  return sheet?._minimized === true;
}

async function minimizeActorSheet(actor) {
  const sheet = actor?.sheet;
  if (!sheet?.rendered || sheetWasMinimized(sheet) || typeof sheet.minimize !== "function") {
    return async () => {};
  }
  await sheet.minimize();
  let restored = false;
  return async () => {
    if (restored) return;
    restored = true;
    if (sheet.rendered && typeof sheet.maximize === "function") await sheet.maximize();
  };
}

export async function withMinimizedActorSheet(actor, operation) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  const restore = await minimizeActorSheet(actor);
  try {
    return await operation();
  }
  finally {
    await restore();
  }
}

function sourceToken(workflow) {
  const token = workflow?.token?.document ?? workflow?.token;
  const actor = workflow?.actor ?? workflow?.activity?.actor ?? workflow?.item?.actor;
  if (token?.actor === actor || token?.actor?.uuid === actor?.uuid) return token;
  const matches = Array.from(globalThis.canvas?.tokens?.controlled ?? [])
    .map((entry) => entry?.document ?? entry)
    .filter((entry) => entry?.actor === actor || entry?.actor?.uuid === actor?.uuid);
  return matches.length === 1 ? matches[0] : null;
}

function sceneOf(token) {
  return token?.parent ?? token?.scene ?? globalThis.canvas?.scene ?? null;
}

function itemFlag(item, key) {
  return item?.getFlag?.(MODULE_ID, key) ?? item?.flags?.[MODULE_ID]?.[key];
}

function buildPreviewPrototype({ actor, name, image }) {
  return {
    parent: actor,
    actor,
    toObject() {
      return {
        actorId: clean(actor?.id),
        actorLink: false,
        name,
        width: BOMB_TOKEN_SIZE,
        height: BOMB_TOKEN_SIZE,
        texture: { src: image },
        sight: { enabled: false },
        disposition: 0,
        rotation: 0,
        elevation: 0,
        randomImg: false
      };
    }
  };
}

async function defaultPlacementProvider(config) {
  const place = globalThis.game?.dnd5e?.canvas?.TokenPlacement?.place
    ?? globalThis.dnd5e?.canvas?.TokenPlacement?.place;
  if (typeof place !== "function") {
    const error = new Error("Встроенное размещение токенов dnd5e недоступно.");
    error.code = "token-placement-unavailable";
    throw error;
  }
  return place.call(globalThis.game?.dnd5e?.canvas?.TokenPlacement ?? globalThis.dnd5e.canvas.TokenPlacement, config);
}

function defaultGridProvider() {
  return {
    size: globalThis.canvas?.grid?.size ?? globalThis.canvas?.dimensions?.size,
    distance: globalThis.canvas?.grid?.distance ?? globalThis.canvas?.dimensions?.distance
  };
}

function workflowId(workflow) {
  const id = clean(workflow?.id ?? workflow?.uuid);
  if (!id) throw new TypeError("Bomb workflow must have an id");
  return id;
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return [];
}

function tokenDocument(value) {
  return value?.document ?? value ?? null;
}

function tokenActor(value) {
  return tokenDocument(value)?.actor ?? value?.actor ?? null;
}

function tokenUuid(value) {
  return clean(tokenDocument(value)?.uuid ?? value?.uuid);
}

function effectDurationPatch(origin) {
  return {
    origin,
    duration: { rounds: 1, turns: 0 },
    "flags.dae.specialDuration": ["turnEndSource", "combatEnd"]
  };
}

async function makeTimedStatus(statusService, actor, status, options, origin) {
  const effect = await statusService.setStatus(actor, status, options);
  if (effect && typeof effect.update === "function") await effect.update(effectDurationPatch(origin));
  return effect;
}

function createdOne(created) {
  return Array.isArray(created) ? created[0] ?? null : created ?? null;
}

function documentId(document) {
  return clean(document?.id ?? document?._id);
}

function documentUuid(document, scene, type) {
  return clean(document?.uuid) || (documentId(document) ? `${scene.uuid}.${type}.${documentId(document)}` : "");
}

function bombDocumentFlags(payload, extra = {}) {
  return {
    [MODULE_ID]: {
      [ALCHEMY_BOMB_FLAG]: {
        version: 1,
        operationId: payload.operationId,
        actorUuid: payload.actorUuid,
        productId: payload.productId ?? "",
        ...extra
      }
    }
  };
}

function gridMetrics(scene) {
  const size = Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100);
  const distance = Number(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance ?? 5);
  if (!(size > 0) || !(distance > 0)) throw new Error("Scene grid metrics are unavailable.");
  return { size, distance };
}

function tokenCenter(token, gridSize) {
  return {
    x: Number(token?.x ?? 0) + ((Number(token?.width ?? 1) * gridSize) / 2),
    y: Number(token?.y ?? 0) + ((Number(token?.height ?? 1) * gridSize) / 2)
  };
}

function tokensInRadius(scene, point, radius) {
  const { size, distance } = gridMetrics(scene);
  const pixelRadius = (radius / distance) * size;
  return collectionValues(scene?.tokens).filter((token) => {
    if (!token?.actor) return false;
    const center = tokenCenter(token, size);
    return Math.hypot(center.x - point.x, center.y - point.y) <= pixelRadius;
  });
}

function equippedArmor(actor) {
  return collectionValues(actor?.items).find((item) => item?.type === "equipment"
    && item?.system?.equipped === true
    && ["light", "medium", "heavy", "natural"].includes(clean(item?.system?.type?.value ?? item?.system?.armor?.type))) ?? null;
}

async function createEffect(actor, data) {
  const created = await actor?.createEmbeddedDocuments?.("ActiveEffect", [data]);
  return createdOne(created);
}

export class AlchemyBombRuntimeService {
  #durabilityService;
  #gridProvider;
  #mapObjectTokenService;
  #mutationRequester;
  #placementProvider;
  #rangeOverlayFactory;
  #resolveUuid;
  #sessions = new Map();
  #statusService;
  #targetUpdater;

  constructor({
    placementProvider = defaultPlacementProvider,
    mutationRequester,
    gridProvider = defaultGridProvider,
    rangeOverlayFactory = createReachBoundaryOverlay,
    statusService = null,
    durabilityService = null,
    mapObjectTokenService = null,
    resolveUuid = (uuid) => globalThis.fromUuid?.(uuid),
    targetUpdater = (ids) => globalThis.game?.user?.updateTokenTargets?.(ids)
  } = {}) {
    if (typeof placementProvider !== "function") throw new TypeError("placementProvider must be a function");
    if (typeof mutationRequester !== "function") throw new TypeError("mutationRequester must be a function");
    if (typeof gridProvider !== "function") throw new TypeError("gridProvider must be a function");
    if (typeof rangeOverlayFactory !== "function") throw new TypeError("rangeOverlayFactory must be a function");
    this.#placementProvider = placementProvider;
    this.#mutationRequester = mutationRequester;
    this.#gridProvider = gridProvider;
    this.#rangeOverlayFactory = rangeOverlayFactory;
    this.#statusService = statusService;
    this.#durabilityService = durabilityService;
    this.#mapObjectTokenService = mapObjectTokenService;
    this.#resolveUuid = resolveUuid;
    this.#targetUpdater = targetUpdater;
  }

  async prepareWorkflow(workflow) {
    const definition = bombDefinition(workflow);
    if (definition?.kind !== "bomb") return true;
    const id = workflowId(workflow);
    if (this.#sessions.has(id)) return true;

    const actor = workflow?.actor ?? workflow?.activity?.actor ?? workflow?.item?.actor;
    const item = workflow?.item ?? workflow?.activity?.item;
    const activity = workflow?.activity;
    const token = sourceToken(workflow);
    const scene = sceneOf(token);
    const image = clean(itemFlag(item, "topDownImage"));
    if (!clean(actor?.uuid) || !clean(item?.uuid) || !clean(activity?.uuid) || !clean(token?.uuid) || !clean(scene?.uuid)) {
      throw new Error("Для броска бомбы нужен один токен персонажа на активной сцене.");
    }
    if (!image) throw new Error("У бомбы отсутствует top-down изображение.");

    const restoreSheet = await minimizeActorSheet(actor);
    let placed = null;
    try {
      const grid = this.#gridProvider();
      const gridSize = finite(grid?.size, "grid size");
      const gridDistance = finite(grid?.distance, "grid distance");
      if (gridSize <= 0 || gridDistance <= 0) throw new RangeError("grid metrics must be positive");
      const rangeOverlay = this.#rangeOverlayFactory({
        sourceToken: token,
        reachFeet: BOMB_THROW_RANGE_FEET,
        grid: { size: gridSize, distance: gridDistance },
        markerRadiusPixels: 0
      });
      let placements;
      try {
        placements = await this.#placementProvider({
          tokens: [buildPreviewPrototype({ actor, name: clean(item?.name) || "Бомба", image })],
          origin: { elevation: finite(token?.elevation ?? 0, "source token elevation") }
        });
      }
      finally {
        rangeOverlay?.destroy?.();
      }
      const placement = Array.isArray(placements) ? placements[0] : null;
      if (!placement) {
        await restoreSheet();
        return false;
      }

      const x = finite(placement.x, "placement x") + ((gridSize * BOMB_TOKEN_SIZE) / 2);
      const y = finite(placement.y, "placement y") + ((gridSize * BOMB_TOKEN_SIZE) / 2);
      if (bombThrowDistanceFeet(token, { x, y }, { size: gridSize, distance: gridDistance }) > BOMB_THROW_RANGE_FEET + 1e-9) {
        throw codedError("outside-throw-range", `Точка броска находится дальше ${BOMB_THROW_RANGE_FEET} футов.`);
      }
      const payload = {
        action: "place",
        operationId: id,
        actorUuid: clean(actor.uuid),
        sourceTokenUuid: clean(token.uuid),
        sceneUuid: clean(scene.uuid),
        itemUuid: clean(item.uuid),
        activityUuid: clean(activity.uuid),
        productId: clean(itemFlag(item, "alchemyProductId")),
        name: clean(item.name) || "Бомба",
        image,
        x,
        y,
        elevation: finite(placement.elevation ?? token?.elevation ?? 0, "placement elevation"),
        radius: finite(definition.radius, "bomb radius"),
        persistent: definition.persistent === true,
        family: clean(definition.family),
        dc: finite(definition.dc, "bomb save DC"),
        durationSeconds: finite(definition.effect?.durationSeconds ?? 0, "bomb duration")
      };
      placed = await this.#mutationRequester(payload);
      const targetUuids = Array.isArray(placed?.targetTokenUuids) ? placed.targetTokenUuids.map(clean).filter(Boolean) : [];
      if (targetUuids.length) {
        const targets = (await Promise.all(targetUuids.map((uuid) => this.#resolveUuid(uuid)))).filter(Boolean);
        workflow.targets = new Set(targets.map((target) => target?.object ?? target));
        await this.#targetUpdater(targets.map((target) => clean(target?.id ?? target?.document?.id)).filter(Boolean));
      }
      const session = {
        definition: structuredClone(definition),
        persistent: definition.persistent === true,
        restoreSheet,
        actorUuid: payload.actorUuid,
        sourceTokenUuid: payload.sourceTokenUuid,
        sceneUuid: payload.sceneUuid,
        operationId: id,
        tokenUuid: clean(placed?.tokenUuid),
        templateUuid: clean(placed?.templateUuid),
        regionUuid: clean(placed?.regionUuid),
        point: { x: payload.x, y: payload.y }
      };
      if (!session.tokenUuid || !session.templateUuid) {
        throw new Error("Размещение бомбы не вернуло токен и шаблон.");
      }
      this.#sessions.set(id, session);
      return true;
    }
    catch (error) {
      if (placed?.tokenUuid || placed?.templateUuid) {
        await this.#requestCleanup({
          actorUuid: clean(actor?.uuid),
          sceneUuid: clean(scene?.uuid),
          operationId: id,
          tokenUuid: clean(placed?.tokenUuid),
          templateUuid: clean(placed?.templateUuid),
          regionUuid: clean(placed?.regionUuid)
        }).catch(() => {});
      }
      await restoreSheet();
      throw error;
    }
  }

  async completeWorkflow(workflow) {
    const id = clean(workflow?.id ?? workflow?.uuid);
    const session = this.#sessions.get(id);
    if (!session) return false;
    try {
      await this.#mutationRequester({
        action: "apply-results",
        operationId: session.operationId,
        actorUuid: session.actorUuid,
        sourceTokenUuid: session.sourceTokenUuid,
        sceneUuid: session.sceneUuid,
        family: session.definition.family,
        failedTokenUuids: Array.from(workflow?.failedSaves ?? []).map(tokenUuid).filter(Boolean),
        savedTokenUuids: Array.from(workflow?.saves ?? []).map(tokenUuid).filter(Boolean),
        effect: structuredClone(session.definition.effect),
        point: structuredClone(session.point),
        regionUuid: session.regionUuid ?? ""
      });
      return await this.#finishWorkflow(workflow, { forceCleanup: false });
    }
    catch (error) {
      await this.#finishWorkflow(workflow, { forceCleanup: true }).catch(() => {});
      throw error;
    }
  }

  async abortWorkflow(workflow) {
    return this.#finishWorkflow(workflow, { forceCleanup: true });
  }

  async #finishWorkflow(workflow, { forceCleanup }) {
    const id = clean(workflow?.id ?? workflow?.uuid);
    const session = this.#sessions.get(id);
    if (!session) return false;
    this.#sessions.delete(id);
    try {
      if (forceCleanup || !session.persistent) await this.#requestCleanup(session);
      return true;
    }
    finally {
      await session.restoreSheet();
    }
  }

  #requestCleanup(session) {
    return this.#mutationRequester({
      action: "cleanup",
      operationId: session.operationId,
      actorUuid: session.actorUuid,
      sceneUuid: session.sceneUuid,
      tokenUuid: session.tokenUuid,
      templateUuid: session.templateUuid,
      regionUuid: session.regionUuid ?? ""
    });
  }

  async handleSocketMutation(payload, { actor, scene } = {}) {
    if (payload.action === "cleanup") return this.#cleanupSceneDocuments(payload, scene);
    if (payload.action === "apply-results") {
      const getToken = (uuid) => scene?.tokens?.get?.(clean(uuid).split(".").at(-1));
      return this.#applyFamilyResults({
        actor,
        failedSaves: new Set(payload.failedTokenUuids.map(getToken).filter(Boolean)),
        saves: new Set(payload.savedTokenUuids.map(getToken).filter(Boolean))
      }, {
        operationId: payload.operationId,
        definition: { family: payload.family, effect: payload.effect },
        point: payload.point,
        regionUuid: payload.regionUuid
      });
    }
    if (payload.action !== "place") throw new Error("Unsupported alchemy bomb mutation action.");
    if (typeof scene?.createEmbeddedDocuments !== "function") throw new Error("Alchemy bomb scene is not writable.");

    const { size, distance } = gridMetrics(scene);
    const templateActor = this.#mapObjectTokenService?.getManagedTemplateActor?.();
    if (!templateActor?.id) throw new Error("Managed map object template actor was not found.");
    const topLeft = {
      x: payload.x - ((size * BOMB_TOKEN_SIZE) / 2),
      y: payload.y - ((size * BOMB_TOKEN_SIZE) / 2)
    };
    let token = null;
    let template = null;
    let region = null;
    try {
      token = createdOne(await scene.createEmbeddedDocuments("Token", [{
        actorId: templateActor.id,
        actorLink: false,
        name: payload.name,
        x: topLeft.x,
        y: topLeft.y,
        elevation: payload.elevation,
        width: BOMB_TOKEN_SIZE,
        height: BOMB_TOKEN_SIZE,
        texture: { src: payload.image },
        sight: { enabled: false },
        disposition: 0,
        flags: bombDocumentFlags(payload)
      }]));
      template = createdOne(await scene.createEmbeddedDocuments("MeasuredTemplate", [{
        t: "circle",
        x: payload.x,
        y: payload.y,
        distance: payload.radius,
        direction: 0,
        angle: 360,
        fillColor: "#c98b35",
        flags: bombDocumentFlags(payload)
      }]));
      if (payload.persistent) {
        const pixelRadius = (payload.radius / distance) * size;
        region = createdOne(await scene.createEmbeddedDocuments("Region", [{
          name: payload.name,
          color: "#c98b35",
          shapes: [{ type: "circle", x: payload.x, y: payload.y, radius: pixelRadius }],
          elevation: { bottom: payload.elevation - 1, top: payload.elevation + 1 },
          behaviors: [
            { name: "Труднопроходимая местность", type: "dnd5e.difficultTerrain", system: { magical: false, types: [], ignoredDispositions: [] } },
            { name: "Спасбросок липкой бомбы", type: "executeScript", system: { events: ["tokenMoveIn", "tokenTurnStart"], source: STICKY_REGION_SCRIPT } }
          ],
          flags: bombDocumentFlags(payload, {
            family: payload.family,
            dc: payload.dc,
            expiresAt: Number(globalThis.game?.time?.worldTime ?? 0) + payload.durationSeconds
          })
        }]));
        if (typeof region?.update === "function") {
          await region.update({
            [`flags.${MODULE_ID}.${ALCHEMY_BOMB_FLAG}.tokenUuid`]: documentUuid(token, scene, "Token"),
            [`flags.${MODULE_ID}.${ALCHEMY_BOMB_FLAG}.templateUuid`]: documentUuid(template, scene, "MeasuredTemplate")
          });
        }
      }
    }
    catch (error) {
      for (const [type, document] of [["Region", region], ["MeasuredTemplate", template], ["Token", token]]) {
        const id = documentId(document);
        if (id) await scene.deleteEmbeddedDocuments?.(type, [id]).catch(() => {});
      }
      throw error;
    }
    return {
      tokenUuid: documentUuid(token, scene, "Token"),
      templateUuid: documentUuid(template, scene, "MeasuredTemplate"),
      regionUuid: documentUuid(region, scene, "Region"),
      targetTokenUuids: tokensInRadius(scene, { x: payload.x, y: payload.y }, payload.radius).map((entry) => clean(entry.uuid)).filter(Boolean)
    };
  }

  async handleStickyRegionEvent({ region, event } = {}) {
    if (!globalThis.game?.user?.isGM) return false;
    const flag = region?.flags?.[MODULE_ID]?.[ALCHEMY_BOMB_FLAG];
    const token = event?.data?.token;
    const actor = token?.actor;
    const dc = Number(flag?.dc);
    if (!actor || !Number.isFinite(dc)) return false;
    const rolls = await actor.rollSavingThrow?.({ ability: "dex", target: dc }, { configure: false }, {});
    const total = Number(Array.isArray(rolls) ? rolls[0]?.total : rolls?.total);
    if (Number.isFinite(total) && total >= dc) return true;
    await this.#applyStickySpeedZero(actor, region.uuid);
    return false;
  }

  async cleanupExpiredStickyZones(worldTime = Number(globalThis.game?.time?.worldTime ?? 0)) {
    if (!globalThis.game?.user?.isGM) return 0;
    let removed = 0;
    for (const scene of collectionValues(globalThis.game?.scenes)) {
      const regions = collectionValues(scene?.regions).filter((region) => {
        const flag = region?.flags?.[MODULE_ID]?.[ALCHEMY_BOMB_FLAG];
        return Number.isFinite(Number(flag?.expiresAt)) && Number(flag.expiresAt) <= worldTime;
      });
      for (const region of regions) {
        const flag = region.flags[MODULE_ID][ALCHEMY_BOMB_FLAG];
        await this.#cleanupSceneDocuments({
          operationId: flag.operationId,
          tokenUuid: clean(flag.tokenUuid),
          templateUuid: clean(flag.templateUuid),
          regionUuid: clean(region.uuid)
        }, scene);
        removed += 1;
      }
    }
    return removed;
  }

  async #applyFamilyResults(workflow, session) {
    const definition = session.definition;
    const failed = Array.from(workflow?.failedSaves ?? []);
    const saved = Array.from(workflow?.saves ?? []);
    const sourceActor = workflow?.actor ?? workflow?.activity?.actor ?? workflow?.item?.actor;
    const sourceOrigin = clean(sourceActor?.uuid);
    const failedActors = failed.map(tokenActor).filter(Boolean);
    if (!failedActors.length && definition.family !== "electrical") return;

    if (definition.family === "alchemical-fire") {
      for (const actor of failedActors) await this.#statusService?.applyDecayingDamage?.(actor, definition.effect.amount, {
        step: definition.effect.step,
        damageType: "fire",
        sourceActorId: clean(sourceActor?.id)
      });
      return;
    }
    if (definition.family === "acid") {
      for (const actor of failedActors) {
        const armor = equippedArmor(actor);
        if (!armor) continue;
        if (definition.effect.breakage >= 2) await this.#durabilityService?.destroyItem?.(armor, { mutationId: `${session.operationId}:${actor.uuid}:acid` });
        else await this.#durabilityService?.breakItem?.(armor, { mutationId: `${session.operationId}:${actor.uuid}:acid` });
      }
      return;
    }
    if (definition.family === "electrical") {
      for (const [entries, amount] of [[failed, definition.effect.failureWeakness], [saved, definition.effect.successWeakness]]) {
        for (const target of entries) {
          const actor = tokenActor(target);
          if (!actor) continue;
          await createEffect(actor, {
            name: `Слабость к электричеству ${amount}`,
            icon: workflow?.item?.img,
            origin: sourceOrigin,
            duration: { rounds: 1, turns: 0 },
            changes: [{ key: "system.traits.dm.amount.lightning", mode: 2, value: String(amount), priority: 20 }],
            flags: { dae: { specialDuration: ["turnEndSource", "combatEnd"] }, [MODULE_ID]: { [ALCHEMY_BOMB_FLAG]: { operationId: session.operationId } } }
          });
        }
      }
      return;
    }
    if (definition.family === "cryogenic") {
      for (const actor of failedActors) await makeTimedStatus(this.#statusService, actor, "rebreya-discreet", { value: definition.effect.restrained }, clean(actor.uuid));
      return;
    }
    if (definition.family === "frightening") {
      for (const actor of failedActors) await makeTimedStatus(this.#statusService, actor, "frightened", {
        value: definition.effect.frightened,
        sourceActor,
        meta: { sourcePoint: session.point }
      }, clean(actor.uuid));
      return;
    }
    if (definition.family === "stinking") {
      for (const actor of failedActors) await this.#statusService?.setStatus?.(actor, "rebreya-nauseated", { value: definition.effect.nauseated });
      return;
    }
    if (definition.family === "sticky") {
      for (const actor of failedActors) await this.#applyStickySpeedZero(actor, session.regionUuid);
    }
  }

  async #applyStickySpeedZero(actor, origin) {
    return createEffect(actor, {
      name: "Скован липкой бомбой",
      icon: "icons/svg/net.svg",
      origin,
      changes: [{ key: "system.attributes.movement.all", mode: 0, value: "0", priority: 30 }],
      flags: { dae: { showIcon: true }, [MODULE_ID]: { [ALCHEMY_BOMB_FLAG]: { sticky: true } } }
    });
  }

  async #cleanupSceneDocuments(payload, scene) {
    const groups = [
      ["Token", payload.tokenUuid],
      ["MeasuredTemplate", payload.templateUuid],
      ["Region", payload.regionUuid]
    ];
    for (const [type, uuid] of groups) {
      const id = clean(uuid).split(".").at(-1);
      if (!id) continue;
      const collection = type === "Token" ? scene?.tokens : type === "MeasuredTemplate" ? scene?.templates : scene?.regions;
      const document = collection?.get?.(id);
      const flag = document?.flags?.[MODULE_ID]?.[ALCHEMY_BOMB_FLAG];
      if (flag?.operationId !== payload.operationId) continue;
      await scene.deleteEmbeddedDocuments?.(type, [id]);
    }
    return { removed: true };
  }
}
