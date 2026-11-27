const PREFIX = "REBREYA_MAIN.SandChild.";

export class SandChildPlacement {
  #selection = null;

  constructor(service, { document = () => globalThis.document, win = () => globalThis.window,
    canvas = () => globalThis.canvas, game = () => globalThis.game, hooks = () => globalThis.Hooks } = {}) {
    Object.assign(this, { service, document, win, canvas, game, hooks });
  }

  #localize(key) {
    return this.game()?.i18n?.localize?.(PREFIX + key) ?? PREFIX + key;
  }

  #owns(token) {
    const user = this.game()?.user;
    return Boolean(user && token?.actor && (user.isGM || token.actor.testUserPermission?.(user, "OWNER")));
  }

  bindTokenHud(app, html) {
    const token = app?.object?.document;
    const bar = (html?.querySelector ? html : html?.[0])?.querySelector(".col.right");
    if (!bar) return;
    const active = this.#owns(token) && this.service.getManifestation(token);
    this.#bindControl(bar, "place", active, "reopen", "fa-hourglass-half", () => {
      const opportunity = this.service.getPlacementOpportunity(token);
      if (opportunity) void this.open(token, opportunity);
      else {
        const sender = this.game()?.user;
        const manual = sender?.isGM && this.service.getManualPlacementOpportunity(token, sender);
        if (manual) void this.open(token, manual);
        else this.service.report({ applied: false, reason: sender?.isGM ? "manualUnavailable" : "stale" });
      }
    });
    this.#bindControl(bar, "end", active, "end", "fa-xmark", () => {
      const effect = this.service.getManifestation(token);
      if (effect) void this.service.request("end", { tokenUuid: token.uuid, effectId: effect.id });
    });
  }

  #bindControl(bar, action, visible, label, icon, click) {
    const existing = bar.querySelector(`[data-rm-sand-hud="${action}"]`);
    if (!visible) return existing?.remove();
    if (existing) return;
    const button = this.document().createElement("button");
    button.type = "button";
    button.className = "control-icon";
    button.dataset.rmSandHud = action;
    button.dataset.tooltip = this.#localize(label);
    button.setAttribute("aria-label", button.dataset.tooltip);
    const glyph = this.document().createElement("i");
    glyph.className = `fa-solid ${icon}`;
    glyph.setAttribute("aria-hidden", "true");
    button.append(glyph);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      click();
    });
    bar.append(button);
  }

  refreshTokenHud(actor) {
    const hud = this.canvas()?.hud?.token;
    if (hud?.rendered && hud.object?.actor?.uuid === actor?.uuid) this.bindTokenHud(hud, hud.element);
  }

  async open(token, opportunity) {
    const { movementId, effectId } = opportunity ?? {};
    if (!opportunity || (this.#selection?.tokenUuid === token?.uuid && this.#selection?.movementId === movementId
      && this.#selection?.effectId === effectId)) return;
    const cell = await this.pickCell(token, opportunity.cells, { movementId, effectId });
    if (!cell || !this.#owns(token)) return;
    const { row, col } = cell;
    if (effectId) return this.service.request("placeManual", { tokenUuid: token.uuid, effectId, row, col });
    const current = this.service.getPlacementOpportunity(token);
    if (current?.movementId !== movementId) return this.service.report({ applied: false, reason: "stale" });
    return this.service.request("place", { tokenUuid: token.uuid, movementId, row, col });
  }

  pickCell(token, cells, { movementId, effectId } = {}) {
    const canvas = this.canvas();
    if (!cells?.length || !this.#owns(token) || canvas?.scene?.id !== token?.parent?.id) return Promise.resolve(null);
    this.close();
    const document = this.document();
    const root = document.createElement("section");
    root.className = "rm-sand-placement";
    const title = this.#localize(effectId ? "placeManual" : movementId ? "place" : "absorb");
    root.setAttribute("aria-label", title);
    const bar = document.createElement("div");
    bar.className = "rm-sand-placement-bar";
    const label = document.createElement("span");
    label.textContent = title;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "×";
    cancel.setAttribute("aria-label", this.#localize("cancel"));
    bar.append(label, cancel);
    root.append(bar);

    return new Promise(resolve => {
      const { size } = token.parent.grid;
      const win = this.win();
      const hooks = this.hooks();
      const controller = new AbortController();
      const finish = cell => {
        if (this.#selection?.finish !== finish) return;
        this.#selection = null;
        controller.abort();
        for (const [name, id] of bindings) if (id != null) hooks.off(name, id);
        root.remove();
        resolve(cell);
      };
      const points = cells.map(cell => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = cell.underToken ? "rm-sand-cell rm-sand-under-token" : "rm-sand-cell";
        button.dataset.row = String(cell.row);
        button.dataset.col = String(cell.col);
        button.setAttribute("aria-label", `${title} (${cell.row + 1}, ${cell.col + 1})`);
        button.addEventListener("click", () => finish(cell), { once: true });
        root.append(button);
        return { button, x: cell.col * size, y: cell.row * size };
      });
      const layout = () => {
        for (const { button, x, y } of points) {
          const start = canvas.clientCoordinatesFromCanvas({ x, y });
          const end = canvas.clientCoordinatesFromCanvas({ x: x + size, y: y + size });
          Object.assign(button.style, { left: `${start.x}px`, top: `${start.y}px`,
            width: `${end.x - start.x}px`, height: `${end.y - start.y}px` });
        }
      };
      const bindings = [["canvasPan", hooks?.on("canvasPan", layout)],
        ["canvasTearDown", hooks?.on("canvasTearDown", () => finish(null))]];
      this.#selection = { token, tokenUuid: token.uuid, movementId, effectId, x: token.x, y: token.y, finish };
      cancel.addEventListener("click", () => finish(null), { signal: controller.signal });
      win.addEventListener("keydown", event => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(null);
      }, { capture: true, signal: controller.signal });
      win.addEventListener("resize", layout, { signal: controller.signal });
      document.body.append(root);
      layout();
      points.find(({ button }) => button.className.includes("rm-sand-under-token"))?.button.focus({ preventScroll: true });
    });
  }

  close(tokenUuid) {
    if (this.#selection && (!tokenUuid || this.#selection.tokenUuid === tokenUuid)) this.#selection.finish(null);
  }

  closeStale() {
    const selection = this.#selection;
    if (!selection) return;
    const { token, movementId, effectId, x, y } = selection;
    if (token.x !== x || token.y !== y
      || (movementId && this.service.getPlacementOpportunity(token)?.movementId !== movementId)
      || (effectId && this.service.getManifestation(token)?.id !== effectId)) this.close();
  }

  async absorbFromSelection() {
    const tokens = this.canvas()?.tokens?.controlled ?? [];
    const token = tokens[0]?.document;
    if (tokens.length !== 1 || !this.#owns(token)) return this.service.report({ applied: false, reason: "token" });
    const tiles = this.service.getAbsorbableSand(token);
    if (!tiles.length) return this.service.report({ applied: false, reason: "noSand" });
    let [tile] = tiles;
    if (tiles.length > 1) {
      const { size } = token.parent.grid;
      const cells = tiles.map(candidate => ({
        row: Math.floor(candidate.y / size), col: Math.floor(candidate.x / size), underToken: true, tileId: candidate.id
      }));
      const selected = await this.pickCell(token, cells);
      if (!selected) return;
      tile = tiles.find(candidate => candidate.id === selected.tileId);
    }
    return this.service.request("absorb", { tokenUuid: token.uuid, tileId: tile.id });
  }
}
