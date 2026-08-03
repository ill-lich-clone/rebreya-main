import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  characterSheetAtPoint,
  patchStorageTokenCanvasDrag,
  StorageTokenDropController
} from "../scripts/integrations/storage-token-drop.js";

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    pending() { return timers.size; }
  };
}

function createHarness() {
  const clock = createClock();
  const token = {
    actor: {
      flags: { [MODULE_ID]: { storage: { enabled: true } } },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    },
    document: { uuid: "Scene.scene.Token.chest" },
    visible: true,
    hover: false,
    border: { visible: false },
    renderFlags: { calls: [], set(value) { this.calls.push(value); } }
  };
  const overlayCalls = [];
  const overlay = {
    showFeedback(actualToken, text, options) {
      overlayCalls.push({ token: actualToken, text, options });
    },
    closeCalls: 0,
    close() { this.closeCalls += 1; }
  };
  const deposits = [];
  const inspections = [];
  const moduleApi = {
    async inspectStorageDepositSource(source) {
      inspections.push(source);
      return {
        source,
        available: source?.kind === "storage-token" ? 1 : 3,
        mode: "move",
        name: "Стрела"
      };
    },
    async depositStorageItem(...args) {
      deposits.push(args);
      return { changed: true };
    }
  };
  const controller = new StorageTokenDropController(moduleApi, {
    canvasProvider: () => ({ tokens: { placeables: [token] } }),
    boundsProvider: () => ({ left: 100, top: 100, right: 200, bottom: 200 }),
    overlayController: overlay,
    promptQuantity: async (maximum) => Math.min(maximum, 2),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createMutationId: () => "deposit-test"
  });
  const source = { type: "Item", uuid: "Actor.hero.Item.arrow" };
  const dataTransfer = {
    dropEffect: "none",
    getData(type) { return type === "text/plain" ? JSON.stringify(source) : ""; }
  };
  const event = {
    clientX: 150,
    clientY: 150,
    dataTransfer,
    preventions: 0,
    stops: 0,
    immediateStops: 0,
    preventDefault() { this.preventions += 1; },
    stopPropagation() { this.stops += 1; },
    stopImmediatePropagation() { this.immediateStops += 1; }
  };
  return { controller, clock, token, overlay, overlayCalls, moduleApi, deposits, inspections, event };
}

function createCanvasDragHarness() {
  const harness = createHarness();
  harness.token.bounds = { contains: (x, y) => x >= 100 && x <= 200 && y >= 100 && y <= 200 };
  class FakeToken {
    constructor(document) {
      this.document = document;
      this.actor = document.actor;
      this.visible = true;
      this.bounds = { contains: () => false };
      this.originalMoves = 0;
      this.originalDrops = 0;
      this.originalCancels = 0;
      this.mouseInteractionManager = {
        callbacks: {
          dragLeftMove: this._onDragLeftMove,
          dragLeftDrop: this._onDragLeftDrop
        }
      };
    }
    _onDragLeftMove() { this.originalMoves += 1; return "move"; }
    _onDragLeftDrop() { this.originalDrops += 1; return "drop"; }
    _onDragLeftCancel() { this.originalCancels += 1; return "cancel"; }
  }
  const sourceDocument = {
    uuid: "Scene.scene.Token.pile",
    actor: {
      flags: { [MODULE_ID]: { storage: { enabled: true } } },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    }
  };
  const source = new FakeToken(sourceDocument);
  harness.controller.canvasProvider = () => ({ tokens: { placeables: [source, harness.token] } });
  patchStorageTokenCanvasDrag(harness.controller, { TokenClass: FakeToken });
  const event = { interactionData: { destination: { x: 150, y: 150 } } };
  return { ...harness, source, event };
}

