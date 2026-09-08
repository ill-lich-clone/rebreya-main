import { DisarmError, calculateDisarmDropCell, evaluateDisarmRules } from "../../combat/disarm-rules.js?v=1.4.252";
import { buildDisarmRollPlan } from "../../integrations/disarm-roll-adapter.js?v=1.4.252";
import { getItemHeldHands, isItemEquipped, canUseHeldItemForHandRequirement } from "../../integrations/held-items.js";
import { getNaturalReachFeet } from "../../combat/natural-reach.js";
import { measureStorageTokenDistance } from "../../data/storage-access.js";
import { itemInstanceFingerprint } from "../../application/item-instance-workflow.js";

const values = collection => Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
const signature = item => itemInstanceFingerprint({ id: item.uuid, hands: getItemHeldHands(item), equipped: isItemEquipped(item), quantity: item.system?.quantity });
const bounds = token => ({ x: token.x, y: token.y, width: token.width * token.parent.grid.size, height: token.height * token.parent.grid.size });
const center = token => { const b = bounds(token); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const reject = (code, message) => { throw new DisarmError(code, message); };

/** Filter before random selection. Collision uses public Token.checkCollision in scene coordinates. */
export function collectDisarmDropPoints(token, canvas = globalThis.canvas) {
  const tokenBounds = bounds(token), gridSize = token.parent.grid.size;
  if (typeof token.object?.checkCollision !== "function" || !canvas?.dimensions?.sceneRect) reject("unavailable-collision", "Проверка стен недоступна.");
  let candidates;
  if (canvas.grid.isHexagonal) {
    // Take neighbours of every occupied centre, retaining only exterior points for large tokens.
    const occupied = new Map();
    for (let x = tokenBounds.x + gridSize / 4; x < tokenBounds.x + tokenBounds.width; x += gridSize / 2) {
      for (let y = tokenBounds.y + gridSize / 4; y < tokenBounds.y + tokenBounds.height; y += gridSize / 2) {
        const offset = canvas.grid.getOffset({ x, y }); occupied.set(`${offset.i}:${offset.j}`, offset);
      }
    }
    const adjacent = new Map();
    for (const offset of occupied.values()) for (const next of canvas.grid.getAdjacentOffsets(offset)) {
      const key = `${next.i}:${next.j}`; if (!occupied.has(key)) adjacent.set(key, canvas.grid.getCenterPoint(next));
    }
    candidates = [...adjacent.values()].filter(p => p.x < tokenBounds.x || p.x >= tokenBounds.x + tokenBounds.width || p.y < tokenBounds.y || p.y >= tokenBounds.y + tokenBounds.height);
  } else candidates = Array.from({ length: 8 }, (_, i) => ({ ...calculateDisarmDropCell({ tokenBounds, gridSize, direction: i + 1 }), direction: i + 1 }));
  return candidates.filter(p => canvas.dimensions.sceneRect.contains(p.x, p.y)
    && !token.object.checkCollision(p, { origin: center(token), type: "move", mode: "any" }));
}

export class DisarmDocuments {
  constructor({ resolve = uuid => globalThis.fromUuid(uuid), gameProvider = () => globalThis.game, canvasProvider = () => globalThis.canvas } = {}) {
    Object.assign(this, { resolve, gameProvider, canvasProvider });
  }
  async tokens(intent, sender) {
    const game = this.gameProvider(), canvas = this.canvasProvider();
    if (game?.system?.id !== "dnd5e") reject("unsupported-system", "Обезоруживание требует dnd5e.");
    if (!sender || game.users.get(sender.id) !== sender) reject("unauthorized", "Пользователь не определён.");
    const [source, target] = await Promise.all([this.resolve(intent.sourceTokenUuid), this.resolve(intent.targetTokenUuid)]);
    if (!source?.actor || !target?.actor || source.uuid === target.uuid || source.actor.uuid === target.actor.uuid
      || source.parent?.id !== target.parent?.id || source.parent?.id !== canvas?.scene?.id) reject("invalid-tokens", "Нужны два разных существа на активной сцене.");
    if (!sender.isGM && !source.actor.testUserPermission(sender, "OWNER")) reject("unauthorized", "Вы не управляете атакующим.");
    if ((!sender.isGM && target.hidden) || !source.object?.checkCollision || source.object.checkCollision(center(target), { origin: center(source), type: "sight", mode: "any" })) reject("target-not-visible", "Цель скрыта или находится за стеной.");
    return { source, target };
  }
  async preview(intent, sender) {
    const { source, target } = await this.tokens(intent, sender);
    return { sourceName: source.name, targetName: target.name,
      weapons: values(source.actor.items).filter(i => i.type === "weapon" && isItemEquipped(i) && getItemHeldHands(i).length).map(i => ({ uuid: i.uuid, name: i.name,
        modes: this.weaponModes(i).map(mode => ({ mode, plan: buildDisarmRollPlan({ actor: source.actor, weapon: i, mode }) })) })),
      items: values(target.actor.items).filter(i => isItemEquipped(i) && getItemHeldHands(i).length).map(i => ({ uuid: i.uuid, name: i.name, heldHands: getItemHeldHands(i).length })) };
  }
  weaponModes(weapon) {
    const ranged = weapon.system?.attackType === "ranged" || /R$/u.test(weapon.system?.type?.value ?? "");
    const modes = [ranged ? "ranged" : "melee"];
    if (new Set(weapon.system?.properties ?? []).has("thr")) modes.push("thrown");
    return modes;
  }
  async prepare(intent, sender, context = {}) {
    const { source, target } = await this.tokens(intent, sender);
    const weapon = values(source.actor.items).find(i => i.uuid === intent.weaponItemUuid);
    const item = values(target.actor.items).find(i => i.uuid === intent.targetItemUuid);
    if (!weapon || weapon.type !== "weapon" || !this.weaponModes(weapon).includes(intent.weaponMode)
      || !item || !isItemEquipped(item) || !getItemHeldHands(item).length || !isItemEquipped(weapon) || !getItemHeldHands(weapon).length) reject("invalid-held-item", "Выберите текущее оружие и удерживаемый предмет цели.");
    const use = canUseHeldItemForHandRequirement(source.actor, weapon, { requiredHands: new Set(weapon.system.properties ?? []).has("two") ? 2 : 1 });
    if (use.ok !== true) reject("invalid-weapon-grip", "Оружие нельзя использовать с текущим хватом.");
    const range = intent.weaponMode === "melee" ? Math.max(getNaturalReachFeet(source.actor), Number(weapon.system.range?.reach ?? 0))
      : Number(weapon.system.range?.value);
    if (!Number.isFinite(range) || range <= 0 || !["ft", undefined, ""].includes(weapon.system.range?.units)
      || measureStorageTokenDistance(source, target, { canvas: this.canvasProvider() }) > range) reject("out-of-range", "Цель вне обычной дистанции выбранного оружия.");
    const users = values(this.gameProvider().users);
    const responder = users.filter(u => !u.isGM && u.active && target.actor.testUserPermission(u, "OWNER")).sort((a,b) => a.id.localeCompare(b.id))[0]
      ?? users.find(u => u.active && u.isGM);
    if (!responder) reject("active-gm-unavailable", "Нет мастера или владельца для выбора спасброска.");
    const state = { sourceName: source.name, targetName: target.name, itemName: item.name,
      sourceActorUuid: source.actor.uuid, targetActorUuid: target.actor.uuid, sceneId: source.parent.id,
      attackerSize: source.actor.system.traits.size, targetSize: target.actor.system.traits.size,
      heldHands: getItemHeldHands(item).length, heldSignature: signature(item), weaponSignature: signature(weapon),
      responderUserId: responder.id, attackPlan: buildDisarmRollPlan({ actor: source.actor, weapon, mode: intent.weaponMode, context }) };
    if (!evaluateDisarmRules({ ...state, saveAbility: "str" }).allowed) reject("target-too-large", "Цель слишком велика.");
    return state;
  }
  async revalidate(record, saveAbility = record.saveAbility ?? "str") {
    const sender = this.gameProvider().users.get(record.senderId);
    const state = await this.prepare(record.intent, sender, { baseline: record.baselineDecision });
    if (state.heldSignature !== record.heldSignature || state.weaponSignature !== record.weaponSignature
      || state.sourceActorUuid !== record.sourceActorUuid || state.targetActorUuid !== record.targetActorUuid
      || state.attackerSize !== record.attackerSize || state.targetSize !== record.targetSize) reject("stale-item", "Размер, предмет или хват изменились после начала атаки.");
    const target = await this.resolve(record.intent.targetTokenUuid);
    const ability = target.actor.system.abilities?.[saveAbility];
    return { targetActor: target.actor, saveConditions: { saveAdvantage: ability?.save?.roll?.mode === 1, saveDisadvantage: ability?.save?.roll?.mode === -1 } };
  }
  async dropPoints(record) { return collectDisarmDropPoints(await this.resolve(record.intent.targetTokenUuid), this.canvasProvider()); }
}
