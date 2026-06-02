import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  applyRadialStatusEffects,
  buildRadialStatusEffectLayouts,
  getRadialStatusMaxIcons,
  registerRadialStatusEffects
} from "../scripts/combat/radial-status-effects.js";
import { registerSettings } from "../scripts/settings.js";

function createBackground() {
  return {
    cleared: false,
    circles: [],
    clear() {
      this.cleared = true;
      return this;
    },
    beginFill(color, alpha) {
      this.fill = { color, alpha };
      return this;
    },
    lineStyle(width, color, alpha) {
      this.line = { width, color, alpha };
      return this;
    },
    drawCircle(x, y, radius) {
      this.circles.push({ x, y, radius });
      return this;
    },
    endFill() {
      return this;
    }
  };
}

function createSprite() {
  const sprite = {
    anchorValue: null,
    eventMode: undefined,
    cursor: undefined,
    width: 0,
    height: 0,
    position: { x: 0, y: 0 },
    texture: {
      orig: { width: 64, height: 32 },
      baseTexture: {}
    },
    scale: {
      x: 1,
      y: 1,
      set(x, y = x) {
        this.x = x;
        this.y = y;
      }
    },
    anchor: {
      set(value) {
        sprite.anchorValue = value;
      }
    }
  };

  return sprite;
}

function assertClose(actual, expected, delta = 0.001) {
  assert.ok(
    Math.abs(actual - expected) < delta,
    `Expected ${actual} to be within ${delta} of ${expected}`
  );
}

