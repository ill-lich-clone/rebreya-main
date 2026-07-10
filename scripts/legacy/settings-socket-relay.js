import { MODULE_ID } from "../constants.js";

/** @deprecated Use typed world-mutation commands instead of the arbitrary setting relay. */
export const SOCKET_EVENT_SET_SETTING = "setSetting";

/** @deprecated Use typed world-mutation command results instead of the arbitrary setting relay. */
export const SOCKET_EVENT_SET_SETTING_RESULT = "setSettingResult";

/**
 * @deprecated Use a typed world-mutation client. World requests fail closed when no relay is available.
 */
export async function requestSettingsUpdate(settingKey, settingData, options = {}) {
  const setting = globalThis.game?.settings?.settings?.get?.(`${MODULE_ID}.${settingKey}`);
  if (setting?.scope === "client") {
    await globalThis.game?.settings?.set?.(MODULE_ID, settingKey, settingData, options);
    return settingData;
  }

  const disabledError = new Error("raw-setting-disabled");
  disabledError.code = "raw-setting-disabled";
  throw disabledError;
}

/** @deprecated Use typed world-mutation command result correlation instead. */
export function handleSettingsUpdateSocketResponse(message = {}) {
  return message?.type === SOCKET_EVENT_SET_SETTING_RESULT;
}
