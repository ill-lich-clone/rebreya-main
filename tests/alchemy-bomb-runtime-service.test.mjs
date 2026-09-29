import assert from "node:assert/strict";
import test from "node:test";

import {
  AlchemyBombRuntimeService,
  withMinimizedActorSheet
} from "../scripts/combat/alchemy-bomb-runtime-service.js";

const MODULE_ID = "rebreya-main";

function makeSheet({ rendered = true, minimized = false } = {}) {
  const calls = [];
  return {
    rendered,
    minimized,
    calls,
    async minimize() {
      calls.push("minimize");
      this.minimized = true;
    },
    async maximize() {
      calls.push("maximize");
      this.minimized = false;
    }
  };
}

function makeWorkflow({ id = "workflow-1", family = "alchemical-fire", persistent = false, sheet = makeSheet(), effect = { amount: 2, step: 1 } } = {}) {
  const actor = { id: "actor-1", uuid: "Actor.actor-1", sheet, items: [] };
  const scene = { id: "scene-1", uuid: "Scene.scene-1" };
  const token = {
    id: "source-token",
    uuid: "Scene.scene-1.Token.source-token",
    actor,
    document: {
      id: "source-token", uuid: "Scene.scene-1.Token.source-token", actor, elevation: 5, parent: scene,
      x: 0, y: 0, width: 1, height: 1
    }
  };
  const definition = {
    kind: "bomb",
    family,
    rank: 1,
    dc: 12,
    ability: "dex",
    radius: 5,
    damage: { formula: "1d6", type: "fire" },
    effect,
    persistent
  };
  const item = {
    id: "item-1",
    uuid: "Actor.actor-1.Item.item-1",
    name: "Алхимический огонь 1-го уровня",
    actor,
    flags: { [MODULE_ID]: { alchemyProductId: "alchemy-154", topDownImage: "modules/rebreya-main/bomb.webp" } }
  };
  const activity = {
    id: "activity-1",
    uuid: "Actor.actor-1.Item.item-1.Activity.activity-1",
    item,
    actor,
    flags: { [MODULE_ID]: { alchemyBomb: definition } }
  };
  return { id, actor, token, item, activity };
}

test("withMinimizedActorSheet restores a visible sheet after success and error", async () => {
  for (const shouldThrow of [false, true]) {
    const sheet = makeSheet();
    const actor = { sheet };
    const operation = async () => {
      assert.deepEqual(sheet.calls, ["minimize"]);
      if (shouldThrow) throw new Error("boom");
      return 42;
    };

    if (shouldThrow) await assert.rejects(() => withMinimizedActorSheet(actor, operation), /boom/u);
    else assert.equal(await withMinimizedActorSheet(actor, operation), 42);
    assert.deepEqual(sheet.calls, ["minimize", "maximize"]);
  }
});

test("withMinimizedActorSheet does not open or maximize closed and already minimized sheets", async () => {
  for (const sheet of [makeSheet({ rendered: false }), makeSheet({ minimized: true })]) {
    assert.equal(await withMinimizedActorSheet({ sheet }, async () => "done"), "done");
    assert.deepEqual(sheet.calls, []);
  }
});