test("holding an item over storage for one second shows drop feedback and dropping deposits quantity", async () => {
  const harness = createHarness();
  harness.controller.handleDragStart(harness.event);
  assert.equal(harness.controller.handleDragOver(harness.event), true);
  assert.equal(harness.token.hover, true);
  assert.equal(harness.token.border.visible, true);
  assert.equal(harness.overlayCalls.length, 0);

  harness.clock.advance(999);
  assert.equal(harness.overlayCalls.length, 0);
  harness.clock.advance(1);
  assert.deepEqual(harness.overlayCalls[0], {
    token: harness.token,
    text: "Отпустите, чтобы добавить",
    options: { durationMs: 0, className: "rm-storage-token-feedback--drop-ready" }
  });

  const handled = await harness.controller.handleDrop(harness.event);
  assert.equal(handled, true);
  assert.equal(harness.deposits.length, 1);
  assert.equal(harness.deposits[0][0], harness.token.document.uuid);
  assert.deepEqual(harness.deposits[0][1], { kind: "item", itemUuid: "Actor.hero.Item.arrow" });
  assert.equal(harness.deposits[0][2], 2);
  assert.equal(harness.deposits[0][3], "deposit-test");
  assert.equal(harness.event.immediateStops, 1);
  assert.equal(harness.token.hover, false);
  assert.equal(harness.token.border.visible, false);
  assert.equal(harness.controller.activeToken, null);
});

test("leaving, Escape, and unsupported drags clear delayed feedback without dispatch", async () => {
  const harness = createHarness();
  harness.controller.handleDragStart(harness.event);
  harness.controller.handleDragOver(harness.event);
  assert.equal(harness.clock.pending(), 1);
  harness.controller.handleDragLeave({ clientX: 20, clientY: 20 });
  harness.clock.advance(1000);
  assert.equal(harness.overlayCalls.length, 0);
  assert.equal(harness.token.hover, false);

  harness.controller.handleDragStart(harness.event);
  harness.controller.handleDragOver(harness.event);
  harness.controller.handleKeyDown({ key: "Escape" });
  assert.equal(harness.clock.pending(), 0);
  assert.equal(harness.controller.activeToken, null);

  const unsupported = {
    ...harness.event,
    dataTransfer: { getData: () => JSON.stringify({ type: "Actor", uuid: "Actor.hero" }) }
  };
  harness.controller.handleDragStart(unsupported);
  assert.equal(harness.controller.handleDragOver(unsupported), false);
  assert.equal(await harness.controller.handleDrop(unsupported), false);
  assert.equal(harness.deposits.length, 0);
});

test("drop before the one-second ready state is consumed without creating a deposit", async () => {
  const harness = createHarness();
  harness.controller.handleDragStart(harness.event);
  harness.controller.handleDragOver(harness.event);

  const handled = await harness.controller.handleDrop(harness.event);

  assert.equal(handled, true);
  assert.equal(harness.deposits.length, 0);
  assert.equal(harness.event.immediateStops, 1);
  assert.equal(harness.controller.activeToken, null);
});

test("holding a whole storage token over another storage intercepts PIXI movement and deposits it", async () => {
  const harness = createCanvasDragHarness();

  harness.source._onDragLeftMove(harness.event);
  harness.clock.advance(1000);
  harness.source._onDragLeftDrop(harness.event);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.source.originalMoves, 1);
  assert.equal(harness.source.originalDrops, 0);
  assert.equal(harness.deposits.length, 1);
  assert.equal(harness.deposits[0][0], harness.token.document.uuid);
  assert.deepEqual(harness.deposits[0][1], {
    kind: "storage-token",
    tokenUuid: harness.source.document.uuid
  });
  assert.equal(harness.deposits[0][2], 1);
});

test("patch rewires managers that captured Foundry drag callbacks before module ready", async () => {
  const harness = createCanvasDragHarness();
  const callbacks = harness.source.mouseInteractionManager.callbacks;

  callbacks.dragLeftMove.call(harness.source, harness.event);
  harness.clock.advance(1000);
  callbacks.dragLeftDrop.call(harness.source, harness.event);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.source.originalMoves, 1);
  assert.equal(harness.source.originalDrops, 0);
  assert.equal(harness.deposits.length, 1);
  assert.deepEqual(harness.deposits[0][1], {
    kind: "storage-token",
    tokenUuid: harness.source.document.uuid
  });
});

