import { Crosshairs, validCardDestination } from "./crosshairs.js";
import { validateCardPayload, resolveCardCaster } from "./teleport.js";
import { escapeFoundryHtml as escape } from "../../../../shared/foundry-values.js";

const steedKey = "cardSteed";
function existingSteed(actor) {
  return actor.effects?.find?.(
    (effect) => effect.flags?.["chris-premades"]?.info?.identifier === "findSteed" && !effect.duration?.expired
  );
}

function placeSteed(template, item, source, center, creatureType, language) {
  return game.rebreyaMain.worldMutationCoordinator.run(`find-steed:${source.actor.uuid}`, () =>
    createSteed(template, item, source, center, creatureType, language)
  );
}

async function createSteed(template, item, source, center, creatureType, language) {
  const actor = source.actor;
  const cfg = item.flags?.["chris-premades"]?.config ?? {};
  if (
    template.folder?.name !== (cfg.folder || "Steeds") ||
    !["celestial", "fey", "fiend"].includes(creatureType) ||
    !Array.from(actor.system.traits.languages.value).includes(language) ||
    !validCardDestination(source, template.prototypeToken, center, 30)
  )
    return false;
  if (existingSteed(actor)) {
    ui.notifications.warn("Сначала отпустите ранее призванного скакуна.");
    return false;
  }
  const effectId = foundry.utils.randomID();
  const effectUuid = `${actor.uuid}.ActiveEffect.${effectId}`;
  const scene = source.document.parent;
  const name = cfg.steedName || `${template.name} Steed`;
  const token = await template.getTokenDocument(
    {
      actorLink: false,
      name,
      disposition: source.document.disposition,
      elevation: source.document.elevation,
      x: center.x - (template.prototypeToken.width * canvas.grid.size) / 2,
      y: center.y - (template.prototypeToken.height * canvas.grid.size) / 2,
      level: source.document.level
    },
    { parent: scene }
  );
  token.updateSource({
    actorLink: false,
    "flags.rebreya-main.cardSteed": effectUuid,
    delta: {
      name,
      ownership: actor.ownership,
      system: {
        abilities: { int: { value: Math.max(6, template.system.abilities.int.value) } },
        details: { type: { value: creatureType } },
        traits: { languages: { value: [...new Set([...(template.system.traits?.languages?.value ?? []), language])] } }
      }
    }
  });
  const id = foundry.utils.randomID();
  const effect = {
    _id: effectId,
    name: item.name,
    img: item.img,
    origin: item.uuid,
    transfer: false,
    duration: game.release?.generation >= 14 ? { value: 86400, units: "seconds" } : { seconds: 86400 },
    flags: {
      "rebreya-main": { [steedKey]: `${scene.uuid}.Token.${id}` },
      "chris-premades": {
        info: { identifier: "findSteed" },
        macros: { midi: { actor: ["findSteedActive"] } },
        unhideActivities: { itemUuid: item.uuid, activityIdentifiers: ["findSteedDismiss"], favorite: true },
        summons: { ids: { [item.name]: [id] }, scenes: { [item.name]: [scene.id] } }
      }
    }
  };
  const data = { ...token.toObject(), _id: id };
  if (foundry.documents?.modifyBatch) {
    await foundry.documents.modifyBatch([
      { action: "create", documentName: "Token", parent: scene, data: [data], keepId: true },
      { action: "create", documentName: "ActiveEffect", parent: actor, data: [effect], keepId: true }
    ]);
  } else {
    const [spawned] = await scene.createEmbeddedDocuments("Token", [data], { keepId: true });
    try {
      await actor.createEmbeddedDocuments("ActiveEffect", [effect], { keepId: true });
    } catch (error) {
      await spawned.delete();
      throw error;
    }
  }
  return true;
}

export async function summonCardSteed(data, { sender }) {
  if (
    !validateCardPayload(data, [
      "sourceTokenUuid",
      "sourceActorUuid",
      "itemCardUuid",
      "x",
      "y",
      "creatureType",
      "language"
    ])
  )
    return false;
  const cast = await resolveCardCaster(data, sender);
  const template = await fromUuid(data.sourceActorUuid);
  if (
    !cast ||
    template?.documentName !== "Actor" ||
    game.actors.get(template.id) !== template ||
    !["find-steed", "findSteed"].includes(
      cast.item.flags?.["chris-premades"]?.info?.identifier ?? cast.item.system.identifier
    )
  )
    return false;
  const confirm = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Призыв скакуна" },
    content: `<p>${escape(sender.name)}: призвать ${escape(template.name)} для ${escape(cast.source.name)} в (${data.x}, ${data.y})?</p>`
  });
  return confirm && placeSteed(template, cast.item, cast.source, data, data.creatureType, data.language);
}

export class Summons {
  static async spawn(template, updates, item, source, { workflow } = {}) {
    const proto = template.prototypeToken;
    const point = await Crosshairs.showCrosshairs(
      {
        actor: source.actor,
        width: proto.width,
        height: proto.height,
        icon: proto.texture?.src ?? template.img,
        elevation: source.document.elevation,
        x: source.center.x,
        y: source.center.y
      },
      { validate: (p) => validCardDestination(source, proto, p, 30) }
    );
    if (point.cancelled) return false;
    const creatureType = updates.actor.system.details.type.value,
      language = updates.actor.system.traits.languages;
    if (game.user.isGM) return placeSteed(template, item, source, point, creatureType, language);
    if (!workflow?.itemCardUuid) return false;
    const { requestCardAuthority } = await import("./sockets.js");
    return requestCardAuthority("summonCardSteed", {
      sourceTokenUuid: source.document.uuid,
      sourceActorUuid: template.uuid,
      itemCardUuid: workflow.itemCardUuid,
      x: point.x,
      y: point.y,
      creatureType,
      language
    });
  }
}

let registered = false;
export function registerSteedLifecycle() {
  if (registered) return;
  registered = true;
  const cleanup = async (effect) => {
    const uuid = effect.flags?.["rebreya-main"]?.[steedKey];
    if (!uuid || game.users.activeGM?.id !== game.user.id) return;
    const steed = await fromUuid(uuid);
    if (steed?.documentName === "Token" && steed.flags?.["rebreya-main"]?.[steedKey] === effect.uuid)
      await steed.delete();
  };
  Hooks.on("deleteActiveEffect", cleanup);
  Hooks.on("updateActiveEffect", (effect, changes) => {
    if (changes.duration?.expired === true) return cleanup(effect);
  });
}
