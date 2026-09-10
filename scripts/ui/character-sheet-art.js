import { normalizeSheetArt, sheetArtGeometry, sheetArtBounds, saveSheetArt, SHEET_ART_FLAG } from "../data/character-sheet-art.js";

const NS = "http://www.w3.org/2000/svg";
let nextMaskId = 0;
const bindings = new WeakMap();
const editors = new WeakMap();

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** One image. The mask keeps its interior and reveals only painted exterior regions. */
export function createSheetArtSvg(art, width, height, { editing = false, showMask = false } = {}) {
  const box = sheetArtGeometry(art, width, height);
  const bounds = sheetArtBounds(width, height);
  const svg = svgNode("svg", { viewBox: editing ? `${-width * 0.15} ${-height * 0.15} ${width * 1.3} ${height * 1.3}` : `0 0 ${width} ${height}`,
    "aria-hidden": "true", preserveAspectRatio: "none" });
  const id = `rm-sheet-art-mask-${++nextMaskId}`;
  const defs = svgNode("defs");
  const clipId = `${id}-bounds`;
  const clip = svgNode("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" });
  clip.append(svgNode("rect", bounds)); defs.append(clip);
  const mask = svgNode("mask", { id, maskUnits: "userSpaceOnUse", x: box.x, y: box.y,
    width: box.width, height: box.height, "mask-type": "luminance" });
  for (const stroke of art.strokes) {
    // Transform the entire brush footprint with the image, including nonuniform resize.
    const transform = `translate(${box.x} ${box.y}) scale(${box.width} ${box.height * art.aspect})`;
    const points = stroke.points.map(([x, y]) => [x, y / art.aspect]);
    if (points.length === 1) mask.append(svgNode("circle", { cx: points[0][0], cy: points[0][1],
      r: stroke.radius, transform, fill: stroke.erase ? "black" : "white" }));
    else mask.append(svgNode("path", { d: points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" "),
      fill: "none", transform, stroke: stroke.erase ? "black" : "white", "stroke-width": stroke.radius * 2,
      "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }
  // The eraser changes exterior permission only; the interior always remains visible.
  mask.append(svgNode("rect", { x: 0, y: 0, width, height, fill: "white" }));
  defs.append(mask); svg.append(defs);
  if (editing) svg.append(svgNode("rect", { width, height, fill: "#20242c", stroke: "#b39b6d", "stroke-width": 2 }));
  if (art.src) {
    const attrs = { href: art.src, x: box.x, y: box.y, width: box.width, height: box.height, preserveAspectRatio: "none" };
    if (editing && showMask) svg.append(svgNode("image", { ...attrs, opacity: 0.2 }));
    const boundedImage = svgNode("g", { "clip-path": `url(#${clipId})` });
    boundedImage.append(svgNode("image", { ...attrs, opacity: art.opacity, mask: `url(#${id})` }));
    svg.append(boundedImage);
  }
  if (editing) {
    svg.append(svgNode("rect", { ...bounds, fill: "none", stroke: "#678880", "stroke-width": 2, "stroke-dasharray": "4 5" }));
    svg.append(svgNode("rect", { width, height, fill: "none", stroke: "#e9c789", "stroke-width": 2, "stroke-dasharray": "8 5" }));
    svg.append(svgNode("rect", { x: bounds.x + bounds.width, y: 0, width: width - bounds.x - bounds.width, height,
      fill: "#c25f5f", opacity: 0.18 }));
  }
  return svg;
}

export function bindCharacterSheetArt(root, actor) {
  if (!root?.classList || !root?.querySelector) return;
  bindings.get(root)?.disconnect();
  bindings.delete(root);
  root.querySelector(":scope > .rm-sheet-art")?.remove();
  root.classList.remove("rm-sheet-art-enabled");
  const art = normalizeSheetArt(actor?.getFlag?.("rebreya-main", SHEET_ART_FLAG));
  if (!art.enabled || actor?.type !== "character") return;
  const host = document.createElement("div");
  host.className = "rm-sheet-art"; host.setAttribute("aria-hidden", "true");
  root.append(host); root.classList.add("rm-sheet-art-enabled");
  const redraw = () => {
    if (!root.isConnected) { unbindCharacterSheetArt(root); return; }
    if (root.classList.contains("minimized")) return;
    const width = root.clientWidth, height = root.clientHeight;
    if (width && height) host.replaceChildren(createSheetArtSvg(art, width, height));
  };
  const observer = new ResizeObserver(redraw);
  observer.observe(root); bindings.set(root, observer); redraw();
}

export function unbindCharacterSheetArt(root) {
  bindings.get(root)?.disconnect(); bindings.delete(root);
}

export async function openCharacterSheetArtEditor(actor, sheet) {
  if (!actor?.isOwner) return;
  const existing = editors.get(actor);
  if (existing) { existing.bringToFront(); return existing; }
  let draft = normalizeSheetArt(actor.getFlag("rebreya-main", SHEET_ART_FLAG));
  const width = sheet?.element?.clientWidth || 800;
  const height = sheet?.element?.clientHeight || 800;
  if (!draft.src) draft.frameAspect = width / height;
  let root, stage, drag = null, loadId = 0, loadedSrc = "", loading = false;
  const content = `<div class="rm-art-editor">
    <p>Кисть разрешает выступы за золотую границу. Предел — 10% сверху, снизу и слева (до 120% высоты). Справа — свободная полоса для кнопок.</p>
    <label class="rm-art-path">Изображение <input type="text" name="src" placeholder="Путь или URL изображения"><button type="button" data-art="browse" title="Выбрать изображение"><i class="fa-solid fa-folder-open"></i></button></label>
    <div class="rm-art-tools"><label><input type="checkbox" name="enabled"> Включено</label>
      <label>Режим <select name="mode"><option value="move">Перемещение</option><option value="paint">Кисть выступов</option><option value="erase">Ластик выступов</option></select></label>
      <label>Кисть <input type="range" name="brush" min="1" max="25" value="5"></label></div>
    <div class="rm-art-stage" tabindex="0" aria-label="Предпросмотр оформления: перетащите картинку или нарисуйте маску"></div>
    <div class="rm-art-sliders"><label>Масштаб <input type="range" name="scale" min="10" max="300"></label>
      <label>По горизонтали <input type="range" name="x" min="-100" max="100"></label>
      <label>По вертикали <input type="range" name="y" min="-100" max="100"></label>
      <label>Непрозрачность <input type="range" name="opacity" min="5" max="100"></label></div>
    <div class="rm-art-tools"><button type="button" data-art="center">По центру</button><button type="button" data-art="undo">Отменить мазок</button><button type="button" data-art="clear">Очистить выступы</button><label><input type="checkbox" name="guide" checked> Показывать скрытые части</label></div>
    <p class="rm-art-status" role="status"></p>
  </div>`;
  const field = name => root.querySelector(`[name="${name}"]`);
  const status = text => { root.querySelector(".rm-art-status").textContent = text; };
  const redraw = () => {
    stage.replaceChildren(createSheetArtSvg(draft, width, height, { editing: true, showMask: field("guide").checked }));
    stage.dataset.mode = field("mode").value;
    for (const name of ["scale", "x", "y", "opacity"]) field(name).value = Math.round(draft[name] * 100);
  };
  const loadImage = async (src, { enable = true } = {}) => {
    const request = ++loadId;
    const normalized = normalizeSheetArt({ src });
    loading = true; loadedSrc = ""; status("Загрузка изображения…");
    if (!normalized.src) { loading = false; status("Укажите корректный путь к изображению."); return; }
    try {
      const image = new Image(); image.src = normalized.src; await image.decode();
      if (request !== loadId || !root.isConnected) return;
      if (draft.src !== normalized.src) draft.strokes = [];
      draft.src = normalized.src; draft.aspect = image.naturalWidth / image.naturalHeight;
      if (enable) { draft.enabled = true; field("enabled").checked = true; }
      loadedSrc = normalized.src; loading = false; status("Изображение загружено. Маска сохраняется вместе с оформлением."); redraw();
    } catch { if (request === loadId) { loading = false; status("Не удалось загрузить картинку. Проверьте путь и доступ к файлу."); } }
  };
  const dialog = new foundry.applications.api.DialogV2({
    window: { title: `${actor.name} — Оформление чарника`, resizable: true },
    position: { width: 720 }, classes: ["rm-art-dialog"], content,
    buttons: [{ action: "save", label: "Сохранить", icon: "fa-solid fa-check", callback: async () => {
      if (loading || (field("enabled").checked && loadedSrc !== field("src").value.trim())) {
        throw new Error("Дождитесь загрузки выбранного изображения.");
      }
      draft.enabled = field("enabled").checked;
      await saveSheetArt(actor, draft);
    } }, { action: "cancel", label: "Отмена" }],
    submit: () => {},
  });
  dialog.addEventListener("render", () => {
    root = dialog.element; stage = root.querySelector(".rm-art-stage");
    if (stage.dataset.bound) return; stage.dataset.bound = "true";
    stage.style.aspectRatio = `${width} / ${height}`;
    field("src").value = draft.src; field("enabled").checked = draft.enabled;
    field("src").addEventListener("change", () => loadImage(field("src").value));
    for (const name of ["scale", "x", "y", "opacity"]) field(name).addEventListener("input", () => { draft[name] = Number(field(name).value) / 100; redraw(); });
    for (const name of ["mode", "guide"]) field(name).addEventListener("change", redraw);
    root.querySelector('[data-art="browse"]').addEventListener("click", () => {
      new foundry.applications.apps.FilePicker.implementation({ type: "image", current: draft.src,
        callback: path => { field("src").value = path; loadImage(path); } }).render(true);
    });
    root.querySelector('[data-art="center"]').addEventListener("click", () => { draft.x = 0; draft.y = 0; redraw(); });
    root.querySelector('[data-art="undo"]').addEventListener("click", () => { draft.strokes.pop(); redraw(); });
    root.querySelector('[data-art="clear"]').addEventListener("click", () => { draft.strokes = []; redraw(); });
    const point = event => { const rect = stage.getBoundingClientRect(); return {
      x: (event.clientX - rect.left) / rect.width * width * 1.3 - width * 0.15,
      y: (event.clientY - rect.top) / rect.height * height * 1.3 - height * 0.15 }; };
    const paint = p => {
      const box = sheetArtGeometry(draft, width, height);
      const x = (p.x - box.x) / box.width, y = (p.y - box.y) / box.height;
      if (x < 0 || x > 1 || y < 0 || y > 1 || drag.stroke.points.length >= 300) return;
      drag.stroke.points.push([Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
    };
    stage.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !loadedSrc) return;
      event.preventDefault(); stage.setPointerCapture(event.pointerId);
      const p = point(event); const mode = field("mode").value;
      drag = { p, x: draft.x, y: draft.y, mode };
      if (mode !== "move") {
        if (draft.strokes.length >= 200) { drag = null; status("Достигнут лимит маски. Отмените лишние мазки."); return; }
        drag.stroke = { erase: mode === "erase", radius: Number(field("brush").value) / 100, points: [] };
        draft.strokes.push(drag.stroke); paint(p); redraw();
      }
    });
    stage.addEventListener("pointermove", event => {
      if (!drag) return; const p = point(event);
      if (drag.mode === "move") {
        draft.x = Math.max(-1, Math.min(1, drag.x + (p.x - drag.p.x) / width));
        draft.y = Math.max(-1, Math.min(1, drag.y + (p.y - drag.p.y) / height));
      } else paint(p);
      redraw();
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) stage.addEventListener(event, () => { drag = null; });
    redraw(); if (draft.src) loadImage(draft.src, { enable: false });
  });
  dialog.addEventListener("close", () => { ++loadId; editors.delete(actor); });
  editors.set(actor, dialog);
  try { await dialog.render({ force: true }); } catch (error) { editors.delete(actor); throw error; }
  return dialog;
}