test("bomb placement keeps the throwing sheet minimized until an instant workflow completes", async () => {
  const workflow = makeWorkflow();
  const placements = [];
  const mutations = [];
  const rangeOverlays = [];
  const service = new AlchemyBombRuntimeService({
    rangeOverlayFactory: (options) => {
      const state = { options, destroyed: 0 };
      rangeOverlays.push(state);
      return { destroy() { state.destroyed += 1; } };
    },
    placementProvider: async (config) => {
      placements.push(config);
      assert.deepEqual(workflow.actor.sheet.calls, ["minimize"]);
      assert.equal(rangeOverlays[0].destroyed, 0);
      return [{ x: 175, y: 275, elevation: 5 }];
    },
    mutationRequester: async (payload) => {
      mutations.push(structuredClone(payload));
      return payload.action === "place"
        ? { tokenUuid: "Scene.scene-1.Token.bomb", templateUuid: "Scene.scene-1.MeasuredTemplate.area" }
        : { removed: true };
    },
    gridProvider: () => ({ size: 100, distance: 5 })
  });

  assert.equal(await service.prepareWorkflow(workflow), true);
  assert.equal(placements.length, 1);
  assert.equal(rangeOverlays.length, 1);
  assert.equal(rangeOverlays[0].options.reachFeet, 60);
  assert.equal(rangeOverlays[0].options.sourceToken, workflow.token.document);
  assert.equal(rangeOverlays[0].destroyed, 1);
  assert.equal(placements[0].tokens.length, 1);
  assert.equal(placements[0].tokens[0].toObject().texture.src, "modules/rebreya-main/bomb.webp");
  assert.deepEqual(workflow.actor.sheet.calls, ["minimize"]);
  assert.deepEqual(mutations[0], {
    action: "place",
    operationId: "workflow-1",
    actorUuid: "Actor.actor-1",
    sourceTokenUuid: "Scene.scene-1.Token.source-token",
    sceneUuid: "Scene.scene-1",
    itemUuid: "Actor.actor-1.Item.item-1",
    activityUuid: "Actor.actor-1.Item.item-1.Activity.activity-1",
    productId: "alchemy-154",
    name: "Алхимический огонь 1-го уровня",
    image: "modules/rebreya-main/bomb.webp",
    x: 200,
    y: 300,
    elevation: 5,
    radius: 5,
    persistent: false,
    family: "alchemical-fire",
    dc: 12,
    durationSeconds: 0
  });

  await service.completeWorkflow(workflow);
  assert.equal(mutations[1].action, "apply-results");
  assert.equal(mutations[2].action, "cleanup");
  assert.equal(mutations[2].tokenUuid, "Scene.scene-1.Token.bomb");
  assert.equal(mutations[2].templateUuid, "Scene.scene-1.MeasuredTemplate.area");
  assert.deepEqual(workflow.actor.sheet.calls, ["minimize", "maximize"]);
});

test("bomb placement rejects a confirmed point beyond the visible 60-foot throw range", async () => {
  const workflow = makeWorkflow();
  let mutationCalls = 0;
  const service = new AlchemyBombRuntimeService({
    placementProvider: async () => [{ x: 1275, y: 25, elevation: 5 }],
    mutationRequester: async () => {
      mutationCalls += 1;
      return { tokenUuid: "Scene.scene-1.Token.bomb", templateUuid: "Scene.scene-1.MeasuredTemplate.area" };
    },
    rangeOverlayFactory: () => ({ destroy() {} }),
    gridProvider: () => ({ size: 100, distance: 5 })
  });

  await assert.rejects(
    () => service.prepareWorkflow(workflow),
    (error) => error?.code === "outside-throw-range"
  );
  assert.equal(mutationCalls, 0);
  assert.deepEqual(workflow.actor.sheet.calls, ["minimize", "maximize"]);
});

test("default bomb placement preview draws a yellow 60-foot boundary around the thrower", async () => {
  const previousPixi = globalThis.PIXI;
  const previousCanvas = globalThis.canvas;
  const drawCalls = [];
  class Graphics {
    clear() {}
    lineStyle(...args) { drawCalls.push(["line", ...args]); }
    drawCircle(...args) { drawCalls.push(["circle", ...args]); }
    destroy() { drawCalls.push(["destroy"]); }
  }
  const overlayLayer = {
    addChild(graphics) { graphics.parent = this; },
    removeChild(graphics) { graphics.parent = null; }
  };
  globalThis.PIXI = { Graphics };
  globalThis.canvas = { interface: { grid: overlayLayer } };

  try {
    const service = new AlchemyBombRuntimeService({
      placementProvider: async () => [],
      mutationRequester: async () => ({}),
      gridProvider: () => ({ size: 100, distance: 5 })
    });

    assert.equal(await service.prepareWorkflow(makeWorkflow()), false);
    assert.deepEqual(drawCalls[0], ["line", 6, 0xffff00, 0.9]);
    assert.deepEqual(drawCalls[1], ["circle", 50, 50, 1200]);
    assert.deepEqual(drawCalls.at(-1), ["destroy"]);
  }
  finally {
    if (previousPixi === undefined) delete globalThis.PIXI;
    else globalThis.PIXI = previousPixi;
    if (previousCanvas === undefined) delete globalThis.canvas;
    else globalThis.canvas = previousCanvas;
  }
});

