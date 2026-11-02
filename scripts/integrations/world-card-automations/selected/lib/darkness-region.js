import { escapeFoundryHtml } from "../../../../shared/foundry-values.js";
import { resolveCardCaster } from "./teleport.js";

const scope = "rebreya-main";
const installed = new WeakSet();

function isDarkness(item) {
  return (
    item?.type === "spell" &&
    (item.flags?.["chris-premades"]?.info?.identifier ?? item.system?.identifier) === "darkness"
  );
}

function geometry(region) {
  const { x, y, width, height } = region.bounds ?? {};
  const scene = region.parent;
  const ratio = scene.dimensions?.distancePixels ?? scene.grid.size / scene.grid.distance;
  if (![x, y, width, height, ratio].every(Number.isFinite) || Math.min(width, height, ratio) <= 0) return null;
  return { x: Math.round(x + width / 2), y: Math.round(y + height / 2), dim: Math.max(width, height) / (2 * ratio) };
}

function linkedLight(region) {
  const marker = region.flags?.[scope]?.darkness;
  const light = marker?.lightId && region.parent.lights.get(marker.lightId);
  const proof = light?.flags?.[scope]?.darkness;
  return proof &&
    light.config?.negative === true &&
    region.flags?.dnd5e?.item === marker.originItemUuid &&
    proof.regionUuid === region.uuid &&
    proof.itemCardUuid === marker.itemCardUuid &&
    proof.originItemUuid === marker.originItemUuid
    ? light
    : null;
}

async function resolveCast(data, sender) {
  const cast = await resolveCardCaster(data, sender);
  if (!cast || !isDarkness(cast.item) || cast.item.uuid !== data.originItemUuid) return null;
  const region = await fromUuid(data.regionUuid);
  const regionSource = region?.flags?.dnd5e;
  const activity = cast.message.getAssociatedActivity?.();
  if (
    !activity ||
    region?.documentName !== "Region" ||
    region.parent !== cast.source.document.parent ||
    regionSource?.item !== cast.item.uuid ||
    regionSource?.origin !== cast.source.document.uuid ||
    regionSource?.activity !== activity.uuid ||
    activity.item?.uuid !== cast.item.uuid
  )
    return null;
  const workflow = globalThis.MidiQOL?.Workflow?.getWorkflow?.(data.itemCardUuid);
  const regions = [workflow?.templateUuid, ...(workflow?.templateUuids ?? [])].filter(Boolean);
  if (workflow?.itemCardUuid === data.itemCardUuid && regions.length) {
    if (!regions.includes(region.uuid)) return null;
  } else if (
    region.flags?.[scope]?.darknessItemCard !== data.itemCardUuid &&
    cast.message.flags?.[scope]?.darknessRegion !== region.uuid
  )
    return null;
  return { ...cast, region };
}

export async function requestDarknessRegion(workflow, requestAuthority) {
  const region = workflow?.template;
  const source = workflow?.token?.document;
  if (
    !isDarkness(workflow?.item) ||
    region?.documentName !== "Region" ||
    !source ||
    !workflow.itemCardUuid ||
    ![workflow.templateUuid, ...(workflow.templateUuids ?? [])].includes(region.uuid)
  )
    return false;
  const message = await fromUuid(workflow.itemCardUuid);
  const activity = message?.getAssociatedActivity?.();
  if (
    message?.documentName !== "ChatMessage" ||
    message.author?.id !== game.user.id ||
    !source.actor?.isOwner ||
    message.getAssociatedItem?.()?.uuid !== workflow.item.uuid ||
    message.getAssociatedToken?.()?.uuid !== source.uuid ||
    !activity?.uuid ||
    activity.uuid !== region.flags?.dnd5e?.activity ||
    region.flags?.dnd5e?.item !== workflow.item.uuid ||
    region.flags?.dnd5e?.origin !== source.uuid
  )
    return false;
  const selection = await foundry.applications.api.DialogV2.wait({
    window: { title: "Тьма" },
    content: "<p>Где действует область заклинания?</p>",
    buttons: [
      { action: "stationary", label: "Оставить на месте", default: true },
      { action: "caster", label: "Привязать к заклинателю" }
    ],
    rejectClose: false
  });
  if (!["stationary", "caster"].includes(selection)) return false;
  const previous = message.flags?.[scope]?.darknessRegion;
  if (previous && previous !== region.uuid) return false;
  // A remote GM may not have the player's in-memory MIDI workflow. Bind the player's own confirmed usage card.
  if (!previous && !game.user.isActiveGM && region.flags?.[scope]?.darknessItemCard !== message.uuid) {
    await message.setFlag(scope, "darknessRegion", region.uuid);
  }
  return requestAuthority("configureDarknessRegion", {
    sourceTokenUuid: source.uuid,
    originItemUuid: workflow.item.uuid,
    itemCardUuid: message.uuid,
    regionUuid: region.uuid,
    attach: selection === "caster"
  });
}

