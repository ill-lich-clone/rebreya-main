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
      abilities: { str: { mod: 3 }, con: { mod: 3 } },
      traits: { size: "med" }
    },
    items: [classItem, ...items],
    effects,
    statuses: new Set(),
    createdEffects: [],
    deletedEffects: [],
    async update(patch) {
      for (const [path, value] of Object.entries(patch)) setProperty(this, path, value);
      return this;
    },
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
    providers: new Map(),
    hasCalls: 0,
    registerProvider(kind, provider) {
      this.providers.set(kind, provider);
      if (kind === "rune-stone") this.provider = provider;
      return this;
    },
    has(kind) {
      if (kind !== "rune-stone") return false;
      this.hasCalls += 1;
      return capabilityAvailable;
    },
    list(kind) {
      if (kind !== "rune-stone") return [];
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

function assignActorIdentity(actor, id, name = id) {
  actor.id = id;
  actor.uuid = `Actor.${id}`;
  actor.name = name;
  return actor;
}

function createHitRewriteHarness({
  consumeReaction = true,
  failShieldApply = false,
  cloudSpent = 0,
  cloudDisposition = 1,
  attackerDisposition = -1,
  includeShield = true,
  redirectedAvailable = true,
  originalIsCloud = false
} = {}) {
  const cloudItem = createItem({ id: "cloud", automation: "cloud", spent: cloudSpent, max: 1 });
  const shieldItem = createItem({ id: "shield", automation: "runic-shield", spent: 0, max: 4 });
  const cloudActor = assignActorIdentity(createActor({ items: [cloudItem] }), "cloud-actor", "Cloud Knight");
  const shieldActor = assignActorIdentity(createActor({ items: [shieldItem] }), "shield-actor", "Shield Knight");
  const attacker = assignActorIdentity(createActor({ level: 1, prof: 2 }), "attacker", "Attacker");
  const original = assignActorIdentity(createActor({ level: 1, prof: 2 }), "original", "Original Target");
  const redirected = assignActorIdentity(createActor({ level: 1, prof: 2 }), "redirected", "Redirected Target");
  original.system.attributes.ac = { value: 15 };
  redirected.system.attributes.ac = { value: 16 };
  const token = (id, actor, disposition = 0) => ({
    id,
    uuid: `Scene.scene.Token.${id}`,
    actor,
    name: actor.name,
    disposition
  });
  const cloudToken = token("cloud", cloudActor, cloudDisposition);
  const shieldToken = token("shield", shieldActor, cloudDisposition);
  const attackerToken = token("attacker", attacker, attackerDisposition);
  const originalToken = originalIsCloud ? cloudToken : token("original", original, cloudDisposition);
  const originalActor = originalIsCloud ? cloudActor : original;
  const redirectedToken = token("redirected", redirected, cloudDisposition);
  const candidates = {
    "rune-cloud": [{
      id: cloudActor.id,
      actor: cloudActor,
      actorUuid: cloudActor.uuid,
      token: cloudToken,
      tokenUuid: cloudToken.uuid,
      item: cloudItem,
      itemUuid: cloudItem.uuid,
      ownerUserIds: ["owner"]
    }],
    "runic-shield": includeShield ? [{
      id: shieldActor.id,
      actor: shieldActor,
      actorUuid: shieldActor.uuid,
      token: shieldToken,
      tokenUuid: shieldToken.uuid,
      item: shieldItem,
      itemUuid: shieldItem.uuid,
      ownerUserIds: ["owner"]
    }] : []
  };
  const capabilityIndex = {
    providers: new Map(),
    registerProvider(kind, provider) {
      this.providers.set(kind, provider);
      return this;
    },
    has(kind) {
      return Boolean(candidates[kind]?.length);
    },
    list(kind) {
      return candidates[kind] ?? [];
    }
  };
  const calls = { prompts: [], reactions: 0, rerolls: 0 };
  const moduleApi = {
    reactionCapabilityIndex: capabilityIndex,
    combatAttackService: {
      canUseReaction: () => ({ canUse: true }),
      async consumeReaction() {
        calls.reactions += 1;
        return { consumed: consumeReaction };
      }
    }
  };
  const combat = {
    id: "rewrite-combat",
    started: true,
    turns: [
      { actor: cloudActor, token: cloudToken },
      { actor: shieldActor, token: shieldToken }
    ]
  };
  const queue = new ReactionQueueService(moduleApi, {
    capabilityIndex,
    isCoordinator: () => true,
    combatProvider: () => combat,
    promptCandidate: async ({ prompt }) => {
      calls.prompts.push(prompt);
      if (prompt.title === "Облачная руна") {
        const options = prompt.fields[0].options;
        assert.equal(options.some((option) => option.value === attackerToken.uuid), false);
        if (redirectedAvailable) {
          assert.ok(options.some((option) => option.value === redirectedToken.uuid));
          return { accepted: true, targetTokenUuid: redirectedToken.uuid };
        }
        return { accepted: false };
      }
      return { accepted: true };
    },
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {}
  });
  moduleApi.reactionQueueService = queue;
  const rerolledAttack = { total: 10, isCritical: false, isFumble: false };
  const originalAttack = {
    total: 18,
    isCritical: false,
    isFumble: false,
    async reroll() {
      calls.rerolls += 1;
      return rerolledAttack;
    }
  };
  const workflow = {
    id: "rewrite-workflow",
    actor: attacker,
    token: attackerToken,
    item: { id: "weapon", type: "weapon", name: "Sword" },
    attackRoll: originalAttack,
    targets: new Set([originalToken]),
    hitTargets: new Set([originalToken]),
    hitTargetsEC: new Set(),
    damageList: [{ tokenUuid: originalToken.uuid, actorUuid: originalActor.uuid }],
    async setAttackRoll(roll) {
      this.attackRoll = roll;
      if (failShieldApply && roll === rerolledAttack) throw new Error("shield apply failed");
      return roll;
    }
  };
  const service = new RuneKnightAutomationService(moduleApi, {
    distanceFeet: () => 25,
    isVisible: () => true,
    sceneTokens: () => [
      cloudToken,
      ...(includeShield ? [shieldToken] : []),
      attackerToken,
      ...(!originalIsCloud ? [originalToken] : []),
      ...(redirectedAvailable ? [redirectedToken] : [])
    ]
  });
  return {
    service,
    queue,
    capabilityIndex,
    workflow,
    calls,
    cloudItem,
    shieldItem,
    cloudActor,
    shieldActor,
    attackerToken,
    originalToken,
    redirectedToken,
    rerolledAttack
  };
}

test("Cloud Rune rewrites the target before Runic Shield rerolls and recalculates the hit", async () => {
  const harness = createHitRewriteHarness();
  await harness.queue.initialize();
  await harness.service.initialize();

  assert.ok(harness.capabilityIndex.providers.has("rune-cloud"));
  assert.ok(harness.capabilityIndex.providers.has("runic-shield"));
  await harness.service.applyMidiHitsChecked(harness.workflow);

  assert.deepEqual(harness.calls.prompts.map((prompt) => prompt.title), ["Облачная руна", "Рунический щит"]);
  assert.equal(harness.cloudItem.system.uses.spent, 1);
  assert.equal(harness.shieldItem.system.uses.spent, 1);
  assert.equal(harness.calls.reactions, 2);
  assert.equal(harness.calls.rerolls, 1);
  assert.equal(harness.workflow.targets.has(harness.originalToken), false);
  assert.equal(harness.workflow.targets.has(harness.redirectedToken), true);
  assert.equal(harness.workflow.hitTargets.has(harness.originalToken), false);
  assert.equal(harness.workflow.hitTargets.has(harness.redirectedToken), false);
  assert.strictEqual(harness.workflow.attackRoll, harness.rerolledAttack);
  assert.equal(harness.workflow.damageList.some((row) => row.tokenUuid === harness.originalToken.uuid), false);
});

test("Cloud Rune ignores friendly and neutral attackers", async () => {
  for (const [cloudDisposition, attackerDisposition] of [[1, 1], [1, 0], [0, -1]]) {
    const harness = createHitRewriteHarness({
      cloudDisposition,
      attackerDisposition,
      includeShield: false
    });
    await harness.service.initialize();

    await harness.service.applyMidiHitsChecked(harness.workflow);

    assert.deepEqual(harness.calls.prompts, []);
    assert.equal(harness.cloudItem.system.uses.spent, 0);
    assert.equal(harness.calls.reactions, 0);
  }
});

test("Cloud Rune treats either opposing disposition direction as hostile", async () => {
  const harness = createHitRewriteHarness({
    cloudDisposition: -1,
    attackerDisposition: 1,
    includeShield: false
  });
  await harness.service.initialize();

  await harness.service.applyMidiHitsChecked(harness.workflow);

  assert.deepEqual(harness.calls.prompts.map((prompt) => prompt.title), ["Облачная руна"]);
  assert.equal(harness.cloudItem.system.uses.spent, 1);
  assert.equal(harness.calls.reactions, 1);
});

test("Cloud Rune does not prompt after its uses are exhausted", async () => {
  const harness = createHitRewriteHarness({ cloudSpent: 1, includeShield: false });
  await harness.service.initialize();

  await harness.service.applyMidiHitsChecked(harness.workflow);

  assert.deepEqual(harness.calls.prompts, []);
  assert.equal(harness.cloudItem.system.uses.spent, 1);
  assert.equal(harness.calls.reactions, 0);
});

test("Cloud Rune requires a different redirect target", async () => {
  const harness = createHitRewriteHarness({
    includeShield: false,
    redirectedAvailable: false,
    originalIsCloud: true
  });
  await harness.service.initialize();

  await harness.service.applyMidiHitsChecked(harness.workflow);

  assert.deepEqual(harness.calls.prompts, []);
  assert.equal(harness.cloudItem.system.uses.spent, 0);
  assert.equal(harness.calls.reactions, 0);
});

test("Cloud and Runic Shield restore workflow and uses when ordinary reaction payment fails", async () => {
  const harness = createHitRewriteHarness({ consumeReaction: false });
  await harness.service.initialize();
  const originalRoll = harness.workflow.attackRoll;

  await harness.service.applyMidiHitsChecked(harness.workflow);

  assert.equal(harness.cloudItem.system.uses.spent, 0);
  assert.equal(harness.shieldItem.system.uses.spent, 0);
  assert.equal(harness.workflow.targets.has(harness.originalToken), true);
  assert.equal(harness.workflow.hitTargets.has(harness.originalToken), true);
  assert.strictEqual(harness.workflow.attackRoll, originalRoll);
});

test("Runic Shield restores its reroll and use when applying the reroll fails", async () => {
  const harness = createHitRewriteHarness({ failShieldApply: true });
  await harness.queue.initialize();
  await harness.service.initialize();
  const originalRoll = harness.workflow.attackRoll;

  await harness.service.applyMidiHitsChecked(harness.workflow);

  assert.equal(harness.cloudItem.system.uses.spent, 1);
  assert.equal(harness.shieldItem.system.uses.spent, 0);
  assert.equal(harness.calls.reactions, 1);
  assert.equal(harness.calls.rerolls, 1);
  assert.equal(harness.workflow.targets.has(harness.originalToken), false);
  assert.equal(harness.workflow.targets.has(harness.redirectedToken), true);
  assert.equal(harness.workflow.hitTargets.has(harness.redirectedToken), true);
  assert.strictEqual(harness.workflow.attackRoll, originalRoll);
});

function createStormHarness({ mode = "disadvantage", reactionConsumed = true, prophetic = true } = {}) {
  const stormItem = createItem({ id: "storm", automation: "storm", spent: 1, max: 1 });
  const effect = prophetic ? {
    id: "storm-prophetic",
    disabled: false,
    flags: {
      "rebreya-main": {
        runeKnight: {
          id: "storm",
          sourceItemUuid: stormItem.uuid,
          propheticState: true
        }
      }
    }
  } : null;
  const stormActor = assignActorIdentity(createActor({ items: [stormItem], effects: effect ? [effect] : [] }), "storm-actor", "Storm Knight");
  const rollingActor = assignActorIdentity(createActor({ level: 1, prof: 2 }), "rolling-actor", "Rolling Creature");
  const stormToken = { id: "storm-token", uuid: "Scene.scene.Token.storm", actor: stormActor, name: stormActor.name };
  const rollingToken = { id: "rolling-token", uuid: "Scene.scene.Token.rolling", actor: rollingActor, name: rollingActor.name };
  const providers = new Map();
  const candidates = [];
  const capabilityIndex = {
    registerProvider(kind, provider) {
      providers.set(kind, provider);
      if (kind === "rune-storm") {
        candidates.splice(0, candidates.length, ...provider({ actor: stormActor, token: stormToken }));
      }
      return this;
    },
    has(kind) {
      return kind === "rune-storm" && candidates.length > 0;
    },
    list(kind) {
      return kind === "rune-storm" ? candidates : [];
    }
  };
  const calls = { prompts: 0, reactions: 0, distance: 0, visibility: 0 };
  const moduleApi = {
    reactionCapabilityIndex: capabilityIndex,
    combatAttackService: {
      canUseReaction: () => ({ canUse: true }),
      async consumeReaction() {
        calls.reactions += 1;
        return { consumed: reactionConsumed };
      }
    }
  };
  const queue = new ReactionQueueService(moduleApi, {
    capabilityIndex,
    isCoordinator: () => true,
    promptCandidate: async ({ prompt }) => {
      calls.prompts += 1;
      assert.equal(prompt.fields[0].name, "mode");
      return { accepted: true, mode };
    },
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {}
  });
  moduleApi.reactionQueueService = queue;
  const service = new RuneKnightAutomationService(moduleApi, {
    distanceFeet: () => {
      calls.distance += 1;
      return 40;
    },
    isVisible: () => {
      calls.visibility += 1;
      return true;
    }
  });
  const workflow = {
    id: "storm-roll",
    uuid: "Workflow.storm-roll",
    actor: rollingActor,
    token: rollingToken,
    options: {},
    attackRoll: null
  };
  return {
    service,
    queue,
    providers,
    candidates,
    calls,
    stormItem,
    stormActor,
    stormToken,
    rollingActor,
    rollingToken,
    workflow
  };
}

for (const rollType of ["attack", "save", "check"]) {
  test(`Storm prophetic state controls a ${rollType} roll before it is finalized`, async () => {
    const harness = createStormHarness();
    await harness.queue.initialize();
    await harness.service.initialize();

    assert.ok(harness.providers.has("rune-storm"));
    const result = await harness.service.applyMidiStormPreRoll(harness.workflow, rollType);

    assert.equal(result.accepted.length, 1);
    assert.equal(harness.workflow.disadvantage, true);
    assert.equal(harness.workflow.options.disadvantage, true);
    assert.equal(harness.stormItem.system.uses.spent, 1);
    assert.equal(harness.calls.reactions, 1);
    assert.equal(harness.calls.prompts, 1);
    assert.equal(harness.calls.distance, 1);
    assert.equal(harness.calls.visibility, 1);
  });
}

test("Storm pre-roll handling is idempotent and rolls back when reaction payment fails", async () => {
  const harness = createStormHarness({ mode: "advantage", reactionConsumed: false });
  await harness.queue.initialize();
  await harness.service.initialize();

  const first = await harness.service.applyMidiStormPreRoll(harness.workflow, "attack");
  const second = await harness.service.applyMidiStormPreRoll(harness.workflow, "attack");

  assert.equal(first.accepted.length, 0);
  assert.equal(second.accepted.length, 0);
  assert.equal(harness.workflow.advantage, undefined);
  assert.equal(harness.workflow.options.advantage, undefined);
  assert.equal(harness.stormItem.system.uses.spent, 1);
  assert.equal(harness.calls.prompts, 1);
  assert.equal(harness.calls.reactions, 1);
});

test("Storm applies an accepted roll mode once and ignores a roll that already finished", async () => {
  const accepted = createStormHarness({ mode: "advantage" });
  await accepted.queue.initialize();
  await accepted.service.initialize();
  const first = await accepted.service.applyMidiStormPreRoll(accepted.workflow, "attack");
  const duplicate = await accepted.service.applyMidiStormPreRoll(accepted.workflow, "attack");

  assert.strictEqual(duplicate, first);
  assert.equal(accepted.workflow.advantage, true);
  assert.equal(accepted.workflow.workflowOptions.advantage, true);
  assert.equal(accepted.calls.prompts, 1);
  assert.equal(accepted.calls.reactions, 1);

  const finished = createStormHarness();
  await finished.service.initialize();
  finished.workflow.completed = true;
  assert.equal(await finished.service.applyMidiStormPreRoll(finished.workflow, "check"), true);
  assert.equal(finished.calls.prompts, 0);
  assert.equal(finished.calls.distance, 0);
});

test("Storm capability requires prophetic state and native hooks apply only a pre-resolved mode", async () => {
  const dormant = createStormHarness({ prophetic: false });
  await dormant.service.initialize();
  assert.equal(dormant.candidates.length, 0);
  const result = await dormant.service.applyMidiStormPreRoll(dormant.workflow, "save");
  assert.equal(result, true);
  assert.equal(dormant.calls.distance, 0);

  const service = new RuneKnightAutomationService({});
  const rollConfig = { _rebreyaStormRuneMode: "advantage" };
  const dialogConfig = {};
  assert.equal(service.applyDnd5eStormRollMode(rollConfig, dialogConfig, {}, "check"), true);
  assert.equal(rollConfig.advantage, true);
  assert.equal(dialogConfig.advantage, true);
  assert.equal(rollConfig._rebreyaStormRuneApplied, true);
  service.applyDnd5eStormRollMode(rollConfig, dialogConfig, {}, "check");
  assert.equal(rollConfig._rebreyaStormRuneApplied, true);
});

function createGiantMightHarness({
  giantSpent = 0,
  dominanceSpent = 0,
  dominanceMax = 4,
  fallbackAccepted = true,
  canGrow = true,
  effectFails = false,
  features = [],
  hugeAccepted = true
} = {}) {
  const giantItem = createItem({ id: "giant-might", automation: "giant-might", spent: giantSpent, max: 4 });
  const dominanceItem = createItem({ id: "dominance", spent: dominanceSpent, max: dominanceMax, identifier: "fighter-dominance" });
  const actor = assignActorIdentity(createActor({
    level: features.some((item) => item.flags?.["rebreya-main"]?.runeKnightAutomation?.id === "runic-juggernaut") ? 18 : 10,
    prof: 4,
    items: [giantItem, dominanceItem, ...features]
  }), "giant-actor", "Rune Giant");
  actor.getRollData = () => ({
    scale: {
      "fighter-rework-v028": {
        "dominance-dice": { value: 4 }
      }
    }
  });
  const token = {
    id: "giant-token",
    uuid: "Scene.scene.Token.giant",
    actor,
    x: 100,
    y: 100,
    width: 1,
    height: 1,
    async update(patch) {
      Object.assign(this, patch);
      return this;
    }
  };
  if (effectFails) {
    actor.createEmbeddedDocuments = async () => {
      throw new Error("giant form failed");
    };
  }
  const calls = { prompts: 0, promptTitles: [], damage: 0, damageFormulas: [] };
  const moduleApi = {
    reactionQueueService: {
      async promptDecision({ prompt }) {
        calls.prompts += 1;
        calls.promptTitles.push(prompt.title);
        if (prompt.title === "Мощь великана") return { accepted: fallbackAccepted };
        if (prompt.title === "Рунический исполин") {
          return { accepted: hugeAccepted, size: "huge" };
        }
        return { accepted: false };
      }
    }
  };
  const service = new RuneKnightAutomationService(moduleApi, {
    canGrowToken: () => canGrow,
    createDamageRoll: async (formula, damageType, sourceActor, flavor) => {
      calls.damage += 1;
      calls.damageFormulas.push(formula);
      return { formula, damageType, actor: sourceActor, flavor, total: 4 };
    }
  });
  const activity = {
    actor,
    item: giantItem,
    flags: {
      "rebreya-main": {
        runeKnightAutomation: { id: "giant-might" }
      }
    }
  };
  return { service, activity, actor, token, giantItem, dominanceItem, calls };
}

test("Giant's Might spends its PB resource, creates the form, and restores owned size values", async () => {
  const harness = createGiantMightHarness();

  assert.equal(await harness.service.applyDnd5ePostUseActivity(harness.activity, { token: harness.token }), true);
  assert.equal(harness.giantItem.system.uses.spent, 1);
  assert.equal(harness.dominanceItem.system.uses.spent, 0);
  assert.equal(harness.calls.prompts, 0);
  assert.equal(harness.actor.system.traits.size, "lg");
  assert.equal(harness.token.width, 2);
  assert.equal(harness.token.height, 2);
  const effect = harness.actor.createdEffects[0];
  assert.equal(effect.duration.seconds, 60);
  assert.equal(effect.flags["rebreya-main"].runeKnight.automation, "giant-might-form");
  assert.deepEqual(effect.flags["rebreya-main"].runeKnight.form.originalToken, {
    x: 100,
    y: 100,
    width: 1,
    height: 1
  });
  assert.ok(effect.changes.some((change) => change.key === "flags.midi-qol.advantage.ability.check.str"));
  assert.ok(effect.changes.some((change) => change.key === "flags.midi-qol.advantage.ability.save.str"));

  harness.actor.effects = harness.actor.effects.filter((entry) => entry !== effect);
  await harness.service.handleEmbeddedEffectDeletion(effect);
  assert.equal(harness.actor.system.traits.size, "med");
  assert.equal(harness.token.width, 1);
  assert.equal(harness.token.height, 1);
  assert.equal(harness.token.x, 100);
  assert.equal(harness.token.y, 100);
});

test("Giant's Might keeps its combat benefits when there is no room to grow", async () => {
  const harness = createGiantMightHarness({ canGrow: false });

  assert.equal(await harness.service.applyDnd5ePostUseActivity(harness.activity, { token: harness.token }), true);
  assert.equal(harness.actor.system.traits.size, "med");
  assert.equal(harness.token.width, 1);
  assert.equal(harness.actor.createdEffects.length, 1);
  assert.equal(harness.actor.createdEffects[0].flags["rebreya-main"].runeKnight.form.grew, false);
});

test("Giant's Might cleanup does not overwrite size values changed by another source", async () => {
  const harness = createGiantMightHarness();
  await harness.service.applyDnd5ePostUseActivity(harness.activity, { token: harness.token });
  const effect = harness.actor.createdEffects[0];
  harness.actor.system.traits.size = "huge";
  harness.token.width = 3;
  harness.actor.effects = [];

  await harness.service.handleEmbeddedEffectDeletion(effect);

  assert.equal(harness.actor.system.traits.size, "huge");
  assert.equal(harness.token.width, 3);
});

test("Giant's Might offers one dominance die only when its own PB uses are empty", async () => {
  const fallback = createGiantMightHarness({
    giantSpent: 4,
    dominanceMax: "@scale.fighter-rework-v028.dominance-dice"
  });
  assert.equal(await fallback.service.applyDnd5ePostUseActivity(fallback.activity, { token: fallback.token }), true);
  assert.equal(fallback.giantItem.system.uses.spent, 4);
  assert.equal(fallback.dominanceItem.system.uses.spent, 1);
  assert.equal(fallback.calls.prompts, 1);

  const empty = createGiantMightHarness({ giantSpent: 4, dominanceSpent: 4 });
  assert.equal(await empty.service.applyDnd5ePostUseActivity(empty.activity, { token: empty.token }), false);
  assert.equal(empty.actor.createdEffects.length, 0);
  assert.equal(empty.calls.prompts, 0);
});

test("Giant's Might rolls back the chosen resource when form creation fails", async () => {
  const harness = createGiantMightHarness({ giantSpent: 4, effectFails: true });

  await assert.rejects(
    harness.service.applyDnd5ePostUseActivity(harness.activity, { token: harness.token }),
    /giant form failed/u
  );
  assert.equal(harness.giantItem.system.uses.spent, 4);
  assert.equal(harness.dominanceItem.system.uses.spent, 0);
  assert.equal(harness.actor.system.traits.size, "med");
  assert.equal(harness.token.width, 1);
});

test("Giant's Might adds damage to the first weapon hit on the actor's turn only", async () => {
  const harness = createGiantMightHarness();
  await harness.service.applyDnd5ePostUseActivity(harness.activity, { token: harness.token });
  const previousGameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "game");
  Object.defineProperty(globalThis, "game", {
    configurable: true,
    writable: true,
    value: {
    id: "giant-combat",
    combat: {
      id: "giant-combat",
      round: 2,
      turn: 1,
      combatant: { actor: harness.actor, token: harness.token }
    }
    }
  });
  const workflow = {
    id: "giant-damage",
    actor: harness.actor,
    token: harness.token,
    item: { id: "greatsword", type: "weapon", name: "Greatsword" },
    hitTargets: new Set([{ id: "target", uuid: "Scene.scene.Token.target", actor: createActor() }]),
    bonusDamageRolls: [],
    async setBonusDamageRolls(rolls) {
      this.bonusDamageRolls = rolls;
    }
  };
  try {
    await harness.service.applyMidiPreDamageRollComplete(workflow);
    await harness.service.applyMidiPreDamageRollComplete(workflow);
    assert.equal(harness.calls.damage, 1);
    assert.equal(workflow.bonusDamageRolls.length, 1);
    assert.equal(workflow.bonusDamageRolls[0].formula, "1d6");

    globalThis.game.combat.combatant = { actor: createActor(), token: null };
    const outOfTurn = { ...workflow, id: "giant-out-of-turn", bonusDamageRolls: [] };
    await harness.service.applyMidiPreDamageRollComplete(outOfTurn);
    assert.equal(outOfTurn.bonusDamageRolls.length, 0);
  }
  finally {
    if (previousGameDescriptor) Object.defineProperty(globalThis, "game", previousGameDescriptor);
    else delete globalThis.game;
  }
});