test("cancelled bomb placement restores the sheet and performs no scene mutation", async () => {
  const workflow = makeWorkflow();
  let mutationCalls = 0;
  const service = new AlchemyBombRuntimeService({
    placementProvider: async () => [],
    mutationRequester: async () => { mutationCalls += 1; },
    gridProvider: () => ({ size: 100, distance: 5 })
  });

  assert.equal(await service.prepareWorkflow(workflow), false);
  assert.equal(mutationCalls, 0);
  assert.deepEqual(workflow.actor.sheet.calls, ["minimize", "maximize"]);
});

test("persistent bomb completion restores the sheet without removing its zone", async () => {
  const workflow = makeWorkflow({ family: "sticky", persistent: true });
  const mutations = [];
  const service = new AlchemyBombRuntimeService({
    placementProvider: async () => [{ x: 0, y: 0, elevation: 0 }],
    mutationRequester: async (payload) => {
      mutations.push(payload);
      return { tokenUuid: "Scene.scene-1.Token.sticky", templateUuid: "Scene.scene-1.MeasuredTemplate.sticky" };
    },
    gridProvider: () => ({ size: 100, distance: 5 })
  });

  await service.prepareWorkflow(workflow);
  await service.completeWorkflow(workflow);
  assert.deepEqual(mutations.map((entry) => entry.action), ["place", "apply-results"]);
  assert.deepEqual(workflow.actor.sheet.calls, ["minimize", "maximize"]);
});

test("abort cleans placed bomb artifacts and restores only the matching workflow sheet", async () => {
  const first = makeWorkflow({ id: "workflow-a" });
  const second = makeWorkflow({ id: "workflow-b" });
  const mutations = [];
  const service = new AlchemyBombRuntimeService({
    placementProvider: async () => [{ x: 0, y: 0, elevation: 0 }],
    mutationRequester: async (payload) => {
      mutations.push(structuredClone(payload));
      if (payload.action === "place") {
        return { tokenUuid: `${payload.sceneUuid}.Token.${payload.operationId}`, templateUuid: `${payload.sceneUuid}.MeasuredTemplate.${payload.operationId}` };
      }
      return { removed: true };
    },
    gridProvider: () => ({ size: 100, distance: 5 })
  });

  await service.prepareWorkflow(first);
  await service.prepareWorkflow(second);
  await service.abortWorkflow(first);
  assert.deepEqual(first.actor.sheet.calls, ["minimize", "maximize"]);
  assert.deepEqual(second.actor.sheet.calls, ["minimize"]);
  await service.completeWorkflow(second);
  assert.deepEqual(second.actor.sheet.calls, ["minimize", "maximize"]);
  assert.equal(mutations.filter((entry) => entry.action === "cleanup").length, 2);
});

