const ZERO_SPEND = Object.freeze({
  predominantMaterialLb: 0,
  baseRawQuantity: 0
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function toFiniteNumber(value, fallback = Number.NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundFive(value) {
  return Math.round((toFiniteNumber(value, 0) + Number.EPSILON) * 100000) / 100000;
}

function requireNonnegative(value, label) {
  const number = toFiniteNumber(value, Number.NaN);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${label} must be a nonnegative number.`);
  }
  return number;
}

function requireIsoDate(value) {
  const isoDate = cleanText(value);
  const match = /^(\d{4,6})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (!match) {
    throw new Error("A valid workday date is required.");
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error("A valid workday date is required.");
  }
  return isoDate;
}

function normalizeReservation(value = {}) {
  const reservation = value && typeof value === "object" ? value : {};
  const normalized = {
    ...clone(reservation),
    predominantMaterialLbReserved: requireNonnegative(
      reservation.predominantMaterialLbReserved ?? 0,
      "Predominant material reservation"
    ),
    predominantMaterialLbSpent: requireNonnegative(
      reservation.predominantMaterialLbSpent ?? 0,
      "Predominant material spend"
    ),
    baseRawQuantityReserved: requireNonnegative(
      reservation.baseRawQuantityReserved ?? 0,
      "Base raw material reservation"
    ),
    baseRawQuantitySpent: requireNonnegative(
      reservation.baseRawQuantitySpent ?? 0,
      "Base raw material spend"
    )
  };
  delete normalized.baseRawMaterialQuantityReserved;
  delete normalized.baseRawMaterialQuantitySpent;

  if (
    normalized.predominantMaterialLbSpent > normalized.predominantMaterialLbReserved
    || normalized.baseRawQuantitySpent > normalized.baseRawQuantityReserved
  ) {
    throw new Error("Craft reservation spend exceeds the reserved quantity.");
  }
  return normalized;
}

function buildProportionalSpend(reservation, nextProgressGold, targetGold, completion) {
  const predominantTarget = completion
    ? reservation.predominantMaterialLbReserved
    : roundFive(reservation.predominantMaterialLbReserved * (nextProgressGold / targetGold));
  const baseRawTarget = completion
    ? reservation.baseRawQuantityReserved
    : roundFive(reservation.baseRawQuantityReserved * (nextProgressGold / targetGold));

  return {
    predominantMaterialLb: roundFive(Math.max(
      0,
      predominantTarget - reservation.predominantMaterialLbSpent
    )),
    baseRawQuantity: roundFive(Math.max(
      0,
      baseRawTarget - reservation.baseRawQuantitySpent
    ))
  };
}

export function processCraftProjectWorkday(project, {
  isoDate,
  transitionId,
  dailyProgressGold
} = {}) {
  const source = project && typeof project === "object" ? project : {};
  const safeIsoDate = requireIsoDate(isoDate);
  const safeTransitionId = cleanText(transitionId);
  if (!safeTransitionId) {
    throw new Error("A workday transition ID is required.");
  }

  const safeDailyProgress = toFiniteNumber(dailyProgressGold, Number.NaN);
  if (!Number.isFinite(safeDailyProgress) || safeDailyProgress <= 0) {
    throw new Error("Daily crafting progress must be greater than zero.");
  }

  const processedWorkdays = Array.isArray(source.processedWorkdays)
    ? source.processedWorkdays
    : [];
  const operationId = `${safeIsoDate}:${safeTransitionId}`;
  const previousWorkday = processedWorkdays.find((entry) => (
    cleanText(entry?.isoDate) === safeIsoDate
    || cleanText(entry?.operationId) === operationId
  ));
  if (previousWorkday) {
    return {
      project: clone(source),
      spend: clone(ZERO_SPEND),
      completion: false,
      alreadyProcessed: true,
      alreadyCompleted: false,
      blocked: false,
      blockReason: ""
    };
  }

  const status = cleanText(source.status);
  if (["paused", "blocked"].includes(status)) {
    return {
      project: clone(source),
      spend: clone(ZERO_SPEND),
      completion: false,
      alreadyProcessed: false,
      alreadyCompleted: false,
      blocked: true,
      blockReason: cleanText(source.blockReason) || `Craft project is ${status}.`
    };
  }
  if (status === "completed") {
    return {
      project: clone(source),
      spend: clone(ZERO_SPEND),
      completion: false,
      alreadyProcessed: false,
      alreadyCompleted: true,
      blocked: false,
      blockReason: ""
    };
  }
  if (status !== "active") {
    throw new Error("Only active craft projects can process a workday.");
  }

  const targetGold = requireNonnegative(source.targetGold, "Craft project target");
  const progressGold = requireNonnegative(source.progressGold ?? 0, "Craft project progress");
  if (targetGold <= 0 || progressGold > targetGold) {
    throw new Error("Craft project progress is inconsistent with its target.");
  }
  const reservation = normalizeReservation(source.reservation);
  const appliedProgressGold = roundFive(Math.min(safeDailyProgress, targetGold - progressGold));
  const nextProgressGold = roundFive(progressGold + appliedProgressGold);
  const completion = nextProgressGold >= targetGold;
  const spend = buildProportionalSpend(reservation, nextProgressGold, targetGold, completion);
  const nextReservation = {
    ...reservation,
    predominantMaterialLbSpent: completion
      ? reservation.predominantMaterialLbReserved
      : roundFive(reservation.predominantMaterialLbSpent + spend.predominantMaterialLb),
    baseRawQuantitySpent: completion
      ? reservation.baseRawQuantityReserved
      : roundFive(reservation.baseRawQuantitySpent + spend.baseRawQuantity)
  };
  const workday = {
    isoDate: safeIsoDate,
    transitionId: safeTransitionId,
    operationId,
    progressGold: appliedProgressGold,
    spend: clone(spend)
  };
  const nextProject = {
    ...clone(source),
    status: completion ? "completed" : "active",
    progressGold: nextProgressGold,
    reservation: nextReservation,
    processedWorkdays: [...clone(processedWorkdays), workday]
  };

  return {
    project: nextProject,
    spend,
    completion,
    alreadyProcessed: false,
    alreadyCompleted: false,
    blocked: false,
    blockReason: ""
  };
}
