import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function getProperty(source, path) {
  return String(path ?? "").split(".").reduce((value, key) => value?.[key], source);
}

function setProperty(source, path, value) {
  const keys = String(path ?? "").split(".");
  const finalKey = keys.pop();
  let target = source;
  for (const key of keys) {
    target[key] ??= {};
    target = target[key];
  }
  target[finalKey] = value;
  return true;
}

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    getProperty,
    setProperty
  }
};

const { RuneKnightAutomationService } = await import("../scripts/combat/rune-knight-automation-service.js");
const { ReactionQueueService } = await import("../scripts/combat/reaction-queue-service.js");

function createItem({ id, automation, spent = 0, max = "", delay = null, type = "feat", identifier = "" }) {
  const item = {
    id,
    _id: id,
    type,
    uuid: `Actor.hero.Item.${id}`,
    system: {
      identifier,
      levels: type === "class" ? 15 : undefined,
      uses: { spent, max, recovery: [] }
    },
    flags: automation ? {
      "rebreya-main": {
        runeKnightAutomation: { id: automation }
      }
    } : {},
    updateCount: 0,
    async update(patch) {
      this.updateCount += 1;
      if (delay) await delay;
      for (const [path, value] of Object.entries(patch)) setProperty(this, path, value);
      return this;
    }
  };
  return item;
}

function createActor({ level = 15, prof = 5, items = [], effects = [] } = {}) {
  const classItem = createItem({
    id: "fighter-class",
    type: "class",
    identifier: "fighter-rework-v028"
  });
  classItem.system.levels = level;
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    system: {
      attributes: { prof },
      abilities: { con: { mod: 3 } }
    },
    items: [classItem, ...items],
    effects,
    statuses: new Set(),
    createdEffects: [],
    deletedEffects: [],
    async createEmbeddedDocuments(type, rows) {
      assert.equal(type, "ActiveEffect");
      const created = rows.map((row, index) => ({
        ...row,
        id: row.id ?? row._id ?? `effect-${this.createdEffects.length + index}`,
        parent: this
      }));
      this.createdEffects.push(...created);
      this.effects.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "ActiveEffect");
      this.deletedEffects.push(...ids);
      this.effects = this.effects.filter((effect) => !ids.includes(effect.id));
      return ids;
    }
  };
  for (const item of actor.items) item.parent = actor;
  for (const effect of actor.effects) effect.parent = actor;
  return actor;
}

test("Rune Knight repair keeps spent uses while synchronizing level and PB maxima", async () => {
  const stone = createItem({ id: "stone", automation: "stone", spent: 1, max: 1 });
  const giantMight = createItem({ id: "giant", automation: "giant-might", spent: 1, max: 2 });
  const runicShield = createItem({ id: "shield", automation: "runic-shield", spent: 2, max: 2 });
  const master = createItem({ id: "master", automation: "master-of-runes" });
  const actor = createActor({ level: 15, prof: 5, items: [stone, giantMight, runicShield, master] });
  const service = new RuneKnightAutomationService({});

  await service.repairActor(actor);

  assert.equal(stone.system.uses.max, 2);
  assert.equal(stone.system.uses.spent, 1);
  assert.equal(giantMight.system.uses.max, 5);
  assert.equal(giantMight.system.uses.spent, 1);
  assert.equal(runicShield.system.uses.max, 5);
  assert.equal(runicShield.system.uses.spent, 2);

  actor.items = actor.items.filter((item) => item !== master);
  actor.items[0].system.levels = 14;
  await service.repairActor(actor);
  assert.equal(stone.system.uses.max, 1);
  assert.equal(stone.system.uses.spent, 1);
});