test("active GM placement creates a half-cell bomb, measured template, sticky region and exact targets", async () => {
  const created = [];
  const scene = {
    uuid: "Scene.scene-1",
    grid: { size: 100, distance: 5 },
    tokens: new Map([
      ["inside", { id: "inside", uuid: "Scene.scene-1.Token.inside", x: 150, y: 250, width: 1, height: 1, actor: {} }],
      ["outside", { id: "outside", uuid: "Scene.scene-1.Token.outside", x: 800, y: 800, width: 1, height: 1, actor: {} }]
    ]),
    async createEmbeddedDocuments(type, data) {
      created.push({ type, data: structuredClone(data) });
      const id = type.toLowerCase();
      return [{ id, uuid: `${this.uuid}.${type}.${id}`, flags: data[0].flags, async update(patch) { this.patch = patch; } }];
    }
  };
  const service = new AlchemyBombRuntimeService({
    placementProvider: async () => [],
    mutationRequester: async () => ({}),
    mapObjectTokenService: { getManagedTemplateActor: () => ({ id: "map-object" }) }
  });

  const result = await service.handleSocketMutation({
    action: "place", operationId: "op", actorUuid: "Actor.actor-1", sceneUuid: scene.uuid,
    productId: "alchemy-190", name: "Липкая бомба", image: "sticky.webp",
    x: 200, y: 300, elevation: 0, radius: 5, persistent: true,
    family: "sticky", dc: 12, durationSeconds: 60
  }, { scene });

  assert.deepEqual(created.map((entry) => entry.type), ["Token", "MeasuredTemplate", "Region"]);
  assert.equal(created[0].data[0].width, 0.5);
  assert.equal(created[0].data[0].texture.src, "sticky.webp");
  assert.equal(created[1].data[0].distance, 5);
  assert.equal(created[2].data[0].behaviors[0].type, "dnd5e.difficultTerrain");
  assert.deepEqual(created[2].data[0].behaviors[1].system.events, ["tokenMoveIn", "tokenTurnStart"]);
  assert.deepEqual(result.targetTokenUuids, ["Scene.scene-1.Token.inside"]);
});

test("family results use canonical status, durability and DAE owners", async () => {
  const statusCalls = [];
  const durabilityCalls = [];
  const effectUpdates = [];
  const targetActor = {
    uuid: "Actor.target",
    items: [{ id: "armor", type: "equipment", system: { equipped: true, type: { value: "heavy" } } }],
    async createEmbeddedDocuments(type, data) { assert.equal(type, "ActiveEffect"); this.effects ??= []; this.effects.push(data[0]); return data; }
  };
  const failed = { id: "failed", uuid: "Scene.scene-1.Token.failed", actor: targetActor };
  const savedActor = { uuid: "Actor.saved", async createEmbeddedDocuments(_type, data) { this.effects = data; return data; } };
  const savedToken = { id: "saved", uuid: "Scene.scene-1.Token.saved", actor: savedActor };
  const statusService = {
    async applyDecayingDamage(...args) { statusCalls.push(["decay", ...args]); },
    async setStatus(...args) {
      statusCalls.push(["status", ...args]);
      return { async update(patch) { effectUpdates.push(patch); } };
    }
  };
  const durabilityService = {
    async breakItem(...args) { durabilityCalls.push(["break", ...args]); },
    async destroyItem(...args) { durabilityCalls.push(["destroy", ...args]); }
  };
  const scene = { tokens: new Map([["failed", failed], ["saved", savedToken]]) };
  const run = async ({ family, effect, persistent = false, saved = [] }) => {
    const workflow = makeWorkflow({ family, effect, persistent });
    workflow.failedSaves = new Set([failed]);
    workflow.saves = new Set(saved);
    let service;
    const mutationRequester = async (payload) => {
      if (payload.action === "place") return { tokenUuid: "Scene.scene-1.Token.bomb", templateUuid: "Scene.scene-1.MeasuredTemplate.area", regionUuid: "Scene.scene-1.Region.zone" };
      if (payload.action === "apply-results") return service.handleSocketMutation(payload, { actor: workflow.actor, scene });
      return { removed: true };
    };
    service = new AlchemyBombRuntimeService({
      placementProvider: async () => [{ x: 0, y: 0, elevation: 0 }], mutationRequester,
      gridProvider: () => ({ size: 100, distance: 5 }), statusService, durabilityService
    });
    await service.prepareWorkflow(workflow);
    await service.completeWorkflow(workflow);
    return workflow;
  };

  await run({ family: "alchemical-fire", effect: { amount: 4, step: 1 } });
  assert.deepEqual(statusCalls[0].slice(0, 3), ["decay", targetActor, 4]);
  assert.equal(statusCalls[0][3].damageType, "fire");

  await run({ family: "acid", effect: { breakage: 1 } });
  await run({ family: "acid", effect: { breakage: 2 } });
  assert.deepEqual(durabilityCalls.map((entry) => entry[0]), ["break", "destroy"]);

  await run({ family: "electrical", effect: { failureWeakness: 2, successWeakness: 1 }, saved: [savedToken] });
  assert.equal(targetActor.effects.at(-1).changes[0].key, "system.traits.dm.amount.lightning");
  assert.equal(targetActor.effects.at(-1).changes[0].value, "2");
  assert.equal(savedActor.effects[0].changes[0].value, "1");

  await run({ family: "cryogenic", effect: { restrained: 10 } });
  await run({ family: "frightening", effect: { frightened: 2 } });
  await run({ family: "stinking", effect: { nauseated: 3 } });
  assert.ok(statusCalls.some((entry) => entry[2] === "rebreya-discreet" && entry[3].value === 10));
  assert.ok(statusCalls.some((entry) => entry[2] === "frightened" && entry[3].value === 2));
  assert.ok(statusCalls.some((entry) => entry[2] === "rebreya-nauseated" && entry[3].value === 3));
  assert.ok(effectUpdates.every((patch) => patch["flags.dae.specialDuration"].includes("turnEndSource")));
});

