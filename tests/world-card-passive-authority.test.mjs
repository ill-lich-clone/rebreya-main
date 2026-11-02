import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPassiveModifier,
  receiveIncomingPassive,
  routeIncomingPassive
} from "../scripts/integrations/world-card-automations/passive-authority.js";

function fixture(duel = false) {
  const gm = { id: "gm", isGM: true, active: true },
    owner = { id: "owner", active: true },
    game = { user: owner };
  const actor = (id) => ({
    uuid: "Actor." + id,
    id,
    name: id,
    hasPlayerOwner: true,
    system: { attributes: { hp: { value: 20 } } },
    testUserPermission: () => true
  });
  const scene = { uuid: "Scene.s" },
    token = (id, a, disposition) => {
      const doc = {
        id,
        uuid: "Scene.s.Token." + id,
        documentName: "Token",
        actor: a,
        name: id,
        disposition,
        parent: scene
      };
      doc.object = { document: doc, actor: a };
      return doc;
    };
  const source = token("s", actor("caster"), 1),
    target = token("t", actor("protected"), 1),
    attacker = token("a", actor("attacker"), -1);
  const id = duel ? "compelledDuel" : "wardingBond",
    kind = duel ? "compelledDuelCompelled" : "wardingBondTarget";
  const item = {
    uuid: source.actor.uuid + ".Item.spell",
    actor: source.actor,
    documentName: "Item",
    system: { activities: new Map() },
    flags: { "chris-premades": { info: { identifier: id }, activityIdentifiers: { wardingBondDamage: "damage" } } }
  };
  const feature = { item };
  item.system.activities.set("damage", feature);
  const receipts = new Map();
  const parent = {
    uuid: source.actor.uuid + ".ActiveEffect.parent",
    documentName: "ActiveEffect",
    origin: item.uuid,
    parent: source.actor,
    flags: {
      "chris-premades": {
        info: { identifier: id + "Source" },
        [id]: { [duel ? "targetUuids" : "bondUuids"]: [target.uuid] }
      }
    },
    getFlag: (_, k) => receipts.get(k),
    setFlag: async (_, k, v) => {
      receipts.set(k, v);
    }
  };
  let deleted = 0;
  const effect = {
    uuid: target.actor.uuid + ".ActiveEffect.child",
    documentName: "ActiveEffect",
    parent: target.actor,
    origin: item.uuid,
    flags: {
      "chris-premades": {
        info: { identifier: id + "Target" },
        parentEntityUuid: parent.uuid,
        [id]: { [duel ? "sourceUuid" : "bondUuid"]: source.uuid }
      }
    },
    delete: async () => {
      deleted++;
    }
  };
  const message = {
    uuid: "ChatMessage.msg",
    id: "msg",
    documentName: "ChatMessage",
    timestamp: Date.now(),
    author: gm,
    getAssociatedToken: () => attacker,
    getAssociatedItem: () => ({ name: "Attack", actor: attacker.actor })
  };
  const docs = new Map([source, target, attacker, item, parent, effect, message].map((d) => [d.uuid, d]));
  const workflow = {
    itemCardUuid: message.uuid,
    token: attacker.object,
    hitTargets: new Set([target.object]),
    damageList: [{ actorId: target.actor.id, tokenUuid: target.uuid, damageDetail: [{ value: 5 }, { value: 2.5 }] }]
  };
  let rolls = [];
  const deps = {
    game,
    sender: gm,
    resolve: (u) => docs.get(u),
    confirm: async () => true,
    ownerFor: () => owner,
    rollDamage: async (a, amount, pair) => {
      assert.equal(a, feature);
      assert.equal(pair.source, source);
      rolls.push(amount);
    }
  };
  let data;
  const send = async () =>
    routeIncomingPassive(
      kind,
      { workflow, trigger: { entity: effect, token: target.object } },
      async (a, p) => {
        assert.equal(a, duel ? target.actor : source.actor);
        data = p;
      },
      deps.resolve
    );
  return {
    source,
    target,
    attacker,
    effect,
    item,
    parent,
    workflow,
    message,
    docs,
    deps,
    kind,
    send,
    get data() {
      return data;
    },
    rolls,
    get deleted() {
      return deleted;
    }
  };
}
test("a real reciprocal Warding Bond transfers only the struck token's final damage once, including duplicate deliveries", async () => {
  const f = fixture();
  f.workflow.damageList.unshift({ actorId: "other", tokenUuid: "Scene.s.Token.other", damageDetail: [{ value: 99 }] });
  await f.send();
  assert.equal(f.data.damage, 7);
  await Promise.all([receiveIncomingPassive(f.data, f.deps), receiveIncomingPassive(f.data, f.deps)]);
  await receiveIncomingPassive(f.data, f.deps);
  assert.deepEqual(f.rolls, [7]);
});
test("no hit, forged reciprocal effect, wrong source token, reused message or redirected owner cannot apply damage", async () => {
  const f = fixture();
  await f.send();
  const request = f.data;
  await assert.rejects(receiveIncomingPassive({ ...request, effect: "Actor.missing.ActiveEffect.fake" }, f.deps));
  await assert.rejects(receiveIncomingPassive({ ...request, attacker: f.source.uuid }, f.deps));
  f.deps.game.user = { id: "other" };
  await assert.rejects(receiveIncomingPassive(request, f.deps));
  f.deps.game.user = f.deps.ownerFor();
  f.message.author = { id: "forged" };
  await assert.rejects(receiveIncomingPassive(request, f.deps));
  f.message.author = f.deps.sender;
  f.message.flags = { "midi-qol": { damageList: f.workflow.damageList } };
  await assert.rejects(receiveIncomingPassive({ ...request, damage: 999 }, f.deps));
  f.parent.flags["chris-premades"].wardingBond.bondUuids = [];
  await assert.rejects(receiveIncomingPassive(request, f.deps));
  assert.deepEqual(f.rolls, []);
  const no = fixture();
  no.workflow.hitTargets.clear();
  await no.send();
  assert.equal(no.data, undefined);
});
test("Compelled Duel ends only the linked target effect after a hostile third party hits", async () => {
  const f = fixture(true);
  await f.send();
  await receiveIncomingPassive(f.data, f.deps);
  assert.equal(f.deleted, 1);
  const ally = fixture(true);
  ally.attacker.disposition = ally.target.disposition;
  await ally.send();
  assert.equal(ally.data, undefined);
  const fake = fixture(true);
  fake.parent.flags["chris-premades"].compelledDuel.targetUuids = [];
  await fake.send();
  assert.equal(fake.data, undefined);
});
test("a fabricated Blur flag without its native concentration cannot change the workflow", async () => {
  const f = fixture(),
    actor = f.target.actor;
  f.item.actor = actor;
  f.item.flags["chris-premades"].info.identifier = "blur";
  f.effect.flags["chris-premades"].info.identifier = "blurEffect";
  await applyPassiveModifier(
    "blurEffect",
    { workflow: {}, trigger: { token: f.target.object, entity: f.effect } },
    f.deps.resolve
  );
});

