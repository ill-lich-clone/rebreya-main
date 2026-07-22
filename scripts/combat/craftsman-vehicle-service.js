import { MODULE_ID } from "../constants.js";

function cleanString(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : JSON.parse(JSON.stringify(value));
}

function vehicleState(vehicle) {
  return vehicle?.flags?.[MODULE_ID]?.vehicleState ?? {};
}

function ownerState(owner) {
  return owner?.flags?.[MODULE_ID]?.craftsman ?? {};
}

function numericEntries(source) {
  return Object.entries(source ?? {}).filter(([, value]) => Number.isFinite(Number(value)));
}

function addToNonZero(source, amount) {
  return Object.fromEntries(numericEntries(source).map(([key, value]) => [
    key,
    Number(value) === 0 ? value : Number(value) + amount
  ]));
}

async function updatePath(document, path, value) {
  if (typeof document?.update === "function") return document.update({ [path]: clone(value) });
  const keys = path.split(".");
  let target = document;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = clone(value);
  return document;
}

export class CraftsmanVehicleService {
  constructor(options = {}) {
    this.options = options;
    this._temporarySpeed = new Map();
  }

  async bindResearchObject(owner, vehicleUuid) {
    const vehicle = await this.#fromUuid(vehicleUuid);
    if (vehicle?.type !== "vehicle" || vehicle?.isOwner !== true) return false;
    await updatePath(owner, `flags.${MODULE_ID}.craftsman`, {
      ...clone(ownerState(owner)),
      researchObjectUuid: cleanString(vehicle.uuid ?? vehicleUuid)
    });
    return true;
  }

  async resolveResearchObject(owner) {
    const uuid = cleanString(ownerState(owner).researchObjectUuid);
    if (!uuid) return null;
    const vehicle = await this.#fromUuid(uuid);
    return vehicle?.type === "vehicle" && vehicle?.isOwner === true ? vehicle : null;
  }

  async resolveVehicle(vehicleUuid) {
    const vehicle = await this.#fromUuid(vehicleUuid);
    return vehicle?.type === "vehicle" && vehicle?.isOwner !== false ? vehicle : null;
  }

  readVehicleState(vehicle) {
    const state = vehicleState(vehicle);
    return {
      acceleration: Number.isFinite(Number(state.acceleration)) ? Number(state.acceleration) : null,
      breakdownThreshold: Math.max(0, Math.floor(Number(state.breakdownThreshold) || 2)),
      emergencyRegulator: state.emergencyRegulator ?? null
    };
  }

