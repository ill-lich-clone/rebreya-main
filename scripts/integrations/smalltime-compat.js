import { MODULE_ID } from "../constants.js";

const SMALLTIME_MODULE_ID = "smalltime";
const SECONDS_PER_DAY = 86400;
const UPDATE_DATE_PATCH = Symbol.for(`${MODULE_ID}.smalltime.updateDatePatch`);
const TIME_COMPONENTS_PATCH = Symbol.for(`${MODULE_ID}.smalltime.timeComponentsPatch`);

let activeModuleApi = null;
let worldTimeHookRegistered = false;
let renderHookRegistered = false;
let suppressNextWorldTimeDateDelta = false;

function isSmallTimeActive() {
  return globalThis.game?.modules?.get?.(SMALLTIME_MODULE_ID)?.active === true;
}

function getSmallTimeAppClass() {
  return globalThis.SmallTimeApp ?? null;
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeSecondsOfDay(value, secondsPerDay = SECONDS_PER_DAY) {
  const safeSecondsPerDay = Math.max(1, Math.floor(toNumber(secondsPerDay, SECONDS_PER_DAY)));
  const seconds = Math.floor(toNumber(value, 0));
  return ((seconds % safeSecondsPerDay) + safeSecondsPerDay) % safeSecondsPerDay;
}

function splitTimeOfDay(value) {
  const timeOfDaySeconds = normalizeSecondsOfDay(value);
  return {
    hour: Math.floor(timeOfDaySeconds / 3600),
    minute: Math.floor((timeOfDaySeconds % 3600) / 60),
    second: timeOfDaySeconds % 60
  };
}

function parseIsoDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,6})-(\d{2})-(\d{2})$/u);
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

function getDayOfYear(date) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - startOfYear) / 86400000) + 1;
}

function getDayOfWeek(date) {
  return date.getUTCDay();
}

function getSnapshotDate(snapshot = {}) {
  const isoDate = parseIsoDate(snapshot.isoDate);
  if (isoDate) {
    return isoDate;
  }

  const year = Math.max(1, Math.floor(toNumber(snapshot.year, 1)));
  const month = Math.max(1, Math.min(12, Math.floor(toNumber(snapshot.month, 1))));
  const day = Math.max(1, Math.min(31, Math.floor(toNumber(snapshot.day, 1))));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return new Date(Date.UTC(1, 0, 1));
  }

  return date;
}

export function buildSmallTimeDateDisplay(snapshot = {}) {
  const weekday = String(snapshot?.weekdayLabel ?? "").trim();
  const day = Number(snapshot?.day ?? 0);
  const month = String(snapshot?.monthName ?? "").trim();
  const year = Number(snapshot?.year ?? 0);
  const parts = [];

  if (weekday) {
    parts.push(`${weekday},`);
  }
  if (day > 0) {
    parts.push(String(day));
  }
  if (month) {
    parts.push(month);
  }
  if (year > 0) {
    parts.push(String(year));
  }

  return parts.join(" ").trim();
}

export function buildRebreyaCalendarTimeComponents(snapshot = {}, calendar = null, fallbackComponents = null) {
  const date = getSnapshotDate(snapshot);
  const timeParts = splitTimeOfDay(snapshot.timeOfDaySeconds);
  const yearZero = Math.trunc(toNumber(calendar?.years?.yearZero, 0));
  const year = date.getUTCFullYear() - yearZero;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  return {
    ...(fallbackComponents ?? {}),
    year,
    month,
    monthNumber: month + 1,
    day,
    dayOfMonth: day,
    dayOfYear: getDayOfYear(date),
    dayOfWeek: getDayOfWeek(date),
    hour: timeParts.hour,
    minute: timeParts.minute,
    second: timeParts.second
  };
}

export function countWorldTimeDayDelta(worldTime, deltaSeconds, secondsPerDay = SECONDS_PER_DAY) {
  const safeWorldTime = Number(worldTime);
  const safeDelta = Number(deltaSeconds);
  const safeSecondsPerDay = Number(secondsPerDay);
  if (!Number.isFinite(safeWorldTime) || !Number.isFinite(safeDelta) || safeSecondsPerDay <= 0) {
    return 0;
  }

  const previousWorldTime = safeWorldTime - safeDelta;
  return Math.floor(safeWorldTime / safeSecondsPerDay) - Math.floor(previousWorldTime / safeSecondsPerDay);
}

