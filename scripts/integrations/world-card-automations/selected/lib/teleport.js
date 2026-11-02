import { movementReceiptPatch, withMovementReceipt } from "../../movement-receipts.js";
import { Crosshairs, validCardDestination } from "./crosshairs.js";
import { releaseMovedCardGrapples } from "../../grapple-release.js";
import { escapeFoundryHtml as escape } from "../../../../shared/foundry-values.js";

export function validateCardPayload(data, keys) {
  return (
    data &&
    typeof data === "object" &&
    Object.keys(data).length === keys.length &&
    keys.every((key) => Object.hasOwn(data, key)) &&
    [data.x, data.y].every(Number.isFinite) &&
    keys
      .filter((key) => key.endsWith("Uuid"))
      .every((key) => typeof data[key] === "string" && data[key].length > 0 && data[key].length < 300)
  );
}

export async function resolveCardCaster(payload, sender) {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || !sender?.active) return null;
  if (
    !/^ChatMessage\.[a-zA-Z0-9]+$/.test(payload.itemCardUuid) ||
    !/^Scene\.[a-zA-Z0-9]+\.Token\.[a-zA-Z0-9]+$/.test(payload.sourceTokenUuid)
  )
    return null;
  const message = await fromUuid(payload.itemCardUuid);
  const token = await fromUuid(payload.sourceTokenUuid);
  if (
    message?.documentName !== "ChatMessage" ||
    token?.documentName !== "Token" ||
    token.parent !== canvas.scene ||
    !token.object
  )
    return null;
  const age = Date.now() - Number(message.timestamp);
  if (!Number.isFinite(age) || age < -30_000 || age > 600_000) return null;
  const item = message.getAssociatedItem?.();
  if (
    message.author?.id !== sender.id ||
    item?.type !== "spell" ||
    item.actor?.uuid !== token.actor?.uuid ||
    !token.actor.testUserPermission(sender, "OWNER") ||
    message.getAssociatedToken?.()?.uuid !== token.uuid
  )
    return null;
  return { item, message, source: token.object };
}

async function move(target, source, center, range, receipt) {
  const doc = target.document;
  if (!validCardDestination(source, doc, center, range, doc.id)) return false;
  const x = center.x - (doc.width * canvas.grid.size) / 2;
  const y = center.y - (doc.height * canvas.grid.size) / 2;
  await doc.update(
    { x, y, ...movementReceiptPatch(doc, receipt) },
    {
      animate: false,
      movement: {
        [doc.id]: { constrainOptions: { ignoreWalls: true, ignoreTokens: true, ignoreCost: true }, showRuler: false }
      }
    }
  );
  await releaseMovedCardGrapples(target);
  return true;
}

export async function moveCardToken(data, { sender }) {
  if (!validateCardPayload(data, ["sourceTokenUuid", "targetTokenUuid", "itemCardUuid", "x", "y"])) return false;
  const cast = await resolveCardCaster(data, sender);
  const target = await fromUuid(data.targetTokenUuid);
  if (!cast || target?.documentName !== "Token" || target.parent !== canvas.scene || !target.object) return false;
  const { item, message, source } = cast;
  const id = item.flags?.["chris-premades"]?.info?.identifier ?? item.system.identifier;
  let range;
  if (["mistyStep", "misty-step"].includes(id)) {
    if (
      target.uuid !== source.document.uuid &&
      (target.disposition !== source.document.disposition ||
        !source.actor.items.some((i) => i.flags?.["chris-premades"]?.info?.identifier === "mistyWanderer"))
    )
      return false;
    range = target.uuid === source.document.uuid ? Number(item.flags?.["chris-premades"]?.config?.range ?? 30) : 5;
  } else if (["vortexWarp", "vortex-warp"].includes(id)) {
    const descriptor = Array.from(message.system?.targets ?? []).find((targetData) => targetData.token === target.uuid);
    const save = message.system?.midi?.sections?.saves?.data?.saves?.find(
      (entry) => entry.target?.document?.uuid === target.uuid
    );
    if ((!descriptor && !save) || descriptor?.saved === true || save?.saveClass === "success") return false;
    const level = Math.max(2, Math.min(9, Number(message.system?.scaling ?? 0) + Number(item.system.level)));
    range = 90 + 30 * (level - 2);
  } else return false;
  if (!validCardDestination(source, target, data, range, target.id)) return false;
  return withMovementReceipt(target, message.uuid, true, async () => {
    const confirm = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Телепортация по заклинанию" },
      content: `<p>${escape(sender.name)}: ${escape(item.name)}. Переместить ${escape(target.name)} в (${data.x}, ${data.y})? Подтвердите допустимость цели и результат спасброска.</p>`
    });
    return confirm && move(target.object, source, data, range, message.uuid);
  });
}

export class Teleport {
  static async target([target], source, { range = 30, workflow } = {}) {
    if (!target?.document || !source?.document || target.document.parent !== source.document.parent) return false;
    const doc = target.document;
    const point = await Crosshairs.showCrosshairs(
      {
        actor: source.actor,
        width: doc.width,
        height: doc.height,
        elevation: doc.elevation,
        icon: doc.texture.src,
        x: source.center.x,
        y: source.center.y
      },
      {
        validate: (center) => validCardDestination(source, doc, center, Number(range), doc.id)
      }
    );
    if (point.cancelled) return false;
    if (doc.isOwner) return withMovementReceipt(doc, workflow?.itemCardUuid, true,
      () => move(target, source, point, Number(range), workflow?.itemCardUuid));
    if (!workflow?.itemCardUuid) return false;
    const { requestCardAuthority } = await import("./sockets.js");
    return requestCardAuthority("moveCardToken", {
      sourceTokenUuid: source.document.uuid,
      targetTokenUuid: doc.uuid,
      itemCardUuid: workflow.itemCardUuid,
      x: point.x,
      y: point.y
    });
  }
}
