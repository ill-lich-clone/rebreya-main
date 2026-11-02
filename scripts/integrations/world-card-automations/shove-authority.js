import { actorUtils } from "./selected/lib/utilities/actorUtils.js";
import { tokenUtils } from "./selected/lib/utilities/tokenUtils.js";
import { escapeFoundryHtml } from "../../shared/foundry-values.js";

import { movementReceiptPatch, withMovementReceipt } from "./movement-receipts.js";

async function resolveShove(data, sender) {
  if (!sender?.active || !game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if (!data || Object.keys(data).length !== 4 || !["prone", "move"].includes(data.result)) return;
  if (
    !/^ChatMessage\.[A-Za-z0-9]+$/.test(data.message) ||
    ![data.source, data.target].every((uuid) => /^Scene\.[A-Za-z0-9]+\.Token\.[A-Za-z0-9]+$/.test(uuid))
  )
    return;
  const [message, source, target] = await Promise.all(
    [data.message, data.source, data.target].map((uuid) => fromUuid(uuid))
  );
  const item = message?.getAssociatedItem?.();
  const elapsed = Date.now() - message?.timestamp;
  if (
    message?.author?.id !== sender.id ||
    !(elapsed >= 0 && elapsed < 600_000) ||
    !source?.object ||
    !target?.object ||
    source.parent !== canvas.scene ||
    target.parent !== source.parent ||
    source.actor?.uuid === target.actor?.uuid ||
    !source.actor?.testUserPermission(sender, "OWNER") ||
    message.getAssociatedToken?.()?.uuid !== source.uuid ||
    item?.actor?.uuid !== source.actor.uuid ||
    item?.flags?.["chris-premades"]?.info?.identifier !== "shove"
  )
    return;
  if (!Array.from(message.system?.targets ?? []).some((row) => row.token === target.uuid)) return;
  const heavy = source.actor.items.some((i) => i.flags?.["chris-premades"]?.info?.identifier === "heavyweight");
  if (actorUtils.getSize(target.actor) > actorUtils.getSize(source.actor) + 1 + Number(heavy)) return;
  const distance = tokenUtils.getDistance(source.object, target.object, { wallsBlock: true });
  if (!Number.isFinite(distance) || distance < 0 || distance > 5) return;
  return { source, target };
}

export async function pushCardToken(data, { sender }) {
  const action = await resolveShove(data, sender);
  if (!action) return false;
  return withMovementReceipt(action.target, data.message, false, async () => {
    const result = data.result === "move" ? "оттолкнуть на 5 футов" : "сбить с ног";
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Толчок" },
      defaultYes: false,
      rejectClose: false,
      content: `<p>${escapeFoundryHtml(action.source.name)} → ${escapeFoundryHtml(action.target.name)}. Подтвердить результат состязания и ${result}?</p>`
    });
    if (!yes) return false;
    const current = await resolveShove(data, sender);
    if (!current) return false;
    if (data.result === "move")
      return tokenUtils.pushToken(current.source.object, current.target.object, 5, data.message);
    if (actorUtils.checkTrait(current.target.actor, "ci", "prone")) return false;
    await current.target.update(movementReceiptPatch(current.target, data.message));
    await current.target.actor.toggleStatusEffect("prone", { active: true });
    return true;
  });
}
