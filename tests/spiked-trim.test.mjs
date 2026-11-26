import test from "node:test";
import assert from "node:assert/strict";
import { SpikedTrimService, registerSpikedTrimHooks } from "../scripts/combat/spiked-trim-service.js";

const moduleId = "rebreya-main";
const defenderUuid = "Scene.scene.Token.defender";
const cardUuid = "ChatMessage.attack";
const productId = "шипастая-отделка-доспеха";

function setup({ midi = true, hitClass = "success", mode = "oneHanded", equipped = true, owner = true, legacyOverride = false } = {}) {
  const player = { id: "player" };
  const gm = { id: "gm", isGM: true };
  const hooks = new Map();
  const applied = [], requests = [];
  const attacker = {
    uuid: "Actor.attacker", flags: { [moduleId]: {} },
    testUserPermission: user => owner && user === player,
    async applyDamage(damages, options) {
      const updates = { "system.attributes.hp.value": 18 };
      hooks.get("dnd5e.preApplyDamage")(this, 2, updates, options);
      Object.assign(this.flags[moduleId], {
        spikedTrimReceipts: updates[`flags.${moduleId}.spikedTrimReceipts`]
      });
      applied.push(damages);
    }
  };
  const host = { id: "armor", type: "equipment", system: { equipped, quantity: 1, type: { value: "heavy" } },
    flags: { [moduleId]: { itemUpgrades: { capacity: 1, installed: [{ itemId: "trim", slotIndex: 1 }] } } } };
  const trim = { id: "trim", system: { container: host.id, quantity: 1 }, flags: { [moduleId]: {
    gearId: "shipastaya-otdelka-dospekha", installedUpgrade: { hostItemId: host.id, slotIndex: 1 }
  } } };
  const defender = { uuid: "Actor.defender", items: new Map([[host.id, host], [trim.id, trim]]) };
  const token = { uuid: defenderUuid, actor: defender };
  const activity = { type: "attack", actor: attacker, attack: { type: { value: "melee" } } };
  const roll = { total: 17, options: { attackMode: mode, ...(midi ? { "midi-qol": { rollType: "attack" } } : {}) } };
  const card = {
    id: "attack", uuid: cardUuid, type: midi ? "usage" : "attack", author: player, speaker: { scene: "scene" },
    getAssociatedActivity: () => activity, getAssociatedActor: () => attacker, rolls: [roll],
    system: { targets: [{ token: defenderUuid, actor: defender.uuid }],
      ...(midi ? { midi: { sections: { hits: { data: { hits: [{ uuid: defenderUuid, hitClass }] } } } } } : {}) }
  };
  const game = { user: midi ? player : gm, modules: new Map([["midi-qol", { active: midi }]]),
    messages: new Map([[card.id, card]]) };
  const context = { sender: player, assertActiveGm() {} };
  const service = new SpikedTrimService({
    itemUpgradeService: { getUpgradeProjection: async () => ({ sourceId: productId, legacyOverride, availability: { decision: "event-implemented" } }) },
    privilegedMutationGateway: { async mutate(command, payload, options) {
      requests.push({ command, payload, options });
      if (!service.authorize(payload, context)) return;
      return service.execute(payload, context);
    } }
  }, { game: () => game, resolveToken: uuid => uuid === defenderUuid ? token : null, isAuthority: () => !midi });
  registerSpikedTrimHooks({ on: (event, handler) => hooks.set(event, handler) }, service);
  const workflow = { itemCardUuid: cardUuid, attackRoll: roll, activity, targets: new Set([token]), chatCard: card };
  return { hooks, applied, requests, attacker, trim, activity, roll, card, workflow, service, context,
    payload: { cardUuid, targetUuid: defenderUuid } };
}

for (const hitClass of ["success", "failure"]) {
  test(`equipped spiked trim retaliates after a melee ${hitClass}, once on the attacker`, async () => {
    const { hooks, workflow, applied, requests } = setup({ hitClass });
    await hooks.get("midi-qol.RollComplete")(workflow);
    await hooks.get("midi-qol.RollComplete")(workflow);
    assert.equal(applied.length, 1);
    assert.equal(applied[0][0].value, 2);
    assert.equal(applied[0][0].type, "piercing");
    assert.equal(requests[0].options.operationId, requests[1].options.operationId);
  });
}

test("ranged, thrown, unequipped, custom profile and unauthorized attacks cannot retaliate", async () => {
  const thrown = setup({ mode: "thrown-oneHanded" });
  const ranged = setup();
  ranged.activity.attack.type.value = "ranged";
  const unequipped = setup({ equipped: false });
  const foreign = setup({ owner: false });
  const staleLink = setup();
  staleLink.trim.system.container = "different";
  for (const example of [thrown, ranged, setup({ mode: "ranged" }), unequipped, foreign, staleLink, setup({ legacyOverride: true })]) {
    await example.hooks.get("midi-qol.RollComplete")(example.workflow);
    assert.equal(example.applied.length, 0);
  }
  const { service, payload, context } = setup();
  assert.equal(service.authorize(payload, { sender: { id: "other" } }), false);
  assert.equal(service.authorize({ ...payload, targetUuid: "Scene.scene.Token.other" }, context), false);
});

test("native dnd5e attack card applies the same retaliation when MIDI is disabled", async () => {
  const { hooks, card, applied } = setup({ midi: false });
  await hooks.get("createChatMessage")(card);
  assert.equal(applied.length, 1);
});

test("the typed command accepts card and target references only and locks the attacker actor", () => {
  const { service, payload, context } = setup();
  service.registerCommand({ registerCommand(name, command) {
    assert.equal(name, "item-upgrade.spiked-trim");
    assert.equal(command.validate(payload), true);
    assert.equal(command.validate({ ...payload, damage: 100 }), false);
    assert.equal(command.validate({ ...payload, targetUuid: "Actor.defender" }), false);
    assert.equal(command.authorize(payload, context), true);
    assert.deepEqual(command.scheduling.keys(payload), ["actor:attacker"]);
  } });
});