test("short and long rests restore only the intended Rune Knight resources", async () => {
  const stone = createItem({ id: "stone", automation: "stone", spent: 1, max: 1 });
  const frost = createItem({ id: "frost", automation: "frost", spent: 1, max: 1 });
  const giantMight = createItem({ id: "giant", automation: "giant-might", spent: 3, max: 4 });
  const runicShield = createItem({ id: "shield", automation: "runic-shield", spent: 2, max: 4 });
  const actor = createActor({ level: 10, prof: 4, items: [stone, frost, giantMight, runicShield] });
  const service = new RuneKnightAutomationService({});

  await Promise.all([
    service.handleRestCompleted(actor, { type: "short" }),
    service.handleRestCompleted(actor, { type: "short" })
  ]);
  assert.equal(stone.system.uses.spent, 0);
  assert.equal(frost.system.uses.spent, 0);
  assert.equal(giantMight.system.uses.spent, 3);
  assert.equal(runicShield.system.uses.spent, 2);
  assert.equal(stone.updateCount, 1);

  await Promise.all([
    service.handleRestCompleted(actor, { longRest: true }),
    service.handleRestCompleted(actor, { longRest: true })
  ]);
  assert.equal(giantMight.system.uses.spent, 0);
  assert.equal(runicShield.system.uses.spent, 0);
  assert.equal(giantMight.updateCount, 2);
});

test("deleted rune cleanup removes only effects owned by that source item", async () => {
  const stone = createItem({ id: "stone", automation: "stone" });
  const matching = {
    id: "matching",
    flags: { "rebreya-main": { runeKnight: { sourceItemUuid: stone.uuid } } }
  };
  const unrelated = {
    id: "unrelated",
    flags: { "rebreya-main": { runeKnight: { sourceItemUuid: "Actor.hero.Item.other" } } }
  };
  const actor = createActor({ items: [stone], effects: [matching, unrelated] });
  actor.items = actor.items.filter((item) => item !== stone);
  stone.parent = actor;
  const service = new RuneKnightAutomationService({});

  await service.handleEmbeddedItemChange(stone);

  assert.deepEqual(actor.deletedEffects, ["matching"]);
  assert.deepEqual(actor.effects.map((effect) => effect.id), ["unrelated"]);
});

test("actor repair is local and coalesces concurrent work", async () => {
  let releaseUpdate;
  const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
  const stone = createItem({ id: "stone", automation: "stone", spent: 0, max: 0, delay: updateGate });
  const actor = createActor({ level: 3, prof: 2, items: [stone] });
  Object.defineProperty(globalThis, "game", {
    configurable: true,
    value: Object.defineProperty({}, "actors", {
      get() {
        throw new Error("repair must not read game.actors");
      }
    })
  });
  const service = new RuneKnightAutomationService({});

  const first = service.repairActor(actor);
  const second = service.repairActor(actor);
  await Promise.resolve();
  releaseUpdate();
  await Promise.all([first, second]);

  assert.equal(stone.updateCount, 1);
  assert.equal(service._repairActorPromises.size, 0);
});

test("Frost, Hill, and Storm activations pay once and create source-owned timed effects", async () => {
  const frost = createItem({ id: "frost", automation: "frost", spent: 0, max: 1 });
  const hill = createItem({ id: "hill", automation: "hill", spent: 0, max: 1 });
  const storm = createItem({ id: "storm", automation: "storm", spent: 0, max: 1 });
  const actor = createActor({ level: 10, prof: 4, items: [frost, hill, storm] });
  const service = new RuneKnightAutomationService({});
  await service.repairActor(actor);

  for (const item of [frost, hill, storm]) {
    const id = item.flags["rebreya-main"].runeKnightAutomation.id;
    const activity = {
      id: `${id}-activity`,
      actor,
      item,
      flags: { "rebreya-main": { runeKnightAutomation: { id } } }
    };
    assert.equal(await service.applyDnd5ePostUseActivity(activity, {}, {}), true);
    assert.equal(item.system.uses.spent, 1);
  }

  const frostEffect = actor.createdEffects.find((effect) => effect.flags["rebreya-main"].runeKnight.id === "frost");
  const hillEffect = actor.createdEffects.find((effect) => effect.flags["rebreya-main"].runeKnight.id === "hill");
  const stormEffect = actor.createdEffects.find((effect) => effect.flags["rebreya-main"].runeKnight.id === "storm");
  assert.equal(frostEffect.duration.seconds, 600);
  assert.deepEqual(frostEffect.changes.map((change) => change.key), [
    "system.abilities.str.bonuses.check",
    "system.abilities.str.bonuses.save",
    "system.abilities.con.bonuses.check",
    "system.abilities.con.bonuses.save"
  ]);
  assert.equal(hillEffect.duration.seconds, 60);
  assert.deepEqual(hillEffect.changes.map((change) => change.value), ["bludgeoning", "piercing", "slashing"]);
  assert.equal(stormEffect.duration.seconds, 60);
  assert.equal(stormEffect.flags["rebreya-main"].runeKnight.propheticState, true);
  assert.equal(frostEffect.flags["rebreya-main"].runeKnight.sourceItemUuid, frost.uuid);
});

