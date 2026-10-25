import { escapeFoundryHtml as escape } from "../shared/foundry-values.js";
import { TreatWoundsError } from "../application/treat-wounds-rules.js?v=1.4.372";
const outcomeLabels = { "critical-success": "Успех на 5 и более", success: "Успех", failure: "Провал: без лечения и урона", "critical-failure": "Провал на 5 и более" };
const bindings = new WeakMap();
export function resolveTreatWoundsSelection(options = {}, controlled = globalThis.canvas?.tokens?.controlled ?? [], targets = Array.from(globalThis.game?.user?.targets ?? [])) {
  const uuid = t => t?.document?.uuid ?? t?.uuid;
  if ((!options.sourceTokenUuid && controlled.length !== 1) || (!options.targetTokenUuid && targets.length > 1)) throw new TreatWoundsError("invalid-tokens", "Выберите одного лекаря и не более одного пациента.");
  const sourceTokenUuid = options.sourceTokenUuid ?? uuid(controlled[0]);
  return { sourceTokenUuid, targetTokenUuid: options.targetTokenUuid ?? (targets.length ? uuid(targets[0]) : sourceTokenUuid) };
}
export async function promptTreatWounds(preview, { DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 } = {}) {
  if (!preview.kits.length) throw new Error("У лекаря и в доступных группах нет целого неиспользованного комплекта целителя.");
  return DialogV2.wait({ window: { title: "Перевязка ран" }, content: `<div>
    <p><strong>${escape(preview.sourceName)}</strong> лечит <strong>${escape(preview.targetName)}</strong>.</p>
    <p>Лечение занимает 10 минут и полностью расходует один комплект. Цель иммунна к перевязке 1 час от начала лечения. Мировое время продвигает Мастер.</p>
    <label>Комплект<select name="kit">${preview.kits.map((k,i) => `<option value="${i}">${escape(k.sourceName)} — ${escape(k.name)} (${escape(k.quantity)} шт.)</option>`).join("")}</select></label>
    <label>Ступень лечения<select name="tierDc">${preview.tiers.map(t => `<option value="${t.dc}">Сл ${t.dc}${t.bonus ? `, +${t.bonus} хитов` : ""}</option>`).join("")}</select></label>
    ${preview.canSetDc ? '<label>Сл по обстоятельствам (необязательно)<input name="customDc" type="number" min="1" max="99" step="1" placeholder="Сл выбранной ступени"></label>' : ""}</div>`,
    buttons: [{ action: "confirm", label: "Перевязать", callback: (_event, button) => {
      const field = name => button.form.elements.namedItem(name)?.value;
      const kit = preview.kits[Number(field("kit"))];
      if (!kit) throw new Error("Комплект не выбран.");
      const custom = preview.canSetDc ? field("customDc") : "";
      return { kitItemUuid: kit.uuid, groupActorId: kit.groupActorId, tierDc: Number(field("tierDc")), customDc: custom ? Number(custom) : null };
    } }, { action: "cancel", label: "Отмена", callback: () => false }], rejectClose: false });
}
export async function promptTreatWoundsContinuation(record, { DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 } = {}) {
  return DialogV2.wait({ window: { title: "Продолжить перевязку" }, content: `<p>Продолжить лечение ${escape(record.targetName)} ещё 50 минут (всего 1 час)?</p>
    <p>Дополнительное лечение: ${escape(record.amount)} хитов, до максимума. Новый бросок и второй комплект не нужны. Мировое время продвигает Мастер.</p>`,
    buttons: [{ action: "confirm", label: "Продолжить", callback: () => true }, { action: "cancel", label: "Отмена", callback: () => false }], rejectClose: false });
}
export function buildTreatWoundsChatContent(record, { worldTime = globalThis.game?.time?.worldTime ?? record.startTime } = {}) {
  const op = escape(record.intent.operationId), kind = record.outcome?.kind;
  const canContinue = record.outcome?.canContinue && !record.continued && (record.phase === "completed" || record.phase === "continuation-prepared");
  const canResume = !record.terminal && record.phase !== "completed" && record.phase !== "continuation-prepared";
  const amount = record.amount;
  const remaining = Math.max(0, Math.ceil(Number(record.startTime) + 3600 - Number(worldTime)));
  const cooldownLabel = remaining ? `${Math.floor(remaining / 60)} мин. ${remaining % 60} сек. мирового времени` : "новая перевязка доступна";
  return `<section class="rm-treat-wounds"><h3>Перевязка ран</h3><p>${escape(record.sourceName)} → ${escape(record.targetName)}</p>
    <p>Ступень лечения: Сл ${escape(record.intent.tierDc ?? record.dc)}${record.bonus ? ` (+${escape(record.bonus)} хитов)` : ""}.</p>
    <p>Мудрость (Медицина): <strong>${escape(record.medicineRoll?.total ?? "—")}</strong>, Сл <strong>${escape(record.dc)}</strong>. ${escape(outcomeLabels[kind] ?? "Проверка выполнена")}</p>
    ${Number.isFinite(amount) ? `<p>${kind === "critical-failure" ? "Чистый колющий урон" : record.outcome.canContinue ? "Лечение" : "Без изменения хитов"}: <strong>${escape(record.continued ? amount * 2 : amount)}</strong>${record.continued ? " за полный час" : ""}.</p>` : ""}
    <p>Длительность: ${record.continued ? "1 час" : "10 минут"}. Иммунитет: 1 час от начала лечения.</p>
    <p>На момент карточки до следующей перевязки: ${escape(cooldownLabel)}.</p>
    ${record.phase !== "completed" ? '<p>Применение ещё не завершено.</p>' : ""}
    ${record.applicationError ? `<p><strong>Не удалось завершить применение:</strong> ${escape(record.applicationError)}</p>` : ""}
    ${canContinue ? `<button type="button" data-treat-wounds-action="continue" data-operation-id="${op}" data-sender-id="${escape(record.senderId)}" data-target-name="${escape(record.targetName)}" data-amount="${escape(amount)}">Продолжить лечение ещё 50 минут</button>` : ""}
    ${canResume ? `<button type="button" data-treat-wounds-action="resume" data-operation-id="${op}" data-sender-id="${escape(record.senderId)}">Завершить применение без нового броска</button>` : ""}</section>`;
}
export function bindTreatWoundsChat(message, html, api) {
  if (!message.getFlag?.("rebreya-main", "treatWoundsOperationId")) return;
  const root = html?.[0] ?? html;
  if (!root?.querySelectorAll) return;
  bindings.get(root)?.abort(); const controller = new AbortController(); bindings.set(root, controller);
  for (const button of root.querySelectorAll("[data-treat-wounds-action]")) {
    if (!globalThis.game?.user?.isGM && button.dataset.senderId !== globalThis.game?.user?.id) { button.hidden = true; continue; }
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (button.dataset.treatWoundsAction === "continue" && !await promptTreatWoundsContinuation({ targetName: button.dataset.targetName, amount: Number(button.dataset.amount) })) return;
        await api.requestTreatWoundsAction(button.dataset.treatWoundsAction, { operationId: button.dataset.operationId });
      } catch (error) { globalThis.ui?.notifications?.error?.(error.message); }
      finally { button.disabled = false; }
    }, { signal: controller.signal });
  }
}
