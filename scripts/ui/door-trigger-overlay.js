import { StorageTokenOverlayController } from "./storage-token-overlay.js?v=1.4.197-door-trigger-target";

const HANDLED_MESSAGES = Object.freeze({
  DOOR_CHARACTER_REQUIRED: "Выберите своего персонажа",
  DOOR_CHARACTER_UNAVAILABLE: "Персонаж недоступен",
  DOOR_SCENE_MISMATCH: "Персонаж на другой сцене",
  DOOR_DISTANCE: "Подойдите ближе",
  DOOR_UNAVAILABLE: "Дверь недоступна",
  DOOR_DISABLED: "Механика двери выключена",
  DOOR_STATE_CHANGED: "Состояние двери изменилось",
  DOOR_LOCKED: "Дверь заперта"
});

function wallUuidOf(control) {
  return String(control?.wall?.document?.uuid ?? control?.wall?.uuid ?? "").trim();
}

export function doorTriggerFeedbackForError(error) {
  const code = String(error?.code ?? "").trim();
  if (code === "DOOR_TRIGGER_DENIED") {
    return {
      text: String(error?.message ?? "").trim() || "Действие запрещено",
      durationMs: 3000
    };
  }
  const text = HANDLED_MESSAGES[code];
  return text ? { text, durationMs: 2000 } : null;
}

export class DoorTriggerOverlayController {
  constructor({
    overlay = new StorageTokenOverlayController()
  } = {}) {
    this.overlay = overlay;
    this.wallUuid = "";
    this.control = null;
  }

  get node() {
    return this.overlay?.node ?? null;
  }

  showOpen(control, { onOpen } = {}) {
    const wallUuid = wallUuidOf(control);
    if (!wallUuid || typeof onOpen !== "function") return false;
    this.wallUuid = wallUuid;
    this.control = control;
    const shown = this.overlay.showActions?.(control, [{
      id: "open",
      label: "Открыть",
      icon: "fa-solid fa-door-open",
      callback: onOpen,
      onError: (error) => {
        const feedback = doorTriggerFeedbackForError(error);
        if (!feedback) return false;
        this.showFeedback(control, feedback.text, { durationMs: feedback.durationMs });
        return true;
      }
    }]) === true;
    this.overlay?.node?.classList?.add?.("rm-door-trigger-actions");
    return shown;
  }

  showFeedback(control, text, options = {}) {
    this.wallUuid = wallUuidOf(control);
    this.control = control;
    return this.overlay.showFeedback?.(control, text, options) === true;
  }

  reposition() {
    return this.overlay.reposition?.() === true;
  }

  clear(wallUuid = "") {
    const exact = String(wallUuid ?? "").trim();
    if (exact && exact !== this.wallUuid) return false;
    this.close();
    return true;
  }

  close() {
    this.overlay.close?.();
    this.wallUuid = "";
    this.control = null;
  }

  destroy() {
    this.overlay.destroy?.();
    this.wallUuid = "";
    this.control = null;
  }
}
