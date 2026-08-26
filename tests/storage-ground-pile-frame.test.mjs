import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";

async function loadFrameModule() {
  return import("../scripts/integrations/storage-ground-pile-frame.js")
    .catch(() => ({}));
}

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
    document: {
      uuid: "Scene.scene-a.Token.pile-a",
      width: 0.5,
      height: 0.5,
      parent: scene
    }
  };
}

test("ground-pile frame controller creates one attached persistent Sequencer frame", async () => {
  const frameModule = await loadFrameModule();
  assert.equal(typeof frameModule.GroundPileFrameController, "function");

  const calls = [];
  const effects = [];
  class FakeSequence {
    effect() {
      calls.push(["effect"]);
      return this;
    }

    attachTo(token, options) {
      calls.push(["attachTo", token, options]);
      return this;
    }

    shape(type, options) {
      calls.push(["shape", type, options]);
      return this;
    }

    aboveLighting(enabled) {
      calls.push(["aboveLighting", enabled]);
      return this;
    }

    persist(enabled) {
      calls.push(["persist", enabled]);
      return this;
    }

    name(value) {
      this.effectName = value;
      calls.push(["name", value]);
      return this;
    }

    async play() {
      calls.push(["play"]);
      effects.push({ name: this.effectName });
      return this;
    }
  }
  const effectManager = {
    getEffects({ name }) {
      return effects.filter((effect) => effect.name === name);
    }
  };
  const game = {
    modules: new Map([["sequencer", { active: true }]])
  };
  const token = createGroundPileToken();
  const controller = new frameModule.GroundPileFrameController({
    gameProvider: () => game,
    sequenceProvider: () => FakeSequence,
    effectManagerProvider: () => effectManager,
    isActiveGm: () => true
  });

  assert.equal(await controller.ensure(token), true);
  assert.equal(await controller.ensure(token), true);
  assert.deepEqual(calls, [
    ["effect"],
    ["attachTo", token, {
      bindVisibility: true,
      bindAlpha: true,
      bindScale: true,
      bindElevation: true,
      bindRotation: false
    }],
    ["shape", "roundedRect", {
      name: "shadow",
      width: 0.56,
      height: 0.56,
      radius: 0.045,
      gridUnits: true,
      fillColor: 0x0f1116,
      fillAlpha: 0.08,
      lineSize: 8,
      lineColor: 0x0f1116
    }],
    ["shape", "roundedRect", {
      name: "brass",
      width: 0.56,
      height: 0.56,
      radius: 0.045,
      gridUnits: true,
      fillAlpha: 0,
      lineSize: 3,
      lineColor: 0xe0b25e
    }],
    ["aboveLighting", true],
    ["persist", true],
    ["name", "rebreya-main.ground-pile-frame.Scene.scene-a.Token.pile-a"],
    ["play"]
  ]);
});
