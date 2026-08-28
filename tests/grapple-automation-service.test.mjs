import assert from "node:assert/strict";
import test from "node:test";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import {
  GRAPPLE_LINK_FLAG,
  GrappleAutomationService
} from "../scripts/combat/grapple-automation-service.js";

const MODULE_ID = "rebreya-main";

function getPath(object, path) {
  return String(path).split(".").reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = String(path).split(".");
  let cursor = object;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = structuredClone(value);
}

function applyPatch(document, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const deleteMarker = path.match(/^(.*)\.-=([^.]+)$/u);
    if (deleteMarker) {
      const parent = getPath(document, deleteMarker[1]);
      if (parent) delete parent[deleteMarker[2]];
      continue;
    }
    if (path.includes(".")) setPath(document, path, value);
    else document[path] = structuredClone(value);
  }
}

function makeActor(id, { hands = 2 } = {}) {
  const actor = {
    id,
    uuid: `Actor.${id}`,
    system: { traits: { size: "med" } },
    flags: { [MODULE_ID]: { hands } },
    items: { contents: [] },
    effects: { contents: [] },
    getFlag(scope, key) { return getPath(this.flags?.[scope], key); },
    async update(patch) { applyPatch(this, patch); return this; },
    async createEmbeddedDocuments(type, rows) {
      assert.equal(type, "ActiveEffect");
      return rows.map((row, index) => {
        const effect = {
          ...structuredClone(row),
          id: `effect-${this.effects.contents.length + index + 1}`,
          parent: this,
          getFlag(scope, key) { return getPath(this.flags?.[scope], key); },
          toObject() {
            const { parent, delete: ignoredDelete, getFlag: ignoredFlag, toObject: ignoredToObject, ...data } = this;
            return structuredClone(data);
          },
          async delete() {
            const position = actor.effects.contents.indexOf(this);
            if (position >= 0) actor.effects.contents.splice(position, 1);
          }
        };
        this.effects.contents.push(effect);
        return effect;
      });
    }
  };
  return actor;
}

function makeToken(scene, id, actor, { x = 0, y = 0, width = 1, height = 1 } = {}) {
  const token = {
    id,
    uuid: `Scene.${scene.id}.Token.${id}`,
    documentName: "Token",
    parent: scene,
    actor,
    x, y, width, height,
    flags: {},
    texture: { src: `${id}.webp` },
    getFlag(scope, key) { return getPath(this.flags?.[scope], key); },
    async update(patch) {
      applyPatch(this, patch);
      if (this.failAfterUpdate || (this.failPositionAfterUpdate && Object.hasOwn(patch, "x"))) {
        this.failAfterUpdate = false;
        this.failPositionAfterUpdate = false;
        throw new Error("token-update-failed");
      }
      return this;
    }
  };
  scene.tokens.contents.push(token);
  return token;
}

function makeScene() {
  const batches = [];
  const scene = {
    id: "scene",
    width: 2000,
    height: 2000,
    grid: { size: 100, distance: 5 },
    tokens: { contents: [] },
    batches,
    async updateEmbeddedDocuments(type, updates, options) {
      assert.equal(type, "Token");
      batches.push({ updates: structuredClone(updates), options: structuredClone(options) });
      for (const update of updates) {
        const token = this.tokens.contents.find((entry) => entry.id === update._id);
        applyPatch(token, update);
      }
      if (this.failAfterBatch) {
        this.failAfterBatch = false;
        throw new Error("batch-failed");
      }
      return updates;
    }
  };
  return scene;
}

function environment({ sourceHands = 2, collision = false } = {}) {
  const scene = makeScene();
  const sourceActor = makeActor("source", { hands: sourceHands });
  const targetActor = makeActor("target");
  const targetActor2 = makeActor("target-2");
  const source = makeToken(scene, "source", sourceActor, { x: 0, y: 0 });
  const target = makeToken(scene, "target", targetActor, { x: 100, y: 0 });
  const target2 = makeToken(scene, "target-2", targetActor2, { x: 0, y: 100 });
  const documents = new Map([source, target, target2, sourceActor, targetActor, targetActor2].map((doc) => [doc.uuid, doc]));
  let nextId = 0;
  const requests = [];
  const service = new GrappleAutomationService({
    coordinator: new WorldMutationCoordinator(),
    commandBus: { async request(command, payload, options) { requests.push({ command, payload, options }); return { remote: true }; } },
    fromUuid: async (uuid) => documents.get(uuid) ?? null,
    randomId: () => `link-${++nextId}`,
    isActiveGmClient: () => true,
    gameProvider: () => ({ user: { id: "gm", isGM: true } }),
    sceneRectProvider: () => ({ x: 0, y: 0, width: 2000, height: 2000 }),
    checkCollision: () => collision
  });
  return { scene, sourceActor, targetActor, targetActor2, source, target, target2, service, requests };
}

function linkOf(token) {
  return token.getFlag(MODULE_ID, GRAPPLE_LINK_FLAG);
}