export async function configureDarknessRegion(payload, { sender }) {
  const keys = ["sourceTokenUuid", "originItemUuid", "itemCardUuid", "regionUuid", "attach"];
  if (
    !payload ||
    typeof payload !== "object" ||
    Object.keys(payload).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(payload, key)) ||
    typeof payload.attach !== "boolean" ||
    keys.slice(0, 4).some((key) => typeof payload[key] !== "string" || payload[key].length > 300) ||
    !/^Scene\.[a-zA-Z0-9]+\.Region\.[a-zA-Z0-9]+$/.test(payload.regionUuid)
  )
    return false;
  return game.rebreyaMain.worldMutationCoordinator.run(`darkness:${payload.regionUuid}`, async () => {
    let cast = await resolveCast(payload, sender);
    if (!cast || !geometry(cast.region)) return false;
    const prior = cast.region.flags?.[scope]?.darkness;
    if (prior) return prior.itemCardUuid === payload.itemCardUuid && prior.originItemUuid === payload.originItemUuid;
    const requestedLight = cast.item.flags?.["chris-premades"]?.config?.useRealDarkness === true;
    const details = [
      sender.name,
      cast.item.name,
      cast.region.name,
      payload.attach ? "Область следует за токеном" : "Область остаётся на месте",
      requestedLight ? "Создать источник магической темноты" : "Учитывать видимость в бою"
    ]
      .map(escapeFoundryHtml)
      .join(" · ");
    if (
      !(await foundry.applications.api.DialogV2.confirm({
        window: { title: "Ребрея · Тьма" },
        content: `<p>${details}</p>`,
        defaultYes: false,
        rejectClose: false
      }))
    )
      return false;
    cast = await resolveCast(payload, sender);
    if (!cast || (cast.item.flags?.["chris-premades"]?.config?.useRealDarkness === true) !== requestedLight)
      return false;
    const { region, item, source } = cast;
    const area = geometry(region);
    if (!area) return false;
    const marker = {
      originItemUuid: item.uuid,
      itemCardUuid: payload.itemCardUuid,
      lightId: requestedLight ? foundry.utils.randomID() : null
    };
    const visibility = { obscured: true, magicalDarkness: true };
    const cached = item.flags?.dnd5e?.cachedFor;
    const feature = cached && (await fromUuid(cached, { relative: item.actor }))?.item;
    if (
      feature?.actor?.uuid === item.actor.uuid &&
      feature.flags?.["chris-premades"]?.info?.identifier === "eyesOfTheDark"
    )
      visibility.canSeeTokens = [source.document.uuid];
    const update = {
      _id: region.id,
      "flags.rebreya-main.darkness": marker,
      "flags.chris-premades.template": { name: item.name, visibility }
    };
    if (payload.attach) {
      const center = source.document.getCenterPoint();
      update["attachment.token"] = source.document.id;
      update.shapes = region.shapes.map((shape) => {
        const next = shape.clone();
        next.move({ x: shape.origin.x + center.x - area.x, y: shape.origin.y + center.y - area.y });
        return next.toObject();
      });
      area.x = Math.round(center.x);
      area.y = Math.round(center.y);
    }
    const ops = [{ action: "update", documentName: "Region", parent: region.parent, updates: [update] }];
    if (requestedLight) {
      const animation = item.flags?.["chris-premades"]?.config?.darknessAnimation;
      const config = { negative: true, dim: area.dim, bright: 0 };
      if (animation && Object.hasOwn(CONFIG.Canvas.darknessAnimations, animation))
        config.animation = { type: animation };
      ops.push({
        action: "create",
        documentName: "AmbientLight",
        parent: region.parent,
        keepId: true,
        data: [
          {
            _id: marker.lightId,
            x: area.x,
            y: area.y,
            levels: Array.from(region.levels ?? []),
            elevation: source.document.elevation ?? 0,
            config,
            flags: {
              "midi-qol": { regionLight: region.uuid },
              [scope]: {
                darkness: { regionUuid: region.uuid, itemCardUuid: marker.itemCardUuid, originItemUuid: item.uuid }
              }
            }
          }
        ]
      });
    }
    await foundry.documents.modifyBatch(ops);
    return true;
  });
}

