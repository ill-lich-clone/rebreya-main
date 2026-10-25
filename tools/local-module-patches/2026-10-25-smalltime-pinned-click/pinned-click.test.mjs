import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const moduleRoot = process.env.SMALLTIME_TEST_ROOT
  ?? fileURLToPath(new URL("../../../../smalltime/", import.meta.url));
const source = readFileSync(`${moduleRoot}/scripts/smalltime-app.mjs`, "utf8");
const start = source.indexOf("class SmallTimeApp extends ");
const end = source.lastIndexOf("globalThis.SmallTimeApp = SmallTimeApp;");
assert.ok(start >= 0 && end > start, "The installed SmallTime class must be exercised");

// Only external Foundry positioning, DOM and settings I/O are doubled. All drag,
// pin/unpin and pin-zone decisions run the installed SmallTime implementation.
function fixture({ height = 58, pinned = true } = {}) {
  const settings = { pinned, position: { top: 446, left: 15 } };
  const writes = [];
  const listeners = new Map();
  const captures = new Set();
  let released = 0;
  let app;
  function element(id) {
    const classes = new Set();
    return {
      id, parentElement: null, children: [], style: {},
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name)
      },
      get nextElementSibling() {
        return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null;
      },
      append(child) {
        if (child.parentElement) {
          const siblings = child.parentElement.children;
          siblings.splice(siblings.indexOf(child), 1);
        }
        this.children.push(child);
        child.parentElement = this;
      },
      insertAdjacentElement(where, child) {
        assert.equal(where, "beforebegin");
        const parent = this.parentElement;
        parent.append(child);
        parent.children.splice(parent.children.indexOf(child), 1);
        parent.children.splice(parent.children.indexOf(this), 0, child);
      }
    };
  }
  const body = element("body"), players = element("players");
  const inactive = element("players-inactive"), active = element("players-active");
  body.append(players);
  players.append(inactive);
  players.append(active);
  inactive.getBoundingClientRect = () => ({
    left: 16, top: app?.element.parentElement === players ? 100 : 166,
    width: 200, height: 14
  });
  const nodes = new Map([body, players, inactive, active].map(node => [node.id, node]));
  class ApplicationV2 {
    setPosition(position) {
      Object.assign(this.position, position);
      this.position.left = Math.max(0, this.position.left);
      this.position.top = Math.max(0, this.position.top);
    }
    _initializeApplicationOptions(options) { return options; }
  }
  const sandbox = {
    foundry: { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: Base => Base } } },
    document: { body, getElementById: id => nodes.get(id) ?? null },
    game: {
      modules: { get: id => { assert.equal(id, "smalltime"); return { myApp: app }; } },
      settings: {
        get(scope, key) { assert.equal(scope, "smalltime"); return settings[key]; },
        async set(scope, key, value) {
          assert.equal(scope, "smalltime");
          assert.ok(["pinned", "position"].includes(key), "Drag must not touch calendar/world settings");
          settings[key] = structuredClone(value);
          writes.push({ key, value: structuredClone(value) });
        }
      }
    },
    window: {
      addEventListener(type, handler) { listeners.set(type, handler); },
      removeEventListener(type, handler) {
        assert.equal(listeners.get(type), handler);
        listeners.delete(type);
      }
    }
  };
  runInNewContext(`${source.slice(start, end)}\nglobalThis.SmallTimeApp = SmallTimeApp;`, sandbox);
  app = Object.create(sandbox.SmallTimeApp.prototype);
  app.element = element("smalltime-app");
  app.element.style.animation = "";
  app.position = pinned ? { top: 446, left: 15 } : { top: 200, left: 300 };
  app.element.getBoundingClientRect = () => ({
    left: app.element.parentElement === players ? 16 : app.position.left,
    top: app.element.parentElement === players ? 122 : app.position.top,
    width: 200, height
  });
  nodes.set(app.element.id, app.element);
  if (pinned) {
    active.insertAdjacentElement("beforebegin", app.element);
    app.element.classList.add("pinned");
  } else body.append(app.element);
  app._boundOnDragMove = app.onDragMove.bind(app);
  app._boundOnDragEnd = app.onDragEnd.bind(app);
  const handle = {
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { assert.ok(captures.delete(id)); released++; }
  };
  const event = (x = 100, y = 122 + height - 5, extra = {}) => ({
    button: 0, pointerId: 7, clientX: x, clientY: y,
    currentTarget: handle, preventDefault() {}, type: "pointerup", ...extra
  });
  return { app, event, settings, writes, listeners, captures, players, body, get released() { return released; } };
}

