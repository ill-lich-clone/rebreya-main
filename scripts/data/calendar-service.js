import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { GROUP_CONTEXT_ERRORS, normalizeGroupState } from "./group-context-service.js";

const WEEKDAY_HEADERS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MOON_CYCLE_DAYS = 28.8;
const MOON_EPOCH_UTC = Date.UTC(1, 0, 1);
const SECONDS_PER_DAY = 86400;
const GROUP_CONTEXT_FALLBACK_ERRORS = new Set([
  GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP,
  GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP,
  GROUP_CONTEXT_ERRORS.GROUP_NOT_FOUND
]);

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function normalizeTimeOfDaySeconds(value, fallback = 0) {
  const numericValue = Math.floor(toNumber(value, fallback));
  return ((numericValue % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

function buildTimeOfDayParts(value) {
  const timeOfDaySeconds = normalizeTimeOfDaySeconds(value);
  const hour = Math.floor(timeOfDaySeconds / 3600);
  const minute = Math.floor((timeOfDaySeconds % 3600) / 60);
  const second = timeOfDaySeconds % 60;
  const timeLabel = [
    String(hour).padStart(2, "0"),
    String(minute).padStart(2, "0"),
    String(second).padStart(2, "0")
  ].join(":");

  return {
    timeOfDaySeconds,
    hour,
    minute,
    second,
    timeLabel,
    timeShortLabel: timeLabel.slice(0, 5)
  };
}

function resolveTimeOfDaySeconds(baseState, options = {}) {
  const source = asObject(options);
  if ("timeOfDaySeconds" in source) {
    return normalizeTimeOfDaySeconds(source.timeOfDaySeconds, baseState?.timeOfDaySeconds ?? 0);
  }

  const hasParts = ["hour", "minute", "second"].some((key) => key in source);
  if (!hasParts) {
    return normalizeTimeOfDaySeconds(baseState?.timeOfDaySeconds ?? 0);
  }

  const current = buildTimeOfDayParts(baseState?.timeOfDaySeconds ?? 0);
  const hour = Math.max(0, Math.min(23, Math.floor(toNumber(source.hour, current.hour))));
  const minute = Math.max(0, Math.min(59, Math.floor(toNumber(source.minute, current.minute))));
  const second = Math.max(0, Math.min(59, Math.floor(toNumber(source.second, current.second))));
  return normalizeTimeOfDaySeconds((hour * 3600) + (minute * 60) + second);
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
    isoDate: toIsoDate(utcDate),
    timeOfDaySeconds: 0
  };
}

function normalizeCalendarState(value = {}, fallback = buildDefaultState()) {
  const source = asObject(value);
  const fallbackState = asObject(fallback);
  const sourceDate = parseIsoDate(source.isoDate);
  const fallbackDate = parseIsoDate(fallbackState.isoDate) ?? parseIsoDate(buildDefaultState().isoDate);

  return {
    version: 1,
    isoDate: toIsoDate(sourceDate ?? fallbackDate),
    timeOfDaySeconds: normalizeTimeOfDaySeconds(
      source.timeOfDaySeconds,
      fallbackState.timeOfDaySeconds ?? 0
    )
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
  constructor({ groupContextService = null } = {}) {
    this.groupContextService = groupContextService;
  }

  setGroupContextService(groupContextService) {
    this.groupContextService = groupContextService;
  }

  #getWorldState() {
    return normalizeCalendarState(
      globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.CALENDAR_STATE),
      buildDefaultState()
    );
  }

  #getCurrentGroupContext() {
    if (!this.groupContextService?.resolveForCurrentUser) {
      return null;
    }

    try {
      return this.groupContextService.resolveForCurrentUser();
    }
    catch (error) {
      if (GROUP_CONTEXT_FALLBACK_ERRORS.has(error?.message)) {
        return null;
      }

      throw error;
    }
  }

  #getStateScope() {
    const worldState = this.#getWorldState();
    const groupContext = this.#getCurrentGroupContext();
    if (!groupContext?.groupId) {
      return {
        type: "world",
        state: worldState
      };
    }

    return {
      type: "group",
      groupId: groupContext.groupId,
      state: normalizeCalendarState(groupContext.groupState?.calendar, worldState)
    };
  }

  async #setState(scope, nextState) {
    const state = normalizeCalendarState(nextState);

    if (scope?.type === "group" && scope.groupId && this.groupContextService) {
      const registry = this.groupContextService.getRegistry();
      registry.groupsById[scope.groupId] = {
        ...normalizeGroupState(scope.groupId, registry.groupsById[scope.groupId] ?? {}),
        calendar: clone(state)
      };
      await this.groupContextService.setRegistry(registry);
      return state;
    }

    await globalThis.game?.settings?.set?.(MODULE_ID, SETTINGS_KEYS.CALENDAR_STATE, state);
    return state;
  }

  #buildSnapshot(state = this.#getStateScope().state) {
    const normalizedState = normalizeCalendarState(state);
    const date = parseIsoDate(normalizedState.isoDate) ?? parseIsoDate(buildDefaultState().isoDate);
    const monthName = getMonthName(date);
    const moon = buildMoonSnapshot(date);
    const timeOfDay = buildTimeOfDayParts(normalizedState.timeOfDaySeconds);

    return {
      isoDate: toIsoDate(date),
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      ...timeOfDay,
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
    return this.#buildSnapshot(this.#getStateScope().state);
  }

  async setDate(year, month, day, options = {}) {
    const scope = this.#getStateScope();
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

    await this.#setState(scope, {
      version: 1,
      isoDate: toIsoDate(date),
      timeOfDaySeconds: resolveTimeOfDaySeconds(scope.state, options)
    });

    return this.getSnapshot();
  }

  async setTimeOfDaySeconds(seconds) {
    const scope = this.#getStateScope();
    await this.#setState(scope, {
      version: 1,
      isoDate: scope.state.isoDate,
      timeOfDaySeconds: normalizeTimeOfDaySeconds(seconds, scope.state.timeOfDaySeconds ?? 0)
    });

    return this.getSnapshot();
  }

  async setTimeOfDay(options = {}) {
    const scope = this.#getStateScope();
    await this.#setState(scope, {
      version: 1,
      isoDate: scope.state.isoDate,
      timeOfDaySeconds: resolveTimeOfDaySeconds(scope.state, options)
    });

    return this.getSnapshot();
  }

  async shiftDays(days) {
    const safeDays = Math.trunc(toNumber(days, 0));
    const scope = this.#getStateScope();
    const state = scope.state;
    const fromDate = parseIsoDate(state.isoDate) ?? parseIsoDate(buildDefaultState().isoDate);
    const toDate = new Date(fromDate.getTime());
    toDate.setUTCDate(toDate.getUTCDate() + safeDays);

    await this.#setState(scope, {
      version: 1,
      isoDate: toIsoDate(toDate),
      timeOfDaySeconds: state.timeOfDaySeconds
    });

    return {
      from: this.#buildSnapshot({
        isoDate: toIsoDate(fromDate),
        timeOfDaySeconds: state.timeOfDaySeconds
      }),
      to: this.getSnapshot(),
      daysAdvanced: safeDays
    };
  }

  async advanceDays(days) {
    const safeDays = Math.max(0, Math.floor(toNumber(days, 0)));
    return this.shiftDays(safeDays);
  }

  async advanceWeeks(weeks = 1) {
    const safeWeeks = Math.max(0, Math.floor(toNumber(weeks, 0)));
    return this.advanceDays(safeWeeks * 7);
  }

  async advanceMonths(months = 1) {
    const safeMonths = Math.max(0, Math.floor(toNumber(months, 0)));
    const scope = this.#getStateScope();
    const state = scope.state;
    const fromDate = parseIsoDate(state.isoDate) ?? parseIsoDate(buildDefaultState().isoDate);
    const toDate = new Date(fromDate.getTime());
    toDate.setUTCMonth(toDate.getUTCMonth() + safeMonths);
    const daysAdvanced = Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));

    await this.#setState(scope, {
      version: 1,
      isoDate: toIsoDate(toDate),
      timeOfDaySeconds: state.timeOfDaySeconds
    });

    return {
      from: this.#buildSnapshot({
        isoDate: toIsoDate(fromDate),
        timeOfDaySeconds: state.timeOfDaySeconds
      }),
      to: this.getSnapshot(),
      daysAdvanced
    };
  }
}