test("sticky region repeats its Dexterity save and applies zero speed only on failure", async () => {
  const previousGame = globalThis.game;
  globalThis.game = { user: { isGM: true } };
  try {
    const effects = [];
    const actor = {
      rolls: [9, 14],
      async rollSavingThrow(config, dialog) {
        assert.deepEqual(config, { ability: "dex", target: 12 });
        assert.deepEqual(dialog, { configure: false });
        return [{ total: this.rolls.shift() }];
      },
      async createEmbeddedDocuments(type, data) { assert.equal(type, "ActiveEffect"); effects.push(data[0]); return data; }
    };
    const service = new AlchemyBombRuntimeService({ placementProvider: async () => [], mutationRequester: async () => ({}) });
    const region = { uuid: "Scene.scene-1.Region.sticky", flags: { [MODULE_ID]: { alchemyBombRuntime: { dc: 12 } } } };
    const event = { data: { token: { actor } } };
    assert.equal(await service.handleStickyRegionEvent({ region, event }), false);
    assert.equal(effects[0].changes[0].key, "system.attributes.movement.all");
    assert.equal(effects[0].changes[0].value, "0");
    assert.equal(await service.handleStickyRegionEvent({ region, event }), true);
    assert.equal(effects.length, 1);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("scene cleanup is operation-scoped and idempotent", async () => {
  const deletes = [];
  const operation = { operationId: "op" };
  const make = (id, matching = true) => ({ id, flags: { [MODULE_ID]: { alchemyBombRuntime: { operationId: matching ? "op" : "foreign" } } } });
  const scene = {
    tokens: new Map([["bomb", make("bomb")]]), templates: new Map([["area", make("area")]]), regions: new Map([["zone", make("zone", false)]]),
    async deleteEmbeddedDocuments(type, ids) { deletes.push([type, ids]); const collection = type === "Token" ? this.tokens : type === "MeasuredTemplate" ? this.templates : this.regions; ids.forEach((id) => collection.delete(id)); }
  };
  const service = new AlchemyBombRuntimeService({ placementProvider: async () => [], mutationRequester: async () => ({}) });
  const payload = { action: "cleanup", ...operation, tokenUuid: "Scene.scene-1.Token.bomb", templateUuid: "Scene.scene-1.MeasuredTemplate.area", regionUuid: "Scene.scene-1.Region.zone" };
  await service.handleSocketMutation(payload, { scene });
  await service.handleSocketMutation(payload, { scene });
  assert.deepEqual(deletes, [["Token", ["bomb"]], ["MeasuredTemplate", ["area"]]]);
});
