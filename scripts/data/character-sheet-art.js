const MODULE_ID = "rebreya-main";
export const SHEET_ART_FLAG = "sheetArt";

function bounded(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Document data, never HTML, CSS, or arbitrary SVG supplied by the user. */
export function normalizeSheetArt(value = {}) {
  const source = typeof value?.src === "string" ? value.src.trim() : "";
  const src = source.length <= 2048 && !/[<>"'\\\x00-\x1f]/u.test(source)
    && !source.startsWith("//") && (!source.includes(":") || /^https?:\/\//iu.test(source)) ? source : "";
  return {
    version: 1, enabled: value?.enabled === true && !!src, src,
    x: bounded(value?.x, 0, -1, 1), y: bounded(value?.y, 0, -1, 1),
    scale: bounded(value?.scale, 1, 0.1, 3), aspect: bounded(value?.aspect, 1, 0.1, 10),
    frameAspect: bounded(value?.frameAspect, 1, 0.1, 10),
    opacity: bounded(value?.opacity, 1, 0.05, 1),
    strokes: (Array.isArray(value?.strokes) ? value.strokes : []).slice(0, 200).map(stroke => ({
      erase: stroke?.erase === true,
      radius: bounded(stroke?.radius, 0.04, 0.002, 0.25),
      points: (Array.isArray(stroke?.points) ? stroke.points : []).slice(0, 300)
        .filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(p => [bounded(p[0], 0, 0, 1), bounded(p[1], 0, 0, 1)])
    })).filter(stroke => stroke.points.length)
  };
}

export function sheetArtGeometry(art, width, height) {
  const imageWidth = width * art.scale;
  const imageHeight = height * art.scale * art.frameAspect / art.aspect;
  return { x: (width - imageWidth) / 2 + art.x * width,
    y: (height - imageHeight) / 2 + art.y * height, width: imageWidth, height: imageHeight };
}

export function sheetArtBounds(width, height) {
  return { x: -width * 0.1, y: -height * 0.1,
    width: width + width / 10 - Math.min(64, width * 0.2), height: height * 1.2 };
}

export async function saveSheetArt(actor, value) {
  if (actor?.type !== "character" || !actor?.isOwner) throw new Error("Изменять оформление может только владелец персонажа.");
  const art = normalizeSheetArt(value);
  await actor.setFlag(MODULE_ID, SHEET_ART_FLAG, art);
  return art;
}