export function patchSmallTimeCalendarTimeSource(moduleApi = activeModuleApi) {
  const calendar = globalThis.game?.time?.calendar ?? null;
  if (!calendar || typeof calendar.timeToComponents !== "function") {
    return false;
  }

  activeModuleApi = moduleApi ?? activeModuleApi;
  if (calendar[TIME_COMPONENTS_PATCH]) {
    return true;
  }

  const originalTimeToComponents = calendar.timeToComponents;
  calendar.timeToComponents = function rebreyaSmallTimeToComponents(...args) {
    const api = activeModuleApi ?? moduleApi;
    const fallbackComponents = originalTimeToComponents.apply(this, args);
    let snapshot = null;

    try {
      snapshot = api?.getCalendarSnapshot?.() ?? null;
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to read Rebreya calendar for SmallTime sun calculations.`, error);
    }

    if (!snapshot) {
      return fallbackComponents;
    }

    return buildRebreyaCalendarTimeComponents(snapshot, this, fallbackComponents);
  };
  calendar.timeToComponents[TIME_COMPONENTS_PATCH] = {
    originalTimeToComponents
  };
  calendar[TIME_COMPONENTS_PATCH] = true;
  return true;
}

export function patchSmallTimeDateDisplay(moduleApi = activeModuleApi) {
  const SmallTimeApp = getSmallTimeAppClass();
  if (!SmallTimeApp || typeof SmallTimeApp.updateDate !== "function") {
    return false;
  }

  activeModuleApi = moduleApi ?? activeModuleApi;
  if (SmallTimeApp.updateDate[UPDATE_DATE_PATCH]) {
    return true;
  }

  const originalUpdateDate = SmallTimeApp.updateDate;
  SmallTimeApp.updateDate = async function rebreyaSmallTimeUpdateDate(...args) {
    const api = activeModuleApi ?? moduleApi;
    let displayDate = "";

    try {
      displayDate = buildSmallTimeDateDisplay(api?.getCalendarSnapshot?.());
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to build SmallTime date from Rebreya calendar.`, error);
    }

    if (!displayDate) {
      return originalUpdateDate.apply(this, args);
    }

    const dateDisplayElement = globalThis.document?.getElementById?.("dateDisplay");
    if (dateDisplayElement) {
      dateDisplayElement.textContent = displayDate;
    }

    if (globalThis.game?.ready && globalThis.game?.user?.isGM) {
      await globalThis.game?.settings?.set?.(SMALLTIME_MODULE_ID, "current-date", displayDate);
    }

    return displayDate;
  };
  SmallTimeApp.updateDate[UPDATE_DATE_PATCH] = true;
  return true;
}

