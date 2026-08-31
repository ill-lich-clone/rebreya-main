import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { GroundPileFrameController } from "../scripts/integrations/storage-ground-pile-frame.js";

function createGroundPileToken() {
  const scene = { id: "scene-a" };
  return {
    actor: {
      flags: {
        [MODULE_ID]: {
          storage: { version: 1, storageKind: "pile" },
          groundPilePrototype: { enabled: true }
        }
      }
    },
    document: { uuid: "Scene.scene-a.Token.pile-a", parent: scene }
  };
}

test("ground-pile frame controller removes both current and legacy persistent frames without creating a sequence", async () => {
  const effects = new Set([
    "rebreya-main.ground-pile-frame.v2.Scene.scene-a.Token.pile-a",
    "rebreya-main.ground-pile-frame.Scene.scene-a.Token.pile-a"
  ]);
  const calls = [];
  let sequenceConstructions = 0;
  class ForbiddenSequence {
    constructor() { sequenceConstructions += 1; }
  }
  const effectManager = {
    getEffects({ name, sceneId }) {
      calls.push(["getEffects", { name, sceneId }]);
      return effects.has(name) ? [{ name }] : [];
    },
    async endEffects({ name, sceneId }) {
      calls.push(["endEffects", { name, sceneId }]);
      effects.delete(name);
    }
  };
  const controller = new GroundPileFrameController({
    gameProvider: () => ({ modules: new Map([["sequencer", { active: true }]]) }),
    sequenceProvider: () => ForbiddenSequence,
    effectManagerProvider: () => effectManager,
    isActiveGm: () => true
  });

  assert.equal(await controller.ensure(createGroundPileToken()), true);

  assert.equal(sequenceConstructions, 0);
  assert.deepEqual([...effects], []);
  assert.deepEqual(calls, [
    ["getEffects", { name: "rebreya-main.ground-pile-frame.v2.Scene.scene-a.Token.pile-a", sceneId: "scene-a" }],
    ["endEffects", { name: "rebreya-main.ground-pile-frame.v2.Scene.scene-a.Token.pile-a", sceneId: "scene-a" }],
    ["getEffects", { name: "rebreya-main.ground-pile-frame.Scene.scene-a.Token.pile-a", sceneId: "scene-a" }],
    ["endEffects", { name: "rebreya-main.ground-pile-frame.Scene.scene-a.Token.pile-a", sceneId: "scene-a" }]
  ]);
});

test("ground-pile frame cleanup stays inactive for non-piles and non-active GMs", async () => {
  let lookups = 0;
  const effectManager = {
    getEffects() { lookups += 1; return []; },
    async endEffects() {}
  };
  const token = createGroundPileToken();
  const inactive = new GroundPileFrameController({
    gameProvider: () => ({ modules: new Map([["sequencer", { active: true }]]) }),
    effectManagerProvider: () => effectManager,
    isActiveGm: () => false
  });
  assert.equal(await inactive.ensure(token), false);

  const active = new GroundPileFrameController({
    gameProvider: () => ({ modules: new Map([["sequencer", { active: true }]]) }),
    effectManagerProvider: () => effectManager,
    isActiveGm: () => true
  });
  token.actor.flags[MODULE_ID].groundPilePrototype = {};
  assert.equal(await active.ensure(token), false);
  assert.equal(lookups, 0);
});