function seesThrough(token, visibility, distance) {
  if (visibility.canSeeTokens?.includes(token.document.uuid)) return true;
  const senses = token.actor?.system?.attributes?.senses;
  const ranges = senses?.ranges ?? senses ?? {};
  const grants = [
    token.actor?.flags?.["chris-premades"]?.senses?.magicalDarkness,
    ranges.tremorsense,
    ranges.blindsight,
    ranges.truesight
  ];
  return grants.some((range) => Number(range) > 0 && Number(range) >= distance);
}

function applyObscuration(workflow) {
  const source = workflow?.token;
  if (!source || !workflow.activity?.attack || workflow.targets?.size !== 1 || !workflow.tracker) return;
  const [target] = workflow.targets;
  if (!target?.document || source.document.parent !== target.document.parent) return;
  const start = { ...source.center, elevation: source.document.elevation ?? 0 };
  const end = { ...target.center, elevation: target.document.elevation ?? 0 };
  for (const region of source.document.parent.regions.values()) {
    const visibility = region.flags?.["chris-premades"]?.template?.visibility;
    if (!region.flags?.[scope]?.darkness || !visibility?.obscured) continue;
    const level = source.document._source?.level;
    if (level && region.levels?.size && !region.levels.has(level)) continue;
    if (
      !region.testPoint(start) &&
      !region.testPoint(end) &&
      !region.segmentizeMovementPath([start, end], [{ x: 0, y: 0 }]).length
    )
      continue;
    const distance = globalThis.MidiQOL.computeDistance(source, target, { wallsBlock: false });
    if (!Number.isFinite(distance) || distance < 0) continue;
    if (!seesThrough(target, visibility, distance))
      workflow.tracker.advantage.add(region.uuid, "Цель не видит атакующего в магической тьме");
    if (!seesThrough(source, visibility, distance)) {
      workflow.flankingAdvantage = false;
      workflow.tracker.disadvantage.add(region.uuid, "Атакующий не видит цель в магической тьме");
    }
  }
}

export function registerDarknessRegionHooks({ Hooks, game }) {
  if (installed.has(Hooks)) return;
  installed.add(Hooks);
  Hooks.on("preCreateRegion", (region) => {
    const origin = region.flags?.dnd5e;
    if (!origin?.activity) return;
    const workflow = globalThis.MidiQOL?.Workflow?.getWorkflow?.(origin.activity);
    if (
      workflow?.itemCardUuid &&
      isDarkness(workflow.item) &&
      workflow.item.uuid === origin.item &&
      workflow.token?.document?.uuid === origin.origin
    ) {
      region.updateSource({ "flags.rebreya-main.darknessItemCard": workflow.itemCardUuid });
    }
  });
  Hooks.on("midi-qol.preAttackRollConfig", applyObscuration);
  Hooks.on("updateRegion", async (region, changes) => {
    if (
      game.user.id !== game.users.activeGM?.id ||
      !["shapes", "elevation", "levels", "hidden", "restriction", "_shapeConstraints"].some((key) => key in changes)
    )
      return;
    const light = linkedLight(region);
    const area = light && geometry(region);
    if (area)
      await light.update({
        x: area.x,
        y: area.y,
        "config.dim": area.dim,
        levels: Array.from(region.levels ?? []),
        hidden: region.hidden === true,
        ...(Number.isFinite(region.elevation?.bottom) ? { elevation: region.elevation.bottom } : {})
      });
  });
  Hooks.on("deleteRegion", async (region) => {
    if (game.user.id === game.users.activeGM?.id) await linkedLight(region)?.delete();
  });
}
