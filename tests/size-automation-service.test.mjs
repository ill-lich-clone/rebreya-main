import test from "node:test";
import assert from "node:assert/strict";

globalThis.CONST ??= { ACTIVE_EFFECT_MODES: { ADD: 2 } };

const {
  SizeAutomationService,
  getCharacterSizeRule,
  buildCharacterSizeEffectData
} = await import(
  "../scripts/combat/size-automation-service.js"
);

function makeActor({ type = "character", size = "med" } = {}) {
  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    type,
    system: { traits: { size } },
    effects: { contents: [] },
    async createEmbeddedDocuments(documentName, entries) {
      assert.equal(documentName, "ActiveEffect");
      const created = entries.map((entry, index) => ({
        ...structuredClone(entry),
        id: `effect-${this.effects.contents.length + index + 1}`
      }));
      this.effects.contents.push(...created);
      return created;
    },
    async updateEmbeddedDocuments(documentName, entries) {
      assert.equal(documentName, "ActiveEffect");
      for (const entry of entries) {
        const effect = this.effects.contents.find((candidate) => candidate.id === entry._id);
        Object.assign(effect, structuredClone(entry));
      }
      return entries;
    },
    async deleteEmbeddedDocuments(documentName, ids) {
      assert.equal(documentName, "ActiveEffect");
      this.effects.contents = this.effects.contents.filter((effect) => !ids.includes(effect.id));
      return ids;
    }
  };
  return actor;
}

test("Teyvankal character size table exposes AC, checks, and base reach", () => {
  const expected = {
    tiny: [2, -2, 2, 0],
    sm: [1, -1, 1, 5],
    med: [0, 0, 0, 5],
    lg: [-1, 1, -1, 10],
    huge: [-2, 2, -2, 15],
    grg: [-3, 3, -3, 20]
  };

  for (const [size, values] of Object.entries(expected)) {
    const rule = getCharacterSizeRule(size);
    assert.deepEqual(
      [rule.ac, rule.strengthChecks, rule.dexterityChecks, rule.baseReachFeet],
      values
    );
  }
});

test("Medium has no managed modifier effect and Large has three visible changes", () => {
  assert.equal(buildCharacterSizeEffectData("med"), null);

  const large = buildCharacterSizeEffectData("lg");
  assert.deepEqual(large.changes.map(({ key, value }) => [key, value]), [
    ["system.attributes.ac.bonus", "-1"],
    ["system.abilities.str.bonuses.check", "1"],
    ["system.abilities.dex.bonuses.check", "-1"]
  ]);
  assert.equal(large.flags["rebreya-main"].sizeAutomation.managed, true);
});

test("syncActor creates, updates, deduplicates, and removes the managed size effect", async () => {
  const actor = makeActor({ type: "character", size: "lg" });
  const service = new SizeAutomationService({}, { canManageActor: () => true });

  await service.syncActor(actor);
  assert.equal(actor.effects.contents.length, 1);
  assert.equal(actor.effects.contents[0].flags["rebreya-main"].sizeAutomation.size, "lg");

  actor.effects.contents.push(structuredClone(actor.effects.contents[0]));
  actor.effects.contents[1].id = "effect-duplicate";
  actor.system.traits.size = "huge";
  await service.syncActor(actor);
  assert.equal(actor.effects.contents.length, 1);
  assert.equal(actor.effects.contents[0].changes[0].value, "-2");
  assert.equal(actor.effects.contents[0].flags["rebreya-main"].sizeAutomation.size, "huge");

  actor.system.traits.size = "med";
  await service.syncActor(actor);
  assert.equal(actor.effects.contents.length, 0);
});

test("syncActor ignores NPC actors and unauthorized clients", async () => {
  const npc = makeActor({ type: "npc", size: "lg" });
  const denied = makeActor({ type: "character", size: "lg" });

  await new SizeAutomationService({}, { canManageActor: () => true }).syncActor(npc);
  await new SizeAutomationService({}, { canManageActor: () => false }).syncActor(denied);

  assert.equal(npc.effects.contents.length, 0);
  assert.equal(denied.effects.contents.length, 0);
});

test("default size synchronization authority belongs only to the active GM", async () => {
  const previousGame = globalThis.game;
  const activeGm = { id: "gm-active", active: true, isGM: true };
  const standbyGm = { id: "gm-standby", active: true, isGM: true };
  const actor = makeActor({ type: "character", size: "lg" });

  try {
    globalThis.game = {
      user: standbyGm,
      users: { activeGM: activeGm, contents: [activeGm, standbyGm] }
    };
    assert.equal(await new SizeAutomationService({}).syncActor(actor), false);
    assert.equal(actor.effects.contents.length, 0);

    globalThis.game.user = activeGm;
    assert.equal(await new SizeAutomationService({}).syncActor(actor), true);
    assert.equal(actor.effects.contents.length, 1);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("default authority elects exactly one active owner when no GM is online", async () => {
  const previousGame = globalThis.game;
  const electedOwner = { id: "I-owner", active: true, isGM: false };
  const otherOwner = { id: "i-owner", active: true, isGM: false };
  const actor = makeActor({ type: "character", size: "lg" });
  actor.testUserPermission = (user, permission) => permission === "OWNER" && [
    electedOwner.id,
    otherOwner.id
  ].includes(user.id);

  try {
    globalThis.game = {
      user: otherOwner,
      users: { activeGM: null, contents: [otherOwner, electedOwner] }
    };
    assert.equal(await new SizeAutomationService({}).syncActor(actor), false);
    assert.equal(actor.effects.contents.length, 0);

    globalThis.game.user = electedOwner;
    assert.equal(await new SizeAutomationService({}).syncActor(actor), true);
    assert.equal(actor.effects.contents.length, 1);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("removing a managed size effect is idempotent when another client already deleted it", async () => {
  const actor = makeActor({ type: "character", size: "med" });
  actor.effects.contents.push({
    id: "stale-size-effect",
    flags: { "rebreya-main": { sizeAutomation: { managed: true, size: "lg" } } }
  });
  actor.deleteEmbeddedDocuments = async () => {
    throw new Error('ActiveEffect "stale-size-effect" does not exist!');
  };

  const service = new SizeAutomationService({}, { canManageActor: () => true });
  assert.equal(await service.syncActor(actor), true);
});