  async activateAfterburner(vehicle, owner, { instanceId = "" } = {}) {
    if (vehicle?.type !== "vehicle") return false;
    const state = vehicleState(vehicle);
    if (Number.isFinite(Number(state.acceleration))) {
      await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, {
        ...clone(state),
        acceleration: Number(state.acceleration) + 10,
        afterburner: { instanceId: cleanString(instanceId), ownerUuid: cleanString(owner?.uuid) }
      });
      return true;
    }
    const movement = addToNonZero(vehicle?.system?.attributes?.movement, 10);
    const travel = addToNonZero(vehicle?.system?.attributes?.travel?.speeds, 10);
    await updatePath(vehicle, "system.attributes.movement", movement);
    await updatePath(vehicle, "system.attributes.travel.speeds", travel);
    await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, {
      ...clone(state),
      afterburner: { instanceId: cleanString(instanceId), ownerUuid: cleanString(owner?.uuid) }
    });
    return true;
  }

  async activateEmergencyRegulator(vehicle, owner, { instanceId = "" } = {}) {
    if (vehicle?.type !== "vehicle") return false;
    await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, {
      ...clone(vehicleState(vehicle)),
      emergencyRegulator: { instanceId: cleanString(instanceId), ownerUuid: cleanString(owner?.uuid) }
    });
    return true;
  }

  async useAfterburnerAction(vehicle, owner, { instanceId = "", turnKey = "" } = {}) {
    if (vehicle?.type !== "vehicle") return false;
    const proficiency = Math.max(0, Math.floor(Number(owner?.system?.attributes?.prof) || 0));
    const amount = 10 * proficiency;
    const key = cleanString(vehicle.uuid) || vehicle;
    const snapshot = {
      movement: clone(vehicle?.system?.attributes?.movement ?? {}),
      travel: clone(vehicle?.system?.attributes?.travel?.speeds ?? {}),
      instanceId: cleanString(instanceId),
      turnKey: cleanString(turnKey),
      vehicle,
      owner
    };
    this._temporarySpeed.set(key, snapshot);
    await updatePath(vehicle, "system.attributes.movement", addToNonZero(snapshot.movement, amount));
    await updatePath(vehicle, "system.attributes.travel.speeds", addToNonZero(snapshot.travel, amount));
    return true;
  }

  async handleCombatTurnChange(currentTurnKey) {
    const key = cleanString(currentTurnKey);
    for (const [vehicleKey, snapshot] of [...this._temporarySpeed]) {
      if (snapshot.turnKey === key) continue;
      await updatePath(snapshot.vehicle, "system.attributes.movement", snapshot.movement);
      await updatePath(snapshot.vehicle, "system.attributes.travel.speeds", snapshot.travel);
      this._temporarySpeed.delete(vehicleKey);
      await this.rollBreakdown(snapshot.vehicle, { sourceInstanceId: snapshot.instanceId });
    }
    return true;
  }

  async rollBreakdown(vehicle, { sourceInstanceId = "", allowReroll = false } = {}) {
    const state = this.readVehicleState(vehicle);
    const baseThreshold = state.breakdownThreshold;
    const effectiveThreshold = Math.max(0, baseThreshold - (state.emergencyRegulator ? 1 : 0));
    const first = await this.#rollD20(vehicle);
    const rolls = [Number(first?.total) || 0];
    let selectedTotal = rolls[0];
    if (allowReroll && state.emergencyRegulator) {
      const second = await this.#rollD20(vehicle);
      rolls.push(Number(second?.total) || 0);
      const choose = this.options.chooseBreakdownRoll;
      selectedTotal = typeof choose === "function"
        ? Number(await choose({ vehicle, rolls: [...rolls], baseThreshold, effectiveThreshold }))
        : rolls[1];
      if (!rolls.includes(selectedTotal)) selectedTotal = rolls[1];
    }
    const context = {
      vehicleUuid: cleanString(vehicle?.uuid),
      baseThreshold,
      effectiveThreshold,
      rolls,
      selectedTotal,
      sourceInstanceId: cleanString(sourceInstanceId)
    };
    await this.#emitBreakdown(context, vehicle);
    return context;
  }

  async #fromUuid(uuid) {
    const resolver = this.options.fromUuid ?? globalThis.fromUuid;
    return typeof resolver === "function" ? resolver(cleanString(uuid)) : null;
  }

  async #rollD20(vehicle) {
    if (typeof this.options.rollD20 === "function") return this.options.rollD20(vehicle);
    const roll = new globalThis.Roll("1d20", vehicle?.getRollData?.() ?? {});
    await roll.evaluate();
    return roll;
  }

  async #emitBreakdown(context, vehicle) {
    if (typeof this.options.emitBreakdown === "function") {
      await this.options.emitBreakdown(context, vehicle);
    }
    else {
      globalThis.Hooks?.callAll?.("rebreya.vehicleBreakdownRoll", context);
      if (globalThis.ChatMessage?.create) {
        await globalThis.ChatMessage.create({
          content: `<p><strong>Граница поломки:</strong> ${context.selectedTotal} (граница ${context.effectiveThreshold})</p>`,
          speaker: globalThis.ChatMessage.getSpeaker?.({ actor: vehicle })
        });
      }
    }
  }
}
