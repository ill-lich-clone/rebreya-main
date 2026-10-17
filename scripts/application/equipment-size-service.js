import { getEquipmentSize, getCreatureTokenFootprint, isEquipmentSize } from "../data/equipment-size-rules.js?v=1.4.393";
import { getActiveGm } from "../infrastructure/foundry/active-gm.js";
import { sha256Hex } from "../shared/sha256.js";
import { itemInstanceFingerprint } from "./item-instance-workflow.js?v=1.4.377";
import { isValidCreatureResizePayload } from "./equipment-size-commands.js?v=1.4.393";

const clone = value => value === undefined ? undefined : structuredClone(value);
const at = (value, path) => path.split(".").reduce((node, key) => node?.[key], value);
const equal = (a, b) => itemInstanceFingerprint(a) === itemInstanceFingerprint(b);
const values = collection => Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
const geometry = token => Object.fromEntries(["x", "y", "width", "height"].map(key => [key, Number(token[key])]));
const owns = (document, user) => Boolean(user?.id && (user.isGM || document?.testUserPermission?.(user, "OWNER")));
const ownsToken = (token, user) => Boolean(user?.id && (user.isGM
  || (typeof token?.canUserModify === "function" ? token.canUserModify(user, "update") : owns(token, user))));
const fail = (code, message) => Object.assign(new Error(message), { code });
function set(data, path, value) {
  const parts = path.split("."), key = parts.pop();
  let node = data;
  for (const part of parts) node = node[part] ??= {};
  if (key.startsWith("-=")) delete node[key.slice(2)];
  else node[key] = clone(value);
}

export class EquipmentSizeService {
  constructor(moduleApi, { buildItemUpdate, getHeldWeapons = () => [], readItemData = item => item.toObject(),
    gameProvider = () => globalThis.game, resolveUuid = uuid => globalThis.fromUuid(uuid) } = {}) {
    this.moduleApi = moduleApi;
    this.buildItemUpdate = buildItemUpdate;
    this.getHeldWeapons = getHeldWeapons;
    this.readItemData = readItemData;
    this.gameProvider = gameProvider;
    this.resolveUuid = resolveUuid;
  }

  async initialize() { return true; }

  preUpdateItem(item, changes, options = {}) {
    if (options.rebreyaEquipmentSize === true) return true;
    const { update } = this.buildItemUpdate(item, { changes, source: "edit" });
    for (const key of Object.keys(changes)) delete changes[key];
    Object.assign(changes, update);
    return true;
  }

  async setItemSize(item, size) {
    if (!item?.isOwner) throw new Error("Нет прав изменять размер этого предмета.");
    const { update, diagnostics } = this.buildItemUpdate(item, { size });
    if (Object.keys(update).length) await item.update(update, { rebreyaEquipmentSize: true });
    if (diagnostics.length) globalThis.ui?.notifications?.info?.("Нестандартная формула урона сохранена без изменения; размер, вес и цена обновлены.");
    return { changed: Object.keys(update).length > 0, diagnostics };
  }