test("Giant's Might native damage fallback uses the same once-per-turn key", async () => {
  const harness = createGiantMightHarness();
  await harness.service.applyDnd5ePostUseActivity(harness.activity, { token: harness.token });
  const previousGameDescriptor = Object.getOwnPropertyDescriptor(globalThis, "game");
  Object.defineProperty(globalThis, "game", {
    configurable: true,
    writable: true,
    value: {
      combat: {
        id: "giant-native-combat",
        round: 1,
        turn: 0,
        combatant: { actor: harness.actor, token: harness.token }
      }
    }
  });
  const weapon = { id: "maul", type: "weapon", name: "Maul", actor: harness.actor };
  const activity = { id: "maul-activity", actor: harness.actor, item: weapon };
  const first = { subject: activity, rolls: [] };
  const second = { subject: activity, rolls: [] };
  try {
    assert.equal(harness.service.applyDnd5eGiantMightDamage(first, {}, {}), true);
    assert.equal(harness.service.applyDnd5eGiantMightDamage(second, {}, {}), true);
    assert.equal(first.rolls.length, 1);
    assert.deepEqual(first.rolls[0].parts, ["1d6"]);
    assert.equal(second.rolls.length, 0);
  }
  finally {
    if (previousGameDescriptor) Object.defineProperty(globalThis, "game", previousGameDescriptor);
    else delete globalThis.game;
  }
});

