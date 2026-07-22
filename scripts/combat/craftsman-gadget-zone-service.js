import { MODULE_ID } from "../constants.js";

function cleanString(value) {
  return String(value ?? "").trim();
}

function smokeState(template) {
  return template?.flags?.[MODULE_ID]?.craftsmanSmoke
    ?? template?.getFlag?.(MODULE_ID, "craftsmanSmoke")
    ?? null;
}

function tokenCenter(token) {
  const source = token?.object ?? token;
  const center = source?.center ?? source?.document?.center;
  if (Number.isFinite(Number(center?.x)) && Number.isFinite(Number(center?.y))) {
    return { x: Number(center.x), y: Number(center.y) };
  }
  const document = source?.document ?? source;
  return { x: Number(document?.x) || 0, y: Number(document?.y) || 0 };
}

function templateContains(template, point) {
  const shape = template?.object?.shape ?? template?.shape;
  const originX = Number(template?.x ?? template?.document?.x) || 0;
  const originY = Number(template?.y ?? template?.document?.y) || 0;
  if (typeof shape?.contains === "function") {
    return shape.contains(point.x - originX, point.y - originY);
  }
  const gridSize = Number(globalThis.canvas?.grid?.size ?? globalThis.canvas?.dimensions?.size) || 100;
  const gridDistance = Number(globalThis.canvas?.scene?.grid?.distance) || 5;
  const pixelsPerFoot = gridSize / gridDistance;
  const side = (Number(template?.distance ?? template?.document?.distance) || 15) * pixelsPerFoot;
  return point.x >= originX && point.y >= originY && point.x <= originX + side && point.y <= originY + side;
}

function turnKey(combat) {
  const id = cleanString(combat?.id ?? combat?._id);
  const round = Number(combat?.round);
  const turn = Number(combat?.turn);
  return id && Number.isFinite(round) && Number.isFinite(turn) ? `${id}:${round}:${turn}` : "";
}

export function isTokenInsideCraftsmanSmoke(template, token) {
  return Boolean(template && token && templateContains(template, tokenCenter(token)));
}

export class CraftsmanGadgetZoneService {
  constructor(options = {}) {
    this.options = options;
    this._templates = new Map();
  }

  registerTemplate(template) {
    const state = smokeState(template);
    const instanceId = cleanString(state?.instanceId);
    if (!instanceId) return null;
    this._templates.set(instanceId, template);
    return template;
  }

  getTemplate(instanceId) {
    const template = this._templates.get(cleanString(instanceId)) ?? null;
    return template?.deleted ? null : template;
  }

  unregisterTemplate(templateOrInstanceId) {
    const instanceId = typeof templateOrInstanceId === "string"
      ? cleanString(templateOrInstanceId)
      : cleanString(smokeState(templateOrInstanceId)?.instanceId);
    if (!instanceId) return false;
    const registered = this._templates.get(instanceId);
    if (typeof templateOrInstanceId !== "string" && registered && registered !== templateOrInstanceId) {
      return false;
    }
    return this._templates.delete(instanceId);
  }

  clearTemplates() {
    this._templates.clear();
  }

  async poisonTemplate(instanceId, context = {}) {
    const key = cleanString(instanceId);
    let template = this.getTemplate(key);
    if (!template) {
      const create = context.createPoisonedTemplate ?? this.options.createPoisonedTemplate;
      if (typeof create !== "function") return null;
      template = await create({ ...context, instanceId: key, poisoned: true });
      if (!template) return null;
    }
    const current = smokeState(template) ?? {};
    const next = {
      ...current,
      instanceId: key,
      ownerActorUuid: cleanString(context.ownerActorUuid ?? current.ownerActorUuid),
      craftsmanLevel: Math.max(1, Math.floor(Number(context.craftsmanLevel ?? current.craftsmanLevel) || 1)),
      poisoned: true,
      expiresAtTurnKey: cleanString(context.expiresAtTurnKey ?? current.expiresAtTurnKey)
    };
    if (typeof template.update === "function") {
      await template.update({ [`flags.${MODULE_ID}.craftsmanSmoke`]: next });
    }
    else {
      template.flags ??= {};
      template.flags[MODULE_ID] ??= {};
      template.flags[MODULE_ID].craftsmanSmoke = next;
    }
    this._templates.set(key, template);
    return template;
  }

  async handleCombatTurn(combat) {
    if (!this.#isActiveGmClient()) return false;
    const currentTurnKey = turnKey(combat);
    for (const [instanceId, template] of [...this._templates]) {
      if (cleanString(smokeState(template)?.expiresAtTurnKey) === currentTurnKey) {
        await this.#deleteTemplate(instanceId, template);
      }
    }
    const token = combat?.combatant?.token?.object ?? combat?.combatant?.token ?? null;
    const actor = token?.actor ?? combat?.combatant?.actor ?? null;
    if (!token || !actor) return true;
    for (const template of this._templates.values()) {
      const state = smokeState(template);
      if (state?.poisoned !== true || !isTokenInsideCraftsmanSmoke(template, token)) continue;
      await this.#applyPoisonDamage(actor, Math.max(1, Math.floor(Number(state.craftsmanLevel) || 1)), template);
    }
    return true;
  }

  isSightObscured(sourceToken, targetToken) {
    const source = tokenCenter(sourceToken);
    const target = tokenCenter(targetToken);
    for (const template of this._templates.values()) {
      for (let step = 0; step <= 64; step += 1) {
        const ratio = step / 64;
        if (templateContains(template, {
          x: source.x + (target.x - source.x) * ratio,
          y: source.y + (target.y - source.y) * ratio
        })) return true;
      }
    }
    return false;
  }

  async deleteByInstanceId(instanceId) {
    const key = cleanString(instanceId);
    const template = this.getTemplate(key);
    if (!template) return false;
    await this.#deleteTemplate(key, template);
    return true;
  }

  registerSceneTemplates(scene = globalThis.canvas?.scene) {
    const templates = scene?.templates?.contents
      ?? (typeof scene?.templates?.values === "function" ? Array.from(scene.templates.values()) : [])
      ?? [];
    this._templates.clear();
    for (const template of templates) this.registerTemplate(template);
    return this._templates.size;
  }

  #isActiveGmClient() {
    if (typeof this.options.isActiveGmClient === "function") return this.options.isActiveGmClient();
    return globalThis.game?.user?.isGM === true;
  }

  async #applyPoisonDamage(actor, amount, template) {
    if (typeof this.options.applyPoisonDamage === "function") {
      return this.options.applyPoisonDamage(actor, amount, template);
    }
    if (typeof actor?.applyDamage === "function") {
      return actor.applyDamage([{ value: amount, type: "poison" }]);
    }
    return false;
  }

  async #deleteTemplate(instanceId, template) {
    this._templates.delete(instanceId);
    if (typeof template?.delete === "function") await template.delete();
  }
}
