import { MODULE_ID } from "../constants.js";
import { getInstalledUpgradeItems } from "../data/item-upgrade-service.js?v=1.4.96-item-upgrades";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { CurseUpgradeSaveAdapter } from "./curse-upgrade-saves.js";
import { CurseUpgradeDamageAdapter } from "./curse-upgrade-damage.js";
import { CurseUpgradeAttackAdapter } from "./curse-upgrade-attacks.js";

const IDS = Object.freeze({
  "molnienosnoy-reaktsii": "lightning", "presleduyushchego-uspekha": "success",
  "zhizni-i-smerti": "death", "tyazhesti-zhizni": "burden", "krovopuskaniya": "blood",
  "skorbyashchego-proshlogo": "mourning", "prityagivanie-snaryadov": "shield",
  "ognennoy-dushi": "fire", "voli-k-zhizni": "will", "tsepey": "chains", "obsidiana": "obsidian"
});
const FLAG = "curseUpgrade";
const STATE = "curseUpgradeState";
const syncOptions = () => ({ rebreyaCurseUpgradeSync: true });
const values = collection => Array.from(collection?.values?.() ?? collection ?? []);
const flag = (doc, key) => doc?.flags?.[MODULE_ID]?.[key] ?? doc?.getFlag?.(MODULE_ID, key);
const clone = value => structuredClone(value);
const change = (key, value) => ({ key, value: String(value), mode: 2, priority: 20 });
const escape = text => String(text ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const getChanged = (patch, path) => Object.hasOwn(patch, path) ? patch[path] : path.split(".").reduce((o, k) => o?.[k], patch);

export function collectCurseUpgradeSources(actor, catalog = new Map()) {
  const slots = flag(actor, "heroDoll")?.slots ?? {};
  const result = [];
  for (const hostId of new Set(Object.values(slots).map(s => s?.itemId).filter(Boolean))) {
    const host = actor.items?.get?.(hostId);
    if (!host) continue;
    for (const upgrade of getInstalledUpgradeItems(host)) {
      const gearId = flag(upgrade, "gearId");
      const key = IDS[String(gearId ?? "").replace(/^proklyat-e-/, "")];
      const local = flag(upgrade, "upgrade");
      const profile = String(local?.type ?? "").trim() ? local : catalog.get?.(gearId)?.upgrade;
      if (!key || !/^прокл(?:ятье|ятие)$/iu.test(String(profile?.type ?? "").trim())) continue;
      const inHand = ["rightHand", "leftHand"].some(s => slots[s]?.itemId === hostId);
      if (["blood", "mourning", "obsidian", "shield"].includes(key) && !inHand) continue;
      if (["blood", "mourning", "obsidian"].includes(key) && host.type !== "weapon") continue;
      if (key === "shield" && host.system?.type?.value !== "shield" && host.system?.armor?.type !== "shield") continue;
      result.push({ key, host, upgrade, profile });
    }
  }
  return result;
}

export function buildCurseUpgradeEffect(source, actor, state = {}) {
  const changes = [];
  if (source.key === "lightning") changes.push(change("system.attributes.init.bonus", 4));
  if (source.key === "will") changes.push(change("system.attributes.ac.bonus", actor.statuses?.has?.("rebreya-bloodied") ? 2 : -2));
  if (source.key === "burden" && state.burdenActive && Number(actor.system?.attributes?.hp?.temp) > 0) {
    for (const [kind, raw] of Object.entries(actor._source?.system?.attributes?.movement ?? actor.system?.attributes?.movement ?? {})) {
      if (!["walk", "burrow", "climb", "fly", "swim"].includes(kind)) continue;
      const speed = Number(raw);
      if (Number.isFinite(speed) && speed > 0) changes.push(change(`system.attributes.movement.${kind}`, -Math.min(10, speed)));
      else if (raw && Number(actor.system?.attributes?.movement?.[kind]) > 0) changes.push(change(`system.attributes.movement.${kind}`, -10));
    }
  }
  if (source.key === "obsidian" && state.ac) changes.push(change("system.attributes.ac.bonus", state.ac));
  return { name: source.upgrade.name, img: source.upgrade.img ?? "icons/svg/aura.svg", type: "base",
    description: `<p>${escape(source.profile.effect).replace(/\n/g, "<br />")}</p>`,
    origin: source.upgrade.uuid, disabled: false, transfer: false, changes,
    flags: { [MODULE_ID]: { [FLAG]: { managed: true, sourceId: source.upgrade.id, hostId: source.host.id, key: source.key } } } };
}

export class CurseUpgradeAutomationService {
  constructor(moduleApi = {}, options = {}) {
    this.moduleApi = moduleApi; this.options = options; this.catalog = new Map(); this.pending = new Map(); this.turns = new Map();
    this.saves = new CurseUpgradeSaveAdapter(this); this.damage = new CurseUpgradeDamageAdapter(this);
    this.attacks = new CurseUpgradeAttackAdapter(this, { distance: (left, right) => {
      const a = left.center ?? left; const b = right.center ?? right;
      const grid = globalThis.canvas?.grid;
      return grid?.measurePath?.([a, b])?.distance ?? grid?.measureDistance?.(a, b) ?? Infinity;
    } });
  }
  isAuthority() { return this.options.isAuthority?.() ?? isActiveGmClient(globalThis.game); }
  sources(actor, key) { return collectCurseUpgradeSources(actor, this.catalog).filter(s => !key || s.key === key); }
  ownedSources(actor, key) {
    return values(actor?.items).filter(upgrade => IDS[String(flag(upgrade, "gearId") ?? "").replace(/^proklyat-e-/, "")] === key)
      .map(upgrade => ({ key, upgrade, host: { actor }, profile: flag(upgrade, "upgrade") }));
  }
  state(source) { return flag(source.upgrade, STATE) ?? {}; }
  now() { return Number(globalThis.game?.time?.worldTime ?? 0); }
  debtSources(actor) {
    return values(actor?.items).filter(upgrade => flag(upgrade, "gearId") === "proklyat-e-presleduyushchego-uspekha"
      && (flag(upgrade, STATE)?.forcedFailurePending || flag(upgrade, STATE)?.saveReceipts?.length))
      .map(upgrade => ({ key: "success", upgrade, host: { actor }, profile: flag(upgrade, "upgrade") }));
  }
  async resolveSaveRequest(payload) {
    if (!this.sources(await globalThis.fromUuid?.(payload.actorUuid), "success").length
      && !this.debtSources(await globalThis.fromUuid?.(payload.actorUuid)).length && payload.kind !== "chains") return { saved: payload.saved, forced: false };
    if (!this.isAuthority()) return this.moduleApi.socketCommandBus.request("curse-upgrade.save", payload);
    return this.executeSaveRequest(payload);
  }
  requestSync(actor) {
    if (!actor?.uuid) return Promise.resolve();
    return this.isAuthority() ? this.syncActor(actor) : this.moduleApi.socketCommandBus.request("curse-upgrade.sync", { actorUuid: actor.uuid });
  }
  async executeSaveRequest(payload, { sender } = {}) {
    if (!this.isAuthority()) throw new Error("Проклятья изменяет активный GM.");
    const actor = await globalThis.fromUuid(payload.actorUuid);
    if (!actor?.items) throw new Error("Персонаж не найден.");
    if (payload.sourceActorUuid && payload.kind !== "chains" && sender && !sender.isGM && !actor.testUserPermission?.(sender, "OWNER")) {
      const recorded = values(actor.items).some(item => flag(item, STATE)?.saveReceipts?.some(entry => entry.eventId === payload.eventId));
      if (!recorded) {
        const confirmation = await this.moduleApi.reactionQueueService.promptDecision({ candidate: {}, prompt: {
          title: "Проклятье: подтвердите исход спасброска", body: `${actor.name}: отправитель сообщает ${payload.saved ? "успех" : "провал"}. Сл не была доступна для автоматической проверки. Подтвердить этот исход?`,
          acceptLabel: "Подтвердить", declineLabel: "Остановить" } });
        if (!confirmation?.accepted) throw new Error("GM не подтвердил исход спасброска.");
      }
    }
    if (payload.kind === "chains") {
      const sourceActor = await globalThis.fromUuid(payload.sourceActorUuid);
      return this.saves.resolveMidiChainAuthority(sourceActor, actor, payload);
    }
    return this.saves.resolveSaveAuthority(actor, payload);
  }
  async writeState(source, patch) {
    if (!this.isAuthority()) throw new Error("Проклятья изменяет активный GM.");
    const next = { ...this.state(source), ...clone(patch) };
    if (JSON.stringify(next) !== JSON.stringify(this.state(source))) await source.upgrade.update({ [`flags.${MODULE_ID}.${STATE}`]: next }, syncOptions());
    return next;
  }
  async prompt(source, { title, body }) {
    const result = await this.moduleApi.reactionQueueService?.promptDecision({
      candidate: { actorUuid: source.host.actor.uuid, actorId: source.host.actor.id,
        ownerUserIds: values(globalThis.game?.users).filter(u => u.active && !u.isGM && source.host.actor.testUserPermission?.(u, "OWNER")).map(u => u.id) },
      prompt: { title, body, acceptLabel: "Применить", declineLabel: "Пропустить" }
    });
    return result?.accepted === true;
  }
  enqueue(actor, operation) {
    const key = actor?.uuid ?? actor?.id;
    const previous = this.pending.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(operation);
    this.pending.set(key, pending);
    return pending.finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); });
  }
  async initialize() {
    this.catalog = (await this.moduleApi.getModel?.())?.gearById ?? new Map();
    if (this.isAuthority()) for (const actor of values(globalThis.game?.actors)) {
      for (const source of this.ownedSources(actor, "chains")) await this.recoverPendingChains(source);
      await this.syncActor(actor);
    }
  }
  registerNativeSaveWrapper() {
    const RollClass = globalThis.CONFIG?.Dice?.D20Roll;
    if (!RollClass || RollClass.rebreyaCurseSaveWrapped) return;
    const service = this;
    if (globalThis.libWrapper?.register) {
      globalThis.libWrapper.register(MODULE_ID, "CONFIG.Dice.D20Roll.buildPost", async function(wrapped, rolls, config, message) {
        await service.saves.applyNativeBuildPost(rolls, config, message);
        return wrapped(rolls, config, message);
      }, "WRAPPER");
    } else {
      const original = RollClass.buildPost;
      if (typeof original !== "function") return;
      RollClass.buildPost = async function(rolls, config, message) {
        await service.saves.applyNativeBuildPost(rolls, config, message);
        return original.call(this, rolls, config, message);
      };
    }
    RollClass.rebreyaCurseSaveWrapped = true;
  }
  async syncActor(actor) {
    if (!this.isAuthority() || !actor?.items || !actor?.createEmbeddedDocuments) return;
    return this.enqueue(actor, async () => {
      const desired = new Map(this.sources(actor).map(s => [s.upgrade.id, buildCurseUpgradeEffect(s, actor, this.state(s))]));
      const remove = []; const update = [];
      for (const effect of values(actor.effects)) {
        const own = flag(effect, FLAG);
        if (!own?.managed || own.kind === "chains") continue;
        const data = desired.get(own.sourceId);
        if (!data) { remove.push(effect.id); continue; }
        desired.delete(own.sourceId);
        const current = effect.toObject?.() ?? effect;
        if (Object.keys(data).some(key => JSON.stringify(key === "flags" ? current.flags?.[MODULE_ID]?.[FLAG] : current[key])
          !== JSON.stringify(key === "flags" ? data.flags[MODULE_ID][FLAG] : data[key]))) update.push({ _id: effect.id, ...data });
      }
      if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove, syncOptions());
      if (update.length) await actor.updateEmbeddedDocuments("ActiveEffect", update, syncOptions());
      if (desired.size) await actor.createEmbeddedDocuments("ActiveEffect", [...desired.values()], syncOptions());
    });
  }
  handleChanged(document, options = {}) {
    if (options.rebreyaCurseUpgradeSync || !this.isAuthority()) return Promise.resolve();
    return this.syncActor(document?.actor ?? (document?.parent?.items ? document.parent : document));
  }
  preUpdateActor(actor, changed, options = {}) {
    if (options.rebreyaCurseUpgradeSync) return;
    const hp = actor.system?.attributes?.hp;
    const next = getChanged(changed, "system.attributes.hp.value");
    if (Number(hp?.value) > 0 && next !== undefined && Number(next) <= 0 && this.sources(actor, "death").length) {
      const failures = getChanged(changed, "system.attributes.death.failure") ?? actor.system?.attributes?.death?.failure ?? 0;
      changed["system.attributes.death.failure"] = Math.min(3, Number(failures) + 1);
    }
    const temp = getChanged(changed, "system.attributes.hp.temp");
    if (temp !== undefined) options.rebreyaCurseTempBefore = Number(hp?.temp ?? 0);
  }
  async actorUpdated(actor, changed, options = {}) {
    if (options.rebreyaCurseUpgradeSync || !this.isAuthority()) return;
    const temp = getChanged(changed, "system.attributes.hp.temp");
    if (temp !== undefined) {
      for (const source of this.ownedSources(actor, "burden")) {
        const damage = getChanged(changed, `flags.${MODULE_ID}.curseTempDamageEvent`);
        if (this.state(source).burdenActive && (Number(temp) <= 0 || !damage)) await this.writeState(source, { burdenActive: false });
      }
    }
    return this.syncActor(actor);
  }
  blocksReaction(actor, combat = globalThis.game?.combat) {
    return Boolean(combat?.started && Number(combat.round) === 1
      && values(combat.combatants).some(c => c.actor?.id === actor?.id)
      && this.sources(actor, "lightning").length);
  }
  preUse(activity) {
    if (String(activity?.activation?.type ?? "").startsWith("reaction") && this.blocksReaction(activity.actor ?? activity.item?.actor)) {
      globalThis.ui?.notifications?.warn?.("Проклятье молниеносной реакции: реакции недоступны до конца первого раунда."); return false;
    }
    return true;
  }
  preDeathSave(config) {
    if (!this.sources(config.subject, "death").length) return;
    for (const roll of config.rolls ?? []) { roll.options ??= {}; roll.options.advantage = true; }
  }
  async initiative(actor, combatants = []) {
    if (!this.isAuthority()) return;
    return this.enqueue(actor, async () => {
    for (const source of this.sources(actor, "burden")) {
      const event = values(combatants).map(c => `${c.uuid}:${c.initiative}`).sort().join("|");
      if (event && this.state(source).initiativeEvent === event) continue;
      const amount = Math.max(0, Number(actor.system?.attributes?.prof ?? 0) + Number(actor.system?.abilities?.con?.mod ?? 0));
      const current = Number(actor.system?.attributes?.hp?.temp ?? 0);
      if (amount > current) {
        await actor.update({ "system.attributes.hp.temp": amount }, syncOptions());
        await this.writeState(source, { burdenActive: true, initiativeEvent: event });
      } else await this.writeState(source, { initiativeEvent: event });
    }
    }
    ).then(() => this.syncActor(actor));
  }
  registerLongRestSteps(pipeline) {
    pipeline.registerStep({ id: "curse-upgrade.restore", label: "Восстановление проклятий", order: 115,
      interactive: false, isEligible: ({ actor }) => this.ownedSources(actor, "success").length > 0,
      run: async ({ actor, result }) => { await this.longRest(actor, result); return { status: "completed" }; }
    });
  }
  async longRest(actor, result = {}) {
    if (!this.isAuthority() || !result.longRest) return;
    for (const upgrade of values(actor.items)) {
      if (!flag(upgrade, STATE)?.successUsed) continue;
      await this.writeState({ upgrade }, { successUsed: false });
    }
  }
  async recoverPendingChains(source) {
    if (!this.isAuthority()) return;
    const pending = this.state(source).chainsPending;
    if (!pending) return;
    if (pending.expiresAt > this.now()) {
      const actor = await globalThis.fromUuid?.(pending.targetActorUuid);
      if (!actor?.createEmbeddedDocuments) throw new Error("Не найдена цель для восстановления проклятья цепей.");
      await this.restrain(actor, source);
    }
    await this.writeState(source, { chainsPending: null });
  }
  async restrain(actor, source) {
    if (!this.isAuthority()) return;
    const combat = globalThis.game?.combat;
    const current = combat ? `${combat.id}:${combat.round}:${combat.turn}` : "";
    const existing = values(actor.effects).find(e => flag(e, FLAG)?.kind === "chains" && e.origin === source.upgrade.uuid);
    const pending = this.state(source).chainsPending;
    if (existing && pending?.eventId && flag(existing, FLAG)?.eventId === pending.eventId) return;
    const data = { name: `${source.upgrade.name}: Опутан`, type: "base", img: "icons/svg/net.svg", origin: source.upgrade.uuid,
      disabled: false, transfer: false, statuses: ["restrained"], changes: [],
      flags: { [MODULE_ID]: { [FLAG]: { managed: true, kind: "chains", createdTurn: current, waitingForTurn: true,
        eventId: pending?.eventId ?? null, expiresAt: pending?.expiresAt ?? this.now() + 12 } } } };
    if (existing) await actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: existing.id, ...data }], syncOptions());
    else await actor.createEmbeddedDocuments("ActiveEffect", [data], syncOptions());
  }
  combatChanged(combat, previous = {}, current = {}) {
    const key = `${combat?.id}:${current.round}:${current.turn}`;
    if (this.turns.has(key)) return this.turns.get(key);
    const pending = this._combatChanged(combat, previous, current).catch(error => { this.turns.delete(key); throw error; });
    this.turns.set(key, pending);
    while (this.turns.size > 128) this.turns.delete(this.turns.keys().next().value);
    return pending;
  }
  async _combatChanged(combat, previous = {}, current = {}) {
    if (!this.isAuthority()) return;
    if (Number(current.round) < Number(previous.round) || (current.round === previous.round && Number(current.turn) <= Number(previous.turn))) return;
    const currentActor = combat.combatant?.actor;
    const previousActor = combat.turns?.[previous.turn]?.actor;
    const stamp = `${combat.id}:${combat.round}:${combat.turn}`;
    for (const actor of new Set(values(combat.combatants).map(c => c.actor).filter(Boolean))) {
      const deletes = []; const updates = [];
      for (const effect of values(actor.effects)) {
        const own = flag(effect, FLAG);
        if (own?.kind !== "chains" || own.createdTurn === stamp) continue;
        if (actor.id === previousActor?.id && own.waitingForTurn === false) deletes.push(effect.id);
        else if (actor.id === currentActor?.id && own.waitingForTurn) updates.push({ _id: effect.id, [`flags.${MODULE_ID}.${FLAG}.waitingForTurn`]: false });
      }
      if (deletes.length) await actor.deleteEmbeddedDocuments("ActiveEffect", deletes, syncOptions());
      if (updates.length) await actor.updateEmbeddedDocuments("ActiveEffect", updates, syncOptions());
      for (const source of this.sources(actor, "obsidian")) {
        if (this.state(source).combatEvent === stamp) continue;
        if (actor.id === currentActor?.id) await this.writeState(source, { ac: 0, attackAction: false, combatEvent: stamp });
        else if (actor.id === previousActor?.id && !this.state(source).attackAction) {
          const didAttack = await this.prompt(source, { title: "Проклятье обсидиана", body: "В завершившийся ход вы совершали действие Атака? Отдельная атака реакцией или бонусным действием не считается." });
          await this.writeState(source, { ac: didAttack ? this.state(source).ac ?? 0 : -1, attackAction: didAttack, combatEvent: stamp });
        }
      }
      await this.syncActor(actor);
    }
  }
  async attackOccurred(actor, host, eventId) {
    if (!this.isAuthority()) return this.moduleApi.socketCommandBus.request("curse-upgrade.attack", { actorUuid: actor.uuid, hostId: host.id, eventId });
    for (const source of this.sources(actor, "obsidian").filter(s => s.host.id === host.id)) {
      if (this.state(source).attackEvent === eventId) continue;
      await this.writeState(source, { ac: 1, attackEvent: eventId, acExpiresAt: this.now() + 6 });
    }
    await this.syncActor(actor);
  }
  async bloodHit(workflow) {
    const actor = workflow?.actor;
    if (!actor || !values(workflow.hitTargets).length) return;
    const eventId = String(workflow.id ?? workflow.uuid ?? "");
    if (!eventId) return;
    const combat = globalThis.game?.combat;
    const turn = combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : `outside:${Math.floor(this.now() / 6)}`;
    for (const source of this.sources(actor, "blood").filter(s => s.host.id === workflow.item?.id)) {
      const amount = this.damage.bloodDamageTotal(workflow, source);
      if (!(amount > 0)) continue;
      if (!this.isAuthority()) {
        await this.moduleApi.socketCommandBus.request("curse-upgrade.blood", { actorUuid: actor.uuid, hostId: source.host.id, sourceId: source.upgrade.id, eventId, turn, amount });
      } else await this.applyBloodDamage(source, { eventId, turn, amount });
    }
  }
  async applyBloodDamage(source, { eventId, turn, amount }) {
    if (!this.isAuthority()) return;
    const actor = source.host.actor;
    return this.enqueue(actor, async () => {
      if (!this.sources(actor, "blood").some(s => s.upgrade.id === source.upgrade.id && s.host.id === source.host.id)) return;
      const state = this.state(source);
      const receipt = flag(actor, "curseBloodReceipts")?.[source.upgrade.id];
      if (state.bloodTurn === turn || state.bloodEvent === eventId || receipt?.turn === turn || receipt?.eventId === eventId) return;
      await actor.applyDamage([{ value: amount, type: "slashing", properties: new Set() }], {
        rebreyaCurseBloodSelf: true, rebreyaCurseBloodReceipt: { sourceId: source.upgrade.id, eventId, turn }
      });
      if (flag(actor, "curseBloodReceipts")?.[source.upgrade.id]?.eventId !== eventId) throw new Error("Не подтверждено применение урона проклятья.");
      await this.writeState(source, { bloodTurn: turn, bloodEvent: eventId });
    });
  }
  preApplyDamage(actor, amount, updates, options = {}) {
    if (amount > 0 && this.ownedSources(actor, "burden").some(s => this.state(s).burdenActive)) updates[`flags.${MODULE_ID}.curseTempDamageEvent`] = globalThis.crypto.randomUUID();
    const receipt = options.rebreyaCurseBloodReceipt;
    if (receipt && this.isAuthority()) updates[`flags.${MODULE_ID}.curseBloodReceipts.${receipt.sourceId}`] = { eventId: receipt.eventId, turn: receipt.turn };
    return true;
  }
  async expireOutsideCombat() {
    if (!this.isAuthority()) return;
    const now = Number(globalThis.game?.time?.worldTime ?? 0);
    for (const actor of values(globalThis.game?.actors)) {
      if (values(globalThis.game?.combat?.combatants).some(c => c.actor?.id === actor.id) && globalThis.game?.combat?.started) continue;
      const ids = values(actor.effects).filter(e => flag(e, FLAG)?.kind === "chains" && flag(e, FLAG).expiresAt <= now).map(e => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, syncOptions());
      for (const source of this.sources(actor, "obsidian")) if (this.state(source).ac && Number(this.state(source).acExpiresAt ?? 0) <= now) {
        await this.writeState(source, { ac: 0 }); await this.syncActor(actor);
      }
    }
  }
}