  getCreatureResizePreview(token, size = token?.actor?.system?.traits?.size ?? "med") {
    token = token?.document ?? token;
    if (!token?.actor || !isEquipmentSize(size)) throw fail("invalid-resize", "Выберите токен существа и допустимый размер.");
    const actor = token.actor, weapons = this.getHeldWeapons(actor);
    return { actorUuid: actor.uuid, tokenUuid: token.uuid, size,
      weaponRows: weapons.map(item => ({ id: item.id, name: item.name, size: getEquipmentSize(item), quantity: Number(item.system.quantity ?? 1) })),
      expected: { actorSize: actor.system.traits.size, token: geometry(token),
        weapons: weapons.map(item => ({ id: item.id, signature: this.#weaponSignature(item) })) } };
  }

  #weaponSignature(item) { return sha256Hex(itemInstanceFingerprint(this.readItemData(item))); }

  async authorizeCreatureResize(payload, sender) {
    const token = await this.resolveUuid(payload.tokenUuid);
    return Boolean(token?.uuid === payload.tokenUuid && token.actor?.uuid === payload.actorUuid
      && ownsToken(token, sender) && owns(token.actor, sender));
  }

  async requestCreatureResize(payload) {
    if (!isValidCreatureResizePayload(payload)) throw fail("invalid-resize", "Некорректный запрос изменения размера.");
    const game = this.gameProvider();
    if (getActiveGm(game)) return this.moduleApi.privilegedMutationGateway.mutate("equipment.resize-creature", payload);
    const execute = () => this.resizeCreature(payload, { senderUserId: game?.user?.id });
    const coordinator = this.moduleApi.worldMutationCoordinator;
    return coordinator ? coordinator.run(`actor:${payload.actorUuid}`, execute) : execute();
  }

  async resizeCreature(payload, { senderUserId, assertAuthority = () => {} } = {}) {
    if (!isValidCreatureResizePayload(payload)) throw fail("invalid-resize", "Некорректный запрос изменения размера.");
    const game = this.gameProvider(), sender = values(game?.users).find(user => user.id === senderUserId) ?? (game?.user?.id === senderUserId ? game.user : null);
    if (!await this.authorizeCreatureResize(payload, sender)) throw fail("permission-denied", "Нет прав изменять этого персонажа и токен.");
    const token = await this.resolveUuid(payload.tokenUuid), actor = token.actor;
    const current = this.getCreatureResizePreview(token, payload.size);
    if (!equal(current.expected.token, payload.expected.token) || current.expected.actorSize !== payload.expected.actorSize
      || payload.weaponIds.some(id => current.expected.weapons.find(row => row.id === id)?.signature !== payload.expected.weapons.find(row => row.id === id)?.signature)) {
      throw fail("stale-resize", "Персонаж, токен или выбранное оружие изменились. Откройте выбор размера заново.");
    }
    const footprint = getCreatureTokenFootprint(payload.size);
    const grid = Number(token.parent?.grid?.size ?? globalThis.canvas?.grid?.size ?? 100);
    const before = geometry(token);
    const tokenPatch = { ...footprint, x: before.x - (footprint.width - before.width) * grid / 2,
      y: before.y - (footprint.height - before.height) * grid / 2 };
    return this.applyPreparedCreatureResize({ actor, token, size: payload.size, tokenPatch, weaponIds: payload.weaponIds,
      expected: payload.expected, assertAuthority });
  }

  /** Trusted module-owner operation. Raw document patches never cross the socket. */
  async applyPreparedCreatureResize({ actor, token, size, tokenPatch = {}, weaponIds = [], changeActorSize = true, expected, assertAuthority = () => {} }) {
    token = token?.document ?? token;
    if (!actor || !isEquipmentSize(size)) throw fail("invalid-resize", "Некорректный размер существа.");
    const user = this.gameProvider()?.user;
    if (!owns(actor, user) || (token && !ownsToken(token, user))) throw fail("permission-denied", "Нет прав изменять этого персонажа и токен.");
    if (token) {
      const liveToken = await this.resolveUuid(token.uuid);
      if (liveToken !== token || liveToken.actor !== actor) throw fail("stale-resize", "Токен или персонаж больше не существует в выбранном состоянии.");
    }
    if (expected) {
      const current = this.getCreatureResizePreview(token, size).expected;
      if (current.actorSize !== expected.actorSize || !equal(current.token, expected.token)
        || weaponIds.some(id => current.weapons.find(row => row.id === id)?.signature !== expected.weapons.find(row => row.id === id)?.signature)) {
        throw fail("stale-resize", "Состояние существа изменилось во время выбора размера.");
      }
    }
    const forcedSize = at(actor.overrides, "system.traits.size");
    if (changeActorSize && forcedSize && forcedSize !== size) throw fail("size-controlled-by-effect", "Размер персонажа задан активным эффектом. Измените этот эффект перед сменой размера.");
    const held = this.getHeldWeapons(actor);
    const selected = weaponIds.map(id => held.find(item => item.id === id));
    if (selected.some(item => !item)) throw fail("stale-resize", "Выбранное оружие больше не находится в руках.");
    const itemUpdates = [], diagnostics = [];
    for (const item of selected) {
      if (getEquipmentSize(item) === size) continue;
      const result = this.buildItemUpdate(item, { size });
      diagnostics.push(...result.diagnostics);
      if (Object.keys(result.update).length) itemUpdates.push({ item, update: result.update });
    }
    const actorPatch = changeActorSize && actor.system.traits.size !== size
      ? { "system.traits.size": size, "prototypeToken.width": getCreatureTokenFootprint(size).width, "prototypeToken.height": getCreatureTokenFootprint(size).height } : {};
    const actualTokenPatch = token ? Object.fromEntries(Object.entries(tokenPatch).filter(([key, value]) => !equal(token[key], value))) : {};
    const stages = [];
    const prepare = (document, patch, roots = Object.keys(patch)) => {
      const source = document.toObject?.() ?? document;
      const before = Object.fromEntries(roots.map(path => [path, clone(at(source, path))]));
      const draft = {};
      for (const [path, value] of Object.entries(before)) set(draft, path, value);
      for (const [path, value] of Object.entries(patch)) set(draft, path, value);
      return { document, patch, before, after: Object.fromEntries(roots.map(path => [path, clone(at(draft, path))])) };
    };
    const actorStage = Object.keys(actorPatch).length ? prepare(actor, actorPatch) : null;
    const tokenStage = Object.keys(actualTokenPatch).length ? prepare(token, actualTokenPatch) : null;
    const itemStages = itemUpdates.map(({ item, update }) => prepare(item, update,
      [...new Set(Object.keys(update).map(path => path.startsWith("flags.") ? path.split(".").slice(0, 3).join(".")
        : path.startsWith("system.damage.") ? path.split(".").slice(0, 3).join(".") : path.split(".").slice(0, 2).join(".")))]));
    try {
      if (actorStage) { await assertAuthority(); stages.push(actorStage); await actor.update(actorPatch, { render: false }); }
      if (tokenStage) { await assertAuthority(); stages.push(tokenStage); await token.update(actualTokenPatch, { render: false }); }
      if (itemStages.length) {
        await assertAuthority(); stages.push(...itemStages);
        await actor.updateEmbeddedDocuments("Item", itemStages.map(stage => ({ _id: stage.document.id, ...stage.patch })), { rebreyaEquipmentSize: true });
      }
      return { changed: stages.length > 0, actorUuid: actor.uuid, tokenUuid: token?.uuid ?? null, size, weaponIds: itemStages.map(stage => stage.document.id), diagnostics };
    }
    catch (cause) {
      const unrestored = [];
      for (const stage of stages.reverse()) {
        const current = stage.document.toObject?.() ?? stage.document;
        if (Object.entries(stage.before).every(([path, value]) => equal(at(current, path), value))) continue;
        if (!Object.entries(stage.after).every(([path, value]) => equal(at(current, path), value))) { unrestored.push(stage.document.uuid); continue; }
        const rollback = {};
        for (const [path, value] of Object.entries(stage.before)) {
          if (value === undefined) { const parts = path.split("."); const key = parts.pop(); rollback[[...parts, `-=${key}`].join(".")] = null; }
          else rollback[path] = clone(value);
        }
        try { await assertAuthority(); await stage.document.update(rollback, { rebreyaEquipmentSize: true, render: false }); }
        catch { unrestored.push(stage.document.uuid); }
      }
      throw Object.assign(fail("resize-failed", `${cause.message}${unrestored.length ? ` Не удалось восстановить: ${unrestored.join(", ")}.` : " Изменения размера отменены."}`), { cause, unrestored });
    }
  }

  getResizePromptOwnerIds(actor) {
    const game = this.gameProvider(), users = values(game?.users).filter(user => user.active && !user.isGM && owns(actor, user));
    const assigned = user => (user.character?.uuid ?? user.character) === actor.uuid;
    return users.sort((a, b) => Number(assigned(b)) - Number(assigned(a)) || Number(b.id === game?.user?.id) - Number(a.id === game?.user?.id) || a.id.localeCompare(b.id)).map(user => user.id);
  }

  async chooseHeldWeaponResize(actor, token, size, { choice, preview = this.getCreatureResizePreview(token, size) } = {}) {
    if (!preview.weaponRows.some(row => row.size !== size)) return [];
    const game = this.gameProvider(), ownerUserIds = this.getResizePromptOwnerIds(actor);
    const responderId = choice?.resizeResponderUserId || ownerUserIds[0] || getActiveGm(game)?.id;
    const answer = choice ?? await this.moduleApi.reactionQueueService?.promptDecision?.({
      forUserId: responderId,
      candidate: { actorUuid: actor.uuid, tokenUuid: preview.tokenUuid, ownerUserIds },
      prompt: { title: "Размер оружия", body: "Изменить размер оружия в руках вместе с размером существа?", acceptLabel: "Изменить оружие", declineLabel: "Оставить оружие" }
    });
    if (answer?.accepted !== true || answer.resizeWeapons === "no") return [];
    const responder = values(game?.users).find(user => user.id === responderId);
    if (!responder?.active || !owns(actor, responder) || !ownsToken(token?.document ?? token, responder)) {
      throw fail("permission-denied", "Владелец утратил права на существо во время выбора размера оружия.");
    }
    const current = this.getCreatureResizePreview(token, size);
    return preview.expected.weapons.filter(row => current.expected.weapons.some(now => now.id === row.id && now.signature === row.signature)).map(row => row.id);
  }
}
