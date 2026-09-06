import { isDamageOnlySaveActivity } from "../combat/curse-upgrade-saves.js";

const text = value => typeof value === "string" && value.length > 0 && value.length < 512;
const exact = (payload, keys) => payload && typeof payload === "object" && !Array.isArray(payload)
  && Object.keys(payload).every(key => keys.includes(key));
const owns = (actor, sender) => Boolean(actor && sender && (sender.isGM || actor.testUserPermission?.(sender, "OWNER")));
const resolve = uuid => globalThis.fromUuid?.(uuid);

export function isValidCurseSaveRequest(payload) {
  return Boolean(exact(payload, ["actorUuid", "sourceActorUuid", "eventId", "saved", "death", "damageOnly", "kind", "workflowId", "itemCardUuid", "activityUuid", "targetUuid"])
    && text(payload.actorUuid) && text(payload.eventId) && typeof payload.saved === "boolean"
    && typeof payload.death === "boolean" && typeof payload.damageOnly === "boolean"
    && (payload.kind === undefined || payload.kind === "chains")
    && ["sourceActorUuid", "workflowId", "itemCardUuid", "activityUuid", "targetUuid"].every(key => payload[key] === undefined || text(payload[key]))
    && (payload.kind !== "chains" || (text(payload.sourceActorUuid) && payload.damageOnly)));
}

export async function authorizeCurseSaveRequest(payload, { sender } = {}) {
  const actor = await resolve(payload.actorUuid);
  if (!actor?.items || !sender) return false;
  if (!payload.sourceActorUuid) return payload.kind !== "chains" && owns(actor, sender);
  const source = await resolve(payload.sourceActorUuid);
  const activity = await resolve(payload.activityUuid);
  const target = await resolve(payload.targetUuid);
  if (!source?.items || !owns(source, sender) || activity?.actor?.uuid !== source.uuid
    || target?.actor?.uuid !== actor.uuid || activity.type !== "save") return false;
  if (payload.kind === "chains" && !isDamageOnlySaveActivity(activity)) return false;
  if (sender.isGM) return true;
  const card = await resolve(payload.itemCardUuid);
  if (!card || (card.author?.id ?? card.user?.id) !== sender.id) return false;
  const itemUuid = card.flags?.dnd5e?.item?.uuid ?? card.flags?.["midi-qol"]?.itemUuid;
  const activityUuid = card.flags?.dnd5e?.activity?.uuid ?? card.flags?.["midi-qol"]?.activityUuid;
  if (activityUuid ? activityUuid !== activity.uuid : itemUuid !== activity.item?.uuid) return false;
  if (![card.uuid, card.id].includes(payload.workflowId)) return false;
  const targets = [...(card.flags?.dnd5e?.targets ?? []), ...(card.flags?.["midi-qol"]?.targets ?? [])];
  if (!targets.some(entry => [actor.uuid, target.uuid].includes(typeof entry === "string" ? entry : entry?.uuid))) return false;
  const event = `curse-save:${payload.workflowId}:${actor.uuid}`;
  if (payload.eventId !== event + (payload.kind === "chains" ? ":chains" : "")) return false;
  if (payload.kind === "chains") return true;
  // A hidden DC may have no native receipt. The executor then asks the active GM
  // to confirm the reported outcome before touching another actor's curse state.
  return true;
}

export function registerCurseUpgradeSocketCommands(moduleApi) {
  const bus = moduleApi.socketCommandBus; const service = moduleApi.curseUpgradeAutomationService;
  bus.register("curse-upgrade.save", { validate: isValidCurseSaveRequest, authorize: authorizeCurseSaveRequest,
    execute: (payload, context) => service.executeSaveRequest(payload, context) });
  const validateAttack = p => exact(p, ["actorUuid", "hostId", "eventId"]) && text(p.actorUuid) && text(p.hostId) && text(p.eventId);
  const authorizeActor = async (p, { sender }) => owns(await resolve(p.actorUuid), sender);
  bus.register("curse-upgrade.sync", { validate: p => exact(p, ["actorUuid"]) && text(p.actorUuid), authorize: authorizeActor,
    execute: async p => service.syncActor(await resolve(p.actorUuid)) });
  bus.register("curse-upgrade.attack", { validate: validateAttack, authorize: authorizeActor,
    execute: async p => { const actor = await resolve(p.actorUuid); const host = actor?.items?.get(p.hostId); if (!host) throw new Error("Оружие не найдено."); return service.attackOccurred(actor, host, p.eventId); } });
  bus.register("curse-upgrade.blood", {
    validate: p => exact(p, ["actorUuid", "hostId", "sourceId", "eventId", "turn", "amount"])
      && [p.actorUuid, p.hostId, p.sourceId, p.eventId, p.turn].every(text) && Number.isFinite(p.amount) && p.amount > 0 && p.amount <= 1000,
    authorize: authorizeActor,
    execute: async p => {
      const actor = await resolve(p.actorUuid);
      const source = service.sources(actor, "blood").find(s => s.host.id === p.hostId && s.upgrade.id === p.sourceId);
      if (!source) throw new Error("Проклятье не установлено на активном оружии.");
      const combat = globalThis.game?.combat;
      const turn = combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : `outside:${Math.floor(service.now() / 6)}`;
      if (p.turn !== turn) throw new Error("Ход уже изменился.");
      return service.applyBloodDamage(source, p);
    }
  });
}