test("radial status effects setting is separate and disabled by default", () => {
  const previousGame = globalThis.game;
  const registered = [];

  globalThis.game = {
    settings: {
      register(moduleId, key, config) {
        registered.push({ moduleId, key, config });
      }
    }
  };

  try {
    registerSettings();

    const radialSetting = registered.find((entry) => entry.key === SETTINGS_KEYS.RADIAL_STATUS_EFFECTS);
    assert.equal(SETTINGS_KEYS.RADIAL_STATUS_EFFECTS, "radialStatusEffects");
    assert.equal(SETTINGS_KEYS.RADIAL_STATUS_EFFECTS_CLICK_TO_TOGGLE, undefined);
    assert.equal(radialSetting?.moduleId, MODULE_ID);
    assert.equal(radialSetting?.config.scope, "world");
    assert.equal(radialSetting?.config.config, true);
    assert.equal(radialSetting?.config.type, Boolean);
    assert.equal(radialSetting?.config.default, false);
    assert.equal(typeof radialSetting?.config.onChange, "function");
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("radial layout places status icons farther away and fills the full ring", () => {
  const layouts = buildRadialStatusEffectLayouts({
    tokenWidth: 1,
    tokenHeight: 1,
    gridSize: 100,
    count: 4
  });

  const center = { x: 50, y: 50 };
  assert.equal(layouts.length, 4);
  assert.equal(layouts[0].slotSize, 28);
  assert.deepEqual(layouts.map((layout) => layout.index), [0, 1, 2, 3]);

  for (const layout of layouts) {
    const distance = Math.hypot(layout.x - center.x, layout.y - center.y);
    assertClose(distance, 68.75);
  }

  const radius = 68.75;
  const firstEffectLeftShift = radius * 0.4;
  const firstEffectVerticalOffset = Math.sqrt((radius ** 2) - (firstEffectLeftShift ** 2));
  assertClose(layouts[0].x, center.x - firstEffectLeftShift);
  assertClose(layouts[0].y, center.y - firstEffectVerticalOffset);
  assertClose(layouts[1].x, center.x + firstEffectVerticalOffset);
  assertClose(layouts[1].y, center.y - firstEffectLeftShift);
  assertClose(layouts[2].x, center.x + firstEffectLeftShift);
  assertClose(layouts[2].y, center.y + firstEffectVerticalOffset);
  assertClose(layouts[3].x, center.x - firstEffectVerticalOffset);
  assertClose(layouts[3].y, center.y + firstEffectLeftShift);
});

test("radial icon capacity follows token size bands", () => {
  assert.equal(getRadialStatusMaxIcons(0.5), 9);
  assert.equal(getRadialStatusMaxIcons(1), 16);
  assert.equal(getRadialStatusMaxIcons(2), 28);
  assert.equal(getRadialStatusMaxIcons(3), 40);
});

test("radial layout keeps icon size until capacity is exceeded", () => {
  const fullCapacity = buildRadialStatusEffectLayouts({
    tokenWidth: 1,
    tokenHeight: 1,
    gridSize: 100,
    count: 16
  });
  const overCapacity = buildRadialStatusEffectLayouts({
    tokenWidth: 1,
    tokenHeight: 1,
    gridSize: 100,
    count: 20
  });

  assert.equal(fullCapacity[0].slotSize, 28);
  assertClose(overCapacity[0].slotSize, 22.4);
});

test("applying radial effects moves only status sprites and does not make them clickable", () => {
  const bg = createBackground();
  const first = createSprite();
  const second = createSprite();
  const overlay = {
    position: { x: 50, y: 50 },
    width: 80,
    height: 80
  };

  const token = {
    scene: { grid: { size: 100 } },
    document: { width: 1, height: 1 },
    effects: {
      bg,
      overlay,
      children: [bg, first, overlay, second]
    }
  };

  applyRadialStatusEffects(token, { enabled: true });

  assert.equal(bg.cleared, true);
  assert.equal(bg.circles.length, 4);
  assert.equal(first.anchorValue, 0.5);
  assert.equal(second.anchorValue, 0.5);
  assertClose(Math.hypot(first.position.x - 50, first.position.y - 50), 68.75);
  assertClose(Math.hypot(second.position.x - 50, second.position.y - 50), 68.75);
  assert.deepEqual(overlay.position, { x: 50, y: 50 });
  assert.equal(first.eventMode, undefined);
  assert.equal(first.cursor, undefined);
  assert.equal(first.customDnd5eAe, undefined);
});

test("registered token patch respects disabled setting", () => {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;

  class TestToken {
    constructor() {
      this.effect = createSprite();
      this.effects = {
        bg: createBackground(),
        overlay: null,
        children: []
      };
      this.effects.children = [this.effects.bg, this.effect];
      this.scene = { grid: { size: 100 } };
      this.document = { width: 1, height: 1 };
    }

    _refreshEffects() {
      this.effect.position.x = 12;
      this.effect.position.y = 18;
      return "core-refresh";
    }
  }

  globalThis.foundry = {
    canvas: {
      placeables: {
        Token: TestToken
      }
    }
  };
  globalThis.game = {
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.RADIAL_STATUS_EFFECTS);
        return false;
      }
    }
  };

  try {
    assert.equal(registerRadialStatusEffects(), true);
    const token = new TestToken();
    assert.equal(token._refreshEffects(), "core-refresh");
    assert.deepEqual(token.effect.position, { x: 12, y: 18 });
  }
  finally {
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
  }
});

test("registered token patch keeps enabled radial effects above the selected border", () => {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;

  class TestToken {
    constructor() {
      this.border = { zIndex: Infinity };
      this.effect = createSprite();
      this.effects = {
        bg: createBackground(),
        overlay: null,
        children: []
      };
      this.effects.children = [this.effects.bg, this.effect];
      this.scene = { grid: { size: 100 } };
      this.document = { width: 1, height: 1 };
    }

    _refreshEffects() {
      return "core-effects";
    }

    _refreshState() {
      this.border.zIndex = Infinity;
      return "core-state";
    }
  }

  globalThis.foundry = {
    canvas: {
      placeables: {
        Token: TestToken
      }
    }
  };
  globalThis.game = {
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        assert.equal(key, SETTINGS_KEYS.RADIAL_STATUS_EFFECTS);
        return true;
      }
    }
  };

  try {
    assert.equal(registerRadialStatusEffects(), true);
    const token = new TestToken();
    assert.equal(token._refreshState(), "core-state");
    assert.equal(token.border.zIndex, 100);
    assert.equal(token.effects.zIndex, 200);
  }
  finally {
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
  }
});