function assertClean(f) {
  assert.equal(f.app._dragState, null);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.captures.size, 0);
  assert.equal(f.released, 1);
  assert.equal(f.app.element.style.animation, "");
}

for (const height of [58, 79]) {
  for (const type of ["pointerup", "pointercancel"]) {
    test(`pinned ${height}px stationary ${type} preserves persisted pinning and DOM`, async () => {
      const f = fixture({ height });
      const event = f.event(undefined, undefined, { type });
      f.app.onDragStart(event);
      await f.app.onDragEnd(event);
      assert.deepEqual(f.writes, []);
      assert.equal(f.settings.pinned, true);
      assert.deepEqual(f.settings.position, { top: 446, left: 15 });
      assert.equal(f.app.element.parentElement, f.players);
      assert.equal(f.app.element.classList.contains("pinned"), true);
      assertClean(f);
      // Startup still sees the same pinned preference and stored floating position.
      assert.equal(f.app._initializeApplicationOptions({}).position.top, 446);
    });
  }
}

test("zero-delta pointermove and duplicate completion do not change pinned settings", async () => {
  const f = fixture();
  const event = f.event();
  f.app.onDragStart(event);
  f.app.onDragMove(event);
  await f.app.onDragEnd(event);
  await f.app.onDragEnd(event);
  assert.deepEqual(f.writes, []);
  assert.equal(f.settings.pinned, true);
  assert.equal(f.app.element.parentElement, f.players);
  assertClean(f);
});

test("real drag outside the pin zone keeps floating coordinates and persists unpinning", async () => {
  const f = fixture();
  f.app.onDragStart(f.event());
  f.app.onDragMove(f.event(400, 300));
  f.app.onDragMove(f.event(460, 340));
  await f.app.onDragEnd(f.event(460, 340));
  assert.equal(f.app.element.parentElement, f.body);
  assert.equal(f.app.element.classList.contains("pinned"), false);
  assert.deepEqual(f.settings.position, { top: 162, left: 76 });
  assert.deepEqual(f.writes, [
    { key: "position", value: { top: 162, left: 76 } }, { key: "pinned", value: false }
  ]);
  assertClean(f);
});

test("real drag back into the pin zone still repins the same app", async () => {
  const f = fixture();
  f.app.onDragStart(f.event());
  f.app.onDragMove(f.event(300, 175));
  f.app.onDragMove(f.event(100, 166));
  await f.app.onDragEnd(f.event(100, 166));
  assert.equal(f.app.element.parentElement, f.players);
  assert.equal(f.app.element.classList.contains("pinned"), true);
  assert.deepEqual(f.writes, [{ key: "pinned", value: true }]);
  assertClean(f);
});

test("floating stationary click outside the pin zone retains existing persistence", async () => {
  const f = fixture({ pinned: false });
  f.app.onDragStart(f.event(400, 253));
  await f.app.onDragEnd(f.event(400, 253));
  assert.equal(f.app.element.parentElement, f.body);
  assert.deepEqual(f.writes, [
    { key: "position", value: { top: 200, left: 300 } }, { key: "pinned", value: false }
  ]);
  assertClean(f);
});

test("floating stationary click inside the pin zone retains existing snap behavior", async () => {
  const f = fixture({ pinned: false });
  f.app.onDragStart(f.event(100, 166));
  await f.app.onDragEnd(f.event(100, 166));
  assert.equal(f.app.element.parentElement, f.players);
  assert.deepEqual(f.writes, [{ key: "pinned", value: true }]);
  assertClean(f);
});

test("a foreign pointer cannot move or finish the active gesture", async () => {
  const f = fixture();
  f.app.onDragStart(f.event());
  const state = f.app._dragState;
  f.app.onDragMove(f.event(400, 300, { pointerId: 8 }));
  await f.app.onDragEnd(f.event(400, 300, { pointerId: 8 }));
  assert.equal(f.app._dragState, state);
  assert.equal(f.listeners.size, 3);
  assert.equal(f.captures.has(7), true);
  assert.equal(f.app.element.parentElement, f.players);
  assert.deepEqual(f.writes, []);
  await f.app.onDragEnd(f.event());
});
