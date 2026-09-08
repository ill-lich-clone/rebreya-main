const openOverlays = new Set();
let tooltipSequence = 0;

export function bindAnchoredTooltips(ownerElement, targets, { signal, getText = target => target.dataset.rmTooltip } = {}) {
  let anchor = null;
  let descriptionBefore = null;
  const tooltipId = `rm-anchored-tooltip-${++tooltipSequence}`;
  const overlay = new AnchoredOverlay({ ownerElement, resolveAnchor: () => anchor, onClose: () => {
    if (!anchor) return;
    if (descriptionBefore === null) anchor.removeAttribute("aria-describedby");
    else anchor.setAttribute("aria-describedby", descriptionBefore);
    anchor = null;
  } });
  const controller = new AbortController();
  const destroy = () => { controller.abort(); overlay.destroy(); };
  const binding = { close: () => overlay.close(), destroy };
  if (signal?.aborted) { destroy(); return binding; }
  signal?.addEventListener("abort", destroy, { once: true });
  const options = { signal: controller.signal };
  for (const target of targets) {
    const show = () => {
      const text = String(getText(target) ?? "").trim();
      if (!text || anchor === target) return;
      overlay.close();
      anchor = target;
      descriptionBefore = target.getAttribute("aria-describedby");
      const content = ownerElement.ownerDocument.createElement("div");
      content.className = "rm-anchored-tooltip";
      content.id = tooltipId;
      content.setAttribute("role", "tooltip");
      content.textContent = text;
      target.setAttribute("aria-describedby", [descriptionBefore, tooltipId].filter(Boolean).join(" "));
      overlay.show(content);
    };
    target.addEventListener("mouseenter", show, options);
    target.addEventListener("focus", show, options);
    for (const event of ["mouseleave", "blur", "click", "dragstart"]) {
      target.addEventListener(event, () => { if (anchor === target) overlay.close(); }, options);
    }
  }
  return binding;
}

export function calculateAnchoredOverlayPosition(anchor, size, viewport, { margin = 8, gap = 6 } = {}) {
  const dimensions = [size.width, size.height, viewport.width, viewport.height, margin, gap];
  if (dimensions.some(value => !Number.isFinite(value) || value < 0)
    || [anchor.left, anchor.right, anchor.top, anchor.bottom].some(value => !Number.isFinite(value))) {
    throw new TypeError("Overlay dimensions must be finite and nonnegative.");
  }
  const width = Math.min(size.width, Math.max(0, viewport.width - 2 * margin));
  const below = Math.max(0, viewport.height - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - margin);
  const placement = size.height <= below || below >= above ? "bottom" : "top";
  const maxHeight = Math.min(size.height, placement === "bottom" ? below : above);
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width));
  const top = placement === "bottom" ? anchor.bottom + gap : anchor.top - gap - maxHeight;
  return { left, top, width, maxHeight, placement };
}

/** Presentation only. The caller retains ownership of content and action dispatch. */
export class AnchoredOverlay {
  constructor({ ownerElement, resolveAnchor, onClose = () => {} }) {
    this.ownerElement = ownerElement;
    this.resolveAnchor = resolveAnchor;
    this.onClose = onClose;
    this.element = null;
    this.observers = [];
    this.frame = null;
  }

  show(content) {
    const doc = this.ownerElement?.ownerDocument;
    if (!doc?.body || !content || !this.ownerElement.isConnected) return;
    const view = doc.defaultView;
    if (!this.element) {
      this.element = doc.createElement("div");
      this.element.className = "rebreya-main rm-anchored-overlay";
      this.element.dataset.rmAnchoredOverlay = "true";
      Object.assign(this.element.style, { position: "fixed", width: "max-content", overflow: "auto" });
      doc.body.append(this.element);
      openOverlays.add(this);
      this.controller = new view.AbortController();
      const options = { signal: this.controller.signal, capture: true };
      const schedule = () => {
        if (this.frame === null) this.frame = view.requestAnimationFrame(() => {
          this.frame = null;
          this.reposition();
        });
      };
      doc.addEventListener("scroll", schedule, options);
      view.addEventListener("resize", schedule, options);
      doc.addEventListener("click", event => {
        const anchor = this.resolveAnchor?.();
        if (this.element?.contains(event.target) || anchor?.contains(event.target)) return;
        this.close();
      }, { signal: this.controller.signal });
      doc.addEventListener("keydown", event => {
        const top = [...openOverlays].filter(o => o.ownerElement?.ownerDocument === doc).at(-1);
        if (event.key !== "Escape" || top !== this) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close({ restoreFocus: true });
      }, options);
      if (view.ResizeObserver) {
        const observer = new view.ResizeObserver(schedule);
        observer.observe(this.ownerElement);
        observer.observe(this.element);
        this.observers.push(observer);
      }
      if (view.MutationObserver) {
        const observer = new view.MutationObserver(schedule);
        observer.observe(this.ownerElement, { attributes: true, attributeFilter: ["style", "class"], childList: true, subtree: true });
        observer.observe(doc.body, { childList: true });
        this.observers.push(observer);
      }
    }
    this.element.replaceChildren(content);
    this.content = content;
    this.naturalWidth = Math.max(content.getBoundingClientRect().width, content.scrollWidth);
    this.reposition();
  }

  reposition() {
    if (!this.element) return;
    const anchor = this.resolveAnchor?.();
    const view = this.ownerElement?.ownerDocument?.defaultView;
    if (!this.ownerElement?.isConnected || !anchor?.isConnected
      || (anchor.getClientRects && !anchor.getClientRects().length)) return this.close();
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= view.innerHeight || rect.right <= 0 || rect.left >= view.innerWidth) return this.close();
    for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
      const style = view.getComputedStyle(parent);
      if (!/(auto|scroll|hidden|clip)/u.test(`${style.overflowX} ${style.overflowY}`)) continue;
      const bounds = parent.getBoundingClientRect();
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom || rect.right <= bounds.left || rect.left >= bounds.right) return this.close();
    }
    const position = calculateAnchoredOverlayPosition({
      left: Math.max(8, rect.left), right: Math.min(view.innerWidth - 8, rect.right),
      top: Math.max(8, rect.top), bottom: Math.min(view.innerHeight - 8, rect.bottom)
    }, {
      width: this.naturalWidth,
      height: Math.max(this.content.scrollHeight, this.content.getBoundingClientRect().height)
    }, { width: view.innerWidth, height: view.innerHeight });
    const layers = Array.from(this.ownerElement.ownerDocument.querySelectorAll(".application, .app"))
      .filter(element => element !== this.element)
      .map(element => Number.parseInt(view.getComputedStyle(element).zIndex, 10) || 0);
    const zIndex = Math.max(100, ...layers) + 1;
    Object.assign(this.element.style, {
      left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`,
      maxHeight: `${position.maxHeight}px`, zIndex: String(zIndex)
    });
    this.element.dataset.placement = position.placement;
  }

  close({ restoreFocus = false } = {}) {
    if (!this.element) return;
    const doc = this.ownerElement?.ownerDocument;
    const view = doc?.defaultView;
    const focusInside = this.element.contains(doc?.activeElement);
    this.controller?.abort();
    for (const observer of this.observers.splice(0)) observer.disconnect();
    if (this.frame !== null) view?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.element.remove();
    this.element = null;
    this.content = null;
    openOverlays.delete(this);
    if (restoreFocus || focusInside) this.resolveAnchor?.()?.focus?.({ preventScroll: true });
    this.onClose?.();
  }

  destroy() {
    this.close();
    this.ownerElement = null;
    this.resolveAnchor = null;
    this.onClose = null;
  }
}
