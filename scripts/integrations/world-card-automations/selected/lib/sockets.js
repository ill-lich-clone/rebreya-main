import { applyCardEffect, cardId, onlyKeys, resolveCard } from "../../card-effect-authority.js";
import { receiveIncomingPassive } from "../../passive-authority.js";
import { DialogApp } from "../applications/dialog.js";
import { grappleItems } from "./utilities/grapple-items.js";
import { escapeFoundryHtml } from "../../../../shared/foundry-values.js";

const names = [
  "addDependent",
  "addFavorites",
  "createEffect",
  "createEmbeddedDocuments",
  "deleteEntity",
  "dialog",
  "setFlag",
  "setReactionUsed",
  "syntheticItemDataRoll",
  "updateEntity",
  "updateTargets"
];
export const sockets = Object.freeze(Object.fromEntries(names.map((name) => [name, Object.freeze({ name })])));
let state;
const tag = "worldCard.";
const uuid = (value) => typeof value === "string" && value.length > 0 && value.length <= 400 && !value.includes("<");
const owned = (doc, user) => doc?.testUserPermission?.(user, "OWNER") === true;
const boundedIds = (ids) => Array.isArray(ids) && ids.length <= 64 && ids.every(uuid);
function ownerFor(actor) {
  const users = state.game.users;
  const owners = Array.from(users.contents ?? users.values())
    .filter((u) => !u.isGM && u.active && owned(actor, u))
    .sort((a, b) => a.id.localeCompare(b.id));
  return owners.find((u) => u.character?.uuid === actor.uuid) ?? owners[0] ?? users.activeGM;
}
const ask = async (sender, action, details) =>
  globalThis.foundry.applications.api.DialogV2.confirm({
    window: { title: "Ребрея · запрос карточки" },
    content: "<p>" + [sender.name, action, details].map(escapeFoundryHtml).join(" · ") + "</p>",
    rejectClose: false
  });