test("toggle reserves first free hands, creates dedicated effects, and supports multiple targets", async () => {
  const env = environment();
  const first = await env.service.toggle({
    sourceTokenUuid: env.source.uuid,
    targetTokenUuid: env.target.uuid,
    operationId: "toggle-1"
  });
  const second = await env.service.toggle({
    sourceTokenUuid: env.source.uuid,
    targetTokenUuid: env.target2.uuid,
    operationId: "toggle-2"
  });

  assert.equal(first.action, "created");
  assert.equal(second.action, "created");
  assert.deepEqual(env.sourceActor.getFlag(MODULE_ID, "handReservations").map((row) => row.handSlot), ["left", "right"]);
  assert.equal(linkOf(env.target).sourceTokenUuid, env.source.uuid);
  assert.equal(linkOf(env.target2).sourceTokenUuid, env.source.uuid);
  assert.deepEqual(env.targetActor.effects.contents[0].statuses, ["grappled"]);
  assert.equal(env.targetActor.effects.contents[0].name, "Схваченный");

  const released = await env.service.toggle({
    sourceTokenUuid: env.source.uuid,
    targetTokenUuid: env.target.uuid,
    operationId: "toggle-3"
  });
  assert.equal(released.action, "released");
  assert.deepEqual(env.sourceActor.getFlag(MODULE_ID, "handReservations").map((row) => row.handSlot), ["right"]);
  assert.equal(linkOf(env.target), undefined);
  assert.equal(env.targetActor.effects.contents.length, 0);
  assert.equal(env.targetActor2.effects.contents.length, 1);
});

test("toggle does not add a second visible grappled marker when another effect already provides the status", async () => {
  const env = environment();
  env.targetActor.effects.contents.push({
    id: "external-grappled",
    name: "Схвачен (внешний)",
    icon: "systems/dnd5e/icons/svg/statuses/grappled.svg",
    statuses: ["grappled"],
    flags: {}
  });

  await env.service.toggle({
    sourceTokenUuid: env.source.uuid,
    targetTokenUuid: env.target.uuid,
    operationId: "reuse-visible-status"
  });

  const visibleGrappled = env.targetActor.effects.contents.filter((effect) => (
    effect.statuses?.includes?.("grappled")
    || effect.icon === "systems/dnd5e/icons/svg/statuses/grappled.svg"
  ));
  const managed = env.targetActor.effects.contents.find((effect) => effect.getFlag?.(MODULE_ID, "managed") === true);
  assert.equal(visibleGrappled.length, 1);
  assert.deepEqual(managed.statuses, []);
  assert.equal(managed.icon, null);
});

test("toggle rejects zero hands and a target managed by another source", async () => {
  const noHands = environment({ sourceHands: 0 });
  await assert.rejects(() => noHands.service.toggle({
    sourceTokenUuid: noHands.source.uuid,
    targetTokenUuid: noHands.target.uuid,
    operationId: "no-hands"
  }), (error) => error?.code === "no-free-hand");

  const env = environment();
  env.target.flags[MODULE_ID] = { [GRAPPLE_LINK_FLAG]: {
    linkId: "foreign", kind: "grapple", handSlot: "left",
    sourceTokenUuid: "Scene.scene.Token.other", targetTokenUuid: env.target.uuid
  } };
  await assert.rejects(() => env.service.toggle({
    sourceTokenUuid: env.source.uuid,
    targetTokenUuid: env.target.uuid,
    operationId: "foreign"
  }), (error) => error?.code === "target-grappled-by-another-source");
});

test("partially failed link creation rolls all managed state back", async () => {
  const env = environment();
  env.target.failAfterUpdate = true;
  await assert.rejects(() => env.service.toggle({
    sourceTokenUuid: env.source.uuid,
    targetTokenUuid: env.target.uuid,
    operationId: "rollback"
  }), /token-update-failed/u);
  assert.deepEqual(env.sourceActor.getFlag(MODULE_ID, "handReservations") ?? [], []);
  assert.equal(linkOf(env.target), undefined);
  assert.equal(env.targetActor.effects.contents.length, 0);
});

test("place revalidates natural reach against a large target footprint", async () => {
  const env = environment();
  env.target.width = 2;
  env.target.height = 2;
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid, operationId: "create" });

  const placed = await env.service.place({
    sourceTokenUuid: env.source.uuid,
    targetTokenUuid: env.target.uuid,
    x: 150,
    y: 0,
    operationId: "place"
  });
  assert.deepEqual(placed, { moved: true, x: 150, y: 0 });
  assert.equal(env.target.x, 150);

  await assert.rejects(() => env.service.place({
    sourceTokenUuid: env.source.uuid,
    targetTokenUuid: env.target.uuid,
    x: 400,
    y: 0,
    operationId: "place-too-far"
  }), (error) => error?.code === "outside-reach");
});