test("Great Stature records one 3d4 height increase and never rerolls during repair", async () => {
  const greatStature = createItem({ id: "great-stature", automation: "great-stature" });
  const actor = assignActorIdentity(createActor({ level: 10, prof: 4, items: [greatStature] }), "stature-actor", "Tall Knight");
  const calls = { rolls: 0, chats: [] };
  const service = new RuneKnightAutomationService({}, {
    async rollFormula(formula) {
      calls.rolls += 1;
      assert.equal(formula, "3d4");
      return { formula, total: 9 };
    },
    async createChatMessage(data) {
      calls.chats.push(data);
      return data;
    }
  });

  await service.repairActor(actor);
  await service.repairActor(actor);

  assert.equal(getProperty(actor, "flags.rebreya-main.runeKnight.heightIncreaseInches"), 9);
  assert.equal(calls.rolls, 1);
  assert.equal(calls.chats.length, 1);
  assert.match(calls.chats[0].content, /9/u);
});

test("Master of Runes synchronizes and restores every owned rune to two uses", async () => {
  const runes = ["stone", "frost", "cloud", "fire", "hill", "storm"].map((id) => (
    createItem({ id, automation: id, spent: 2, max: 1 })
  ));
  const master = createItem({ id: "master", automation: "master-of-runes" });
  const actor = createActor({ level: 15, prof: 5, items: [...runes, master] });
  const service = new RuneKnightAutomationService({});

  await service.repairActor(actor);
  assert.deepEqual(runes.map((item) => item.system.uses.max), [2, 2, 2, 2, 2, 2]);
  await service.handleRestCompleted(actor, { type: "short" });
  assert.deepEqual(runes.map((item) => item.system.uses.spent), [0, 0, 0, 0, 0, 0]);
});

