import { CLASS_FEATURES_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { SAND_MANIFESTATION_ACTIVITY_ID, buildSandChildItemPatch, sandChildFeatureKind } from "../data/sand-child-features.js?v=1.6.13";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { getItemHeldHands, itemRequiresTwoHandsForUse } from "../integrations/held-items.js?v=1.5.29";
import { completedSandMovementDistance, sandDestinationIsFree, sandPlacementCells, sandTokenBounds, sandTokenContainsCell } from "./sand-child-geometry.js?v=1.6.13";
import { GROUPED_COMBAT_FLAG } from "./turn-group-rules.js?v=1.5.87";

const MANIFESTATION = "sandChildManifestation";
const ACTIVATION = "sandChildActivation";
const ACTIVATION_RECEIPTS = "sandChildActivationReceipts";
const SAND = "sandChild";
const PLACEMENTS = "sandChildPlacements";
const ABSORPTIONS = "sandChildAbsorptions";
const COVER = "sandChildCover";
const SAND_TEXTURE = "modules/rebreya-main/assets/sand-child/sand-tile.webp";
const DURATION = 60;
const CARD_LIFETIME = 120000;
const INCAPACITATED = ["incapacitated", "unconscious", "dead", "stunned", "paralyzed", "petrified"];
const ONE_HANDED_ATTACK_MODES = ["oneHanded", "offhand", "thrown", "thrown-offhand"];
const flagPath = key => `flags.${MODULE_ID}.${key}`;
const flag = (document, key) => document?.flags?.[MODULE_ID]?.[key];
const collectionValues = collection => Array.from(collection?.values?.() ?? collection ?? []);
const rejected = reason => ({ applied: false, reason });
const stats = actor => actor.system?.attributes;
const tempHp = actor => Number(stats(actor)?.hp?.temp) || 0;
const prof = actor => Math.max(0, Math.floor(Number(stats(actor)?.prof) || 0));
const spentUses = item => Math.max(0, Number(item.system?.uses?.spent) || 0);
const tileKey = (row, col) => `${row}:${col}`;
const elevation = document => Number(document.elevation) || 0;
const isManifestationActivity = activity => activity?.id === SAND_MANIFESTATION_ACTIVITY_ID
  && sandChildFeatureKind(activity.item) === "manifestation";

function cannotManifest(actor) {
  if (INCAPACITATED.some(status => actor.statuses?.has(status))) return "incapacitated";
  if (collectionValues(actor.items).some(item => item.type === "equipment" && item.system?.equipped
    && ["medium", "heavy"].includes(item.system.type?.value ?? item.system.armor?.type))) return "armor";
  return null;
}

function runInQueue(queue, key, operation) {
  const result = (queue.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  queue.set(key, result);
  return result.finally(() => {
    if (queue.get(key) === result) queue.delete(key);
  });
}

export class SandChildService {
  #actorOperations = new Map();
  #sceneOperations = new Map();
  #coverOperations = new Map();
  #observedRoutes = new WeakMap();
  #movements = new Map();
  #tileIndexes = new Map();
  #manifestingActors = new Map();
  #featureSources = null;

  constructor({ game = () => globalThis.game, resolve = uuid => globalThis.fromUuid(uuid),
    isActiveGM = () => isActiveGmClient(game()), now = Date.now,
    roll = async actor => (await new globalThis.Roll("1d10 + @abilities.cha.mod", actor.getRollData()).evaluate()).total,
    halfCover = async () => (await globalThis.ActiveEffect.fromStatusEffect("coverHalf")).toObject(),
    newId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    gateway } = {}) {
    Object.assign(this, { game, resolve, isActiveGM, now, roll, halfCover, newId, gateway });
  }

  worldTime() {
    return Number(this.game()?.time?.worldTime) || 0;
  }

  tokenForActor(actor) {
    if (!actor) return null;
    if (actor.token?.actor === actor) return actor.token;
    const tokens = (globalThis.canvas?.tokens?.controlled ?? []).filter(token => token.actor?.uuid === actor.uuid);
    if (tokens.length === 1) return tokens[0].document;
    if (tokens.length > 1) return null;
    const active = actor.getActiveTokens?.(false, true) ?? [];
    return active.length === 1 ? active[0] : null;
  }

  async canControl(tokenUuid, sender) {
    return Boolean(await this.#ownedToken(tokenUuid, sender));
  }

  async #ownedToken(tokenUuid, sender) {
    if (!sender) return null;
    const token = await this.resolve(tokenUuid);
    if (!token?.parent?.tokens?.has(token.id) || !token.actor) return null;
    if (sender.isGM || (sender.viewedScene === token.parent.id && token.actor.testUserPermission?.(sender, "OWNER"))) return token;
    return null;
  }

  #forActor(actor, operation) {
    return runInQueue(this.#actorOperations, actor.uuid, operation);
  }

  getManifestation(token) {
    const at = this.worldTime();
    return collectionValues(token?.actor?.effects).find(effect => {
      const state = flag(effect, MANIFESTATION);
      return state?.tokenUuid === token.uuid && state.expiresAt > at && !effect.disabled && !effect.isSuppressed;
    }) ?? null;
  }

  prepareManifestation(activity, usageConfig, messageConfig) {
    if (!isManifestationActivity(activity)) return true;
    const actor = activity.actor ?? activity.item.actor;
    const token = this.tokenForActor(actor);
    const reason = !token ? "token" : this.#manifestationBlocker(token, activity.item);
    if (reason) {
      this.report({ applied: false, reason });
      return false;
    }
    if (usageConfig) usageConfig.consume = false;
    if (messageConfig?.data) messageConfig.data.speaker = { scene: token.parent.id, token: token.id, actor: actor.id, alias: token.name };
    return true;
  }

  async requestManifestation(activity, results) {
    if (!isManifestationActivity(activity) || !results?.message?.id) return;
    const { scene, token } = results.message.speaker ?? {};
    const source = this.game()?.scenes?.get(scene)?.tokens?.get(token);
    if (!source) return this.report(rejected("token"));
    return this.request("activate", { tokenUuid: source.uuid, itemUuid: activity.item.uuid, messageId: results.message.id });
  }

  async request(action, payload) {
    try {
      const result = await this.gateway?.mutate(`combat.sandChild.${action}`, payload);
      this.report(result);
      return result;
    } catch (error) {
      console.error(`${MODULE_ID} | Sand Child command failed.`, error);
      this.report(rejected("failed"));
      return rejected("failed");
    }
  }

  report(result) {
    if (result?.applied !== false) return;
    globalThis.ui?.notifications?.warn(`REBREYA_MAIN.SandChild.${result.reason ?? "failed"}`, { localize: true });
  }

  #manifestationBlocker(token, item) {
    const actor = token.actor;
    return cannotManifest(actor) ?? (collectionValues(actor.effects).some(effect => {
      const state = flag(effect, MANIFESTATION);
      return state && state.expiresAt > this.worldTime() && !effect.disabled && !effect.isSuppressed;
    }) ? "active" : spentUses(item) >= prof(actor) ? "empty" : null);
  }

  #validCard(message, sender, token, item) {
    const uuid = message?.system?.activity?.uuid ?? message?.flags?.dnd5e?.activity?.uuid;
    const author = message?.author?.id ?? message?.user?.id;
    return Boolean(message && author === sender.id && this.now() - Number(message.timestamp) <= CARD_LIFETIME
      && uuid === `${item.uuid}.Activity.${SAND_MANIFESTATION_ACTIVITY_ID}`
      && message.speaker?.scene === token.parent.id && message.speaker?.token === token.id);
  }

  async activate({ tokenUuid, itemUuid, messageId }, { sender } = {}) {
    const token = await this.#ownedToken(tokenUuid, sender);
    if (!this.isActiveGM() || !token) return rejected("token");
    const actor = token.actor;
    const result = await this.#forActor(actor, async () => {
      const item = collectionValues(actor.items).find(candidate => candidate.uuid === itemUuid);
      if (sandChildFeatureKind(item) !== "manifestation") return rejected("card");
      const pending = flag(item, ACTIVATION);
      if (pending) {
        if (pending.messageId !== messageId || pending.tokenUuid !== tokenUuid) return rejected("active");
        return this.#finishActivation(actor, item, pending);
      }
      const message = this.game()?.messages?.get(messageId);
      if (!this.#validCard(message, sender, token, item)) return rejected("card");
      if (this.#activationReceipts(actor).some(entry => entry.messageId === messageId)) return { applied: true };
      const reason = this.#manifestationBlocker(token, item);
      if (reason) return rejected(reason);
      const total = await this.roll(actor);
      if (!Number.isFinite(total)) return rejected("failed");
      const state = { messageId, tokenUuid, startedAt: this.worldTime(), issuedAt: Number(message.timestamp), total };
      await item.update({ "system.uses.spent": spentUses(item) + 1, [flagPath(ACTIVATION)]: state });
      return this.#finishActivation(actor, item, state);
    });
    if (result.applied) await this.reconcileCover(token);
    return result;
  }

  #activationReceipts(actor) {
    return (flag(actor, ACTIVATION_RECEIPTS) ?? []).filter(entry => this.now() - entry.issuedAt <= CARD_LIFETIME);
  }

  async #finishActivation(actor, item, state) {
    const receipts = this.#activationReceipts(actor);
    if (!(flag(actor, ACTIVATION_RECEIPTS) ?? []).some(entry => entry.messageId === state.messageId)) {
      const expiresAt = state.startedAt + DURATION;
      if (expiresAt > this.worldTime() && !cannotManifest(actor)
        && !collectionValues(actor.effects).some(effect => flag(effect, MANIFESTATION)?.messageId === state.messageId)) {
        await actor.createEmbeddedDocuments("ActiveEffect", [{
          name: item.name, img: item.img, origin: item.uuid,
          duration: { seconds: DURATION, startTime: state.startedAt },
          flags: { [MODULE_ID]: { [MANIFESTATION]: { tokenUuid: state.tokenUuid, messageId: state.messageId, expiresAt } } }
        }]);
      }
      this.#manifestingActors.set(actor.uuid, actor);
      const updated = Math.max(0, tempHp(actor), state.total);
      const update = { [flagPath(ACTIVATION_RECEIPTS)]: [...receipts, { messageId: state.messageId, issuedAt: state.issuedAt }] };
      if (updated !== tempHp(actor)) update["system.attributes.hp.temp"] = updated;
      await actor.update(update);
    }
    await item.update({ [flagPath(ACTIVATION)]: null });
    return { applied: true };
  }

  async endManifestation({ tokenUuid, effectId }, { sender } = {}) {
    const token = await this.#ownedToken(tokenUuid, sender);
    if (!this.isActiveGM() || !token) return rejected("token");
    const result = await this.#forActor(token.actor, async () => {
      const effect = token.actor.effects?.get(effectId);
      if (flag(effect, MANIFESTATION)?.tokenUuid === token.uuid) await effect.delete();
      return { applied: true };
    });
    if (this.#movements.get(token.uuid)?.effectId === effectId) this.#movements.delete(token.uuid);
    await this.reconcileCover(token);
    return result;
  }

  attackCompleted({ token, item, attackId, attackMode }) {
    if (!attackId || item?.type !== "weapon" || !token?.actor || item.actor?.uuid !== token.actor.uuid) return;
    if (ONE_HANDED_ATTACK_MODES.includes(attackMode) || (attackMode !== "twoHanded"
      && getItemHeldHands(item).length < 2 && !itemRequiresTwoHandsForUse(item))) return;
    const effect = this.getManifestation(token);
    if (!effect) return;
    const payload = { tokenUuid: token.uuid, effectId: effect.id };
    if (this.isActiveGM()) return this.endManifestation(payload, { sender: this.game().user });
    return this.request("end", payload);
  }

  async reconcileActor(actor) {
    if (!actor?.uuid || !this.isActiveGM()) return;
    const effects = collectionValues(actor.effects).filter(effect => flag(effect, MANIFESTATION));
    const card = collectionValues(actor.items).find(item => flag(item, ACTIVATION) && sandChildFeatureKind(item) === "manifestation");
    if (!effects.length && !card) {
      this.#manifestingActors.delete(actor.uuid);
      return;
    }
    await this.#forActor(actor, async () => {
      const pending = flag(card, ACTIVATION);
      if (pending) await this.#finishActivation(actor, card, pending);
      for (const effect of effects) {
        const current = actor.effects?.get(effect.id);
        if (current && (cannotManifest(actor) || flag(current, MANIFESTATION).expiresAt <= this.worldTime())) await current.delete();
      }
    });
    if (collectionValues(actor.effects).some(effect => flag(effect, MANIFESTATION))) this.#manifestingActors.set(actor.uuid, actor);
    else this.#manifestingActors.delete(actor.uuid);
    for (const effect of effects) {
      const token = await this.resolve(flag(effect, MANIFESTATION).tokenUuid);
      if (token) await this.reconcileCover(token);
    }
  }

  async repairItem(item) {
    const kind = item?.actor && sandChildFeatureKind(item);
    if (!kind || !this.isActiveGM()) return;
    const pack = this.game()?.packs?.get(`world.${CLASS_FEATURES_COMPENDIUM_NAME}`);
    if (!pack) return;
    const featureIds = await (this.#featureSources ??= pack.getIndex({ fields: [flagPath("featureId")] }).then(index =>
      new Map(collectionValues(index).filter(entry => sandChildFeatureKind(entry)).map(entry => [sandChildFeatureKind(entry), entry._id]))
    ).catch(error => {
      this.#featureSources = null;
      throw error;
    }));
    const id = featureIds.get(kind);
    const source = id && await pack.getDocument(id);
    const patch = buildSandChildItemPatch(item, source);
    if (patch) await item.update(patch);
  }

  async initializeActor(actor) {
    if (!actor || !this.isActiveGM()) return;
    for (const item of collectionValues(actor?.items)) {
      if (sandChildFeatureKind(item)) await this.repairItem(item);
    }
    for (const effect of collectionValues(actor.effects)) {
      const coverTokenUuid = flag(effect, COVER);
      const tokenUuid = coverTokenUuid ?? flag(effect, MANIFESTATION)?.tokenUuid;
      if (!tokenUuid) continue;
      const token = await this.resolve(tokenUuid);
      if (!token?.parent?.tokens?.has(token.id) || token.actor?.uuid !== actor.uuid) await effect.delete();
      else if (coverTokenUuid) await this.reconcileCover(token);
    }
    await this.reconcileActor(actor);
  }

  #turnKey(token, ownTurn) {
    const game = this.game();
    const scene = token.parent;
    const sceneIdOf = combat => combat.scene?.id ?? combat.scene;
    const tokenIsMember = (combat, member) => member.tokenId === token.id
      && (member.sceneId ?? sceneIdOf(combat)) === scene.id;
    const encounters = collectionValues(game?.combats).filter(combat => combat.active && combat.started
      && combat.turns?.some(member => tokenIsMember(combat, member)));
    const combat = encounters.find(value => sceneIdOf(value) === scene.id) ?? encounters.find(value => !sceneIdOf(value));
    if (!combat) return `world:${Math.floor(this.worldTime() / 6)}`;
    const index = combat.turns.findIndex(member => tokenIsMember(combat, member));
    const grouped = flag(combat, GROUPED_COMBAT_FLAG);
    if (game.rebreyaMain?.groupedCombatService?.groupedEnabled !== false && grouped?.mode === "active") {
      const position = grouped.executionPosition ?? grouped.current;
      const current = grouped.groups?.findIndex(group => group.id === position?.groupId) ?? -1;
      const own = grouped.groups?.findIndex(group => group.memberIds.includes(combat.turns[index].id)) ?? -1;
      if (own >= 0 && current >= 0) {
        if (ownTurn) return `${combat.id}:${position.round - Number(current < own)}:own`;
        return `${combat.id}:${position.round}:group:${position.groupId}`;
      }
    }
    if (!ownTurn) return `${combat.id}:${combat.round}:${combat.turn}`;
    const round = combat.round - Number(combat.turn < index);
    return `${combat.id}:${round}:own`;
  }

  async observeMovement(token, movement, user, operation = {}) {
    if (!movement?.id || !token?.actor || !user?.id) return null;
    if (this.#observedRoutes.get(token) === movement.id) return null;
    this.#observedRoutes.set(token, movement.id);
    const effect = this.getManifestation(token);
    if (!effect) {
      this.#movements.delete(token.uuid);
      return null;
    }
    const grid = token.parent?.grid;
    if (!sandTokenBounds(token, grid)) return null;
    const previous = this.#movements.get(token.uuid);
    const continuation = previous && movement.chain?.includes(previous.lastId) && previous.effectId === effect.id;
    const forced = operation[MODULE_ID]?.grappleBypass || operation.isUndo || operation.isPaste;
    const native = token.movement?.id === movement.id ? token.movement : null;
    const committed = native?.state === "completed";
    const destination = committed ? (movement.passed?.waypoints?.at(-1) ?? movement.destination) : movement.destination;
    const state = {
      movementId: continuation ? previous.movementId : movement.id, lastId: movement.id,
      x: destination?.x, y: destination?.y,
      effectId: effect.id, userId: user.id, key: this.#turnKey(token, true),
      distance: forced ? 0 : (continuation ? previous.distance : 0) + completedSandMovementDistance(movement, grid)
    };
    this.#movements.set(token.uuid, state);
    state.completion = Promise.resolve(committed || movement.finished).then(completed => {
      if (completed !== true || this.#movements.get(token.uuid) !== state || movement.pending?.waypoints?.length
        || token.x !== state.x || token.y !== state.y || state.distance < 5 || !sandDestinationIsFree(token, grid)) return null;
      state.completed = true;
      return this.getPlacementOpportunity(token);
    });
    const [opportunity] = await Promise.all([state.completion, this.isActiveGM() && this.reconcileCover(token)]);
    return opportunity;
  }

  getPlacementOpportunity(token) {
    const state = this.#movements.get(token?.uuid);
    if (!state?.completed || this.getManifestation(token)?.id !== state.effectId || state.key !== this.#turnKey(token, true)
      || token.x !== state.x || token.y !== state.y) return null;
    const ledger = flag(token.actor, PLACEMENTS);
    const entries = ledger?.key === state.key ? ledger.entries : [];
    const placement = entries.find(entry => entry.tokenUuid === token.uuid && entry.movementId === state.movementId);
    if (placement) {
      if (!placement.pending) return null;
      const { row, col } = placement;
      return { movementId: state.movementId, cells: [{ row, col, underToken: sandTokenContainsCell(token, token.parent.grid, row, col) }] };
    }
    if (entries.length >= prof(token.actor)) return null;
    const cells = this.#availablePlacementCells(token);
    return cells.length ? { movementId: state.movementId, cells } : null;
  }

  getManualPlacementOpportunity(token, sender) {
    const effect = sender?.isGM && this.getManifestation(token);
    if (!effect) return null;
    const ledger = flag(token.actor, PLACEMENTS);
    const entries = ledger?.key === this.#turnKey(token, true) ? ledger.entries : [];
    const pending = entries.find(entry => entry.manual && entry.pending && entry.tokenUuid === token.uuid);
    const cells = pending
      ? sandPlacementCells(token).filter(cell => cell.row === pending.row && cell.col === pending.col)
      : entries.length < prof(token.actor) ? this.#availablePlacementCells(token) : [];
    return cells.length ? { effectId: effect.id, cells } : null;
  }

  #availablePlacementCells(token) {
    const index = this.#tileIndex(token.parent);
    return sandPlacementCells(token).filter(cell => !this.#tilesAt(index, cell.row, cell.col).length);
  }

  #tileIndex(scene) {
    if (this.#tileIndexes.has(scene.id)) return this.#tileIndexes.get(scene.id);
    const index = { scene, tiles: new Map(), cells: new Map() };
    this.#tileIndexes.set(scene.id, index);
    for (const tile of collectionValues(scene.tiles)) this.#updateIndex(index, tile, false);
    return index;
  }

  #updateIndex(index, tile, deleted) {
    const old = index.tiles.get(tile.id);
    const data = deleted ? null : flag(tile, SAND);
    const row = Math.floor(tile.y / index.scene.grid?.size);
    const col = Math.floor(tile.x / index.scene.grid?.size);
    const next = data && Number.isSafeInteger(row) && Number.isSafeInteger(col) ? { ...data, row, col, elevation: elevation(tile) } : null;
    if (JSON.stringify(old ?? null) === JSON.stringify(next)) return [];
    if (old) {
      const key = tileKey(old.row, old.col);
      const ids = index.cells.get(key);
      ids?.delete(tile.id);
      if (!ids?.size) index.cells.delete(key);
    }
    index.tiles.delete(tile.id);
    if (next) {
      const key = tileKey(row, col);
      const ids = index.cells.get(key) ?? new Set();
      ids.add(tile.id);
      index.cells.set(key, ids);
      index.tiles.set(tile.id, next);
    }
    return [old, next].filter(Boolean);
  }

  #tilesAt(index, row, col) {
    return Array.from(index.cells.get(tileKey(row, col)) ?? [], id => index.scene.tiles.get(id))
      .filter(tile => flag(tile, SAND)?.expiresAt > this.worldTime());
  }

  #tilesUnder(token, includeReserved = false) {
    const grid = token.parent?.grid;
    const bounds = sandTokenBounds(token, grid);
    if (!bounds) return [];
    const index = this.#tileIndex(token.parent);
    const tiles = [];
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let col = bounds.left; col <= bounds.right; col += 1) {
        for (const tile of this.#tilesAt(index, row, col)) {
          if ((includeReserved || !flag(tile, SAND)?.absorption) && elevation(tile) === elevation(token)) tiles.push(tile);
        }
      }
    }
    return tiles;
  }

  async observeTile(tile, deleted = false) {
    if (!tile?.parent) return;
    const existing = this.#tileIndexes.get(tile.parent.id);
    if (!flag(tile, SAND) && !existing?.tiles.has(tile.id)) return;
    const index = this.#tileIndex(tile.parent);
    const changed = this.#updateIndex(index, tile, deleted);
    if (!changed.length || !this.isActiveGM()) return;
    await Promise.all(collectionValues(tile.parent.tokens).filter(token => changed.some(cell =>
      elevation(token) === cell.elevation && sandTokenContainsCell(token, tile.parent.grid, cell.row, cell.col))
      && this.getManifestation(token)).map(token => this.reconcileCover(token)));
  }

  async reconcileCover(token) {
    if (!token?.actor || !this.isActiveGM()) return;
    return runInQueue(this.#coverOperations, token.uuid, async () => {
      const actor = token.actor;
      const effect = collectionValues(actor.effects).find(candidate => flag(candidate, COVER) === token.uuid);
      const shouldCover = this.getManifestation(token) && this.#tilesUnder(token).length > 0;
      if (shouldCover && !effect) {
        const data = await this.halfCover();
        if (!data) return;
        delete data._id;
        data.flags = { ...data.flags, [MODULE_ID]: { ...data.flags?.[MODULE_ID], [COVER]: token.uuid } };
        await actor.createEmbeddedDocuments("ActiveEffect", [data]);
      } else if (!shouldCover && effect) await effect.delete();
    });
  }

  async observeManifestationEffect(effect) {
    const state = flag(effect, MANIFESTATION);
    if (!state) return;
    const token = await this.resolve(state.tokenUuid);
    if (token) await this.reconcileCover(token);
  }

  async forgetToken(token, { removed = false } = {}) {
    this.#movements.delete(token?.uuid);
    if (!removed || !this.isActiveGM()) return;
    const actor = token.actor ?? (token.actorLink && this.game()?.actors?.get(token.actorId));
    if (!actor) return;
    await this.#forActor(actor, async () => {
      for (const effect of collectionValues(actor.effects)) {
        if (flag(effect, COVER) === token.uuid || flag(effect, MANIFESTATION)?.tokenUuid === token.uuid) await effect.delete();
      }
    });
  }

  placeSand(payload, context) {
    return this.#placeSand(payload, context);
  }

  async placeManualSand(payload, context) {
    if (!context?.sender?.isGM || !context.operationId) return rejected("token");
    return this.#placeSand({ ...payload, movementId: `manual:${context.operationId}` }, context);
  }

  async #placeSand({ tokenUuid, movementId, row, col, effectId }, { sender, operationId } = {}) {
    const token = await this.#ownedToken(tokenUuid, sender);
    if (!this.isActiveGM() || !token) return rejected("token");
    const actor = token.actor;
    const scene = token.parent;
    return runInQueue(this.#sceneOperations, scene.id, () => this.#forActor(actor, async () => {
      const key = this.#turnKey(token, true);
      const old = flag(actor, PLACEMENTS);
      const entries = old?.key === key ? old.entries : [];
      const recorded = entries.find(entry => entry.tokenUuid === tokenUuid
        && (entry.movementId === movementId || (effectId && entry.manual && entry.pending)));
      if (recorded) {
        if (recorded.row !== row || recorded.col !== col) return rejected("stale");
        return recorded.pending ? this.#finishPlacement(token, key, entries, recorded) : { applied: true, tileId: recorded.tileId };
      }
      const motion = effectId ? null : this.#movements.get(tokenUuid);
      if (motion?.movementId === movementId) await motion.completion;
      const opportunity = effectId ? this.getManualPlacementOpportunity(token, sender) : this.getPlacementOpportunity(token);
      const matches = effectId ? opportunity?.effectId === effectId : opportunity?.movementId === movementId;
      if (!matches || !opportunity.cells.some(cell => cell.row === row && cell.col === col)
        || (!effectId && !sandDestinationIsFree(token))) return rejected(effectId ? "manualUnavailable" : "stale");
      const entry = { tokenUuid, movementId, operationId, row, col, tileId: this.newId(), elevation: elevation(token),
        expiresAt: this.worldTime() + DURATION, pending: true, manual: Boolean(effectId) };
      const next = [...entries, entry];
      await actor.update({ [flagPath(PLACEMENTS)]: { key, entries: next } });
      return this.#finishPlacement(token, key, next, entry);
    }));
  }

  async #finishPlacement(token, key, entries, entry) {
    const scene = token.parent;
    const actor = token.actor;
    const save = next => actor.update({ [flagPath(PLACEMENTS)]: { key, entries: next } });
    const removeEntry = () => save(entries.filter(value => value.tileId !== entry.tileId));
    let tile = scene.tiles.get(entry.tileId);
    if (!tile) {
      if (entry.expiresAt <= this.worldTime() || this.#tilesAt(this.#tileIndex(scene), entry.row, entry.col).length) {
        await removeEntry();
        return rejected("stale");
      }
      const size = scene.grid.size;
      try {
        [tile] = await scene.createEmbeddedDocuments("Tile", [{
          _id: entry.tileId, x: entry.col * size, y: entry.row * size,
          width: size, height: size, elevation: entry.elevation,
          texture: { src: SAND_TEXTURE, anchorX: 0, anchorY: 0 },
          flags: { [MODULE_ID]: { [SAND]: {
            creatorActorUuid: actor.uuid, creatorTokenUuid: token.uuid,
            row: entry.row, col: entry.col, expiresAt: entry.expiresAt, placementId: entry.movementId
          } } }
        }], { keepId: true });
        if (!tile) throw new Error("Sand tile was not created");
      } catch (error) {
        tile = scene.tiles.get(entry.tileId);
        if (!tile) {
          await removeEntry();
          throw error;
        }
      }
    }
    await save(entries.map(value => value.tileId === entry.tileId ? { ...value, pending: false } : value));
    await this.observeTile(tile);
    return { applied: true, tileId: tile.id };
  }

  getAbsorbableSand(token) {
    if (!collectionValues(token?.actor?.items).some(item => sandChildFeatureKind(item) === "ancestralArt")) return [];
    const receipts = flag(token.actor, ABSORPTIONS)?.receipts ?? [];
    return this.#tilesUnder(token, true).filter(tile => flag(tile, SAND)?.creatorActorUuid === token.actor.uuid
      && !receipts.some(entry => entry.sceneId === token.parent.id && entry.tileId === tile.id));
  }

  async absorbSand({ tokenUuid, tileId }, { sender, operationId } = {}) {
    const token = await this.#ownedToken(tokenUuid, sender);
    if (!this.isActiveGM() || !token) return rejected("token");
    const actor = token.actor;
    const scene = token.parent;
    return runInQueue(this.#sceneOperations, scene.id, () => this.#forActor(actor, async () => {
      const key = this.#turnKey(token, false);
      const old = flag(actor, ABSORPTIONS);
      const receipts = (old?.receipts ?? []).filter(entry => entry.expiresAt > this.worldTime());
      const tile = scene.tiles.get(tileId);
      const receipt = receipts.find(entry => entry.sceneId === scene.id && entry.tileId === tileId);
      if (receipt) {
        if (flag(tile, SAND)?.absorption?.operationId === receipt.operationId) await this.#deleteSand(tile);
        return { applied: true, tileId };
      }
      if (old?.key === key) return rejected("absorbed");
      if (!this.getAbsorbableSand(token).some(candidate => candidate.id === tileId)) return rejected("noSand");
      const data = flag(tile, SAND);
      const absorption = data.absorption ?? { operationId, hidden: Boolean(tile.hidden) };
      try {
        if (!data.absorption) await tile.update({ [flagPath(SAND)]: { ...data, absorption }, hidden: true });
        await this.observeTile(tile);
        const updated = Math.max(0, tempHp(actor), prof(actor));
        const changes = { [flagPath(ABSORPTIONS)]: { key, receipts: [...receipts, {
          sceneId: scene.id, tileId, operationId: absorption.operationId, expiresAt: data.expiresAt
        }] } };
        if (updated !== tempHp(actor)) changes["system.attributes.hp.temp"] = updated;
        await actor.update(changes);
      } catch (error) {
        if (!flag(actor, ABSORPTIONS)?.receipts?.some(entry => entry.tileId === tileId && entry.operationId === absorption.operationId)) {
          if (flag(tile, SAND)?.absorption?.operationId === absorption.operationId) {
            await tile.update({ [`${flagPath(SAND)}.absorption`]: null, hidden: absorption.hidden });
            await this.observeTile(tile);
          }
          throw error;
        }
      }
      await this.#deleteSand(tile);
      return { applied: true, tileId };
    }));
  }

  async #deleteSand(tile) {
    if (!flag(tile, SAND)) return;
    await tile.delete();
    await this.observeTile(tile, true);
  }

  async initializeScene(scene) {
    if (!scene) return;
    this.#tileIndex(scene);
    if (!this.isActiveGM()) return;
    for (const token of collectionValues(scene.tokens)) {
      if (token.actorLink === false) await this.initializeActor(token.actor);
      const actor = token.actor;
      const ledger = flag(actor, PLACEMENTS);
      if (!ledger?.entries.some(entry => entry.pending && entry.tokenUuid === token.uuid)) continue;
      await runInQueue(this.#sceneOperations, scene.id, () => this.#forActor(actor, async () => {
        const current = flag(actor, PLACEMENTS);
        const pending = current?.entries.find(entry => entry.pending && entry.tokenUuid === token.uuid);
        if (pending) await this.#finishPlacement(token, current.key, current.entries, pending);
      }));
    }
    await this.expireSand(this.worldTime(), scene, true);
  }

  async initializeWorld() {
    if (!this.isActiveGM() || this.game()?.system?.id !== "dnd5e") return;
    this.#featureSources = null;
    for (const actor of collectionValues(this.game().actors)) await this.initializeActor(actor);
    for (const scene of collectionValues(this.game().scenes)) await this.initializeScene(scene);
  }

  async expireSand(worldTime = this.worldTime(), onlyScene = null, recover = false) {
    if (!this.isActiveGM()) return;
    const indexes = onlyScene ? [this.#tileIndex(onlyScene)] : this.#tileIndexes.values();
    for (const { scene, tiles } of indexes) {
      const ids = [...tiles].filter(([, state]) => state.expiresAt <= worldTime || (recover && state.absorption)).map(([id]) => id);
      if (!ids.length) continue;
      await runInQueue(this.#sceneOperations, scene.id, async () => {
        for (const id of ids) {
          const tile = scene.tiles.get(id);
          const data = flag(tile, SAND);
          if (!data) continue;
          if (data.expiresAt <= worldTime) {
            await this.#deleteSand(tile);
          } else if (recover && data.absorption) {
            const actor = await this.resolve(data.creatorActorUuid);
            const committed = flag(actor, ABSORPTIONS)?.receipts?.some(entry => entry.sceneId === scene.id
              && entry.tileId === id && entry.operationId === data.absorption.operationId);
            if (committed) await this.#deleteSand(tile);
            else {
              await tile.update({ [`${flagPath(SAND)}.absorption`]: null, hidden: data.absorption.hidden });
              await this.observeTile(tile);
            }
          }
        }
      });
    }
    for (const actor of this.#manifestingActors.values()) await this.reconcileActor(actor);
  }
}
