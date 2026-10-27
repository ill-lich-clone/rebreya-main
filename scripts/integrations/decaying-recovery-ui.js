const SCOPE = "rebreya-main";
const STATUS = "rebreya-decaying-damage";
const escape = value => String(value ?? "").replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const effects = actor => (actor?.effects?.contents ?? []).filter(e => e.statuses?.has?.(STATUS) || e.statuses?.includes?.(STATUS) || e.getFlag?.(SCOPE, "statusId") === STATUS);

export async function requestRecoveryOnce(state, intent, request) {
  state.pending ??= intent;
  try {
    const result = await request(state.pending);
    state.pending = null;
    return result;
  } catch (error) {
    if (["decaying-recovery-rejected", "invalid-request", "active-gm-unavailable"].includes(error?.code)) state.pending = null;
    throw error;
  }
}

export async function promptDecayingRecovery({ candidates, effectId }) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2?.wait) throw new Error("Диалог Foundry недоступен.");
  const content = `<p>Выберите эффект и способ уменьшения. Если источник неизвестен, укажите Сл.</p>
    <label>Эффект <select name="effectId">${candidates.map(e => `<option value="${escape(e.id)}" ${e.id === effectId ? "selected" : ""}>${escape(e.name)}</option>`).join("")}</select></label>
    <label>Способ <select name="action"><option value="bonus">Проверка: бонусное действие</option><option value="action">Проверка: действие</option><option value="manual">Уменьшить вручную</option></select></label>
    <label>Ручное уменьшение <input name="amount" type="number" min="1" value="1"></label>
    <label>Сл при неизвестном источнике <input name="dc" type="number" min="1" max="99" placeholder="Укажите Сл"></label>`;
  return DialogV2.wait({ window: { title: "Затихающий урон" }, content, rejectClose: false, buttons: [
    { action: "apply", label: "Применить", default: true, callback: (_event, button) => ({ effectId: button.form.querySelector('[name="effectId"]').value,
      action: button.form.querySelector('[name="action"]').value, amount: Number(button.form.querySelector('[name="amount"]').value), dc: Number(button.form.querySelector('[name="dc"]').value) }) },
    { action: "cancel", label: "Отмена", callback: () => null }
  ] });
}

export async function runDecayingRecoveryMacro({ targetTokenUuid = "", effectId = "", canvas = globalThis.canvas, game = globalThis.game,
  resolve = uuid => globalThis.fromUuid?.(uuid), dialog = promptDecayingRecovery, randomId = () => globalThis.foundry.utils.randomID(), request } = {}) {
  const controlled = (canvas?.tokens?.controlled ?? []).map(token => token.document ?? token);
  if (controlled.length !== 1 || (!game?.user?.isGM && !controlled[0].actor?.isOwner)) throw new Error("Выберите один подконтрольный токен лекаря.");
  const source = controlled[0];
  const targets = Array.from(game?.user?.targets ?? []).map(token => token.document ?? token);
  if (!targetTokenUuid && targets.length > 1) throw new Error("Выберите не более одного пациента через T.");
  const target = targetTokenUuid ? await resolve(targetTokenUuid) : (targets[0] ?? source);
  const candidates = effects(target?.actor);
  if (!candidates.length || (effectId && !candidates.some(e => e.id === effectId))) throw new Error("Выбранный эффект затихающего урона недоступен.");
  const choice = await dialog({ candidates, effectId });
  if (!choice) return null;
  return request({ operationId: randomId(), sourceTokenUuid: source.uuid, targetTokenUuid: target.uuid,
    effectId: choice.effectId, action: choice.action, amount: choice.amount, dc: choice.dc });
}

export function bindDecayingRecoveryChat(message, html, moduleApi) {
  const context = message?.getFlag?.(SCOPE, "decayingRecoveryTarget");
  const button = html?.querySelector?.('[data-action="decaying-recovery"]');
  if (!context || !button || button.dataset?.rebreyaBound === "true") return;
  if (button.dataset) button.dataset.rebreyaBound = "true";
  button.addEventListener("click", async event => {
    event.preventDefault();
    try { await moduleApi.recoverDecayingDamage({ targetTokenUuid: context.targetTokenUuid, effectId: context.effectId }); }
    catch (error) { globalThis.ui?.notifications?.warn?.(error.message); }
  });
}

export async function publishDecayingRecoveryPrompt(effect, { active, create } = {}) {
  if (!active?.() || !effects({ effects: { contents: [effect] } }).length || !effect?.id) return;
  for (const token of effect.parent?.getActiveTokens?.() ?? []) {
    const document = token.document ?? token;
    if (!document.uuid || document.hidden) continue;
    await create({ content: `<p>${escape(document.name)}: затихающий урон.</p><button type="button" data-action="decaying-recovery">Уменьшить затихающий урон</button>`,
      flags: { [SCOPE]: { decayingRecoveryTarget: { targetTokenUuid: document.uuid, effectId: effect.id } } } });
  }
}
