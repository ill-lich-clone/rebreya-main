import { MODULE_ID } from "../constants.js";
import { buildTransportFuelInventorySnapshot } from "./transport-fuel-item.js";
import { resolveTransportFuelConsumption } from "./transport-fuel-consumption.js";

const PAYLOAD_KEYS = Object.freeze(["appliedMiles", "groupActorId"]);

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isSafeId(value) {
  const clean = cleanId(value);
  return clean.length > 0
    && clean.length <= 128
    && !["__proto__", "prototype", "constructor"].includes(clean);
}

function toNumber(value) {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function roundQuantity(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function readTransport(actor) {
  return actor?.getFlag?.(MODULE_ID, "transport")
    ?? actor?.flags?.[MODULE_ID]?.transport
    ?? null;
}

function emptyResult({ configured = false, itemName = "" } = {}) {
  return {
    configured,
    required: 0,
    consumed: 0,
    shortage: 0,
    itemName: cleanId(itemName),
    warning: ""
  };
}

export function validateTransportFuelConsumptionPayload(payload) {
  const miles = toNumber(payload?.appliedMiles);
  return hasExactKeys(payload, PAYLOAD_KEYS)
    && isSafeId(payload.groupActorId)
    && miles != null
    && miles >= 0;
}

export class TransportFuelService {
  constructor({ groupContextService } = {}) {
    if (!groupContextService?.resolveForGroup) {
      throw new TypeError("Transport fuel service requires the group context service");
    }
    this.groupContextService = groupContextService;
  }

  async consumeForTravel(payload) {
    const requestedMiles = toNumber(payload?.appliedMiles);
    if (
      hasExactKeys(payload, PAYLOAD_KEYS)
      && isSafeId(payload.groupActorId)
      && requestedMiles != null
      && requestedMiles < 0
    ) {
      return emptyResult();
    }
    if (!validateTransportFuelConsumptionPayload(payload)) {
      throw new Error("Некорректный запрос списания топлива транспорта.");
    }
    const context = this.groupContextService.resolveForGroup(payload.groupActorId);
    const activeTransportId = cleanId(context?.groupState?.transportState?.activeTransportId);
    const actorId = activeTransportId.startsWith("member:") ? activeTransportId.slice(7) : "";
    const actor = (context?.members ?? []).find((member) => member?.id === actorId);
    const transport = readTransport(actor);
    if (
      actor?.type !== "vehicle"
      || transport?.instance !== true
      || cleanId(transport.groupActorId) !== cleanId(context?.groupId)
    ) {
      return emptyResult();
    }

    const fuel = buildTransportFuelInventorySnapshot(
      context?.groupActor?.items,
      transport.instanceState?.fuelSelector
    );
    const effectiveConsumption = resolveTransportFuelConsumption(
      transport.instanceState?.fuelConsumption,
      transport.consumption
    );
    const fuelPerMile = effectiveConsumption.amount;
    const itemName = cleanId(fuel.name);
    const appliedMiles = Math.max(0, requestedMiles ?? 0);
    if (!fuel.configured || fuelPerMile <= 0) return emptyResult({ itemName });
    if (appliedMiles <= 0) return emptyResult({ configured: true, itemName });

    const required = roundQuantity(appliedMiles * fuelPerMile);
    if (required <= 0) return emptyResult({ configured: true, itemName });
    if (fuel.stacks.length === 0) {
      return {
        configured: true,
        required,
        consumed: 0,
        shortage: required,
        itemName,
        warning: `Топливо «${itemName || "выбранный предмет"}» не найдено на складе группы.`
      };
    }

    const consumed = roundQuantity(Math.min(fuel.quantity, required));
    const shortage = roundQuantity(Math.max(0, required - consumed));
    let remaining = consumed;
    const updates = [];
    for (const stack of fuel.stacks) {
      if (remaining <= 0) break;
      const stackConsumed = roundQuantity(Math.min(stack.quantity, remaining));
      if (stackConsumed <= 0) continue;
      updates.push({
        _id: stack.itemId,
        "system.quantity": roundQuantity(stack.quantity - stackConsumed)
      });
      remaining = roundQuantity(remaining - stackConsumed);
    }
    try {
      if (updates.length > 0) {
        if (typeof context?.groupActor?.updateEmbeddedDocuments === "function") {
          await context.groupActor.updateEmbeddedDocuments("Item", updates);
        }
        else {
          const items = context?.groupActor?.items;
          for (const patch of updates) {
            const item = items?.get?.(patch._id)
              ?? items?.contents?.find?.((entry) => entry?.id === patch._id);
            await item?.update?.({ "system.quantity": patch["system.quantity"] });
          }
        }
      }
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to consume transport fuel.`, error);
      return {
        configured: true,
        required,
        consumed: 0,
        shortage: required,
        itemName,
        warning: `Не удалось списать топливо «${itemName}». Путешествие продолжено.`
      };
    }

    return {
      configured: true,
      required,
      consumed,
      shortage,
      itemName,
      warning: shortage > 0
        ? `Топливо «${itemName}»: не хватило ${shortage}. Путешествие продолжено.`
        : ""
    };
  }
}
