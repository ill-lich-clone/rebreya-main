import { MODULE_ID } from "../constants.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;

/** @deprecated Use typed world-mutation commands instead of the arbitrary setting relay. */
export const SOCKET_EVENT_SET_SETTING = "setSetting";

/** @deprecated Use typed world-mutation command results instead of the arbitrary setting relay. */
export const SOCKET_EVENT_SET_SETTING_RESULT = "setSettingResult";

const SETTINGS_UPDATE_TIMEOUT_MS = 10000;
const pendingSettingUpdates = new Map();

function cloneSettingValue(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createSettingsUpdateRequestId() {
  const randomPart = globalThis.foundry?.utils?.randomID?.()
    ?? Math.random().toString(36).slice(2);
  return `settings-${Date.now()}-${randomPart}`;
}

function buildSettingUpdateError(message) {
  return new Error(String(message ?? "").trim() || "Не удалось обновить настройку мира через мастера.");
}

/**
 * @deprecated Use a typed world-mutation client. World requests fail closed when no relay is available.
 */
export async function requestSettingsUpdate(settingKey, settingData, options = {}) {
  const setting = globalThis.game?.settings?.settings?.get?.(`${MODULE_ID}.${settingKey}`);
  if (globalThis.game?.user?.isGM || setting?.scope === "client") {
    await globalThis.game?.settings?.set?.(MODULE_ID, settingKey, settingData, options);
    return settingData;
  }

  if (typeof globalThis.game?.socket?.emit !== "function") {
    throw buildSettingUpdateError("Сокет Foundry недоступен для обновления настройки мира.");
  }

  const requestId = createSettingsUpdateRequestId();
  const payload = {
    type: SOCKET_EVENT_SET_SETTING,
    requestId,
    key: settingKey,
    data: cloneSettingValue(settingData),
    options: cloneSettingValue(options),
    senderId: globalThis.game?.user?.id ?? ""
  };

  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout?.(() => {
      pendingSettingUpdates.delete(requestId);
      reject(buildSettingUpdateError("Мастер не подтвердил обновление настройки мира."));
    }, SETTINGS_UPDATE_TIMEOUT_MS);

    pendingSettingUpdates.set(requestId, {
      resolve: () => resolve(settingData),
      reject,
      timeoutId
    });

    try {
      globalThis.game.socket.emit(SOCKET_CHANNEL, payload);
    }
    catch (error) {
      pendingSettingUpdates.delete(requestId);
      if (timeoutId !== undefined && typeof globalThis.clearTimeout === "function") {
        globalThis.clearTimeout(timeoutId);
      }
      reject(error);
    }
  });
}

/** @deprecated Use typed world-mutation command result correlation instead. */
export function handleSettingsUpdateSocketResponse(message = {}) {
  if (message?.type !== SOCKET_EVENT_SET_SETTING_RESULT) {
    return false;
  }

  const requestId = String(message.requestId ?? "").trim();
  const pending = pendingSettingUpdates.get(requestId);
  if (!pending) {
    return true;
  }

  const forUserId = String(message.forUserId ?? "").trim();
  if (forUserId && forUserId !== String(globalThis.game?.user?.id ?? "")) {
    return true;
  }

  pendingSettingUpdates.delete(requestId);
  if (pending.timeoutId !== undefined && typeof globalThis.clearTimeout === "function") {
    globalThis.clearTimeout(pending.timeoutId);
  }

  if (message.ok === false) {
    pending.reject(buildSettingUpdateError(message.error));
  }
  else {
    pending.resolve(message.data);
  }
  return true;
}
