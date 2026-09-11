import { normalizeSheetArt, sheetArtGeometry, sheetArtPreview, saveSheetArt, SHEET_ART_FLAG } from "../data/character-sheet-art.js?v=1.4.285";

const NS = "http://www.w3.org/2000/svg";
let nextMaskId = 0;
const bindings = new WeakMap();
const editors = new WeakMap();

function svgNode(name, attributes = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** Exterior is always visible; brush and eraser control entry into the sheet. */
export function createSheetArtSvg(art, width, height, { editing = false, showMask = false, view = {} } = {}) {
  const box = sheetArtGeometry(art, width, height);
  const viewport = sheetArtPreview(width, height, view);
  const svg = svgNode("svg", { viewBox: editing ? `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}` : `0 0 ${width} ${height}`,
    "aria-hidden": "true", preserveAspectRatio: "none" });
  const id = `rm-sheet-art-mask-${++nextMaskId}`;
  const defs = svgNode("defs");
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
  // Union with the exterior AFTER painting: erasing can never hide outside artwork.
  mask.append(svgNode("path", { fill: "white", "fill-rule": "evenodd",
    d: `M${box.x} ${box.y}h${box.width}v${box.height}h${-box.width}Z M0 0h${width}v${height}h${-width}Z` }));
  defs.append(mask); svg.append(defs);
  if (editing) svg.append(svgNode("rect", { width, height, fill: "#20242c", stroke: "#b39b6d", "stroke-width": 2 }));
  if (art.src) {
    const attrs = { href: art.src, x: box.x, y: box.y, width: box.width, height: box.height, preserveAspectRatio: "none" };
    if (editing && showMask) svg.append(svgNode("image", { ...attrs, opacity: 0.2 }));
    svg.append(svgNode("image", { ...attrs, opacity: art.opacity, mask: `url(#${id})` }));
  }
  if (editing) {
    svg.append(svgNode("rect", { width, height, fill: "none", stroke: "#e9c789", "stroke-width": 2, "stroke-dasharray": "8 5" }));
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
  const view = { zoom: 1, panX: 0, panY: 0 };
  const content = `<div class="rm-art-editor">
    <p>Снаружи картинка видна без ограничений. Кистью разрешите ей заходить внутрь золотой границы чарника. Ластик скрывает нарисованные участки внутри.</p>
    <label class="rm-art-path">Изображение <input type="text" name="src" placeholder="Путь или URL изображения"><button type="button" data-art="browse" title="Выбрать изображение"><i class="fa-solid fa-folder-open"></i></button></label>
    <div class="rm-art-tools"><label><input type="checkbox" name="enabled"> Включено</label>
      <label>Режим <select name="mode"><option value="move">Перемещение картинки</option><option value="paint">Кисть внутри чарника</option><option value="erase">Ластик внутри чарника</option><option value="pan">Перемещение вида</option></select></label>
      <label>Кисть <input type="range" name="brush" min="0.2" step="0.2" max="25" value="5"></label></div>
    <div class="rm-art-tools"><label>Приближение вида <input type="range" name="zoom" min="20" max="400" value="100"><output name="zoomLabel">100%</output></label><button type="button" data-art="resetView">Сбросить вид</button></div>
    <p>Колесо мыши — приблизить под курсором. Shift + перетаскивание — переместить вид. Это не меняет размер картинки на чарнике.</p>
    <div class="rm-art-stage" tabindex="0" aria-label="Предпросмотр оформления: перетащите картинку или нарисуйте маску"></div>
    <div class="rm-art-sliders"><label>Масштаб <input type="range" name="scale" min="10" max="300"></label>
      <label>По горизонтали <input type="range" name="x" min="-100" max="100"></label>
      <label>По вертикали <input type="range" name="y" min="-100" max="100"></label>
      <label>Непрозрачность <input type="range" name="opacity" min="5" max="100"></label></div>
    <div class="rm-art-tools"><button type="button" data-art="center">По центру</button><button type="button" data-art="undo">Отменить мазок</button><button type="button" data-art="clear">Очистить маску внутри</button><label><input type="checkbox" name="guide" checked> Показывать скрытые части</label></div>
    <p class="rm-art-status" role="status"></p>
  </div>`;
  const field = name => root.querySelector(`[name="${name}"]`);
  const status = text => { root.querySelector(".rm-art-status").textContent = text; };
  const redraw = () => {
    stage.replaceChildren(createSheetArtSvg(draft, width, height, { editing: true, showMask: field("guide").checked, view }));
    stage.dataset.mode = field("mode").value;
    field("zoom").value = view.zoom * 100;
    field("zoomLabel").textContent = `${Math.round(view.zoom * 100)}%`;
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
    field("zoom").addEventListener("input", () => { view.zoom = Number(field("zoom").value) / 100; redraw(); });
    root.querySelector('[data-art="resetView"]').addEventListener("click", () => { Object.assign(view, { zoom: 1, panX: 0, panY: 0 }); redraw(); });
    root.querySelector('[data-art="browse"]').addEventListener("click", () => {
      new foundry.applications.apps.FilePicker.implementation({ type: "image", current: draft.src,
        callback: path => { field("src").value = path; loadImage(path); } }).render(true);
    });
    root.querySelector('[data-art="center"]').addEventListener("click", () => { draft.x = 0; draft.y = 0; redraw(); });
    root.querySelector('[data-art="undo"]').addEventListener("click", () => { draft.strokes.pop(); redraw(); });
    root.querySelector('[data-art="clear"]').addEventListener("click", () => { draft.strokes = []; redraw(); });
    const point = event => { const rect = stage.getBoundingClientRect(); const area = sheetArtPreview(width, height, view); return {
      x: (event.clientX - rect.left) / rect.width * area.width + area.x,
      y: (event.clientY - rect.top) / rect.height * area.height + area.y }; };
    stage.addEventListener("wheel", event => {
      event.preventDefault(); if (drag) return;
      const before = point(event);
      view.zoom = Math.max(0.2, Math.min(4, view.zoom * Math.exp(-event.deltaY * 0.0015)));
      const after = point(event); view.panX += before.x - after.x; view.panY += before.y - after.y; redraw();
    }, { passive: false });
    const paint = p => {
      const box = sheetArtGeometry(draft, width, height);
      const x = (p.x - box.x) / box.width, y = (p.y - box.y) / box.height;
      if (x < 0 || x > 1 || y < 0 || y > 1 || drag.stroke.points.length >= 300) return;
      drag.stroke.points.push([Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
    };
    stage.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const mode = event.shiftKey ? "pan" : field("mode").value;
      if (!loadedSrc && mode !== "pan") return;
      event.preventDefault(); stage.setPointerCapture(event.pointerId);
      const p = point(event);
      drag = { p, x: draft.x, y: draft.y, mode, clientX: event.clientX, clientY: event.clientY,
        panX: view.panX, panY: view.panY, area: sheetArtPreview(width, height, view) };
      if (mode === "paint" || mode === "erase") {
        if (draft.strokes.length >= 200) { drag = null; status("Достигнут лимит маски. Отмените лишние мазки."); return; }
        drag.stroke = { erase: mode === "erase", radius: Number(field("brush").value) / 100, points: [] };
        draft.strokes.push(drag.stroke); paint(p); redraw();
      }
    });
    stage.addEventListener("pointermove", event => {
      if (!drag) return; const p = point(event);
      if (drag.mode === "pan") {
        const rect = stage.getBoundingClientRect();
        view.panX = drag.panX - (event.clientX - drag.clientX) / rect.width * drag.area.width;
        view.panY = drag.panY - (event.clientY - drag.clientY) / rect.height * drag.area.height;
      } else if (drag.mode === "move") {
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