test("Great Stature and Runic Juggernaut progress Giant's Might damage dice", async () => {
  const great = createItem({ id: "great-stature", automation: "great-stature" });
  const stature = createGiantMightHarness({ features: [great] });
  await stature.service.applyDnd5ePostUseActivity(stature.activity, { token: stature.token });
  const statureConfig = {
    subject: { id: "stature-attack", actor: stature.actor, item: { id: "sword", type: "weapon", actor: stature.actor } },
    rolls: []
  };
  stature.service.applyDnd5eGiantMightDamage(statureConfig);
  assert.deepEqual(statureConfig.rolls[0].parts, ["1d8"]);

  const juggernaut = createItem({ id: "runic-juggernaut", automation: "runic-juggernaut" });
  const huge = createGiantMightHarness({ features: [juggernaut] });
  await huge.service.applyDnd5ePostUseActivity(huge.activity, { token: huge.token });
  const hugeConfig = {
    subject: { id: "huge-attack", actor: huge.actor, item: { id: "maul", type: "weapon", actor: huge.actor } },
    rolls: []
  };
  huge.service.applyDnd5eGiantMightDamage(hugeConfig);
  assert.deepEqual(hugeConfig.rolls[0].parts, ["1d10"]);
});

test("Runic Juggernaut can create a Huge form with source-owned reach", async () => {
  const juggernaut = createItem({ id: "runic-juggernaut", automation: "runic-juggernaut" });
  const huge = createGiantMightHarness({ features: [juggernaut], hugeAccepted: true });
  await huge.service.applyDnd5ePostUseActivity(huge.activity, { token: huge.token });
  const effect = huge.actor.createdEffects[0];

  assert.deepEqual(huge.calls.promptTitles, ["Рунический исполин"]);
  assert.equal(huge.actor.system.traits.size, "huge");
  assert.equal(huge.token.width, 3);
  assert.equal(effect.flags["rebreya-main"].runeKnight.reachBonus, 5);
  assert.equal(effect.flags["rebreya-main"].runeKnight.form.appliedActorSize, "huge");

  const large = createGiantMightHarness({ features: [
    createItem({ id: "runic-juggernaut", automation: "runic-juggernaut" })
  ], hugeAccepted: false });
  await large.service.applyDnd5ePostUseActivity(large.activity, { token: large.token });
  assert.equal(large.actor.system.traits.size, "lg");
  assert.equal(large.actor.createdEffects[0].flags["rebreya-main"].runeKnight.reachBonus, 0);
});

