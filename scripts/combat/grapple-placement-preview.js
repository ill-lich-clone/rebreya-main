import {
  grapplePlacementDistanceFeet,
  tokenFootprint,
  validateGrapplePlacement
} from "./grapple-geometry.js";

const VALID_COLOR = 0xffff00;
const INVALID_COLOR = 0xff0000;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function targetTexture(token) {
  return token?.document?.texture?.src ?? token?.texture?.src ?? token?.texture ?? null;
}

function cprResolution(width, height) {
  const maximum = Math.max(width, height);
  if (!Number.isInteger(maximum)) return 2;
  return maximum % 2 === 0 ? 1 : -1;
}

function defaultOverlayFactory({ sourceToken, reachFeet, grid, markerRadiusPixels }) {
  const Graphics = globalThis.PIXI?.Graphics;
  if (typeof Graphics !== "function") return { update() {}, destroy() {} };
  const source = tokenFootprint(sourceToken);
  const center = {
    x: source.x + ((source.width * grid.size) / 2),
    y: source.y + ((source.height * grid.size) / 2)
  };
  const radius = ((reachFeet / grid.distance) * grid.size) + markerRadiusPixels;
  const graphics = new Graphics();
  const redraw = (valid) => {
    graphics.clear();
    graphics.lineStyle(6, valid ? VALID_COLOR : INVALID_COLOR, 0.9);
    graphics.drawCircle(center.x, center.y, radius);
  };
  redraw(true);
  const parent = globalThis.canvas?.interface?.grid ?? globalThis.canvas?.stage;
  parent?.addChild?.(graphics);
  return {
    update({ valid }) { redraw(valid); },
    destroy() {
      graphics.parent?.removeChild?.(graphics);
      graphics.destroy?.();
    }
  };
}

function defaultSceneRect() {
  const dimensions = globalThis.canvas?.dimensions;
  if (!dimensions) return null;
  return {
    x: dimensions.sceneX ?? 0,
    y: dimensions.sceneY ?? 0,
    width: dimensions.sceneWidth ?? dimensions.width,
    height: dimensions.sceneHeight ?? dimensions.height
  };
}

function defaultGrid() {
  const grid = globalThis.canvas?.grid;
  return {
    size: grid?.size ?? globalThis.canvas?.dimensions?.size,
    distance: grid?.distance ?? globalThis.canvas?.dimensions?.distance
  };
}

function defaultCollision({ targetToken, targetPoint }) {
  const object = targetToken?.object ?? targetToken;
  return object?.checkCollision?.(targetPoint, { type: "move", mode: "any" }) === true;
}

export class GrapplePlacementPreview {
  #checkCollision;
  #crosshairsProvider;
  #gridProvider;
  #overlayFactory;
  #sceneRectProvider;
  #wait;

  constructor({
    crosshairsProvider = () => globalThis.chrisPremades?.Crosshairs,
    overlayFactory = defaultOverlayFactory,
    gridProvider = defaultGrid,
    sceneRectProvider = defaultSceneRect,
    checkCollision = defaultCollision,
    wait = (milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
  } = {}) {
    this.#crosshairsProvider = crosshairsProvider;
    this.#overlayFactory = overlayFactory;
    this.#gridProvider = gridProvider;
    this.#sceneRectProvider = sceneRectProvider;
    this.#checkCollision = checkCollision;
    this.#wait = wait;
  }

  async choose({ sourceToken, targetToken, reachFeet } = {}) {
    const Crosshairs = this.#crosshairsProvider();
    if (typeof Crosshairs?.showCrosshairs !== "function") {
      throw codedError("crosshairs-unavailable", "CPR Crosshairs is unavailable");
    }
    const grid = this.#gridProvider();
    const target = tokenFootprint(targetToken);
    const markerRadiusPixels = (Math.max(target.width, target.height) * Number(grid?.size)) / 2;
    const overlay = this.#overlayFactory({ sourceToken, targetToken, reachFeet, grid, markerRadiusPixels });
    let trackingPromise = Promise.resolve();
    try {
      const validateCenter = (center) => validateGrapplePlacement({
        sourceToken,
        targetToken,
        position: {
          x: Number(center?.x) - ((target.width * Number(grid?.size)) / 2),
          y: Number(center?.y) - ((target.height * Number(grid?.size)) / 2)
        },
        grid,
        reachFeet,
        sceneRect: this.#sceneRectProvider(),
        checkCollision: this.#checkCollision
      });
      const track = async (crosshair) => {
        do {
          const placement = validateCenter(crosshair?.document ?? crosshair);
          const distance = grapplePlacementDistanceFeet(
            sourceToken,
            targetToken,
            placement,
            grid
          );
          overlay?.update?.({ ...placement, distanceFeet: distance });
          if (crosshair) {
            crosshair.label = `${Number(distance.toFixed(1))} / ${reachFeet} фт.`;
            crosshair.draw?.();
          }
          if (!crosshair?.inFlight) break;
          await this.#wait(50);
        } while (crosshair?.inFlight);
      };
      const result = await Crosshairs.showCrosshairs({
        x: target.x + ((target.width * Number(grid?.size)) / 2),
        y: target.y + ((target.height * Number(grid?.size)) / 2),
        size: Number(grid?.distance) * Math.max(target.width, target.height),
        texture: targetTexture(targetToken),
        icon: targetTexture(targetToken),
        drawIcon: false,
        drawOutline: true,
        fillAlpha: 0.2,
        fillColor: VALID_COLOR,
        lockSize: true,
        lockPosition: false,
        resolution: cprResolution(target.width, target.height),
        label: `0 / ${reachFeet} фт.`
      }, {
        show: (crosshair) => {
          trackingPromise = track(crosshair);
          return trackingPromise;
        }
      });
      await trackingPromise;
      if (result?.cancelled !== false) return { cancelled: true, x: null, y: null };
      const placement = validateCenter(result);
      if (!placement.valid) throw codedError(placement.reason, `Invalid grapple placement: ${placement.reason}`);
      return { cancelled: false, x: placement.x, y: placement.y };
    } finally {
      overlay?.destroy?.();
    }
  }
}
