import { MODULE_ID } from "../constants.js";
import { escapeFoundryHtml } from "../shared/foundry-values.js";

export const HARVEST_ABILITY_REQUEST = "rebreyaHarvestAbility";
const template = `modules/${MODULE_ID}/templates/creature-harvesting-chat.hbs`;

export function harvestCheckLabel(check) {
  const [ability, skill] = check.split(":");
  const labels = globalThis.CONFIG?.DND5E;
  const localize = label => globalThis.game?.i18n?.localize(label) ?? label;
  const abilityLabel = localize(labels?.abilities?.[ability]?.label ?? ({ str: "Сила", dex: "Ловкость",
    con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма" })[ability] ?? ability);
  const skillLabel = labels?.skills?.[skill]?.label ?? ({ sur: "Выживание", arc: "Магия", slt: "Ловкость рук", ath: "Атлетика" })[skill] ?? skill;
  return skillLabel ? `${abilityLabel} (${localize(skillLabel)})` : abilityLabel;
}

export function harvestRequestData(attempt, gmId) {
  const [ability, skill] = attempt.check.split(":");
  return {
    _id: attempt.receipt,
    type: "request",
    flavor: "Запрос проверки разделки",
    content: `<p><strong>${escapeFoundryHtml(attempt.corpseName)}</strong> · ${escapeFoundryHtml(harvestCheckLabel(attempt.check))} · Сл ${attempt.dc}</p>`,
    whisper: [...new Set([attempt.requesterId, gmId].filter(Boolean))],
    system: {
      handler: skill ? "skill" : HARVEST_ABILITY_REQUEST,
      data: { ability, ...(skill ? { skill } : {}), target: attempt.dc },
      button: { label: "Проверка разделки", icon: "fa-solid fa-dice-d20" },
      targets: [{ actor: attempt.actorUuid, user: attempt.requesterId }]
    },
    flags: { [MODULE_ID]: { harvestRequest: { tokenUuid: attempt.tokenUuid, receipt: attempt.receipt } } }
  };
}

export async function rollHarvestAbilityRequest(actor, request, config, { event } = {}) {
  const data = { flags: { dnd5e: { requestResult: { actorUuid: actor.uuid, requestId: request.id } } } };
  const [roll] = await actor.rollAbilityCheck({ ...config, event }, {}, { data }) ?? [];
  return roll?.parent ?? null;
}

export function harvestReplyTotal(message, attempt) {
  const reply = message?.flags?.dnd5e?.requestResult;
  const author = message?.author;
  const [ability, skill] = attempt.check.split(":");
  if (!author || (author.id !== attempt.requesterId && !author.isGM)
      || reply?.requestId !== attempt.receipt || reply.actorUuid !== attempt.actorUuid
      || message.type !== "check" || (skill ? message.system?.skill !== skill || message.system?.tool
        : message.system?.ability !== ability || message.system?.skill || message.system?.tool)) return null;
  const roll = message.rolls?.[0];
  return roll?.validD20Roll === true && Number.isFinite(roll.total) ? roll.total : null;
}

export async function renderHarvestChat({ attempt, monster, harvester, result, rows }, render = globalThis.foundry.applications.handlebars.renderTemplate) {
  const outcomes = { severe: "Тяжёлый провал", partial: "Лёгкий провал", success: "Успех",
    exceptional: "Успех на 5 и более", closed: "Попытка закрыта" };
  const check = harvestCheckLabel(attempt.check ?? "wis:sur");
  return render(template, {
    harvester: harvester?.name || "Персонаж", corpse: attempt.corpseName || monster.name, check,
    rolled: result.total !== null, total: result.total, dc: result.dc, outcome: outcomes[result.outcome],
    severe: result.outcome === "severe", loot: result.loot.map((item, index) => ({ ...item, img: rows[index]?.img }))
  });
}
