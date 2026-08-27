import { MODULE_ID } from "../../constants.js";
import { SOCKET_CHANNEL } from "./socket-command-bus.js";
import { isActiveGmClient } from "./active-gm.js";

export const STORAGE_TRIGGER_PROMPT_REQUEST = "rebreya.storage-trigger.prompt";
export const STORAGE_TRIGGER_PROMPT_RESULT = "rebreya.storage-trigger.prompt.result";

function clean(value, maximum = 512) { return String(value ?? "").trim().slice(0, maximum); }
function userById(game, id) {
  return game?.users?.get?.(id)
    ?? game?.users?.contents?.find?.((user) => clean(user?.id) === clean(id))
    ?? null;
}
function promptData(value = {}) {
  return {
    title: clean(value.title, 120) || "Хранилище",
    message: clean(value.message, 2000),
    confirmLabel: clean(value.confirmLabel, 80) || "Продолжить",
    cancelLabel: clean(value.cancelLabel, 80) || "Отмена"
  };
}

export class StorageTriggerPromptBroker {
  constructor({
    gameProvider = () => globalThis.game,
    showDialog = async () => false,
    idFactory = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    setTimeoutFn = (...args) => globalThis.setTimeout(...args),
    clearTimeoutFn = (id) => globalThis.clearTimeout(id),
    timeoutMs = 120000
  } = {}) {
    this.gameProvider = gameProvider;
    this.showDialog = showDialog;
    this.idFactory = idFactory;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
  }

  async request(context = {}, config = {}) {
    const game = this.gameProvider();
    if (!isActiveGmClient(game)) throw new Error("Диалог триггера может запросить только active GM.");
    const targetUserId = clean(context.senderId, 160);
    const target = userById(game, targetUserId);
    if (!target?.active) throw new Error("Инициатор действия больше не подключён.");
    const prompt = promptData(config);
    if (targetUserId === clean(game.user?.id)) return Boolean(await this.showDialog(prompt));
    const requestId = clean(this.idFactory(), 160);
    if (!requestId || this.pending.has(requestId)) throw new Error("Не удалось создать запрос диалога триггера.");
    const envelope = {
      type: STORAGE_TRIGGER_PROMPT_REQUEST,
      requestId,
      gmId: clean(game.user.id, 160),
      targetUserId,
      prompt
    };
    return new Promise((resolve, reject) => {
      const entry = { targetUserId, resolve, reject, timeoutId: null };
      entry.timeoutId = this.setTimeoutFn(() => {
        if (this.pending.get(requestId) !== entry) return;
        this.pending.delete(requestId);
        reject(new Error("Игрок не ответил на диалог триггера."));
      }, this.timeoutMs);
      this.pending.set(requestId, entry);
      try { game.socket.emit(SOCKET_CHANNEL, envelope); }
      catch (error) { this.pending.delete(requestId); this.clearTimeoutFn(entry.timeoutId); reject(error); }
    });
  }

  async handleMessage(message, transportSenderId = "") {
    if (![STORAGE_TRIGGER_PROMPT_REQUEST, STORAGE_TRIGGER_PROMPT_RESULT].includes(message?.type)) return false;
    const game = this.gameProvider();
    const requestId = clean(message.requestId, 160);
    const gmId = clean(message.gmId, 160);
    const targetUserId = clean(message.targetUserId, 160);
    const activeGmId = clean(game?.users?.activeGM?.id, 160);
    if (!requestId || !gmId || gmId !== activeGmId) return true;

    if (message.type === STORAGE_TRIGGER_PROMPT_REQUEST) {
      if (clean(game?.user?.id) !== targetUserId || clean(transportSenderId) !== gmId) return true;
      let accepted = false;
      try { accepted = Boolean(await this.showDialog(promptData(message.prompt))); }
      catch (error) { console.warn(`${MODULE_ID} | Storage trigger requester dialog failed.`, error); }
      game.socket?.emit?.(SOCKET_CHANNEL, {
        type: STORAGE_TRIGGER_PROMPT_RESULT, requestId, gmId, targetUserId, accepted
      });
      return true;
    }

    if (!isActiveGmClient(game) || clean(transportSenderId) !== targetUserId) return true;
    const entry = this.pending.get(requestId);
    if (!entry || entry.targetUserId !== targetUserId) return true;
    this.pending.delete(requestId);
    this.clearTimeoutFn(entry.timeoutId);
    entry.resolve(message.accepted === true);
    return true;
  }
}
