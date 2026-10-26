import { MODULE_ID } from "../constants.js";
import { getAlchemyInventoryEntries } from "../data/alchemy-tracker.js?v=1.5.14";
import { getActiveAlchemyReagentEffects } from "../data/alchemy-reagent-service.js?v=1.5.14";
import { AnchoredOverlay } from "../ui/anchored-overlay.js?v=1.4.392";

const LABELS = { healing: "Лечебные зелья", utility: "Алхимические расходники", reagents: "Действующие зелья" };
let nextId = 0;

function values(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  return typeof collection?.values === "function" ? Array.from(collection.values()) : [];
}

function appendText(parent, tag, className, text) {
  const node = parent.ownerDocument.createElement(tag);
  node.className = className;
  node.textContent = String(text);
  parent.append(node);
  return node;
}

function remainingTime(seconds) {
  let remaining = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const secondsPart = remaining % 60;
  return [hours && `${hours} ч`, minutes && `${minutes} мин`, secondsPart && `${secondsPart} с`]
    .filter(Boolean).join(" ") || "0 с";
}

function trackerSettings(actor, kind) {
  const trackers = actor?.getFlag?.(MODULE_ID, "potionTrackers") ?? actor?.flags?.[MODULE_ID]?.potionTrackers ?? {};
  return trackers[kind] ?? {};
}

function wholeNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function buildContent(doc, actor, kind, state) {
  const content = doc.createElement("div");
  content.className = "rm-potion-popover";
  content.id = `rm-potion-popover-${++nextId}`;
  content.setAttribute("role", "region");
  content.setAttribute("aria-label", LABELS[kind]);
  content.setAttribute("tabindex", "0");
  appendText(content, "strong", "rm-potion-popover__heading", `${LABELS[kind]} · ${state.value}/${state.max}`);
  const saved = trackerSettings(actor, kind);
  if (kind === "reagents" && wholeNumber(saved.value) > 0) {
    appendText(content, "p", "rm-potion-popover__note", `Ручная база: ${Math.max(0, wholeNumber(saved.value))}`);
  }
  else if (kind !== "reagents" && saved.mode === "manual") {
    appendText(content, "p", "rm-potion-popover__note", `Ручной итог: ${state.value}. Ниже — фактические запасы.`);
  }
  else if (kind !== "reagents" && wholeNumber(saved.adjustment)) {
    const adjustment = wholeNumber(saved.adjustment);
    appendText(content, "p", "rm-potion-popover__note", `Корректировка: ${adjustment > 0 ? "+" : ""}${adjustment}`);
  }

  const descriptions = [];
  if (kind === "reagents") {
    const now = Number(globalThis.game?.time?.worldTime ?? 0);
    const effects = getActiveAlchemyReagentEffects(actor, now);
    if (!effects.length) appendText(content, "p", "rm-potion-popover__empty", "Действующих зелий нет.");
    for (const effect of effects) {
      const data = effect.flags[MODULE_ID].alchemyReagent;
      const row = doc.createElement("div");
      row.className = "rm-potion-popover__row";
      appendText(row, "strong", "rm-potion-popover__name", effect.name ?? "Зелье");
      appendText(row, "span", "rm-potion-popover__detail", `Реагенты: ${data.level} · Осталось: ${remainingTime(data.expiresAt - now)}`);
      const description = appendText(row, "p", "rm-potion-popover__description", "");
      descriptions.push({ node: description, productId: data.productId });
      content.append(row);
    }
  }
  else {
    const grouped = new Map();
    for (const entry of getAlchemyInventoryEntries(values(actor?.items)).filter(entry => entry.kind === kind)) {
      const key = JSON.stringify([entry.productId, entry.rank, entry.name]);
      const group = grouped.get(key);
      if (group) group.quantity += entry.quantity;
      else grouped.set(key, { ...entry });
    }
    if (!grouped.size) appendText(content, "p", "rm-potion-popover__empty", "Запасов нет.");
    for (const entry of grouped.values()) {
      const row = doc.createElement("div");
      row.className = "rm-potion-popover__row";
      appendText(row, "strong", "rm-potion-popover__name", entry.name);
      appendText(row, "span", "rm-potion-popover__detail", `Ранг ${entry.rank} · ${entry.quantity} шт. · ${entry.rank * entry.quantity} ур.`);
      content.append(row);
    }
  }
  return { content, descriptions };
}