test("Fire tool expertise, Hill poison saves, and Storm surprise immunity are context gated", async () => {
  const fire = createItem({ id: "fire", automation: "fire" });
  const hill = createItem({ id: "hill", automation: "hill" });
  const storm = createItem({ id: "storm", automation: "storm" });
  const actor = createActor({ items: [fire, hill, storm] });
  const service = new RuneKnightAutomationService({});
  await service.repairActor(actor);

  const proficientTool = { actor, proficiency: { multiplier: 1 } };
  const untrainedTool = { actor, proficiency: { multiplier: 0 } };
  service.applyDnd5ePreRollToolCheck(proficientTool, {}, {});
  service.applyDnd5ePreRollToolCheck(untrainedTool, {}, {});
  assert.equal(proficientTool.proficiency.multiplier, 2);
  assert.equal(proficientTool.bonus, "@prof");
  assert.equal(untrainedTool.proficiency.multiplier, 0);

  const poisonSave = { actor, ability: "con", options: { damageType: "poison" } };
  const ordinarySave = { actor, ability: "con", options: { damageType: "fire" } };
  service.applyDnd5ePreRollSavingThrow(poisonSave, {}, {});
  service.applyDnd5ePreRollSavingThrow(ordinarySave, {}, {});
  assert.equal(poisonSave.advantage, true);
  assert.equal(ordinarySave.advantage, undefined);

  const surprised = {
    parent: actor,
    statuses: new Set(["surprised"]),
    flags: { core: { statusId: "surprised" } }
  };
  assert.equal(service.prepareActiveEffectCreate(surprised), false);
  actor.statuses.add("incapacitated");
  assert.equal(service.prepareActiveEffectCreate(surprised), true);
});

