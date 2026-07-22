import { MODULE_ID } from "../constants.js";

function cleanString(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clone(value) {
  if (value === undefined || value === null) return value;
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : JSON.parse(JSON.stringify(value));
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents.filter(Boolean);
  if (Array.isArray(collection)) return collection.filter(Boolean);
  if (typeof collection?.values === "function") return Array.from(collection.values()).filter(Boolean);
  return [];
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
    this._knownVehicles = new Set();
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

  async selectResearchObject(owner) {
    const vehicles = this.#vehicleDocuments()
      .filter((vehicle) => vehicle?.isOwner === true)
      .sort((left, right) => cleanString(left?.name).localeCompare(cleanString(right?.name), "ru"));
    if (!vehicles.length) {
      globalThis.ui?.notifications?.warn?.("Нет доступного транспорта для объекта исследования Механика.");
      return null;
    }
    const choices = vehicles.map((vehicle) => ({
      uuid: cleanString(vehicle.uuid),
      name: cleanString(vehicle.name) || cleanString(vehicle.uuid)
    }));
    let selectedUuid;
    if (typeof this.options.promptResearchObject === "function") {
      selectedUuid = cleanString(await this.options.promptResearchObject(owner, clone(choices)));
    }
    else if (choices.length === 1) {
      selectedUuid = choices[0].uuid;
    }
    else {
      const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
      if (typeof DialogV2?.wait !== "function") return null;
      const options = choices.map((choice) => (
        `<option value="${escapeHtml(choice.uuid)}">${escapeHtml(choice.name)}</option>`
      )).join("");
      selectedUuid = cleanString(await DialogV2.wait({
        window: { title: "Объект исследования Механика" },
        content: `<form><div class="form-group"><label>Транспорт</label><select name="vehicleUuid">${options}</select></div></form>`,
        buttons: [{
          action: "select",
          label: "Выбрать",
          default: true,
          callback: (_event, _button, dialog) => dialog?.element?.querySelector?.('[name="vehicleUuid"]')?.value ?? ""
        }, {
          action: "cancel",
          label: "Отмена",
          callback: () => ""
        }],
        close: () => ""
      }));
    }
    if (!selectedUuid || !await this.bindResearchObject(owner, selectedUuid)) return null;
    return this.resolveResearchObject(owner);
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
    this._knownVehicles.add(vehicle);
    const key = cleanString(instanceId);
    const state = clone(vehicleState(vehicle));
    const gadgetEffects = clone(state.gadgetEffects ?? {});
    if (gadgetEffects[key]) return true;
    gadgetEffects[key] = {
      gadgetId: "afterburner-injector",
      ownerUuid: cleanString(owner?.uuid),
      baseline: {
        hasAcceleration: Number.isFinite(Number(state.acceleration)),
        acceleration: Number.isFinite(Number(state.acceleration)) ? Number(state.acceleration) : null,
        movement: clone(vehicle?.system?.attributes?.movement ?? {}),
        travel: clone(vehicle?.system?.attributes?.travel?.speeds ?? {})
      }
    };
    const nextState = { ...state, gadgetEffects };
    if (Number.isFinite(Number(state.acceleration))) {
      nextState.acceleration = Number(state.acceleration) + 10;
      nextState.afterburner = { instanceId: key, ownerUuid: cleanString(owner?.uuid) };
      await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, nextState);
      return true;
    }
    const movement = addToNonZero(vehicle?.system?.attributes?.movement, 10);
    const travel = addToNonZero(vehicle?.system?.attributes?.travel?.speeds, 10);
    nextState.afterburner = { instanceId: key, ownerUuid: cleanString(owner?.uuid) };
    await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, nextState);
    await updatePath(vehicle, "system.attributes.movement", movement);
    await updatePath(vehicle, "system.attributes.travel.speeds", travel);
    return true;
  }

  async activateEmergencyRegulator(vehicle, owner, { instanceId = "" } = {}) {
    if (vehicle?.type !== "vehicle") return false;
    this._knownVehicles.add(vehicle);
    const key = cleanString(instanceId);
    const state = clone(vehicleState(vehicle));
    const gadgetEffects = clone(state.gadgetEffects ?? {});
    gadgetEffects[key] ??= {
      gadgetId: "emergency-regulator",
      ownerUuid: cleanString(owner?.uuid),
      baseline: {}
    };
    await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, {
      ...state,
      gadgetEffects,
      emergencyRegulator: { instanceId: key, ownerUuid: cleanString(owner?.uuid) }
    });
    return true;
  }

  async deactivateGadget(vehicle, { instanceId = "", gadgetId = "" } = {}) {
    if (vehicle?.type !== "vehicle") return false;
    this._knownVehicles.add(vehicle);
    const key = cleanString(instanceId);
    const state = clone(vehicleState(vehicle));
    const gadgetEffects = clone(state.gadgetEffects ?? {});
    const effect = gadgetEffects[key];
    const resolvedGadgetId = cleanString(effect?.gadgetId ?? gadgetId);
    const temporary = state.temporaryAfterburner;

    if (temporary?.instanceId === key) {
      await updatePath(vehicle, "system.attributes.movement", temporary.movement ?? {});
      await updatePath(vehicle, "system.attributes.travel.speeds", temporary.travel ?? {});
      delete state.temporaryAfterburner;
    }

    if (resolvedGadgetId === "afterburner-injector" && effect?.baseline) {
      const baseline = effect.baseline;
      await updatePath(vehicle, "system.attributes.movement", baseline.movement ?? {});
      await updatePath(vehicle, "system.attributes.travel.speeds", baseline.travel ?? {});
      if (baseline.hasAcceleration) state.acceleration = Number(baseline.acceleration);
      else delete state.acceleration;
      if (state.afterburner?.instanceId === key) delete state.afterburner;
    }
    if (resolvedGadgetId === "emergency-regulator" && state.emergencyRegulator?.instanceId === key) {
      delete state.emergencyRegulator;
    }
    delete gadgetEffects[key];
    if (Object.keys(gadgetEffects).length) state.gadgetEffects = gadgetEffects;
    else delete state.gadgetEffects;
    await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, state);
    return true;
  }

  async useAfterburnerAction(vehicle, owner, { instanceId = "", turnKey = "" } = {}) {
    if (vehicle?.type !== "vehicle") return false;
    this._knownVehicles.add(vehicle);
    const state = clone(vehicleState(vehicle));
    const existing = state.temporaryAfterburner;
    if (existing) {
      await updatePath(vehicle, "system.attributes.movement", existing.movement ?? {});
      await updatePath(vehicle, "system.attributes.travel.speeds", existing.travel ?? {});
    }
    const proficiency = Math.max(0, Math.floor(Number(owner?.system?.attributes?.prof) || 0));
    const amount = 10 * proficiency;
    const snapshot = {
      movement: clone(vehicle?.system?.attributes?.movement ?? {}),
      travel: clone(vehicle?.system?.attributes?.travel?.speeds ?? {}),
      instanceId: cleanString(instanceId),
      turnKey: cleanString(turnKey),
      ownerUuid: cleanString(owner?.uuid)
    };
    await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, {
      ...state,
      temporaryAfterburner: snapshot
    });
    await updatePath(vehicle, "system.attributes.movement", addToNonZero(snapshot.movement, amount));
    await updatePath(vehicle, "system.attributes.travel.speeds", addToNonZero(snapshot.travel, amount));
    return true;
  }

  async handleCombatTurnChange(currentTurnKey) {
    if (typeof this.options.isActiveGmClient === "function" && !this.options.isActiveGmClient()) return false;
    const key = cleanString(currentTurnKey);
    for (const vehicle of this.#vehicleDocuments()) {
      const state = clone(vehicleState(vehicle));
      const snapshot = state.temporaryAfterburner;
      if (!snapshot) continue;
      if (snapshot.turnKey === key) continue;
      await updatePath(vehicle, "system.attributes.movement", snapshot.movement ?? {});
      await updatePath(vehicle, "system.attributes.travel.speeds", snapshot.travel ?? {});
      delete state.temporaryAfterburner;
      await updatePath(vehicle, `flags.${MODULE_ID}.vehicleState`, state);
      await this.rollBreakdown(vehicle, {
        sourceInstanceId: snapshot.instanceId,
        allowReroll: Boolean(this.readVehicleState(vehicle).emergencyRegulator)
      });
    }
    return true;
  }

  #vehicleDocuments() {
    const supplied = typeof this.options.vehicleDocuments === "function"
      ? collectionValues(this.options.vehicleDocuments())
      : collectionValues(globalThis.game?.actors);
    return Array.from(new Set([...this._knownVehicles, ...supplied])).filter((actor) => actor?.type === "vehicle");
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
