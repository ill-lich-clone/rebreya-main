import { DoorTriggerOverlayController } from "../ui/door-trigger-overlay.js?v=1.4.199-door-overlay-anchor";

const WRAPPER = Symbol.for("rebreya-main.door-trigger-control");
const REGISTRATIONS = new WeakMap();

function wallDocument(control) {
  return control?.wall?.document ?? control?.wall ?? null;
}

function feedbackForAccess(access) {
  const messages = {
    character: "Выберите своего персонажа",
    scene: "Персонаж на другой сцене",
    distance: "Подойдите ближе",
    secret: "Дверь недоступна",
    door: "Дверь недоступна"
  };
  return messages[access?.reason] ?? "Дверь сейчас недоступна";
}

export function isCtrlModified(event, { keyboard = globalThis.game?.keyboard } = {}) {
  return event?.ctrlKey === true
    || event?.nativeEvent?.ctrlKey === true
    || event?.data?.originalEvent?.ctrlKey === true
    || keyboard?.isModifierActive?.("Control") === true;
}

export function createDoorTriggerControlClass(BaseDoorControl, moduleApi, overlayController, {
  gameProvider = () => globalThis.game,
  mutationIdFactory = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto?.randomUUID?.()
} = {}) {
  if (typeof BaseDoorControl !== "function") throw new TypeError("DoorControl base class is unavailable.");
  if (BaseDoorControl[WRAPPER] === true) return BaseDoorControl;

  class RebreyaDoorTriggerControl extends BaseDoorControl {
    async _onMouseDown(event) {
      const wall = wallDocument(this);
      const open = Number(globalThis.CONST?.WALL_DOOR_STATES?.OPEN ?? 1);
      if (Number(wall?.ds) === open) {
        overlayController.close?.();
        return super._onMouseDown(event);
      }
      const wallUuid = String(wall?.uuid ?? "").trim();
      const access = moduleApi.getDoorTriggerPreflight?.(wallUuid);
      if (access?.configured !== true || access?.enabled !== true) {
        return super._onMouseDown(event);
      }
      event?.stopPropagation?.();
      event?.preventDefault?.();
      if (access.allowed !== true) {
        overlayController.showFeedback?.(this, feedbackForAccess(access), { durationMs: 2000 });
        return false;
      }
      return overlayController.showOpen?.(this, {
        onOpen: async () => {
          const current = moduleApi.getDoorTriggerPreflight?.(wallUuid);
          if (current?.allowed !== true) {
            overlayController.showFeedback?.(this, feedbackForAccess(current), { durationMs: 2000 });
            return false;
          }
          return moduleApi.attemptDoorOpen(
            wallUuid,
            String(mutationIdFactory?.() ?? "").trim(),
            { characterTokenUuid: String(current.characterTokenUuid ?? "").trim() }
          );
        }
      });
    }

    async _onRightDown(event) {
      if (gameProvider()?.user?.isGM === true && isCtrlModified(event, {
        keyboard: gameProvider()?.keyboard
      })) {
        event?.stopPropagation?.();
        event?.preventDefault?.();
        overlayController.close?.();
        return moduleApi.openDoorTriggerEditor?.(String(wallDocument(this)?.uuid ?? "").trim());
      }
      return super._onRightDown(event);
    }
  }

  Object.defineProperty(RebreyaDoorTriggerControl, WRAPPER, { value: true });
  return RebreyaDoorTriggerControl;
}

export function registerDoorTriggerHooks(moduleApi, {
  hooks = globalThis.Hooks,
  CONFIG = globalThis.CONFIG,
  gameProvider = () => globalThis.game,
  overlayController = new DoorTriggerOverlayController(),
  mutationIdFactory
} = {}) {
  if (!CONFIG?.Canvas || typeof CONFIG.Canvas.doorControlClass !== "function") return false;
  const existing = REGISTRATIONS.get(CONFIG);
  if (existing) return existing;
  const BaseDoorControl = CONFIG.Canvas.doorControlClass;
  const DoorControlClass = createDoorTriggerControlClass(
    BaseDoorControl,
    moduleApi,
    overlayController,
    { gameProvider, mutationIdFactory }
  );
  CONFIG.Canvas.doorControlClass = DoorControlClass;

  const subscriptions = [];
  const on = (name, callback) => {
    if (typeof hooks?.on !== "function") return;
    subscriptions.push([name, hooks.on(name, callback)]);
  };
  on("canvasPan", () => overlayController.reposition?.());
  on("updateWall", (document, changed = {}) => {
    const affectsPresentation = ["c", "door", "ds", "flags"].some((key) => Object.hasOwn(changed, key));
    if (affectsPresentation) overlayController.clear?.(String(document?.uuid ?? "").trim());
    else overlayController.reposition?.();
  });
  on("deleteWall", (document) => overlayController.clear?.(String(document?.uuid ?? "").trim()));
  on("canvasReady", () => overlayController.close?.());
  on("canvasTearDown", () => overlayController.close?.());

  const registration = {
    DoorControlClass,
    unregister() {
      for (const [name, id] of subscriptions) hooks?.off?.(name, id);
      if (CONFIG.Canvas.doorControlClass === DoorControlClass) CONFIG.Canvas.doorControlClass = BaseDoorControl;
      overlayController.destroy?.();
      REGISTRATIONS.delete(CONFIG);
    }
  };
  REGISTRATIONS.set(CONFIG, registration);
  return registration;
}
