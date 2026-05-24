const PATCHED_RENDER_SETTINGS_FLAG = "__rebreyaSmAirshipRenderSettingsCompat";
const SM_AIRSHIP_SETTINGS_SELECTOR = ".sm-airship-settings-launch";

function isSmAirshipRenderSettingsHook(fn) {
  if (typeof fn !== "function") {
    return false;
  }

  if (fn[PATCHED_RENDER_SETTINGS_FLAG]) {
    return false;
  }

  return Function.prototype.toString.call(fn).includes(SM_AIRSHIP_SETTINGS_SELECTOR);
}

function toJQueryCompatibleHtml(html) {
  if (typeof html?.find === "function") {
    return html;
  }

  if (typeof globalThis.$ !== "function") {
    return html;
  }

  try {
    return globalThis.$(html);
  }
  catch (_error) {
    return html;
  }
}

export function patchSmAirshipRenderSettingsHook(HooksApi = globalThis.Hooks) {
  const renderSettingsHooks = HooksApi?.events?.renderSettings;
  if (!Array.isArray(renderSettingsHooks)) {
    return 0;
  }

  let patched = 0;
  for (const entry of renderSettingsHooks) {
    const originalFn = entry?.fn;
    if (!isSmAirshipRenderSettingsHook(originalFn)) {
      continue;
    }

    const wrappedFn = function rebreyaSmAirshipRenderSettingsCompat(app, html, ...rest) {
      return originalFn.call(this, app, toJQueryCompatibleHtml(html), ...rest);
    };
    Object.defineProperty(wrappedFn, PATCHED_RENDER_SETTINGS_FLAG, { value: true });
    entry.fn = wrappedFn;
    patched += 1;
  }

  return patched;
}
