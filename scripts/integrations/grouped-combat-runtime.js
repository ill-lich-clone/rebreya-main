import { MODULE_ID, SETTINGS_KEYS } from "../constants.js?v=1.4.397";
import { combatantsOf, GROUPED_COMBAT_FLAG } from "../combat/turn-group-rules.js";
import { hasGroupedCombatPhases } from "./grouped-combat-effects.js?v=1.5.2";
import { GROUPED_NATIVE_WRITES, isGroupedCombatProgressUpdate } from "../infrastructure/foundry/grouped-combat-repository.js?v=1.5.2";

const REGISTERED = Symbol.for("rebreya-main.groupedCombatRuntime");
const stateOf = combat => combat?.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG];
const operationId = () => globalThis.crypto?.randomUUID?.() ?? `combat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const escape = value => String(value ?? "").replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const messages = {
  "forbidden": "Недостаточно прав для этого действия в бою.", "no-creatures": "Выделите существ текущей сцены. Хранилища и объекты не участвуют.",
  "stale-combat": "Положение боя уже изменилось. Повторите действие.", "unsupported-combat-effects": "Общий ход недоступен: проверьте совместимость активных модулей эффектов.",
  "combat-phase-failed": "Обработка эффекта прервана. Запустите «Начать сражение» для проверки незавершённого шага.",
  "combat-blocked": "В бою есть незавершённый шаг эффекта. Требуется проверка GM.", "invalid-combat-target": "Недопустимый переход между группами.",
  "initiative-cancelled": "Бросок инициативы не завершён.", "combat-pending": "Общие ходы включатся со следующего раунда."
};
function notifyResult(result) {
  if (!result?.ok) {
    const detail = result?.details?.issues?.includes("midi-auto-reroll-initiative") ? " Автоматический переброс инициативы MIDI-QOL несовместим с общим броском группы; настройка не изменена." : "";
    globalThis.ui?.notifications?.warn?.((messages[result?.code] ?? "Не удалось изменить ход боя.") + detail);
  }
  else if (result.pending) globalThis.ui?.notifications?.info?.(messages["combat-pending"]);
  return result;
}
async function send(moduleApi, name, payload) {
  const service = moduleApi.groupedCombatService, method = { start: "start", transition: "transition", resolve: "resolveUncertainStep" }[name];
  return service.isAuthority() ? service[method](payload, { sender: globalThis.game?.user })
    : moduleApi.socketCommandBus.request(`combat.grouped.${name}`, payload, { requestId: payload.operationId });
}
export async function runStartCombatMacro(moduleApi, { canvas = globalThis.canvas, game = globalThis.game, DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 } = {}) {
  if (!game?.user?.isGM) return notifyResult({ ok: false, code: "forbidden" });
  const tokenUuids = [...new Set((canvas?.tokens?.controlled ?? []).map(t => (t.document ?? t).uuid).filter(Boolean))];
  if (!canvas?.scene || !tokenUuids.length) return notifyResult({ ok: false, code: "no-creatures" });
  let result = await send(moduleApi, "start", { sceneId: canvas.scene.id, tokenUuids, operationId: operationId() });
  while (!result.ok && ["combat-blocked", "combat-phase-failed"].includes(result.code) && result.details?.state && DialogV2?.wait) {
    const state = result.details.state, [stepKey, receipt] = Object.entries(state.receipts).find(([, r]) => r.status === "uncertain") ?? [];
    if (!stepKey) break;
    const resolution = await DialogV2.wait({ window: { title: "Проверка незавершённого эффекта" }, rejectClose: false,
      content: `<p>Проверьте, выполнился ли шаг. Уже нанесённый урон не отменяется.</p><p>Существо: ${escape(receipt.combatantId)}<br>Эффект: ${escape(receipt.effectUuid)}<br>Фаза: ${escape(receipt.phase)}</p>`,
      buttons: [{ action: "completed", label: "Шаг уже выполнен", callback: () => "completed" }, { action: "retry", label: "Повторить шаг", callback: () => "retry" }, { action: "cancel", label: "Отмена", default: true, callback: () => null }] });
    if (!resolution) return result;
    result = await send(moduleApi, "resolve", { combatId: result.details.combatId, expectedRevision: state.revision, stepKey, resolution, operationId: operationId() });
  }
  return notifyResult(result);
}
export async function panToActiveCombatGroup(combat, { canvas = globalThis.canvas, game = globalThis.game, enabled = true } = {}) {
  const state = stateOf(combat);
  if (!enabled || !canvas?.ready || canvas.scene?.id !== (combat.scene?.id ?? combat.sceneId) || state?.mode !== "active" || state.pendingTransition) return false;
  const group = state.groups.find(g => g.id === state.current?.groupId);
  const visible = combatantsOf(combat).filter(c => group?.memberIds.includes(c.id)).map(c => ({ c, token: c.token?.object ?? c.token }))
    .filter(({ c, token }) => token?.center && (game?.user?.isGM || (!c.hidden && token.isVisible === true)));
  const candidate = visible.find(({ c }) => !c.isDefeated) ?? visible[0];
  if (!candidate || !Number.isFinite(candidate.token.center.x) || !Number.isFinite(candidate.token.center.y)) return false;
  await canvas.animatePan({ x: candidate.token.center.x, y: candidate.token.center.y, duration: 400 }); return true;
}
export function registerGroupedCombatRuntime(moduleApi, { Hooks = globalThis.Hooks, CombatClass = globalThis.CONFIG?.Combat?.documentClass,
  CombatantClass = globalThis.CONFIG?.Combatant?.documentClass, CombatTrackerClass = globalThis.ui?.combat?.constructor } = {}) {
  if (!CombatClass?.prototype) return () => {};
  const prototype = CombatClass.prototype;
  if (prototype[REGISTERED]) return prototype[REGISTERED];
  const restores = [], hookIds = [], focusStamps = new Map(), publicStamps = new Map(), observers = new Map(), transitions = new Map();
  const progressUpdates = new WeakSet();
  const patch = (target, name, factory) => {
    if (!target || typeof target[name] !== "function") return;
    const own = Object.getOwnPropertyDescriptor(target, name), original = target[name]; target[name] = factory(original);
    restores.push(() => { if (own) Object.defineProperty(target, name, own); else delete target[name]; });
  };
  const hook = (name, fn) => { const id = Hooks?.on?.(name, fn); if (id != null) hookIds.push([name, id]); };
  patch(prototype, "_onUpdate", original => function (changed, options, userId) {
    if (!isGroupedCombatProgressUpdate(this, changed, options)) return original.call(this, changed, options, userId);
    progressUpdates.add(this);
    try { return original.call(this, changed, options, userId); } finally { progressUpdates.delete(this); }
  });
  patch(prototype, "updateCombatantActors", original => function (...args) {
    if (!progressUpdates.has(this)) return original.apply(this, args);
  });
  patch(CombatantClass?.prototype, "refreshDynamicRing", original => function (...args) {
    if (!progressUpdates.has(this.parent)) return original.apply(this, args);
  });
  const usableGroups = combat => {
    const groups = stateOf(combat)?.groups ?? [];
    if (!combat.settings?.skipDefeated) return groups;
    const live = groups.filter(g => g.memberIds.some(id => combatantsOf(combat).some(c => c.id === id && !c.isDefeated)));
    return live.length ? live : groups;
  };
  const requestTransition = (combat, target) => {
    if (transitions.has(combat.id)) return transitions.get(combat.id);
    const pending = send(moduleApi, "transition", { combatId: combat.id, expectedRevision: stateOf(combat).revision,
      targetRound: target.round, targetGroupId: target.groupId, operationId: operationId() }).finally(() => { if (transitions.get(combat.id) === pending) transitions.delete(combat.id); });
    transitions.set(combat.id, pending); return pending;
  };
  const navigate = async (combat, target) => {
    if (target) notifyResult(await requestTransition(combat, target));
    return combat;
  };
  for (const [method, direction] of [["nextTurn", 1], ["previousTurn", -1]]) patch(prototype, method, original => async function (...args) {
    const state = stateOf(this);
    if (!hasGroupedCombatPhases(this)) return original.apply(this, args);
    const groups = usableGroups(this), index = groups.findIndex(g => g.id === state.current?.groupId), next = index + direction;
    if (!groups.length || (next < 0 && this.round <= 1)) return this;
    return navigate(this, { round: this.round + (next >= groups.length ? 1 : next < 0 ? -1 : 0), groupId: groups[(next + groups.length) % groups.length].id });
  });
  for (const [method, direction] of [["nextRound", 1], ["previousRound", -1]]) patch(prototype, method, original => async function (...args) {
    const state = stateOf(this), round = this.round + direction;
    if (!state || (state.mode === "pending" && round < state.activateAtRound)) return original.apply(this, args);
    const groups = usableGroups(this); return round >= 1 && groups.length ? navigate(this, { round, groupId: groups[0].id }) : this;
  });
  patch(prototype, "update", original => async function (data, options = {}) {
    const state = stateOf(this);
    if (!state || GROUPED_NATIVE_WRITES.has(this) || (data.round === undefined && data.turn === undefined)
      || (state.mode === "pending" && (data.round ?? this.round) < state.activateAtRound)) return original.call(this, data, options);
    const group = state.groups.find(g => g.memberIds.includes(this.turns?.[data.turn ?? this.turn]?.id)), round = data.round ?? this.round;
    if (!group || round < 1) throw new Error("Завершите бой перед сбросом общего порядка ходов.");
    const result = await requestTransition(this, { round, groupId: group.id });
    if (!result.ok) { notifyResult(result); throw new Error(result.code); }
    const rest = Object.fromEntries(Object.entries(data).filter(([key]) => !["round", "turn"].includes(key)));
    return Object.keys(rest).length ? original.call(this, rest, options) : this;
  });
  patch(prototype, "_manageTurnEvents", original => async function (...args) {
    if (!hasGroupedCombatPhases(this)) return original.apply(this, args);
    const observed = { ...this.current }, previous = { ...this.previous };
    try {
      if (moduleApi.groupedCombatService.isAuthority()) await moduleApi.groupedCombatService.observeNativeTransition(this, previous, observed);
      else if (stateOf(this)?.pendingTransition) await new Promise(resolve => {
        const finish = () => { Hooks.off("updateCombat", id); observers.get(this.id)?.delete(finish); resolve(); };
        const id = Hooks.on("updateCombat", doc => { if (doc.id === this.id && (!stateOf(doc)?.pendingTransition || stateOf(doc)?.mode === "blocked")) finish(); });
        if (!observers.has(this.id)) observers.set(this.id, new Set()); observers.get(this.id).add(finish);
      });
      const state = stateOf(this), nativeId = observed.combatantId ?? this.combatant?.id;
      if (state.mode !== "active" || state.pendingTransition || (observed.round !== undefined && observed.round !== state.current?.round)
        || !state.groups.find(g => g.id === state.current?.groupId)?.memberIds.includes(nativeId)) return;
      const stamp = JSON.stringify(state.current); if (publicStamps.get(this.id) === stamp) return; publicStamps.set(this.id, stamp);
      Hooks.callAll("combatTurnChange", this, previous, { ...this.current });
    } catch (error) { console.error(`${MODULE_ID} | Group turn phase failed`, error); }
  });
  patch(prototype, "_sortCombatants", original => function (a, b) {
    const state = stateOf(a.parent ?? b.parent);
    if (!state || state.mode === "pending" || a.initiative !== b.initiative) return original.call(this, a, b);
    const left = state.groups.find(g => g.memberIds.includes(a.id)), right = state.groups.find(g => g.memberIds.includes(b.id));
    const leftKey = left?.id ?? `single:${a.id}`, rightKey = right?.id ?? `single:${b.id}`;
    return leftKey !== rightKey ? leftKey.localeCompare(rightKey) : original.call(this, a, b);
  });
  patch(CombatantClass?.prototype, "getGroupingKey", original => function (...args) {
    const state = stateOf(this.parent); if (!state || state.mode === "pending") return original.apply(this, args);
    const group = state.groups.find(g => g.memberIds.includes(this.id)); return group?.memberIds.length > 1 ? group.id : null;
  });
  patch(CombatTrackerClass?.prototype, "renderGroups", original => function (html, ...args) {
    const result = original.call(this, html, ...args), state = stateOf(this.viewed);
    if (state && state.mode !== "pending") for (const row of html.querySelectorAll(".combatant-group[data-group-key]")) {
      const group = state.groups.find(g => g.id === row.dataset.groupKey), count = row.querySelector(".group-numbers");
      if (count && group) count.textContent = `${combatantsOf(this.viewed).filter(c => group.memberIds.includes(c.id)).length} · Общий ход`;
    }
    return result;
  });
  hook("updateCombat", combat => {
    const state = stateOf(combat); if (state?.mode !== "active" || state.pendingTransition || !state.current) return;
    const stamp = JSON.stringify(state.current); if (focusStamps.get(combat.id) === stamp) return; focusStamps.set(combat.id, stamp);
    const enabled = globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.COMBAT_AUTO_PAN) ?? true;
    panToActiveCombatGroup(combat, { enabled }).catch(error => console.warn(`${MODULE_ID} | Camera pan failed`, error));
  });
  hook("deleteCombat", combat => { focusStamps.delete(combat.id); publicStamps.delete(combat.id); for (const finish of observers.get(combat.id) ?? []) finish(); observers.delete(combat.id); });
  const reconcile = () => {
    if (!moduleApi.groupedCombatService.isAuthority()) return;
    for (const combat of globalThis.game?.combats?.contents ?? []) moduleApi.groupedCombatService.reconcile(combat).catch(error => console.error(`${MODULE_ID} | Combat recovery failed`, error));
  };
  hook("userConnected", reconcile); hook("updateUser", reconcile);
  moduleApi.groupedCombatService.effects?.installNativeGuards();
  const dispose = () => { for (const waiters of observers.values()) for (const finish of waiters) finish(); observers.clear(); for (const restore of restores.reverse()) restore(); for (const [name, id] of hookIds) Hooks.off(name, id); delete prototype[REGISTERED]; };
  Object.defineProperty(prototype, REGISTERED, { value: dispose, configurable: true }); return dispose;
}