test("dropping a storage token directly on storage deposits without a one-second hold", async () => {
  const harness = createCanvasDragHarness();

  harness.source._onDragLeftMove(harness.event);
  const result = harness.source._onDragLeftDrop(harness.event);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(result, undefined);
  assert.equal(harness.source.originalDrops, 0);
  assert.equal(harness.deposits.length, 1);
  assert.deepEqual(harness.deposits[0][1], {
    kind: "storage-token",
    tokenUuid: harness.source.document.uuid
  });
});

test("canvas token hit testing falls back to scene document geometry when PIXI bounds miss", async () => {
  const harness = createCanvasDragHarness();
  harness.token.bounds = { contains: () => false };
  Object.assign(harness.token.document, { x: 100, y: 100, width: 1, height: 1 });
  harness.controller.canvasProvider = () => ({
    scene: { grid: { size: 100 } },
    tokens: { placeables: [harness.source, harness.token] }
  });

  harness.source._onDragLeftMove(harness.event);
  harness.clock.advance(1000);
  harness.source._onDragLeftDrop(harness.event);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.source.originalDrops, 0);
  assert.equal(harness.deposits.length, 1);
});

test("dropping a whole storage token on a character sheet transfers it to that inventory", async () => {
  const harness = createCanvasDragHarness();
  const moves = [];
  harness.controller.characterSheetProvider = () => ({ uuid: "Actor.hero", type: "character" });
  harness.moduleApi.moveStorageTokenToCharacter = async (...args) => moves.push(args);
  harness.event.interactionData.destination = { x: 20, y: 20 };
  harness.source._onDragLeftMove(harness.event);
  const pointer = {
    clientX: 500,
    clientY: 300,
    prevented: 0,
    stopped: 0,
    preventDefault() { this.prevented += 1; },
    stopPropagation() { this.stopped += 1; },
    stopImmediatePropagation() { this.stopped += 1; }
  };

  const handled = harness.controller.handleCanvasTokenPointerUp(pointer);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(handled, true);
  assert.equal(pointer.prevented, 1);
  assert.deepEqual(moves, [[harness.source.document.uuid, "Actor.hero", "deposit-test"]]);
});

test("Foundry v13 character sheets resolve from their ApplicationV2 element id", () => {
  const actor = { id: "hero123", uuid: "Actor.hero123", type: "character" };
  const sheet = {
    id: "CharacterActorSheet-Actor-hero123",
    classList: { contains: () => false },
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 700, bottom: 700 })
  };
  const document = {
    elementFromPoint: () => ({ closest: () => sheet })
  };

  assert.equal(characterSheetAtPoint(400, 400, {
    document,
    windows: {},
    actors: { get: (id) => id === actor.id ? actor : null }
  }), actor);
});

test("dropping a whole storage token on a character token transfers it to that inventory", async () => {
  const harness = createCanvasDragHarness();
  const moves = [];
  const character = { uuid: "Actor.hero", name: "Герой", type: "character" };
  const characterToken = {
    actor: character,
    visible: true,
    document: { x: 300, y: 300, width: 1, height: 1, uuid: "Scene.scene.Token.hero" },
    hover: false,
    border: { visible: false },
    renderFlags: { set() {} }
  };
  harness.moduleApi.moveStorageTokenToCharacter = async (...args) => moves.push(args);
  harness.controller.canvasProvider = () => ({
    scene: { grid: { size: 100 } },
    tokens: { placeables: [harness.source, harness.token, characterToken] }
  });
  harness.event.interactionData.destination = { x: 350, y: 350 };

  harness.source._onDragLeftMove(harness.event);
  harness.source._onDragLeftDrop(harness.event);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.source.originalDrops, 0);
  assert.deepEqual(moves, [[
    harness.source.document.uuid,
    character.uuid,
    "deposit-test",
    { characterTokenUuid: characterToken.document.uuid }
  ]]);
});
