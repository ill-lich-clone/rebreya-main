import { escapeFoundryHtml as escape } from "../shared/foundry-values.js";
const modeNames = { melee: "Ближний бой", ranged: "Дальний бой", thrown: "Бросок оружия" };
const phases = { prepared: "Подготовлено", "awaiting-baseline": "Нужно подтвердить исходную характеристику", "awaiting-save": "Защитник выбирает спасбросок", "save-resolved": "Спасбросок выполнен", "drop-prepared": "Перенос предмета", completed: "Завершено", cancelled: "Отменено", conflict: "Условия изменились", "manual-review": "Нужна сверка мастером" };
export function resolveDisarmSelection(options = {}, controlled = globalThis.canvas?.tokens?.controlled ?? [], targets = Array.from(globalThis.game?.user?.targets ?? [])) {
  const uuid = token => token?.document?.uuid ?? token?.uuid;
  const sourceTokenUuid = options.sourceTokenUuid ?? (controlled.length === 1 ? uuid(controlled[0]) : null);
  const targetTokenUuid = options.targetTokenUuid ?? (targets.length === 1 ? uuid(targets[0]) : null);
  if (!sourceTokenUuid || !targetTokenUuid) throw new Error("Выберите одного атакующего и одну цель.");
  return { sourceTokenUuid, targetTokenUuid };
}
export async function promptDisarm(preview) {
  const choices = preview.weapons.flatMap(weapon => weapon.modes.map(({ mode, plan }) => ({ ...weapon, mode, plan })));
  if (!choices.length || !preview.items.length) throw new Error("Нужно удерживаемое оружие атакующего и предмет в руках цели.");
  const dialog = foundry.applications.api.DialogV2;
  const chosen = await dialog.wait({ window: { title: "Обезоруживание" },
    content: `<div class="rm-disarm-form"><p>${escape(preview.sourceName)} → ${escape(preview.targetName)}</p>
      <label>Ваше оружие<select name="weapon">${choices.map((w,i) => `<option value="${i}">${escape(w.name)} · ${modeNames[w.mode]}</option>`).join("")}</select></label>
      <label>Выбить предмет<select name="item">${preview.items.map((item,i) => `<option value="${i}">${escape(item.name)} · рук: ${item.heldHands}</option>`).join("")}</select></label><p>Расход: 1 атака из доступных.</p></div>`,
    buttons: [{ action: "select", label: "Далее", default: true, callback: (_e, button) => ({ weapon: Number(button.form.elements.namedItem("weapon").value), item: Number(button.form.elements.namedItem("item").value) }) },
      { action: "cancel", label: "Отмена", callback: () => false }], rejectClose: false });
  if (!chosen) return null;
  const weapon = choices[chosen.weapon], item = preview.items[chosen.item];
  if (!weapon || !item) throw new Error("Выбранный предмет недоступен.");
  const confirmed = await dialog.confirm({ window: { title: "Подтвердить обезоруживание" },
    content: `<div class="rm-disarm-form"><p>${escape(weapon.name)} → ${escape(item.name)}</p><p>Формула: <strong>${escape(weapon.plan.formula ?? "Мастер должен подтвердить исходную характеристику и владение")}</strong>.</p>
      <p>В броске используются только характеристика и владение оружием.</p>
      ${weapon.plan.excludedModifiers?.length ? `<p>Не учитываются: ${weapon.plan.excludedModifiers.map(value => escape(value)).join("; ")}.</p>` : ""}
      ${weapon.plan.unresolvedModifiers?.length ? `<p>Мастер должен подтвердить: ${weapon.plan.unresolvedModifiers.map(value => escape(({ "ability-baseline": "исходное значение характеристики", "proficiency-baseline": "вклад владения оружием" })[value] ?? "исходные значения броска")).join("; ")}.</p>` : ""}
      ${item.heldHands >= 2 ? "<p>Предмет удерживают двумя руками: атака с помехой.</p>" : ""}<p><strong>Расход: 1 атака.</strong> Кнопка не предоставляет дополнительную атаку.</p></div>`, rejectClose: false });
  return confirmed ? { weaponItemUuid: weapon.uuid, targetItemUuid: item.uuid, weaponMode: weapon.mode } : null;
}
export async function promptDisarmBaseline(operationId) {
  return foundry.applications.api.DialogV2.wait({ window: { title: "Исходные значения для обезоруживания" },
    content: `<div class="rm-disarm-form"><p>Укажите постоянную характеристику без временных усилений и числовой вклад владения. Бонусы черт не добавляются.</p>
      <label>Значение характеристики<input name="abilityScore" type="number" min="1" max="99" step="1" required></label>
      <label>Вклад владения<input name="proficiencyContribution" type="number" min="0" max="30" step="1" required></label>
      <label>Основание<input name="reason" maxlength="240" required></label></div>`,
    render: (_e, dialog) => { const root = dialog.element?.[0] ?? dialog.element; const cancel = root?.querySelector("[data-action='cancel']"); if (cancel) cancel.formNoValidate = true; },
    buttons: [{ action: "confirm", label: "Подтвердить и бросить", callback: (_e, button) => ({ operationId, abilityScore: Number(button.form.elements.namedItem("abilityScore").value), proficiencyContribution: Number(button.form.elements.namedItem("proficiencyContribution").value), reason: button.form.elements.namedItem("reason").value }) },
      { action: "cancel", label: "Отмена", callback: () => false }], rejectClose: false });
}
export async function promptDisarmResponder(operationId, expectedResponderRevision, users = globalThis.game?.users?.contents ?? []) {
  return foundry.applications.api.DialogV2.wait({ window: { title: "Кто отвечает за спасбросок" },
    content: `<div class="rm-disarm-form"><p>Выберите подключённого владельца защитника или мастера. Назначение не выполняет бросок.</p>
      <label>Отвечающий<select name="responderUserId" required>${users.filter(user => user.active).map(user => `<option value="${escape(user.id)}">${escape(user.name)}</option>`).join("")}</select></label>
      <label>Причина смены<input name="reason" maxlength="240" required></label></div>`,
    render: (_e, dialog) => {
      const root = dialog.element?.[0] ?? dialog.element, reason = root?.querySelector('[name="reason"]');
      const confirm = root?.querySelector("[data-action='confirm']"), cancel = root?.querySelector("[data-action='cancel']");
      if (cancel) cancel.formNoValidate = true;
      const validate = () => { if (confirm) confirm.disabled = !reason?.value.trim(); };
      reason?.addEventListener("input", validate); validate();
    },
    buttons: [{ action: "confirm", label: "Назначить", callback: (_e, button) => ({ operationId, expectedResponderRevision,
      responderUserId: button.form.elements.namedItem("responderUserId").value, reason: button.form.elements.namedItem("reason").value }) },
      { action: "cancel", label: "Отмена", callback: () => false }], rejectClose: false });
}
export function buildDisarmChatContent(record) {
  const pending = record.phase === "awaiting-save", id = record.intent.operationId;
  return `<section class="rm-disarm-chat" data-disarm-operation="${escape(id)}"><h3>Обезоруживание</h3><p>${escape(record.sourceName)} → ${escape(record.targetName)}</p>
    <p>Предмет: <strong>${escape(record.itemName)}</strong></p><p>Расход: <strong>1 атака</strong>${record.attackRoll ? " (бросок выполнен)" : " (до броска отмена свободна)"}.</p>
    <p>Формула: ${escape(record.attackPlan?.formula ?? "ожидает подтверждения мастера")}${record.attackMode === "disadvantage" ? " · с помехой" : ""}</p>
    ${record.attackRoll ? `<p>Сл спасброска: <strong>${record.attackRoll.total}</strong></p>` : ""}
    <p>${escape(phases[record.phase] ?? record.phase)}</p>
    ${pending ? `<p>Защитник выбирает Силу или Ловкость.${record.strSaveAdvantage ? " Сила — с преимуществом из-за размера." : ""}</p><div class="rm-disarm-actions" data-disarm-responder="${escape(record.responderUserId)}"><button data-disarm-save="str">Сила</button><button data-disarm-save="dex">Ловкость</button></div>` : ""}
    ${pending ? `<button data-disarm-reassign data-responder-revision="${escape(record.responderRevision ?? 0)}">Сменить отвечающего</button>` : ""}
    ${record.responderDecisions?.length ? `<p>Причина смены отвечающего: ${escape(record.responderDecisions.at(-1).reason)}</p>` : ""}
    ${record.saveRoll ? `<p>${escape(record.targetName)} · ${record.saveAbility === "str" ? "Сила" : "Ловкость"}: <strong>${record.saveRoll.total}</strong> · ${record.dropped ? "предмет выбит" : "предмет удержан"}.</p>` : ""}
    ${record.directionRoll ? `<p>Случайная точка: ${record.directionRoll.total} из ${record.dropPoints.length}; ${record.destination.x}, ${record.destination.y}.</p>` : ""}
    ${record.error ? `<p role="alert">${escape(record.error)}</p>` : ""}
    <button data-disarm-resume>Открыть / продолжить</button>
    ${["awaiting-save", "awaiting-baseline", "prepared"].includes(record.phase) ? `<button data-disarm-cancel data-disarm-sender="${escape(record.senderId)}">Отменить попытку</button>` : ""}</section>`;
}
const listeners = new WeakMap();
export function bindDisarmChat(message, html, api) {
  const id = message.getFlag("rebreya-main", "disarmOperationId");
  const root = (html?.[0] ?? html)?.querySelector?.("[data-disarm-operation]");
  if (!id || !root || !message.author?.isGM) return;
  listeners.get(root)?.abort(); const controller = new AbortController(); listeners.set(root, controller);
  const responder = root.querySelector("[data-disarm-responder]");
  if (responder && responder.dataset.disarmResponder !== game.user.id) responder.hidden = true;
  const reassign = root.querySelector("[data-disarm-reassign]");
  if (reassign && !game.user.isGM) reassign.hidden = true;
  const cancel = root.querySelector("[data-disarm-cancel]");
  if (cancel && !game.user.isGM && cancel.dataset.disarmSender !== game.user.id) cancel.hidden = true;
  root.addEventListener("click", async event => {
    const button = event.target.closest("button"); if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (button.dataset.disarmSave) await api.requestDisarmAction("resolve-save", { operationId: id, saveAbility: button.dataset.disarmSave });
      else if (button.hasAttribute("data-disarm-reassign")) {
        if (!game.user.isGM) return;
        const intent = await promptDisarmResponder(id, Number(button.dataset.responderRevision));
        if (intent) await api.requestDisarmAction("reassign-responder", intent);
      }
      else if (button.hasAttribute("data-disarm-cancel")) await api.requestDisarmAction("cancel", { operationId: id });
      else if (button.hasAttribute("data-disarm-resume")) await api.openDisarmOperation(id);
    } catch (error) { ui.notifications.error(error.message); }
    finally { if (button.isConnected) button.disabled = false; }
  }, { signal: controller.signal });
}