export async function refreshSmallTimeSunTimes() {
  if (!isSmallTimeActive()) {
    return false;
  }

  try {
    const helpersModule = await import("/modules/smalltime/scripts/helpers.mjs");
    if (typeof helpersModule?.Helpers?.updateSunriseSunsetTimes !== "function") {
      return false;
    }

    await helpersModule.Helpers.updateSunriseSunsetTimes();
    return true;
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to refresh SmallTime sunrise and sunset times.`, error);
    return false;
  }
}

export async function refreshSmallTimeDateDisplay() {
  patchSmallTimeDateDisplay(activeModuleApi);
  patchSmallTimeCalendarTimeSource(activeModuleApi);
  await refreshSmallTimeSunTimes();
  const SmallTimeApp = getSmallTimeAppClass();
  if (typeof SmallTimeApp?.updateDate !== "function") {
    return false;
  }

  await SmallTimeApp.updateDate();
  return true;
}

function bindRebreyaCalendarOpen(app) {
  const root = app?.element ?? globalThis.document?.getElementById?.("smalltime-app") ?? null;
  const dateDisplayElement = root?.querySelector?.("#dateDisplay") ?? globalThis.document?.getElementById?.("dateDisplay");
  if (!dateDisplayElement || dateDisplayElement.dataset?.rebreyaSmallTimeCalendar === "true") {
    return false;
  }

  dateDisplayElement.dataset.rebreyaSmallTimeCalendar = "true";
  dateDisplayElement.addEventListener("click", (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    activeModuleApi?.openInventoryApp?.({ tab: "calendar" });
  }, { capture: true });
  return true;
}

export async function handleSmallTimeWorldTimeUpdate(
  worldTime,
  deltaSeconds,
  { moduleApi = activeModuleApi, refreshSmallTimeDateDisplay: refreshDisplay = refreshSmallTimeDateDisplay } = {}
) {
  const rawDayDelta = countWorldTimeDayDelta(worldTime, deltaSeconds);
  const dayDelta = suppressNextWorldTimeDateDelta ? 0 : rawDayDelta;
  suppressNextWorldTimeDateDelta = false;
  const timeOfDaySeconds = normalizeSecondsOfDay(worldTime);

  if (globalThis.game?.user?.isGM) {
    if (moduleApi?.setCalendarTimeOfDay) {
      await moduleApi.setCalendarTimeOfDay(timeOfDaySeconds, {
        reason: "smalltime-world-time"
      });
    }

    if (dayDelta !== 0 && moduleApi?.shiftCalendarDays) {
      await moduleApi.shiftCalendarDays(dayDelta, {
        processDailyCycles: false,
        reason: "smalltime-world-time"
      });
    }
  }

  await refreshDisplay?.();
  return dayDelta;
}

export async function syncSmallTimeToCalendarTime(
  moduleApi = activeModuleApi,
  { refreshSmallTimeDateDisplay: refreshDisplay = refreshSmallTimeDateDisplay } = {}
) {
  activeModuleApi = moduleApi ?? activeModuleApi;
  if (typeof globalThis.game?.modules?.get === "function" && !isSmallTimeActive()) {
    await refreshDisplay?.();
    return false;
  }

  const snapshot = moduleApi?.getCalendarSnapshot?.();
  if (!snapshot || typeof globalThis.game?.time?.worldTime !== "number") {
    await refreshDisplay?.();
    return false;
  }

  const targetSeconds = normalizeSecondsOfDay(snapshot.timeOfDaySeconds);
  const currentSeconds = normalizeSecondsOfDay(globalThis.game.time.worldTime);
  const deltaSeconds = targetSeconds - currentSeconds;
  const SmallTimeApp = getSmallTimeAppClass();

  if (globalThis.game?.user?.isGM && deltaSeconds !== 0 && typeof globalThis.game.time.advance === "function") {
    suppressNextWorldTimeDateDelta = true;
    try {
      await globalThis.game.time.advance(deltaSeconds);
    }
    catch (error) {
      suppressNextWorldTimeDateDelta = false;
      throw error;
    }
  }

  await refreshSmallTimeSunTimes();

  if (typeof SmallTimeApp?.timeTransition === "function") {
    SmallTimeApp.timeTransition(Math.floor(targetSeconds / 60), {
      persistDarkness: false
    });
  }

  await refreshDisplay?.();
  return true;
}

export function registerSmallTimeIntegration(moduleApi) {
  activeModuleApi = moduleApi;
  if (!isSmallTimeActive()) {
    return false;
  }

  patchSmallTimeDateDisplay(moduleApi);
  patchSmallTimeCalendarTimeSource(moduleApi);

  if (!worldTimeHookRegistered && globalThis.Hooks?.on) {
    worldTimeHookRegistered = true;
    Hooks.on("updateWorldTime", (worldTime, deltaSeconds) => {
      handleSmallTimeWorldTimeUpdate(worldTime, deltaSeconds).catch((error) => {
        console.warn(`${MODULE_ID} | Failed to sync SmallTime world time with Rebreya calendar.`, error);
      });
    });
  }

  if (!renderHookRegistered && globalThis.Hooks?.on) {
    renderHookRegistered = true;
    Hooks.on("renderSmallTimeApp", (app) => {
      patchSmallTimeDateDisplay(activeModuleApi);
      patchSmallTimeCalendarTimeSource(activeModuleApi);
      bindRebreyaCalendarOpen(app);
      refreshSmallTimeDateDisplay().catch((error) => {
        console.warn(`${MODULE_ID} | Failed to refresh SmallTime date display.`, error);
      });
    });
  }

  refreshSmallTimeDateDisplay().catch((error) => {
    console.warn(`${MODULE_ID} | Failed to initialize SmallTime date display.`, error);
  });
  return true;
}