export function bindPotionTrackerPopover(root, { actor, moduleApi, getState }) {
  const doc = root?.ownerDocument;
  if (!doc?.defaultView || !root?.addEventListener || typeof getState !== "function") return null;
  let anchor = null;
  let previousDescription = null;
  let timer = null;
  let anchorHovered = false;
  let panelHovered = false;
  let anchorFocused = false;
  let panelFocused = false;
  const controller = new doc.defaultView.AbortController();
  const overlay = new AnchoredOverlay({ ownerElement: root, resolveAnchor: () => anchor, onClose: () => {
    if (anchor) {
      if (previousDescription === null) anchor.removeAttribute("aria-describedby");
      else anchor.setAttribute("aria-describedby", previousDescription);
    }
    clearTimeout(timer);
    timer = null;
    anchor = null;
    anchorHovered = panelHovered = anchorFocused = panelFocused = false;
  } });
  const options = { signal: controller.signal };
  const cancelClose = () => { clearTimeout(timer); timer = null; };
  const closeSoon = () => {
    cancelClose();
    timer = setTimeout(() => {
      if (!anchorHovered && !panelHovered && !anchorFocused && !panelFocused) overlay.close();
    }, 150);
  };
  const findButton = (target) => {
    const button = target?.closest?.("[data-action='rebreya-potion-tracker-edit']");
    if (!button || !root.contains(button)) return null;
    const kind = button.closest("[data-potion-tracker]")?.dataset?.potionTracker;
    return Object.hasOwn(LABELS, kind) ? { button, kind } : null;
  };
  const show = ({ button, kind }) => {
    cancelClose();
    if (anchor === button && overlay.element) return;
    overlay.close();
    anchor = button;
    previousDescription = button.getAttribute("aria-describedby");
    const { content, descriptions } = buildContent(doc, actor, kind, getState(actor, kind));
    button.setAttribute("aria-describedby", [previousDescription, content.id].filter(Boolean).join(" "));
    overlay.show(content);
    if (!overlay.element) {
      if (previousDescription === null) button.removeAttribute("aria-describedby");
      else button.setAttribute("aria-describedby", previousDescription);
      anchor = null;
      return;
    }
    const panel = overlay.element;
    panel.addEventListener("pointerenter", () => { panelHovered = true; cancelClose(); });
    panel.addEventListener("pointerleave", () => { panelHovered = false; closeSoon(); });
    panel.addEventListener("focusin", () => { panelFocused = true; cancelClose(); });
    panel.addEventListener("focusout", (event) => {
      panelFocused = panel.contains(event.relatedTarget);
      closeSoon();
    });
    if (descriptions.length && typeof moduleApi?.getModel === "function") {
      Promise.resolve().then(() => moduleApi.getModel()).then((model) => {
        if (anchor !== button || overlay.content !== content || !button.isConnected) return;
        for (const { node, productId } of descriptions) {
          node.textContent = String(model?.alchemyProductById?.get?.(productId)?.effect ?? "");
        }
        overlay.reposition();
      }).catch(() => {});
    }
  };
  root.addEventListener("pointerover", (event) => {
    const target = findButton(event.target);
    if (!target || target.button.contains(event.relatedTarget)) return;
    show(target);
    anchorHovered = true;
  }, options);
  root.addEventListener("pointerout", (event) => {
    if (!anchor?.contains(event.target) || anchor.contains(event.relatedTarget)) return;
    anchorHovered = false;
    if (overlay.element?.contains(event.relatedTarget)) panelHovered = true;
    closeSoon();
  }, options);
  root.addEventListener("focusin", (event) => {
    const target = findButton(event.target);
    if (!target || (anchor === target.button && !overlay.element)) return;
    show(target);
    anchorFocused = true;
  }, options);
  root.addEventListener("focusout", (event) => {
    if (!anchor?.contains(event.target)) return;
    anchorFocused = false;
    if (overlay.element?.contains(event.relatedTarget)) panelFocused = true;
    closeSoon();
  }, options);
  root.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    const target = findButton(event.target);
    if (!target) return;
    if (anchor !== target.button || !overlay.content) show(target);
    if (!overlay.content) return;
    event.preventDefault();
    panelFocused = true;
    overlay.content.focus({ preventScroll: true });
  }, options);
  root.addEventListener("click", (event) => { if (anchor?.contains(event.target)) overlay.close(); }, { ...options, capture: true });
  return { destroy() { controller.abort(); cancelClose(); overlay.destroy(); } };
}
