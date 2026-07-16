import { normalizeMapObjectInput } from "../data/map-object-token-service.js";

const DEFAULT_INPUT = Object.freeze({
  name: normalizeMapObjectInput({}).name,
  hp: 10,
  ac: 10,
  damageThreshold: 0,
  size: 1
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readMapObjectForm(form) {
  return {
    name: form?.elements?.name?.value,
    hp: form?.elements?.hp?.value,
    ac: form?.elements?.ac?.value,
    damageThreshold: form?.elements?.damageThreshold?.value,
    size: form?.elements?.size?.value
  };
}

function mapObjectFormContent() {
  return `<form class="rebreya-map-object-token-form">
    <label>Name<input name="name" type="text" value="${escapeHtml(DEFAULT_INPUT.name)}" required></label>
    <label>HP<input name="hp" type="number" value="${escapeHtml(DEFAULT_INPUT.hp)}" min="1" max="1000000" step="1" required></label>
    <label>AC<input name="ac" type="number" value="${escapeHtml(DEFAULT_INPUT.ac)}" min="0" max="100" step="1" required></label>
    <label>Damage threshold<input name="damageThreshold" type="number" value="${escapeHtml(DEFAULT_INPUT.damageThreshold)}" min="0" max="1000000" step="1" required></label>
    <label>Size<input name="size" type="number" value="${escapeHtml(DEFAULT_INPUT.size)}" min="0.25" max="20" step="0.25" required></label>
  </form>`;
}

export async function promptMapObjectInput({
  DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2,
  notifyError = (message) => globalThis.ui?.notifications?.error?.(message)
} = {}) {
  if (typeof DialogV2?.wait !== "function") {
    throw new TypeError("DialogV2.wait is required");
  }

  const rawInput = await DialogV2.wait({
    window: { title: "Create map object" },
    content: mapObjectFormContent(),
    buttons: [{
      action: "place",
      label: "Place",
      default: true,
      callback: (_event, button, _dialog) => readMapObjectForm(button?.form)
    }, {
      action: "cancel",
      label: "Cancel",
      callback: () => null
    }]
  });

  if (rawInput == null) {
    return null;
  }

  try {
    return normalizeMapObjectInput(rawInput);
  }
  catch (error) {
    notifyError?.(error?.message ?? "Invalid map object input");
    return null;
  }
}

function getLocalScenePoint(event, canvas) {
  const target = canvas?.tokens ?? canvas?.stage;
  const getDataLocalPosition = event?.data?.getLocalPosition;
  const getDirectLocalPosition = event?.getLocalPosition;
  const point = typeof getDataLocalPosition === "function"
    ? getDataLocalPosition.call(event.data, target)
    : typeof getDirectLocalPosition === "function"
      ? getDirectLocalPosition.call(event, target)
      : null;
  const x = Number(point?.x);
  const y = Number(point?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("The canvas pointer event must provide a finite local position");
  }

  return { x, y };
}

function snapScenePoint(point, grid) {
  if (typeof grid?.getSnappedPoint === "function") {
    const snapped = grid.getSnappedPoint(point);
    const x = Number(snapped?.x);
    const y = Number(snapped?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError("canvas.grid.getSnappedPoint must return a finite point");
    }
    return { x, y };
  }

  const size = Number(grid?.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError("canvas.grid.size must be a positive number when snapping is unavailable");
  }
  return {
    x: Math.round(point.x / size) * size,
    y: Math.round(point.y / size) * size
  };
}

export function waitForMapObjectPlacement({
  canvas = globalThis.canvas,
  documentTarget = globalThis.document
} = {}) {
  const stage = canvas?.stage;
  if (typeof stage?.on !== "function" || typeof stage?.off !== "function") {
    return Promise.reject(new TypeError("canvas.stage with on and off methods is required"));
  }

  return new Promise((resolve, reject) => {
    let completed = false;
    const view = canvas?.app?.view;
    const previousViewContextMenu = view?.oncontextmenu;
    let viewContextMenuBound = false;

    const removeListeners = () => {
      stage.off("mousedown", onMouseDown);
      documentTarget?.removeEventListener?.("keydown", onKeyDown);
      documentTarget?.removeEventListener?.("contextmenu", onContextMenu);
      if (viewContextMenuBound) {
        view.oncontextmenu = previousViewContextMenu;
        viewContextMenuBound = false;
      }
    };

    const finalize = (result, error = null) => {
      if (completed) {
        return;
      }
      completed = true;
      removeListeners();
      if (error) {
        reject(error);
      }
      else {
        resolve(result);
      }
    };

    const onMouseDown = (event) => {
      if (completed) {
        return;
      }
      const button = event?.button ?? event?.data?.button ?? 0;
      if (button !== 0) {
        return;
      }
      try {
        finalize(snapScenePoint(getLocalScenePoint(event, canvas), canvas?.grid));
      }
      catch (error) {
        finalize(null, error);
      }
    };

    const onKeyDown = (event) => {
      if (completed) {
        return;
      }
      if (event?.key === "Escape") {
        finalize(null);
      }
    };

    const onContextMenu = (event) => {
      if (completed) {
        return false;
      }
      event?.preventDefault?.();
      finalize(null);
      return false;
    };

    try {
      stage.on("mousedown", onMouseDown);
      documentTarget?.addEventListener?.("keydown", onKeyDown);
      documentTarget?.addEventListener?.("contextmenu", onContextMenu);
      if (view) {
        view.oncontextmenu = onContextMenu;
        viewContextMenuBound = true;
      }
    }
    catch (error) {
      finalize(null, error);
    }
  });
}

function notify(notifications, level, message) {
  notifications?.[level]?.(message);
}

export async function runMapObjectTokenMacro({
  service,
  game = globalThis.game,
  canvas = globalThis.canvas,
  DialogV2 = globalThis.foundry?.applications?.api?.DialogV2 ?? globalThis.DialogV2,
  documentTarget = globalThis.document,
  notifications = globalThis.ui?.notifications
} = {}) {
  if (!game?.user?.isGM) {
    const error = new Error("Only a GM can create map objects.");
    notify(notifications, "error", error.message);
    throw error;
  }

  const scene = canvas?.scene ?? game?.scenes?.active;
  if (!scene) {
    const error = new Error("An active scene is required to create a map object.");
    notify(notifications, "error", error.message);
    throw error;
  }
  if (typeof service?.createToken !== "function") {
    const error = new TypeError("service.createToken is required");
    notify(notifications, "error", error.message);
    throw error;
  }

  try {
    const input = await promptMapObjectInput({
      DialogV2,
      notifyError: (message) => notify(notifications, "error", message)
    });
    if (!input) {
      notify(notifications, "info", "Map object creation cancelled.");
      return null;
    }

    const point = await waitForMapObjectPlacement({ canvas, documentTarget });
    if (!point) {
      notify(notifications, "info", "Map object creation cancelled.");
      return null;
    }

    const token = await service.createToken(input, {
      scene,
      point,
      gridSize: canvas?.grid?.size
    });
    notify(notifications, "info", "Map object created.");
    return token;
  }
  catch (error) {
    notify(notifications, "error", `Map object creation failed: ${error?.message ?? "Unknown error"}`);
    throw error;
  }
}