test("Rune Knight hooks stay actor-local", async () => {
  const source = await readFile(new URL("../scripts/combat/hooks.js", import.meta.url), "utf8");
  const serviceSource = await readFile(
    new URL("../scripts/combat/rune-knight-automation-service.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /hasRuneKnightService/u);
  assert.match(serviceSource, /id: "rune-knight\.restore"/u);
  assert.match(serviceSource, /registerLongRestSteps\(pipeline\)/u);
  assert.match(source, /runeKnightAutomationService\.handleEmbeddedItemChange\(item\)/u);
  assert.match(source, /runeKnightAutomationService\.handleEmbeddedEffectChange\(effect\)/u);
  assert.match(source, /runeKnightAutomationService\.applyDnd5ePostUseActivity/u);
  assert.match(source, /runeKnightAutomationService\.applyDnd5ePreRollToolCheck/u);
  assert.match(source, /runeKnightAutomationService\.applyDnd5ePreRollSavingThrow/u);
  assert.match(source, /runeKnightAutomationService\.applyMidiStormPreRoll/u);
  assert.match(source, /runeKnightAutomationService\.applyDnd5eStormRollMode/u);
  assert.match(source, /midi-qol\.preTargetSave/u);
  assert.match(source, /dnd5e\.preRollD20Test/u);
  assert.match(source, /runeKnightAutomationService\.applyDnd5eGiantMightDamage/u);
  assert.match(source, /runeKnightAutomationService\.handleEmbeddedEffectDeletion/u);
  assert.match(source, /runeKnightAutomationService\.prepareActiveEffectCreate/u);
});