function unavailable(op, doc = "") {
  const msg =
    "Ребрея: " +
    op +
    " " +
    doc +
    " — действие требует владельца документа. Откройте карточку у владельца или выполните этот шаг у мастера.";
  globalThis.ui?.notifications?.warn?.(msg);
  throw Error(msg);
}
async function receiver(command, payload, sender) {
  const { game, resolve, confirm } = state;
  if (!sender?.active) throw Error("Неизвестный отправитель запроса карточки.");
  if (command === "incomingHit") return receiveIncomingPassive(payload, { game, sender, resolve, confirm, ownerFor });
  if (["moveCardToken", "summonCardSteed", "configureDarknessRegion", "pushCardToken"].includes(command)) {
    if (!game.user?.isGM || game.users.activeGM?.id !== game.user.id)
      throw Error("Действие доступно только активному мастеру.");
    return state[command](payload, { sender });
  }
  if (
    [
      "applyEffect",
      "useReaction",
      "endEffect",
      "linkEffect",
      "linkFrighten",
      "expireChill",
      "escapeAction",
      "favoriteEscape",
      "grappleEscapeSettings"
    ].includes(command)
  ) {
    const subject = await resolve(payload?.target ?? payload?.effect);
    const actor = subject?.documentName === "Actor" ? subject : subject?.parent;
    if (actor?.documentName !== "Actor" || game.user.id !== ownerFor(actor)?.id)
      throw Error("Требуется подтверждение владельца цели.");
    if (command === "applyEffect") return applyCardEffect(payload, { sender, resolve, confirm });
    if (command === "linkFrighten") {
      if (!onlyKeys(payload, ["effect", "related"])) throw Error("Недопустимый запрос Frighten.");
      const [fright, smite] = await Promise.all([resolve(payload.effect), resolve(payload.related)]);
      const item = await resolveCard(smite?.origin, resolve);
      const activity = item?.system?.activities?.get(
        item.flags?.["chris-premades"]?.activityIdentifiers?.wrathfulSmiteFrighten
      );
      const template = Array.from(activity?.effects ?? []).find((row) => row.effect?.name === fright?.name)?.effect;
      if (
        fright?.documentName !== "ActiveEffect" ||
        smite?.documentName !== "ActiveEffect" ||
        cardId(smite) !== "wrathfulSmite" ||
        cardId(item) !== "wrathfulSmite" ||
        !owned(item.actor, sender) ||
        smite.parent?.uuid !== item.actor.uuid ||
        !template ||
        (await resolveCard(fright.origin, resolve))?.uuid !== item.uuid
      )
        throw Error("Не подтверждён эффект родной Activity Frighten.");
      if (!(await confirm(sender, "Связать испуг с Wrathful Smite", item.actor.name + " · " + actor.name)))
        throw Error("Связь отменена владельцем.");
      await fright.setFlag("dnd5e", "dependentOn", smite.uuid);
      return true;
    }
    if (command === "useReaction") {
      if (!onlyKeys(payload, ["source", "target"])) throw Error("Некорректный запрос реакции.");
      const [source, target] = await Promise.all([resolveCard(payload.source, resolve), resolve(payload.target)]);
      if (cardId(source) !== "shockingGrasp" || !owned(source.actor, sender) || target?.documentName !== "Actor")
        throw Error("Источник реакции не подтверждён.");
      if (!(await confirm(sender, "Потратить реакцию цели", source.name + " · " + target.name)))
        throw Error("Мастер отклонил расход реакции.");
      await globalThis.MidiQOL.setReactionUsed(target);
      return true;
    }
    if (command === "escapeAction" || command === "favoriteEscape" || command === "grappleEscapeSettings") {
      if (
        !onlyKeys(
          payload,
          command === "grappleEscapeSettings" ? ["target", "effect", "dc", "disadvantage"] : ["target", "effect"]
        )
      )
        throw Error("Некорректные данные захвата.");
      const targetEffect = await resolve(payload.effect);
      const provenance = targetEffect?.flags?.["rebreya-main"]?.worldCardAuthority;
      const origin = await resolveCard(provenance?.source, resolve);
      if (
        cardId(targetEffect) !== "grappled" ||
        targetEffect.parent?.uuid !== actor.uuid ||
        cardId(origin) !== "grapple" ||
        !owned(origin.actor, sender)
      )
        throw Error("Не подтверждён захват.");
      const existing = actor.items?.find((item) => cardId(item) === "grappleEscape");
      if (command === "grappleEscapeSettings") {
        const tokenId = targetEffect.flags["chris-premades"].grapple?.tokenId;
        if (
          !existing ||
          typeof tokenId !== "string" ||
          !/^[a-zA-Z0-9_-]+$/u.test(tokenId) ||
          (payload.dc !== false && !(Number.isInteger(payload.dc) && payload.dc > 0 && payload.dc <= 40)) ||
          typeof payload.disadvantage !== "boolean"
        )
          throw Error("Недопустимые условия освобождения.");
        if (
          !(await confirm(
            sender,
            "Обновить выход из захвата",
            actor.name + " · Сл " + (payload.dc || "состязание") + " · помеха " + payload.disadvantage
          ))
        )
          throw Error("Отменено владельцем.");
        return existing
          .setFlag("chris-premades", "grapple." + tokenId, { dc: payload.dc, disadvantage: payload.disadvantage })
          .then(() => true);
      }
      if (command === "favoriteEscape") {
        if (!existing || !(await confirm(sender, "Добавить выход из захвата в избранное", actor.name)))
          throw Error("Не удалось подтвердить избранное.");
        await actor.system.addFavorite?.({ id: existing.getRelativeUUID(actor), type: "item" });
        return true;
      }
      if (existing) return [existing.uuid];
      if (!(await confirm(sender, "Добавить действие выхода из захвата", actor.name)))
        throw Error("Отменено владельцем.");
      const copy = structuredClone(grappleItems["Grapple: Escape"]);
      delete copy._id;
      copy.flags.dnd5e = { ...copy.flags.dnd5e, dependentOn: targetEffect.uuid };
      copy.flags["chris-premades"].info = { ...copy.flags["chris-premades"].info, identifier: "grappleEscape" };
      const [item] = await actor.createEmbeddedDocuments("Item", [copy]);
      return [item.uuid];
    }
    if (!onlyKeys(payload, ["effect", "related"])) throw Error("Некорректная связь эффекта.");
    const effect = await resolve(payload.effect);
    if (effect?.documentName !== "ActiveEffect" || !effect.flags?.["rebreya-main"]?.worldCardAuthority)
      throw Error("Эффект не создан обработчиком Rebreya.");
    const source = await resolveCard(effect.flags["rebreya-main"].worldCardAuthority.source, resolve);
    if (
      !owned(source?.actor, sender) ||
      (game.user.isGM && (effect.parent?.hasPlayerOwner || !game.users.get(effect._stats?.lastModifiedBy)?.isGM))
    )
      throw Error("Нужен создатель или владелец эффекта.");
    if (command === "expireChill") {
      if (cardId(effect) !== "chillTouchChilled" || cardId(source) !== "chillTouch")
        throw Error("Не подтверждено Леденящее прикосновение.");
      const active = Array.from(effect.system?.changes ?? []);
      if (active.some((c) => c.key !== "system.traits.di.value" || c.value !== "healing"))
        throw Error("Эффект изменён владельцем.");
      if (!(await confirm(sender, "Завершить запрет лечения", actor.name))) throw Error("Отменено владельцем.");
      await effect.update({ "system.changes": [] });
      return true;
    }
    if (command === "endEffect") {
      if (!(await confirm(sender, "Завершить эффект", effect.name + " · " + effect.parent.name)))
        throw Error("Отменено владельцем.");
      await effect.delete();
      return true;
    }
    const related = await resolve(payload.related);
    if (
      related?.documentName !== "ActiveEffect" ||
      related.parent?.uuid !== source.actor.uuid ||
      (await resolveCard(related.origin, resolve))?.uuid !== source.uuid
    )
      throw Error("Другой источник связанного эффекта.");
    if (effect.flags?.dnd5e?.dependentOn === related.uuid) return true;
    if (!(await confirm(sender, "Связать завершение эффектов", effect.name + " · " + related.name)))
      throw Error("Отменено владельцем.");
    await effect.setFlag("dnd5e", "dependentOn", related.uuid);
    return true;
  }
  if (command === "choice") {
    if (
      !onlyKeys(payload, ["title", "content", "inputs", "buttons"]) ||
      typeof payload.title !== "string" ||
      typeof payload.content !== "string" ||
      !Array.isArray(payload.inputs) ||
      JSON.stringify(payload).length > 32000 ||
      /[<>]/.test(JSON.stringify(payload)) ||
      /"(?:__proto__|prototype|constructor)"/u.test(JSON.stringify(payload)) ||
      ![undefined, null, "ok", "cancel", "yesNo", "okCancel"].includes(payload.buttons)
    )
      throw Error("В запросе выбора допускается только текст.");
    return DialogApp.dialog(
      sender.name + " · " + payload.title,
      payload.content,
      payload.inputs,
      payload.buttons ?? "okCancel"
    );
  }
  if (command === "selectTargets") {
    if (!onlyKeys(payload, ["ids"]) || !boundedIds(payload.ids)) throw Error("Некорректные цели.");
    const tokens = payload.ids.map((id) => globalThis.canvas?.scene?.tokens?.get(id));
    if (
      tokens.some((t) => !t?.object?.visible) ||
      !(await confirm(sender, "Изменить выделенные цели", tokens.map((t) => t.name).join(", ")))
    )
      throw Error("Выбор целей отменён.");
    globalThis.canvas.tokens.setTargets(payload.ids);
    return true;
  }
  throw Error("Неизвестная операция карточки.");
}
export function registerWorldCardTransport({
  socketlib,
  game,
  moveCardToken,
  summonCardSteed,
  configureDarknessRegion,
  pushCardToken,
  resolve = (uuid) => globalThis.fromUuid(uuid),
  confirm = ask
}) {
  const transport = socketlib?.registerModule?.("rebreya-main");
  if (!transport) return false;
  if (state?.transport === transport) return true;
  state = { transport, game, resolve, confirm, moveCardToken, summonCardSteed, configureDarknessRegion, pushCardToken };
  const commands = [
    "applyEffect",
    "useReaction",
    "endEffect",
    "linkEffect",
    "linkFrighten",
    "expireChill",
    "escapeAction",
    "favoriteEscape",
    "grappleEscapeSettings",
    "choice",
    "selectTargets",
    "incomingHit"
  ];
  if (moveCardToken) commands.push("moveCardToken");
  if (summonCardSteed) commands.push("summonCardSteed");
  if (configureDarknessRegion) commands.push("configureDarknessRegion");
  if (pushCardToken) commands.push("pushCardToken");
  for (const command of commands)
    transport.register(tag + command, function (payload) {
      return receiver(command, payload, game.users.get(this.socketdata?.userId));
    });
  return true;
}
async function toUser(command, user, payload) {
  if (!state || !user?.active) unavailable(command);
  if (user.id === state.game.user.id) return receiver(command, payload, state.game.user);
  return state.transport.executeAsUser(tag + command, user.id, payload);
}
export function requestCardAuthority(command, payload) {
  return toUser(command, state?.game.users.activeGM, payload);
}
export function requestCardPassive(actor, payload) {
  if (!state) unavailable("incomingHit");
  return toUser("incomingHit", ownerFor(actor), payload);
}
async function toOwner(command, id, payload) {
  const subject = await state.resolve(id),
    actor = subject?.documentName === "Actor" ? subject : subject?.parent;
  return toUser(command, ownerFor(actor), payload);
}
export const socket = {
  async executeAsUser(op, id, ...args) {
    const user = state?.game.users.get(id);
    if (op === "dialog") {
      const [title, content, inputs, buttons] = args;
      return toUser("choice", user, { title, content, inputs, buttons });
    }
    if (op === "updateTargets") return toUser("selectTargets", user, { ids: args[0] });
    unavailable(op);
  },
  async executeAsGM(op, ...args) {
    if (!state) unavailable(op);
    const [target, data, opts = {}] = args;
    if (op === "setReactionUsed") return toOwner("useReaction", target, { target, source: data });
    if (op === "deleteEntity") return toOwner("endEffect", target, { effect: target });
    if (op === "setFlag" && data === "dnd5e" && opts === "dependentOn")
      return toOwner("linkEffect", target, { effect: target, related: args[3] });
    if (op === "addDependent" && boundedIds(data)) {
      for (const effect of data) {
        if (effect === target) continue;
        const dependent = await state.resolve(effect);
        if (dependent?.flags?.dnd5e?.dependentOn === target) continue;
        const parent = await state.resolve(target);
        if (cardId(parent) === "wrathfulSmite" && dependent?.documentName === "ActiveEffect") {
          await toOwner("linkFrighten", effect, { effect, related: target });
          continue;
        }
        await toOwner("linkEffect", effect, { effect, related: target });
      }
      return true;
    }
    if (op === "updateEntity") {
      const doc = await state.resolve(target);
      if (state.game.user.isGM && owned(doc, state.game.user)) return doc.update(data);
      if (onlyKeys(data, ["origin"]) && data.origin === doc?.origin) return true;
      if (
        cardId(doc) === "chillTouchChilled" &&
        onlyKeys(data, ["changes"]) &&
        Array.isArray(data.changes) &&
        data.changes.length === 0
      )
        return toOwner("expireChill", target, { effect: target });
      const grapple = data?.flags?.["chris-premades"]?.grapple;
      if (cardId(doc) === "grappleEscape" && grapple && Object.keys(grapple).length === 1) {
        const [tokenId, config] = Object.entries(grapple)[0];
        const match = doc.actor.effects.find(
          (e) => cardId(e) === "grappled" && e.flags?.["chris-premades"]?.grapple?.tokenId === tokenId
        );
        if (match)
          return toOwner("grappleEscapeSettings", doc.actor.uuid, {
            target: doc.actor.uuid,
            effect: match.uuid,
            dc: config.dc,
            disadvantage: config.disadvantage
          });
      }
    }
    if (op === "createEffect") {
      const cpr = data?.flags?.["chris-premades"],
        source =
          opts.concentrationItemUuid ??
          data?.flags?.["rebreya-main"]?.worldCardSource ??
          data?.origin ??
          data?.workflow;
      let item = await resolveCard(source, state.resolve);
      if (!item && opts.parentEntityUuid) item = await resolveCard(opts.parentEntityUuid, state.resolve);
      const recipe =
        cpr?.info?.identifier ??
        { hexbladesCurse: "curseCritical", brandingSmite: "branded" }[cardId(item)] ??
        cardId(item);
      const payload = {
        target,
        source: item?.uuid,
        recipe,
        requestId: globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID()
      };
      if (opts.parentEntityUuid) payload.parent = opts.parentEntityUuid;
      if (opts.concentrationItemUuid) payload.concentration = true;
      const token =
        cpr?.wardingBond?.bondUuid ??
        cpr?.compelledDuel?.sourceUuid ??
        (cpr?.grapple?.tokenId && globalThis.canvas?.scene?.tokens?.get(cpr.grapple.tokenId)?.uuid);
      if (token) payload.sourceToken = token;
      if (!payload.source || !recipe) unavailable(op, target);
      return toOwner("applyEffect", target, payload);
    }
    if (
      (op === "createEmbeddedDocuments" &&
        data === "Item" &&
        Array.isArray(opts) &&
        opts.length === 1 &&
        cardId(opts[0]) === "grappleEscape") ||
      (op === "addFavorites" && boundedIds(data))
    ) {
      const actor = await state.resolve(target);
      const candidates =
        actor?.effects?.filter(
          (e) => cardId(e) === "grappled" && e.flags?.["rebreya-main"]?.worldCardAuthority?.source
        ) ?? [];
      if (candidates.length === 1)
        return toOwner(op === "addFavorites" ? "favoriteEscape" : "escapeAction", target, {
          target,
          effect: candidates[0].uuid
        });
    }
    unavailable(op, uuid(target) ? target : "");
  }
};
