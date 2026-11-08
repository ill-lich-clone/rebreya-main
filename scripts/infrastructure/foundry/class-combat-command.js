import { keyedMutationScheduling } from "../../application/socket-command-scheduling.js?v=1.5.3";
import { cardHitEvidence, usageCardData } from "../../integrations/midi-usage-card.js";
import { MODULE_ID } from "../../constants.js";

export const FIGHTER_MANEUVER_COMMAND = "combat.fighter.maneuver";
export const FIRE_RUNE_COMMAND = "combat.rune-knight.fire";
export const SECOND_WIND_COMMAND = "combat.fighter.second-wind";
const id = /^[\w-]{1,64}$/u;
const tokenUuid = /^Scene\.[\w-]{1,64}\.Token\.[\w-]{1,64}$/u;
const itemUuid = /^(?:Actor\.[\w-]+|Scene\.[\w-]+\.Token\.[\w-]+(?:\.Actor\.[\w-]+)?)\.Item\.[\w-]+$/u;
const actorUuid = /^(?:Actor\.[\w-]+|Scene\.[\w-]+\.Token\.[\w-]+\.Actor\.[\w-]+)$/u;

export function classCombatCardOwned(message, sender, now = Date.now()) {
  const author = message?.author?.id ?? message?.user?.id ?? message?.user;
  const created = message?._stats?.createdTime ?? message?.timestamp;
  return Boolean(sender && author === sender.id && Number.isFinite(created) && created <= now && now - created <= 120000);
}

export async function resolveClassCombatHit(payload, {
  sender, game = globalThis.game, resolve = globalThis.fromUuid, now = Date.now()
} = {}) {
  const attack = game?.messages?.get?.(payload.attackId);
  const usage = usageCardData(attack);
  if (!usage || !classCombatCardOwned(attack, sender, now) || !cardHitEvidence(attack, payload.targetTokenUuid)) return null;
  const item = attack.getAssociatedItem?.() ?? await resolve?.(usage.item?.uuid ?? usage.use?.item);
  const actor = item?.actor;
  if (!actor?.testUserPermission?.(sender, "OWNER")
    || (item.type !== "weapon" && !/(?:^|-)unarmed-strike$/u.test(item.system?.identifier ?? ""))) return null;
  const activity = usage.activity?.uuid ? await resolve?.(usage.activity.uuid) : usage.activity;
  if ((activity?.type ?? usage.activity?.type) !== "attack") return null;
  const scene = game?.scenes?.get?.(attack.speaker?.scene);
  const source = scene?.tokens?.get?.(attack.speaker?.token);
  const token = await resolve?.(payload.targetTokenUuid);
  if (!source || source.actor?.uuid !== actor.uuid || !token?.actor || token.actor.uuid === actor.uuid
    || token.parent !== scene || scene.tokens.get(token.id) !== token) return null;
  return { attack, actor, item, token, target: token.actor };
}

export async function reserveClassCombatOperation(kind, hit, item, relatedId = "", {
  game = globalThis.game,
  confirm = (config) => globalThis.foundry?.applications?.api?.DialogV2?.confirm(config),
  create = (data) => globalThis.ChatMessage?.create(data)
} = {}) {
  if (!game?.user?.isGM) return { receipt: null };
  const operation = `${kind}:${hit.attack.id}`;
  const existing = Array.from(game.messages?.values?.() ?? game.messages ?? []).find(message => {
    const marker = message.flags?.[MODULE_ID]?.classCombatReceipt;
    return (message.author?.isGM || game.users?.get?.(message.user?.id ?? message.user)?.isGM)
      && marker?.kind === kind && (marker.operation === operation || (relatedId && marker.relatedId === relatedId));
  });
  if (existing) return { receipt: null, existing };
  const escape = (text) => String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const details = `${escape(hit.actor.name)} · ${escape(item.name)} · ${escape(hit.target.name)}`;
  if (await confirm({
    window: { title: "Подтвердить классовое умение" },
    content: `<p>${details}</p><p>Проверьте попадание и применение умения перед записью на цель.</p>`
  }) !== true) return { receipt: null };
  const receipt = await create({
    content: `<p>${details}</p>`,
    whisper: [game.user.id],
    flags: { [MODULE_ID]: { classCombatReceipt: { kind, operation, relatedId, target: hit.token?.uuid, applied: false } } }
  });
  return { receipt };
}

export function registerClassCombatCommands(bus, fighter, runeKnight) {
  const register = (command, keys, validateMore, service, apply) => {
    bus.register(command, {
      validate: payload => Boolean(payload && Object.keys(payload).length === keys.length + 2
        && typeof payload.attackId === "string" && id.test(payload.attackId)
        && typeof payload.targetTokenUuid === "string" && tokenUuid.test(payload.targetTokenUuid)
        && validateMore(payload)),
      authorize: async (payload, context) => Boolean(await resolveClassCombatHit(payload, context)),
      scheduling: keyedMutationScheduling(payload => [
        `class-combat:${payload.attackId}`,
        `document:${payload.targetTokenUuid}`,
        `class-combat-use:${payload.itemUuid ?? payload.maneuverId}`
      ]),
      execute: (payload, context) => service[apply](payload, context)
    });
  };
  register(FIGHTER_MANEUVER_COMMAND, ["maneuverId", "disadvantage"],
    payload => typeof payload.maneuverId === "string" && id.test(payload.maneuverId) && typeof payload.disadvantage === "boolean",
    fighter, "applyRemoteManeuver");
  register(FIRE_RUNE_COMMAND, ["itemUuid"],
    payload => typeof payload.itemUuid === "string" && payload.itemUuid.length <= 320 && itemUuid.test(payload.itemUuid),
    runeKnight, "applyRemoteFireRune");
  bus.register(SECOND_WIND_COMMAND, {
    validate: payload => Boolean(payload && Object.keys(payload).length === 3
      && typeof payload.actorUuid === "string" && payload.actorUuid.length <= 240 && actorUuid.test(payload.actorUuid)
      && Number.isInteger(payload.diceCount) && payload.diceCount >= 1 && payload.diceCount <= 30
      && typeof payload.turn === "string" && payload.turn.length <= 100),
    authorize: async (payload, { sender }) => Boolean(sender
      && (await globalThis.fromUuid?.(payload.actorUuid))?.testUserPermission?.(sender, "OWNER")),
    scheduling: keyedMutationScheduling(payload => [`document:${payload.actorUuid}`]),
    execute: (payload, context) => fighter.applyRemoteSecondWind(payload, context)
  });
}