test("drag moves source and every authoritative target by one shared delta in one batch", async () => {
  const env = environment();
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid, operationId: "create-1" });
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target2.uuid, operationId: "create-2" });

  const result = await env.service.drag({ sourceTokenUuid: env.source.uuid, x: 300, y: 200, operationId: "drag" });

  assert.equal(result.moved, true);
  assert.deepEqual([env.source.x, env.source.y], [300, 200]);
  assert.deepEqual([env.target.x, env.target.y], [400, 200]);
  assert.deepEqual([env.target2.x, env.target2.y], [300, 300]);
  assert.equal(env.scene.batches.length, 1);
  assert.equal(env.scene.batches[0].updates.length, 3);
  assert.equal(env.scene.batches[0].options[MODULE_ID].grappleBypass, true);
});

test("drag preserves an existing grapple axis without rechecking natural reach", async () => {
  const env = environment();
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid, operationId: "create" });
  env.target.x = 600;

  await env.service.drag({ sourceTokenUuid: env.source.uuid, x: 100, y: 100, operationId: "drag-existing-axis" });

  assert.deepEqual([env.source.x, env.source.y], [100, 100]);
  assert.deepEqual([env.target.x, env.target.y], [700, 100]);
});

test("invalid dragged participant cancels the whole batch", async () => {
  const env = environment({ collision: true });
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid, operationId: "create" });
  await assert.rejects(() => env.service.drag({
    sourceTokenUuid: env.source.uuid, x: 300, y: 0, operationId: "blocked-drag"
  }), (error) => error?.code === "wall-collision");
  assert.equal(env.scene.batches.length, 0);
  assert.deepEqual([env.source.x, env.target.x], [0, 100]);
});

test("failed place, grouped drag, and release-and-move restore prior positions and links", async () => {
  const env = environment();
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid, operationId: "create" });
  const link = structuredClone(linkOf(env.target));

  env.target.failPositionAfterUpdate = true;
  await assert.rejects(() => env.service.place({
    sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid,
    x: 150, y: 0, operationId: "failed-place"
  }), /token-update-failed/u);
  assert.deepEqual([env.target.x, env.target.y], [100, 0]);

  env.scene.failAfterBatch = true;
  await assert.rejects(() => env.service.drag({
    sourceTokenUuid: env.source.uuid, x: 300, y: 200, operationId: "failed-drag"
  }), /batch-failed/u);
  assert.deepEqual([env.source.x, env.source.y, env.target.x, env.target.y], [0, 0, 100, 0]);

  env.target.failPositionAfterUpdate = true;
  await assert.rejects(() => env.service.releaseAndMove({
    targetTokenUuid: env.target.uuid, linkId: link.linkId,
    x: 500, y: 500, operationId: "failed-release-move"
  }), /token-update-failed/u);
  assert.deepEqual([env.target.x, env.target.y], [100, 0]);
  assert.equal(linkOf(env.target).linkId, link.linkId);
  assert.equal(env.sourceActor.getFlag(MODULE_ID, "handReservations").length, 1);
  assert.equal(env.targetActor.effects.contents.length, 1);
});

test("operation ids are replay-safe and cannot be rebound to another payload", async () => {
  const env = environment();
  const payload = { sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid, operationId: "same" };
  const first = await env.service.toggle(payload);
  const replay = await env.service.toggle(payload);
  assert.deepEqual(replay, first);
  assert.equal(env.targetActor.effects.contents.length, 1);
  await assert.rejects(async () => env.service.toggle({ ...payload, targetTokenUuid: env.target2.uuid }),
    (error) => error?.code === "operation-fingerprint-mismatch");
});

test("deleting a source token clears every reservation and target fragment", async () => {
  const env = environment();
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid, operationId: "create-1" });
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target2.uuid, operationId: "create-2" });
  await env.service.handleTokenDeleted(env.source);
  assert.deepEqual(env.sourceActor.getFlag(MODULE_ID, "handReservations") ?? [], []);
  assert.equal(linkOf(env.target), undefined);
  assert.equal(linkOf(env.target2), undefined);
  assert.equal(env.targetActor.effects.contents.length + env.targetActor2.effects.contents.length, 0);
});

test("managed effect deletion and reconciliation clear only orphaned managed state", async () => {
  const env = environment();
  await env.service.toggle({ sourceTokenUuid: env.source.uuid, targetTokenUuid: env.target.uuid, operationId: "create" });
  const effect = env.targetActor.effects.contents[0];
  await effect.delete();
  await env.service.handleManagedEffectDeleted(effect);
  assert.equal(linkOf(env.target), undefined);
  assert.deepEqual(env.sourceActor.getFlag(MODULE_ID, "handReservations") ?? [], []);

  env.sourceActor.flags[MODULE_ID].handReservations = [{
    linkId: "orphan", kind: "grapple", handSlot: "left",
    sourceTokenUuid: env.source.uuid, targetTokenUuid: "Scene.scene.Token.missing"
  }];
  assert.deepEqual(await env.service.reconcileScene(env.scene), { removed: 1 });
  assert.deepEqual(env.sourceActor.getFlag(MODULE_ID, "handReservations") ?? [], []);
  assert.deepEqual(await env.service.reconcileScene(env.scene), { removed: 0 });
});
