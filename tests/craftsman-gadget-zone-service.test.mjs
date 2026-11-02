import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= { utils: { deepClone: (value) => structuredClone(value) } };

const {
  CraftsmanGadgetZoneService,
  isTokenInsideCraftsmanSmoke
} = await import("../scripts/combat/craftsman-gadget-zone-service.js");

function template({ id = "smoke", x = 100, y = 100, poisoned = false } = {}) {
  const document = {
    id,
    uuid: `Scene.scene.MeasuredTemplate.${id}`,
    x,
    y,
    distance: 15,
    flags: {
      "rebreya-main": {
        craftsmanSmoke: {
          instanceId: "g1",
          ownerActorUuid: "Actor.owner",
          craftsmanLevel: 5,
          poisoned,
          expiresAtTurnKey: "combat:2:0"
        }
      }
    },
    object: {
      shape: {
        contains: (localX, localY) => localX >= 0 && localY >= 0 && localX <= 300 && localY <= 300
      }
    },
    async update(patch) {
      this.flags["rebreya-main"].craftsmanSmoke = structuredClone(
        patch["flags.rebreya-main.craftsmanSmoke"]
      );
      return this;
    },
    async delete() {
      this.deleted = true;
    }
  };
  return document;
}

function token(x, y, actor = { uuid: "Actor.target" }) {
  return {
    center: { x, y },
    actor,
    document: { x, y, width: 1, height: 1 }
  };
}

test("token membership uses the managed template shape", () => {
  const zone = template();
  assert.equal(isTokenInsideCraftsmanSmoke(zone, token(250, 250)), true);
  assert.equal(isTokenInsideCraftsmanSmoke(zone, token(450, 450)), false);
});

test("gadget action poisons the existing cloud without creating another", async () => {
  const zone = template();
  let createCalls = 0;
  const service = new CraftsmanGadgetZoneService({
    createPoisonedTemplate: async () => {
      createCalls += 1;
      return template({ id: "second" });
    }
  });
  service.registerTemplate(zone);
  const result = await service.poisonTemplate("g1", {});
  assert.equal(result, zone);
  assert.equal(zone.flags["rebreya-main"].craftsmanSmoke.poisoned, true);
  assert.equal(createCalls, 0);
});

test("cancelled activation placement lets the action create one already-poisoned cloud", async () => {
  const created = template({ id: "poisoned" });
  let createCalls = 0;
  const service = new CraftsmanGadgetZoneService({
    createPoisonedTemplate: async (context) => {
      createCalls += 1;
      assert.equal(context.instanceId, "g1");
      return created;
    }
  });
  const result = await service.poisonTemplate("g1", {
    ownerActorUuid: "Actor.owner",
    craftsmanLevel: 5,
    expiresAtTurnKey: "combat:2:0"
  });
  assert.equal(result, created);
  assert.equal(createCalls, 1);
  assert.equal(created.flags["rebreya-main"].craftsmanSmoke.poisoned, true);
});

test("only the active GM damages a token that starts its turn inside poisoned smoke", async () => {
  const damageCalls = [];
  const zone = template({ poisoned: true });
  const target = token(250, 250);
  const service = new CraftsmanGadgetZoneService({
    isActiveGmClient: () => true,
    applyPoisonDamage: async (actor, amount) => damageCalls.push({ actor, amount })
  });
  service.registerTemplate(zone);
  await service.handleCombatTurn({ id: "combat", round: 1, turn: 0, combatant: { token: target } });
  assert.deepEqual(damageCalls, [{ actor: target.actor, amount: 5 }]);

  const playerService = new CraftsmanGadgetZoneService({
    isActiveGmClient: () => false,
    applyPoisonDamage: async () => damageCalls.push("duplicate")
  });
  playerService.registerTemplate(zone);
  await playerService.handleCombatTurn({ id: "combat", round: 1, turn: 0, combatant: { token: target } });
  assert.equal(damageCalls.includes("duplicate"), false);
});

test("owner turn expiry removes the single managed cloud", async () => {
  const zone = template({ poisoned: true });
  const service = new CraftsmanGadgetZoneService({ isActiveGmClient: () => true });
  service.registerTemplate(zone);
  await service.handleCombatTurn({ id: "combat", round: 2, turn: 0, combatant: { token: token(500, 500) } });
  assert.equal(zone.deleted, true);
  assert.equal(service.getTemplate("g1"), null);
});

test("strong obscuration is reported when either endpoint or the line crosses smoke", () => {
  const service = new CraftsmanGadgetZoneService();
  service.registerTemplate(template());
  assert.equal(service.isSightObscured(token(50, 250), token(450, 250)), true);
  assert.equal(service.isSightObscured(token(50, 50), token(50, 450)), false);
});

test("default poison damage uses a typed dnd5e poison damage entry", async () => {
  const calls = [];
  const actor = { applyDamage: async (...args) => calls.push(args) };
  const zone = template({ poisoned: true });
  const service = new CraftsmanGadgetZoneService({ isActiveGmClient: () => true });
  service.registerTemplate(zone);

  await service.handleCombatTurn({ combatant: { token: token(250, 250, actor) } });

  assert.deepEqual(calls, [[[{ value: 5, type: "poison" }]]]);
});

test("scene reindex replaces stale templates and document deletion only unregisters", () => {
  const first = template({ id: "first" });
  const second = template({ id: "second" });
  const service = new CraftsmanGadgetZoneService();
  service.registerTemplate(first);
  assert.equal(service.getTemplate("g1"), first);

  service.registerSceneTemplates({ templates: { contents: [second] } });
  assert.equal(service.getTemplate("g1"), second);
  service.unregisterTemplate(second);
  assert.equal(service.getTemplate("g1"), null);
  assert.equal(second.deleted, undefined);
});

test("native Region smoke reindexes on load and tests the actor center and sight segment at their elevations",async t=>{
  const old=globalThis.game;globalThis.game={release:{generation:14}};t.after(()=>{globalThis.game=old;});
  const region={documentName:"Region",flags:template({poisoned:true}).flags,
    testPoint:p=>p.x===450 && p.y===450 && p.elevation===5,
    segmentizeMovementPath:([a,b])=>a.x===200 && b.x===900 && a.elevation===b.elevation?[{type:1}]:[]};
  const service=new CraftsmanGadgetZoneService();
  assert.equal(service.registerSceneTemplates({regions:new Map([["smoke",region]]),get templates(){throw Error("deprecated compatibility collection touched");}}),1);
  assert.equal(isTokenInsideCraftsmanSmoke(region,{center:{x:450,y:450},document:{elevation:5}}),true);
  assert.equal(isTokenInsideCraftsmanSmoke(region,{center:{x:450,y:450},document:{elevation:20}}),false);
  assert.equal(service.isSightObscured(token(200,300),token(900,300)),true);
  assert.equal(service.isSightObscured(token(20,300),token(100,300)),false);
});

test("a smoke update or deletion on another scene cannot replace or discard the viewed scene's index",()=>{
  const first={id:"first"},other={id:"other"};
  const current={...template(),parent:first},foreign={...template({id:"elsewhere"}),parent:other};
  first.templates={contents:[current]};
  const service=new CraftsmanGadgetZoneService();
  service.registerSceneTemplates(first);
  service.registerTemplate(foreign);
  assert.equal(service.getTemplate("g1"),current);
  service.clearTemplates(other);
  assert.equal(service.getTemplate("g1"),current);
  service.clearTemplates(first);
  assert.equal(service.getTemplate("g1"),null);
});
