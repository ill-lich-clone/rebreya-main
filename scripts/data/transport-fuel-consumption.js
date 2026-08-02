const TRANSPORT_FUEL_UNITS = new Set(["lb", "gal"]);

function numericAmount(value) {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  return Number(normalized);
}

export function normalizeTransportFuelConsumption(value, { optional = false } = {}) {
  if (optional && value == null) return null;

  const amount = numericAmount(value?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Расход топлива должен быть больше нуля.");
  }

  const unit = String(value?.unit ?? "").trim();
  if (!TRANSPORT_FUEL_UNITS.has(unit)) {
    throw new Error("Единица расхода топлива должна быть: фунты или галлоны.");
  }

  return { amount, unit };
}

export function resolveTransportFuelConsumption(override, fallback = {}) {
  const normalizedOverride = normalizeTransportFuelConsumption(override, { optional: true });
  if (normalizedOverride) {
    return { ...normalizedOverride, source: "override" };
  }

  if (fallback?.kind === "fuel" && fallback?.cadence === "mile") {
    try {
      return {
        ...normalizeTransportFuelConsumption(fallback),
        source: "transport"
      };
    }
    catch (_error) {
      // Invalid legacy transport consumption is treated as unconfigured.
    }
  }

  return { amount: 0, unit: "", source: "none" };
}
