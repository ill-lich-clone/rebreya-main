const DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_STATUSES = ["free", "pending", "approved", "processed", "blocked"];

function parseIsoDate(isoDate) {
  const match = String(isoDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  const [, yearText, monthText, dayText] = match;
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  if (
    date.getUTCFullYear() !== Number(yearText)
    || date.getUTCMonth() !== Number(monthText) - 1
    || date.getUTCDate() !== Number(dayText)
  ) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }

  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftIsoDate(isoDate, days) {
  return toIsoDate(new Date(parseIsoDate(isoDate).getTime() + (days * DAY_MS)));
}

function isWeekend(isoDate) {
  return [0, 6].includes(parseIsoDate(isoDate).getUTCDay());
}

function cloneSlots(slots) {
  return structuredClone(slots ?? []);
}

function compareSlots(left, right) {
  return left.isoDate.localeCompare(right.isoDate)
    || String(left.actorId ?? "").localeCompare(String(right.actorId ?? ""))
    || String(left.requestId ?? "").localeCompare(String(right.requestId ?? ""))
    || String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function assignRequest(slot, requestId) {
  slot.status = "pending";
  slot.requestId = requestId;
  return slot;
}

function clearRequest(slot) {
  const released = { ...slot, status: "free", requestId: null };
  for (const key of ["projectId", "activityId", "hours", "blockReason", "processedTransitionId"]) {
    if (key in released) {
      released[key] = null;
    }
  }
  return released;
}

export function nearestMonday(isoDate) {
  const date = parseIsoDate(isoDate);
  const daysUntilMonday = (8 - date.getUTCDay()) % 7;
  return toIsoDate(new Date(date.getTime() + (daysUntilMonday * DAY_MS)));
}

export function buildGrantSlots({
  actorId,
  grantId,
  weeks,
  fromIsoDate,
  occupiedDates = new Set()
}) {
  const weekCount = Math.max(0, Math.trunc(Number(weeks) || 0));
  const occupied = new Set(occupiedDates ?? []);
  const slots = [];
  let monday = nearestMonday(fromIsoDate);

  while (slots.length < weekCount * 5) {
    const weekDates = Array.from({ length: 5 }, (_, index) => shiftIsoDate(monday, index));
    if (weekDates.every((isoDate) => !occupied.has(isoDate))) {
      for (const isoDate of weekDates) {
        slots.push({
          id: `${grantId}:${isoDate}`,
          actorId,
          isoDate,
          status: "free",
          grantId,
          requestId: null,
          projectId: null,
          activityId: null,
          hours: null,
          blockReason: null,
          processedTransitionId: null
        });
        occupied.add(isoDate);
      }
    }
    monday = shiftIsoDate(monday, 7);
  }

  return slots;
}

export function allocateRequestSlots({
  slots,
  actorId,
  requestId,
  workdays,
  ownedWorkshop = false
}) {
  const source = cloneSlots(slots);
  const requestedWorkdays = Math.max(0, Math.trunc(Number(workdays) || 0));
  const occupiedDates = new Set(source
    .filter((slot) => slot.actorId === actorId && slot.status !== "free")
    .map((slot) => slot.isoDate));
  const freeSlots = source
    .filter((slot) => slot.actorId === actorId && slot.status === "free")
    .sort(compareSlots);
  const eligible = ownedWorkshop
    ? freeSlots
    : freeSlots.filter((slot, index, sortedSlots) => (
      !isWeekend(slot.isoDate)
      && !occupiedDates.has(slot.isoDate)
      && (index === 0 || sortedSlots[index - 1].isoDate !== slot.isoDate)
    ));

  if (eligible.length < requestedWorkdays) {
    throw new Error("Insufficient free workdays.");
  }

  const selected = eligible.slice(0, requestedWorkdays);
  if (!ownedWorkshop || selected.length === 0) {
    selected.forEach((slot) => assignRequest(slot, requestId));
    return source;
  }

  const selectedSlots = new Set(selected);
  const reflowOccupiedDates = new Set(source
    .filter((slot) => slot.actorId === actorId && !selectedSlots.has(slot))
    .map((slot) => slot.isoDate));
  let candidateDate = selected[0].isoDate;

  for (const slot of selected) {
    while (reflowOccupiedDates.has(candidateDate)) {
      candidateDate = shiftIsoDate(candidateDate, 1);
    }
    slot.isoDate = candidateDate;
    assignRequest(slot, requestId);
    reflowOccupiedDates.add(candidateDate);
    candidateDate = shiftIsoDate(candidateDate, 1);
  }

  return source;
}

export function releaseFutureRequestSlots({ slots, requestId, currentIsoDate }) {
  parseIsoDate(currentIsoDate);
  return cloneSlots(slots).map((slot) => {
    if (
      slot.requestId === requestId
      && slot.isoDate > currentIsoDate
      && slot.status !== "processed"
    ) {
      return clearRequest(slot);
    }
    return slot;
  });
}

export function summarizeScheduleByDate(slots) {
  const summaries = new Map();
  const sortedSlots = cloneSlots(slots).sort(compareSlots);

  for (const slot of sortedSlots) {
    if (!summaries.has(slot.isoDate)) {
      summaries.set(slot.isoDate, {
        isoDate: slot.isoDate,
        total: 0,
        counts: Object.fromEntries(SUMMARY_STATUSES.map((status) => [status, 0])),
        slots: []
      });
    }

    const summary = summaries.get(slot.isoDate);
    summary.total += 1;
    if (slot.status in summary.counts) {
      summary.counts[slot.status] += 1;
    }
    summary.slots.push(slot);
  }

  return summaries;
}