test("a verified Blur uses the shipped passive to add disadvantage before the roll", async (t) => {
  const f = fixture(),
    actor = f.target.actor;
  f.item.actor = actor;
  f.item.flags["chris-premades"].info.identifier = "blur";
  f.effect.flags["chris-premades"].info.identifier = "blurEffect";
  f.effect.name = "Blur";
  f.effect.flags["chris-premades"].concentrationEffectUuid = "Actor.protected.ActiveEffect.conc";
  const previous = globalThis.MidiQOL,
    config = globalThis.CONFIG;
  globalThis.CONFIG = { Canvas: { darknessAnimations: {} } };
  globalThis.MidiQOL = {
    getConcentrationEffect: () => ({ uuid: f.effect.flags["chris-premades"].concentrationEffectUuid }),
    canSense: () => false
  };
  t.after(() => {
    globalThis.MidiQOL = previous;
    globalThis.CONFIG = config;
  });
  const calls = [];
  const workflow = {
    activity: { getActionType: () => "mwak" },
    targets: new Set([f.target.object]),
    token: f.attacker.object,
    tracker: { disadvantage: { add: (...args) => calls.push(args) } }
  };
  await applyPassiveModifier(
    "blurEffect",
    { workflow, trigger: { entity: f.effect, token: f.target.object } },
    f.deps.resolve
  );
  assert.deepEqual(calls, [["Blur", "Blur"]]);
});
