import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";

const WEEKDAY_HEADERS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MOON_CYCLE_DAYS = 28.8;
const MOON_EPOCH_UTC = Date.UTC(1, 0, 1);

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function toIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,6})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatWeekday(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    timeZone: "UTC"
  }).format(date);
}

function formatDateLabel(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function capitalizeFirst(text) {
  const value = String(text ?? "");
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getMonthName(date) {
  return capitalizeFirst(new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    timeZone: "UTC"
  }).format(date));
}

function getMondayIndex(date) {
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function buildDefaultState() {
  const today = new Date();
  const utcDate = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  ));
  return {
    version: 1,
    isoDate: toIsoDate(utcDate)
  };
}

function resolveMoonPhase(progress) {
  if (progress < 0.03 || progress >= 0.97) {
    return { id: "new", label: "Новолуние" };
  }

  if (progress < 0.22) {
    return { id: "waxing-crescent", label: "Растущий серп" };
  }

  if (progress < 0.28) {
    return { id: "first-quarter", label: "Первая четверть" };
  }

  if (progress < 0.47) {
    return { id: "waxing-gibbous", label: "Растущая луна" };
  }

  if (progress < 0.53) {
    return { id: "full", label: "Полнолуние" };
  }

  if (progress < 0.72) {
    return { id: "waning-gibbous", label: "Убывающая луна" };
  }

  if (progress < 0.78) {
    return { id: "last-quarter", label: "Последняя четверть" };
  }

  return { id: "waning-crescent", label: "Убывающий серп" };
}

function buildMoonSnapshot(date) {
  const daysFromEpoch = (date.getTime() - MOON_EPOCH_UTC) / 86400000;
  const ageDays = ((daysFromEpoch % MOON_CYCLE_DAYS) + MOON_CYCLE_DAYS) % MOON_CYCLE_DAYS;
  const progress = ageDays / MOON_CYCLE_DAYS;
  const phase = resolveMoonPhase(progress);

  return {
    ageDays: roundNumber(ageDays, 2),
    cycleDays: MOON_CYCLE_DAYS,
    progressPercent: roundNumber(progress * 100, 1),
    phaseId: phase.id,
    phaseLabel: phase.label
  };
}

function buildCalendarCells(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekdayIndex = getMondayIndex(firstOfMonth);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const previousMonthDate = new Date(Date.UTC(year, month - 1, 0));
  const daysInPreviousMonth = previousMonthDate.getUTCDate();

  const cells = [];

  for (let offset = firstWeekdayIndex; offset > 0; offset -= 1) {
    const prevDay = daysInPreviousMonth - offset + 1;
    const prevDate = new Date(Date.UTC(year, month - 2, prevDay));
    cells.push({
      year: prevDate.getUTCFullYear(),
      month: prevDate.getUTCMonth() + 1,
      day: prevDate.getUTCDate(),
      isoDate: toIsoDate(prevDate),
      isOutsideMonth: true,
      isCurrentDay: false
    });
  }

  for (let monthDay = 1; monthDay <= daysInMonth; monthDay += 1) {
    const currentDate = new Date(Date.UTC(year, month - 1, monthDay));
    cells.push({
      year,
      month,
      day: monthDay,
      isoDate: toIsoDate(currentDate),
      isOutsideMonth: false,
      isCurrentDay: monthDay === day
    });
  }

  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    const nextDate = new Date(Date.UTC(year, month, nextDay));
    cells.push({
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
      isoDate: toIsoDate(nextDate),
      isOutsideMonth: true,
      isCurrentDay: false
    });
    nextDay += 1;
  }

  return cells;
}

export class CalendarService {
  #getState() {
    const state = game.settings.get(MODULE_ID, SETTINGS_KEYS.CALENDAR_STATE);
    const nextState = foundry.utils.mergeObject(buildDefaultState(), foundry.utils.deepClone(state ?? {}));
    const parsedDate = parseIsoDate(nextState.isoDate);
    if (!parsedDate) {
      nextState.isoDate = buildDefaultState().isoDate;
    }

    return nextState;
  }

  async #setState(nextState) {
    await game.settings.set(MODULE_ID, SETTINGS_KEYS.CALENDAR_STATE, nextState);
    return nextState;
  }

  #buildSnapshot(state = this.#getState()) {
    const date = parseIsoDate(state.isoDate) ?? parseIsoDate(buildDefaultState().isoDate);
    const monthName = getMonthName(date);
    const moon = buildMoonSnapshot(date);

    return {
      isoDate: toIsoDate(date),
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      weekdayLabel: capitalizeFirst(formatWeekday(date)),
      dateLabel: capitalizeFirst(formatDateLabel(date)),
      monthName,
      monthYearLabel: `${monthName} ${date.getUTCFullYear()}`,
      weekdayHeaders: WEEKDAY_HEADERS,
      cells: buildCalendarCells(date),
      moon
    };
  }

  getSnapshot() {
    return this.#buildSnapshot();
  }

  async setDate(year, month, day) {
    const safeYear = Math.max(1, Math.floor(toNumber(year, 1)));
    const safeMonth = Math.max(1, Math.min(12, Math.floor(toNumber(month, 1))));
    const safeDay = Math.max(1, Math.min(31, Math.floor(toNumber(day, 1))));
    const date = new Date(Date.UTC(safeYear, safeMonth - 1, safeDay));
    if (
      date.getUTCFullYear() !== safeYear
      || date.getUTCMonth() !== safeMonth - 1
      || date.getUTCDate() !== safeDay
    ) {
      throw new Error("Некорректная дата календаря.");
    }

    await this.#setState({
      version: 1,
      isoDate: toIsoDate(date)
    });

    return this.getSnapshot();
  }

  async advanceDays(days) {
    const safeDays = Math.max(0, Math.floor(toNumber(days, 0)));
    const state = this.#getState();
    const fromDate = parseIsoDate(state.isoDate) ?? parseIsoDate(buildDefaultState().isoDate);
    const toDate = new Date(fromDate.getTime());
    toDate.setUTCDate(toDate.getUTCDate() + safeDays);

    await this.#setState({
      version: 1,
      isoDate: toIsoDate(toDate)
    });

    return {
      from: this.#buildSnapshot({ isoDate: toIsoDate(fromDate) }),
      to: this.getSnapshot(),
      daysAdvanced: safeDays
    };
  }

  async advanceWeeks(weeks = 1) {
    const safeWeeks = Math.max(0, Math.floor(toNumber(weeks, 0)));
    return this.advanceDays(safeWeeks * 7);
  }

  async advanceMonths(months = 1) {
    const safeMonths = Math.max(0, Math.floor(toNumber(months, 0)));
    const state = this.#getState();
    const fromDate = parseIsoDate(state.isoDate) ?? parseIsoDate(buildDefaultState().isoDate);
    const toDate = new Date(fromDate.getTime());
    toDate.setUTCMonth(toDate.getUTCMonth() + safeMonths);
    const daysAdvanced = Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));

    await this.#setState({
      version: 1,
      isoDate: toIsoDate(toDate)
    });

    return {
      from: this.#buildSnapshot({ isoDate: toIsoDate(fromDate) }),
      to: this.getSnapshot(),
      daysAdvanced
    };
  }
}