function createStoneHarness({ promptAccepted = true, reactionConsumed = true, capabilityAvailable = true } = {}) {
  const stone = createItem({ id: "stone", automation: "stone", spent: 0, max: 1 });
  const reactor = createActor({ level: 10, prof: 4, items: [stone] });
  reactor.name = "Rune Knight";
  const target = createActor({ level: 1, prof: 2 });
  target.id = "target";
  target.uuid = "Actor.target";
  target.name = "Target";
  const reactorToken = { id: "reactor-token", uuid: "Scene.scene.Token.reactor", actor: reactor, name: reactor.name };
  const targetToken = { id: "target-token", uuid: "Scene.scene.Token.target", actor: target, name: target.name };
  const candidate = {
    id: reactor.id,
    actor: reactor,
    actorUuid: reactor.uuid,
    token: reactorToken,
    tokenUuid: reactorToken.uuid,
    item: stone,
    itemUuid: stone.uuid,
    ownerUserIds: ["owner"]
  };
  const capabilityIndex = {
    provider: null,
    hasCalls: 0,
    registerProvider(kind, provider) {
      assert.equal(kind, "rune-stone");
      this.provider = provider;
      return this;
    },
    has(kind) {
      assert.equal(kind, "rune-stone");
      this.hasCalls += 1;
      return capabilityAvailable;
    },
    list(kind) {
      assert.equal(kind, "rune-stone");
      return capabilityAvailable ? [candidate] : [];
    }
  };
  const calls = { distance: 0, visibility: 0, saves: 0, reactions: 0 };
  const moduleApi = {
    reactionCapabilityIndex: capabilityIndex,
    combatAttackService: {
      async consumeReaction() {
        calls.reactions += 1;
        return { consumed: reactionConsumed };
      }
    }
  };
  const combat = {
    id: "combat",
    round: 2,
    turn: 1,
    turns: [{ actor: reactor, token: reactorToken }, { actor: target, token: targetToken }]
  };
  const queue = new ReactionQueueService(moduleApi, {
    capabilityIndex,
    isCoordinator: () => true,
    combatProvider: () => combat,
    promptCandidate: async () => ({ accepted: promptAccepted }),
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {}
  });
  moduleApi.reactionQueueService = queue;
  const saveResults = [false, true];
  const service = new RuneKnightAutomationService(moduleApi, {
    distanceFeet() {
      calls.distance += 1;
      return 25;
    },
    isVisible() {
      calls.visibility += 1;
      return true;
    },
    async rollSave() {
      calls.saves += 1;
      return saveResults.shift() ?? true;
    }
  });
  return {
    service,
    queue,
    capabilityIndex,
    calls,
    stone,
    reactor,
    reactorToken,
    target,
    targetToken,
    combat
  };
}

