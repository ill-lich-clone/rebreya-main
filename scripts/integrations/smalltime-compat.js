import { MODULE_ID } from "../constants.js";

const SMALLTIME_MODULE_ID = "smalltime";
const SECONDS_PER_DAY = 86400;
const UPDATE_DATE_PATCH = Symbol.for(`${MODULE_ID}.smalltime.updateDatePatch`);

let activeModuleApi = null;
let worldTimeHookRegistered = false;
let renderHookRegistered = false;

function isSmallTimeActive() {
  return globalThis.game?.modules?.get?.(SMALLTIME_MODULE_ID)?.active === true;
}

function getSmallTimeAppClass() {
  return globalThis.SmallTimeApp ?? null;
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

export async function refreshSmallTimeDateDisplay() {
  patchSmallTimeDateDisplay(activeModuleApi);
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
  const dayDelta = countWorldTimeDayDelta(worldTime, deltaSeconds);

  if (globalThis.game?.user?.isGM && dayDelta !== 0 && moduleApi?.shiftCalendarDays) {
    await moduleApi.shiftCalendarDays(dayDelta, {
      processDailyCycles: false,
      reason: "smalltime-world-time"
    });
  }

  await refreshDisplay?.();
  return dayDelta;
}

export function registerSmallTimeIntegration(moduleApi) {
  activeModuleApi = moduleApi;
  if (!isSmallTimeActive()) {
    return false;
  }

  patchSmallTimeDateDisplay(moduleApi);

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
