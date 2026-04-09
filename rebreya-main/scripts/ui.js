import { DEFAULT_DISPLAY_PRECISION, MODULE_ID, SETTINGS_KEYS } from "./constants.js";

export function getDisplayPrecision() {
  return Number(game.settings.get(MODULE_ID, SETTINGS_KEYS.DISPLAY_PRECISION) ?? DEFAULT_DISPLAY_PRECISION);
}

export function formatNumber(value, precision = getDisplayPrecision()) {
  const numericValue = Number(value ?? 0);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const roundedValue = Number(safeValue.toFixed(Math.max(0, precision)));

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, precision)
  }).format(roundedValue);
}

export function formatPercent(value, precision = 1) {
  return `${formatNumber(Number(value ?? 0) * 100, precision)}%`;
}

export function formatSignedPercent(value, precision = 1) {
  const numericValue = Number(value ?? 0);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const prefix = safeValue > 0 ? "+" : "";
  return `${prefix}${formatPercent(safeValue, precision)}`;
}

export function formatSignedNumber(value, precision = getDisplayPrecision()) {
  const numericValue = Number(value ?? 0);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const prefix = safeValue > 0 ? "+" : "";
  return `${prefix}${formatNumber(safeValue, precision)}`;
}

export function getAppElement(app) {
  if (!app?.element) {
    return null;
  }

  return app.element instanceof HTMLElement ? app.element : (app.element[0] ?? null);
}

export function bringAppToFront(app) {
  if (typeof app?.bringToFront === "function") {
    try {
      app.bringToFront();
    }
    catch (error) {
      console.debug(`${MODULE_ID} | Native bringToFront failed. Falling back to z-index bump.`, error);
    }
  }

  const element = getAppElement(app);
  if (!element) {
    return null;
  }

  const windowElement = element.closest(".window-app, .application") ?? element;
  const windows = Array.from(document.querySelectorAll(".window-app, .application"));
  const maxZIndex = windows.reduce((maxValue, node) => {
    const currentValue = Number.parseInt(window.getComputedStyle(node).zIndex ?? "", 10);
    return Number.isFinite(currentValue) ? Math.max(maxValue, currentValue) : maxValue;
  }, 100);

  windowElement.style.zIndex = String(maxZIndex + 2);
  return windowElement;
}

export function rerenderApp(app) {
  if (!app?.render) {
    return Promise.resolve();
  }

  return app.render({ force: true });
}

export function registerHandlebarsHelpers() {
  if (Handlebars.helpers.rmNum) {
    return;
  }

  Handlebars.registerHelper("rmNum", (value, options) => {
    const precision = Number(options?.hash?.precision ?? getDisplayPrecision());
    return formatNumber(value, precision);
  });

  Handlebars.registerHelper("rmPct", (value, options) => {
    const precision = Number(options?.hash?.precision ?? 1);
    return formatPercent(value, precision);
  });

  Handlebars.registerHelper("rmSigned", (value, options) => {
    const precision = Number(options?.hash?.precision ?? getDisplayPrecision());
    return formatSignedNumber(value, precision);
  });

  Handlebars.registerHelper("rmSignedPct", (value, options) => {
    const precision = Number(options?.hash?.precision ?? 1);
    return formatSignedPercent(value, precision);
  });

  Handlebars.registerHelper("rmEq", (left, right) => left === right);
}
