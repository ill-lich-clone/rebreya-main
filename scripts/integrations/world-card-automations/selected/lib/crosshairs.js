// Adapt the selected cards' point picker to Foundry's transient token placement.
export class Crosshairs {
  static async showCrosshairs(config = {}, callbacks = {}) {
    const { grid, scene, tokens } = canvas;
    const actor =
      config.actor ?? tokens.controlled?.[0]?.actor ?? game.user.character ?? game.actors.find?.((a) => a.isOwner);
    if (!scene || (!actor && !game.user.isGM)) return { cancelled: true };
    const size = config.width ?? Math.max(0.25, ((config.size ?? grid.distance / 2) * 2) / grid.distance);
    const data = {
      actorId: actor?.id,
      width: size,
      height: config.height ?? size,
      texture: { src: config.icon ?? "icons/svg/target.svg" },
      name: config.label ?? "",
      sight: { enabled: false },
      displayName: globalThis.CONST?.TOKEN_DISPLAY_MODES?.ALWAYS,
      rotation: config.direction ?? 0,
      elevation: config.elevation ?? 0,
      level: canvas.level?.id
    };
    const cursor = { x: config.x ?? 0, y: config.y ?? 0, inFlight: true, draw() {} };
    const point = (doc) =>
      doc.getCenterPoint?.() ?? { x: doc.x + (data.width * grid.size) / 2, y: doc.y + (data.height * grid.size) / 2 };
    let tracking;
    let started = false;
    const change = ({ document, preview }) => {
      Object.assign(cursor, point(document));
      if (!started) {
        started = true;
        tracking = callbacks.show?.(cursor);
      }
      if (preview?.tooltip && cursor.label) preview.tooltip.text = cursor.label;
    };
    try {
      let placed;
      if (tokens.placeTokens) {
        [placed] = await tokens.placeTokens([data], {
          create: false,
          allowRotation: true,
          onChange: change,
          preConfirm: ({ document }) => !callbacks.validate || callbacks.validate(point(document))
        });
      } else {
        const placement = game.dnd5e?.canvas?.TokenPlacement;
        if (!actor || !placement?.place) return { cancelled: true };
        const track = (event) => {
          const center = event.data?.getLocalPosition?.(canvas.stage) ?? event.getLocalPosition?.(canvas.stage);
          if (center) change({ document: { getCenterPoint: () => center } });
        };
        canvas.stage.on("mousemove", track);
        try {
          [placed] = await placement.place({
            tokens: [{ parent: actor, toObject: () => data }],
            origin: { elevation: data.elevation }
          });
        } finally {
          canvas.stage.off("mousemove", track);
        }
      }
      if (!placed) return { cancelled: true };
      const center = point(placed);
      if (callbacks.validate && !callbacks.validate(center)) return { cancelled: true };
      return { ...center, direction: placed.rotation ?? data.rotation, cancelled: false };
    } finally {
      cursor.inFlight = false;
      await tracking;
    }
  }
}

export function validCardDestination(source, target, center, range, ignoreTokenId) {
  const { grid, scene } = canvas;
  if (![center?.x, center?.y, range].every(Number.isFinite) || range < 0 || source.document.parent !== scene)
    return false;
  const distance = grid.measurePath([source.center, center]).distance;
  if (
    !Number.isFinite(distance) ||
    distance > range ||
    source.checkCollision?.(center, { origin: source.center, type: "sight", mode: "any" })
  )
    return false;
  const w = target.width * grid.size,
    h = target.height * grid.size;
  const x = center.x - w / 2,
    y = center.y - h / 2;
  const rect = scene.dimensions.sceneRect;
  if (!rect.contains(x, y) || !rect.contains(x + w - 0.01, y + h - 0.01)) return false;
  return !Array.from(scene.tokens.values()).some(
    (token) =>
      token.id !== ignoreTokenId &&
      Number(token.elevation ?? 0) === Number(source.document.elevation ?? 0) &&
      x < token.x + token.width * grid.size &&
      x + w > token.x &&
      y < token.y + token.height * grid.size &&
      y + h > token.y
  );
}