test("Stone Rune uses the shared reaction queue and applies its failed-save stupor", async () => {
  const harness = createStoneHarness();
  await harness.queue.initialize();
  await harness.service.initialize();

  const indexed = harness.capabilityIndex.provider({
    actor: harness.reactor,
    token: harness.reactorToken
  });
  assert.equal(indexed.length, 1);
  const result = await harness.service.handleCombatTurnChange(harness.combat, {
    previous: { combatant: { actor: harness.target, token: harness.targetToken }, round: 2, turn: 0 }
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(harness.stone.system.uses.spent, 1);
  assert.equal(harness.calls.reactions, 1);
  assert.equal(harness.calls.saves, 1);
  const effect = harness.target.createdEffects[0];
  assert.equal(effect.duration.seconds, 60);
  assert.deepEqual(effect.statuses, ["charmed", "incapacitated"]);
  assert.equal(effect.flags["rebreya-main"].runeKnight.saveDC, 15);
  assert.equal(effect.flags["rebreya-main"].runeKnight.sourceItemUuid, harness.stone.uuid);
  assert.ok(effect.changes.some((change) => change.key === "system.attributes.movement.walk" && change.value === "0"));
  assert.ok(effect.changes.some((change) => change.key === "flags.midi-qol.OverTime"));

  await harness.service.handleCombatTurnChange(harness.combat, {
    previous: { combatant: { actor: harness.target, token: harness.targetToken }, round: 2, turn: 1 }
  });
  assert.equal(harness.calls.saves, 2);
  assert.deepEqual(harness.target.effects, []);
});

test("Stone Rune timeout and failed ordinary-reaction payment roll back all state", async () => {
  const declined = createStoneHarness({ promptAccepted: false });
  await declined.service.initialize();
  const declineResult = await declined.service.handleCombatTurnChange(declined.combat, {
    previous: { combatant: { actor: declined.target, token: declined.targetToken }, round: 2, turn: 0 }
  });
  assert.equal(declineResult.accepted.length, 0);
  assert.equal(declined.stone.system.uses.spent, 0);
  assert.equal(declined.calls.reactions, 0);
  assert.equal(declined.target.createdEffects.length, 0);

  const reactionFailure = createStoneHarness({ reactionConsumed: false });
  await reactionFailure.service.initialize();
  const failedResult = await reactionFailure.service.handleCombatTurnChange(reactionFailure.combat, {
    previous: { combatant: { actor: reactionFailure.target, token: reactionFailure.targetToken }, round: 2, turn: 0 }
  });
  assert.equal(failedResult.accepted.length, 0);
  assert.equal(reactionFailure.stone.system.uses.spent, 0);
  assert.deepEqual(reactionFailure.target.effects, []);
});

test("Stone Rune capability guard performs zero geometry when no reactor exists", async () => {
  const harness = createStoneHarness({ capabilityAvailable: false });
  await harness.service.initialize();

  const result = await harness.service.handleCombatTurnChange(harness.combat, {
    previous: { combatant: { actor: harness.target, token: harness.targetToken }, round: 2, turn: 0 }
  });

  assert.equal(result, true);
  assert.equal(harness.calls.distance, 0);
  assert.equal(harness.calls.visibility, 0);
});

function createFireHarness({ weapon = true, damageFails = false } = {}) {
  const fire = createItem({ id: "fire", automation: "fire", spent: 0, max: 1 });
  const actor = createActor({ level: 10, prof: 4, items: [fire] });
  actor.name = "Rune Knight";
  const target = createActor({ level: 1, prof: 2 });
  target.id = "fire-target";
  target.uuid = "Actor.fire-target";
  target.name = "Fire Target";
  const targetToken = { id: "fire-target-token", uuid: "Scene.scene.Token.fire-target", actor: target };
  const calls = { prompts: 0, rolls: 0, saves: 0, damage: 0 };
  const moduleApi = {
    reactionCapabilityIndex: { has: () => false },
    reactionQueueService: {
      async promptDecision({ prompt }) {
        calls.prompts += 1;
        assert.equal(prompt.title, "Огненная руна");
        return { accepted: true };
      }
    },
    combatAttackService: {
      async consumeReaction() {
        throw new Error("Fire Rune must not consume an ordinary reaction");
      }
    }
  };
  const saveResults = [false, true];
  const service = new RuneKnightAutomationService(moduleApi, {
    async createDamageRoll(formula, damageType) {
      calls.rolls += 1;
      assert.equal(formula, "2d6");
      assert.equal(damageType, "fire");
      if (damageFails) throw new Error("damage roll failed");
      return { formula, total: 7, options: { type: damageType, flavor: "Огненная руна" } };
    },
    async rollSave() {
      calls.saves += 1;
      return saveResults.shift() ?? true;
    },
    async applyDamage(damageTarget, formula, damageType) {
      assert.equal(damageTarget, target);
      assert.equal(formula, "2d6");
      assert.equal(damageType, "fire");
      calls.damage += 1;
      return true;
    }
  });
  const workflow = {
    id: "fire-workflow",
    actor,
    item: { id: "weapon", type: weapon ? "weapon" : "spell", name: "Sword" },
    activity: { item: { type: weapon ? "weapon" : "spell" } },
    hitTargets: new Set([targetToken]),
    bonusDamageRolls: [],
    async setBonusDamageRolls(rolls) {
      this.bonusDamageRolls = rolls;
      return rolls;
    }
  };
  return { service, fire, actor, target, targetToken, workflow, calls };
}

test("Fire Rune prompts once on a weapon hit and adds one fire roll plus shackles", async () => {
  const harness = createFireHarness();
  await harness.service.repairActor(harness.actor);

  await Promise.all([
    harness.service.applyMidiHitsChecked(harness.workflow),
    harness.service.applyMidiHitsChecked(harness.workflow)
  ]);
  assert.equal(harness.calls.prompts, 1);
  assert.equal(harness.fire.system.uses.spent, 1);

  await harness.service.applyMidiPreDamageRollComplete(harness.workflow);
  await harness.service.applyMidiPreDamageRollComplete(harness.workflow);
  assert.equal(harness.calls.rolls, 1);
  assert.equal(harness.workflow.bonusDamageRolls.length, 1);
  assert.equal(harness.workflow.bonusDamageRolls[0].formula, "2d6");
  assert.equal(harness.calls.saves, 1);
  const shackles = harness.target.effects.find((effect) => (
    effect.flags?.["rebreya-main"]?.runeKnight?.automation === "fire-shackles"
  ));
  assert.ok(shackles);
  assert.deepEqual(shackles.statuses, ["restrained"]);
  assert.equal(shackles.duration.seconds, 60);
  assert.equal(shackles.changes.filter((change) => change.key === "flags.midi-qol.OverTime").length, 2);
  assert.equal(shackles.flags["rebreya-main"].runeKnight.sourceItemUuid, harness.fire.uuid);
});

test("Fire Rune is weapon-only and rolls back payment when damage integration fails", async () => {
  const spellHarness = createFireHarness({ weapon: false });
  await spellHarness.service.repairActor(spellHarness.actor);
  await spellHarness.service.applyMidiHitsChecked(spellHarness.workflow);
  assert.equal(spellHarness.calls.prompts, 0);
  assert.equal(spellHarness.fire.system.uses.spent, 0);

  const failed = createFireHarness({ damageFails: true });
  await failed.service.repairActor(failed.actor);
  await failed.service.applyMidiHitsChecked(failed.workflow);
  assert.equal(await failed.service.applyMidiPreDamageRollComplete(failed.workflow), false);
  assert.equal(failed.fire.system.uses.spent, 0);
  assert.deepEqual(failed.target.effects, []);

  const aborted = createFireHarness();
  await aborted.service.repairActor(aborted.actor);
  await aborted.service.applyMidiHitsChecked(aborted.workflow);
  await aborted.service.applyMidiRollComplete(aborted.workflow);
  assert.equal(aborted.fire.system.uses.spent, 0);
});

test("Fire shackles deal start-turn damage and repeat the STR save at turn end", async () => {
  const harness = createFireHarness();
  await harness.service.repairActor(harness.actor);
  await harness.service.applyMidiHitsChecked(harness.workflow);
  await harness.service.applyMidiPreDamageRollComplete(harness.workflow);
  const other = createActor({ level: 1, prof: 2 });
  const otherToken = { id: "other", uuid: "Scene.scene.Token.other", actor: other };
  const combat = {
    id: "fire-combat",
    round: 1,
    turn: 1,
    turns: [{ actor: other, token: otherToken }, { actor: harness.target, token: harness.targetToken }]
  };

  await harness.service.handleCombatTurnChange(combat, {
    previous: { combatant: { actor: other, token: otherToken }, turn: 0 },
    current: { combatant: { actor: harness.target, token: harness.targetToken }, turn: 1 }
  });
  assert.equal(harness.calls.damage, 1);

  await harness.service.handleCombatTurnChange(combat, {
    previous: { combatant: { actor: harness.target, token: harness.targetToken }, turn: 1 },
    current: { combatant: { actor: other, token: otherToken }, turn: 0 }
  });
  assert.equal(harness.calls.saves, 2);
  assert.deepEqual(harness.target.effects, []);
});

test("Rune Knight hooks stay actor-local", async () => {
  const source = await readFile(new URL("../scripts/combat/hooks.js", import.meta.url), "utf8");

  assert.match(source, /hasRuneKnightService/u);
  assert.match(source, /runeKnightAutomationService\.handleRestCompleted\(actor, result, config\)/u);
  assert.match(source, /runeKnightAutomationService\.handleEmbeddedItemChange\(item\)/u);
  assert.match(source, /runeKnightAutomationService\.handleEmbeddedEffectChange\(effect\)/u);
  assert.match(source, /runeKnightAutomationService\.applyDnd5ePostUseActivity/u);
  assert.match(source, /runeKnightAutomationService\.applyDnd5ePreRollToolCheck/u);
  assert.match(source, /runeKnightAutomationService\.applyDnd5ePreRollSavingThrow/u);
  assert.match(source, /runeKnightAutomationService\.prepareActiveEffectCreate/u);
});
