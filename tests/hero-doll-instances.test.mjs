import test from "node:test";
import assert from "node:assert/strict";
import { HeroDollService, isValidHeroDollAssignPayload } from "../scripts/data/hero-doll-service.js";
import { buildHeldItemHandUpdate, buildHeldItemReleaseHandUpdate } from "../scripts/integrations/held-items.js";
import { filterMagicItemSpellbook } from "../scripts/integrations/magic-item-spellbook.js";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";

function setup(options={}) {
  const fx=makeInstanceDocumentsFixture({quantity:2,...options});
  fx.group.flags["rebreya-main"].managedPartyGroup=true;
  fx.group.items.contents=[];fx.hero.items.contents.push(fx.source);fx.source.parent=fx.hero;
  fx.service=new HeroDollService(fx.api);
  fx.payload={actorUuid:fx.hero.uuid,sourceItemUuid:fx.source.uuid,slotId:"neck",operationId:"equip-1"};
  fx.run=(payload=fx.payload,sender=game.user)=>fx.service.executeAssignItemToSlot(payload,{sender});
  return fx;
}

test("doll assignments validate exact synthetic actor and item UUIDs", () => {
  const actorUuid = "Scene.sceneA.Token.tokenA.Actor.actorA";
  const payload = { actorUuid, sourceItemUuid: `${actorUuid}.Item.weaponA`, slotId: "leftHand", operationId: "op1" };
  assert.equal(isValidHeroDollAssignPayload(payload), true);
  assert.equal(isValidHeroDollAssignPayload({ ...payload, actorUuid: "Scene.sceneA.Token.tokenA" }), false);
  assert.equal(isValidHeroDollAssignPayload({ ...payload, sourceItemUuid: `${actorUuid}.Item.weaponA.Item.other` }), false);
});

test("legacy mechanized clothing can use the clothing slot despite its old chest metadata", async t => {
  const fx = setup({ quantity: 1, itemFlags: { gearId: "mekhanizirovannaya-odezhda", heroDollSlots: ["chest"] } });
  t.after(() => fx.restore());
  const result = await fx.run({ ...fx.payload, slotId: "clothing" });
  assert.equal(result.itemId, fx.source.id);
  assert.equal(fx.hero.getFlag("rebreya-main", "heroDoll").slots.clothing.itemId, fx.source.id);
});

test("NPC equips and clears a real unit with existing owner authorization",async t=>{
  const fx=setup({quantity:1});t.after(()=>fx.restore());fx.hero.type="npc";
  const result=await fx.run(fx.payload,{id:"player",isGM:false});assert.equal(result.itemId,fx.source.id);
  assert.equal(fx.source.system.equipped,true);
  await fx.service.executeAssignItemToSlot({...fx.payload,operationId:"npc-clear"},{sender:game.user},"clear");
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{});
  assert.equal(fx.total(),1);
});
test("NPC assignment rejects non-owner and unsupported Actor types",async t=>{
  const fx=setup({quantity:1});t.after(()=>fx.restore());fx.hero.type="npc";
  await assert.rejects(fx.run(fx.payload,{id:"stranger",isGM:false}),/доступ|прав|персонаж/iu);
  assert.equal(fx.calls.length,0);
  fx.hero.type="vehicle";
  await assert.rejects(fx.run(),/доступ|прав|персонаж/iu);
});
test("hero equips one real unit and replay does not create another",async t=>{
  const fx=setup();t.after(()=>fx.restore());
  const result=await fx.run();assert.notEqual(result.itemId,fx.source.id);
  assert.equal(fx.source.system.quantity,1);assert.equal(fx.source.system.equipped,false);
  assert.equal(fx.hero.items.get(result.itemId).system.quantity,1);
  assert.equal(fx.hero.items.get(result.itemId).system.equipped,true);
  assert.equal(fx.hero.getFlag("rebreya-main","heroDoll").slots.neck.itemId,result.itemId);
  assert.equal((await fx.run()).itemId,result.itemId);assert.equal(fx.total(),2);
});
test("hero moves an equipped singleton into the third ring slot preserving ID and removes old slot",async t=>{
  const fx=setup({quantity:1,itemFlags:{heroDollSlots:["ring1","ring2"]}});t.after(()=>fx.restore());
  const first=await fx.run({...fx.payload,slotId:"ring1"});
  const second=await fx.run({...fx.payload,slotId:"ring3",operationId:"equip-2"});
  assert.equal(first.itemId,second.itemId);assert.equal(first.itemId,fx.source.id);
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{ring3:{itemId:fx.source.id}});
  assert.equal(fx.calls.filter(([phase])=>phase==="create").length,0);
});

test("legacy five-slot back metadata accepts the two added back slots",async t=>{
  const fx=setup({quantity:1,itemFlags:{heroDollSlots:["back1","back2","back3","back4","back5"]}});t.after(()=>fx.restore());
  await fx.run({...fx.payload,slotId:"back7"});
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{back7:{itemId:fx.source.id}});
});
test("invalid slot, ownership and complex stack fail before writes",async t=>{
  const fx=setup();t.after(()=>fx.restore());
  await assert.rejects(fx.run({...fx.payload,slotId:"leftHand"}));
  await assert.rejects(fx.run(fx.payload,{id:"stranger",isGM:false}));
  fx.source.data.flags["rebreya-main"].itemUpgrades={installed:[{id:"upgrade"}]};
  await assert.rejects(fx.run(),e=>e.code==="complex-stack");
  assert.deepEqual(fx.calls,[]);assert.equal(fx.total(),2);
});
for(const phase of ["create","debit","equip","placement"]) for(const timing of ["before","after"]) {
  test(`hero ${timing} ${phase} failure preserves physical units and slot state`,async t=>{
    const fx=setup();t.after(()=>fx.restore());fx.failAt(phase,timing);
    await assert.rejects(fx.run());
    assert.equal(fx.total(),2);assert.equal(fx.source.system.quantity,2);
    assert.equal(fx.source.system.equipped,false);assert.equal(fx.hero.getFlag("rebreya-main","heroDoll"),undefined);
  });
}


test("legacy normalization keeps equipped original ID and unequipped remainder; clear never merges",async t=>{
  const fx=setup({quantity:3,itemSystem:{equipped:true}});t.after(()=>fx.restore());
  fx.hero.flags["rebreya-main"].heroDoll={version:1,slots:{neck:{itemId:fx.source.id}}};
  const before=fx.source.toObject();fx.service.getActorSnapshot(fx.hero);assert.deepEqual(fx.source.toObject(),before);
  const result=await fx.service.executeAssignItemToSlot(fx.payload,{sender:game.user},"normalize");
  assert.equal(fx.source.system.quantity,1);assert.equal(fx.source.system.equipped,true);
  assert.equal(fx.hero.items.get(result.itemId).system.quantity,2);assert.equal(fx.hero.items.get(result.itemId).system.equipped,false);
  assert.equal(fx.hero.getFlag("rebreya-main","heroDoll").slots.neck.itemId,fx.source.id);
  assert.equal((await fx.service.executeAssignItemToSlot(fx.payload,{sender:game.user},"normalize")).itemId,result.itemId);
  await fx.service.executeAssignItemToSlot({...fx.payload,operationId:"clear-1"},{sender:game.user},"clear");
  assert.equal(fx.source.system.equipped,false);assert.equal(fx.hero.items.contents.length,2);assert.equal(fx.total(),3);
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{});
});

test("a two-handed item occupies one chosen doll slot without taking a real hand",async t=>{
  const fx=setup({quantity:1,itemFlags:{heroDollSlots:["leftHand","rightHand"],handRequirement:2}});t.after(()=>fx.restore());
  fx.source.data.type="weapon";const payload={...fx.payload,slotId:"leftHand"};
  await fx.run(payload);
  assert.equal(fx.source.getFlag("rebreya-main","heldHands"),undefined);
  assert.equal(fx.source.system.equipped,true);
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{leftHand:{itemId:fx.source.id}});
  await fx.service.executeAssignItemToSlot({...payload,operationId:"clear-2"},{sender:game.user},"clear");
  assert.equal(fx.source.getFlag("rebreya-main","heldHands"),undefined);assert.equal(fx.total(),1);
});

test("a mundane sword is a doll candidate independently of its real grip", async t => {
  const fx = setup({ quantity: 1, itemFlags: { heroDollSlots: ["leftHand", "rightHand", "back1"], heldHands: ["left"] }, itemSystem: { equipped: true } });
  t.after(() => fx.restore());
  fx.source.data.type = "weapon";
  fx.source.data.name = "Длинный меч";
  const before = structuredClone(fx.hero.flags["rebreya-main"]);
  let snapshot = fx.service.getActorSnapshot(fx.hero);
  assert.equal(snapshot.slots.find(slot => slot.id === "leftHand").itemId, "");
  assert.equal(snapshot.reservedCount, 0);
  assert.deepEqual(snapshot.inventoryItems.find(item => item.id === fx.source.id)?.allowedSlots, ["leftHand", "rightHand", "back1"]);
  fx.source.flags["rebreya-main"].heldHands = [];
  snapshot = fx.service.getActorSnapshot(fx.hero);
  assert.equal(snapshot.slots.find(slot => slot.id === "leftHand").itemId, "");
  assert.equal(snapshot.inventoryItems.some(item => item.id === fx.source.id), true);
  assert.deepEqual(fx.hero.flags["rebreya-main"], before);

  await fx.run({ ...fx.payload, slotId: "back1" });
  snapshot = fx.service.getActorSnapshot(fx.hero);
  assert.equal(snapshot.slots.find(slot => slot.id === "back1").itemId, fx.source.id);
  assert.equal(snapshot.inventoryItems.some(item => item.id === fx.source.id), false);
  assert.deepEqual(fx.source.getFlag("rebreya-main", "heldHands"), []);
});

test("hero doll candidates include compatible items regardless of magic", async t => {
  const fx = setup({ quantity: 1, itemFlags: { heroDollSlots: ["neck"] } });
  t.after(() => fx.restore());
  const [magic, clothing, incompatible] = await fx.hero.createEmbeddedDocuments("Item", [
    { _id: "magic-ring", name: "Магическое кольцо", type: "equipment", system: { quantity: 1 }, flags: { "rebreya-main": { magical: true, heroDollSlots: ["ring1"] } } },
    { _id: "ordinary-clothing", name: "Одежда", type: "equipment", system: { quantity: 1, type: { value: "clothing" } }, flags: { "rebreya-main": {} } },
    { _id: "incompatible", name: "Кусок металла", type: "loot", system: { quantity: 1 }, flags: { "rebreya-main": {} } }
  ]);
  const snapshot = fx.service.getActorSnapshot(fx.hero);
  assert.deepEqual(new Set(snapshot.inventoryItems.map(item => item.id)), new Set([magic.id, clothing.id, fx.source.id]));
  assert.equal(snapshot.inventoryItems.some(item => item.id === incompatible.id), false);
});

test("a slotted focus keeps its equipment and spell when weapon and shield take both hands", async t => {
  const fx = setup({ quantity: 1, itemFlags: { heroDollSlots: ["leftHand"], magical: true }, itemSystem: { equipped: true } });
  t.after(() => fx.restore());
  fx.hero.flags["rebreya-main"].heroDoll = { version: 1, slots: { leftHand: { itemId: fx.source.id } } };
  const [weapon, shield] = await fx.hero.createEmbeddedDocuments("Item", [
    { _id: "sword", name: "Меч", type: "weapon", system: { quantity: 1, equipped: false } },
    { _id: "shield", name: "Щит", type: "equipment", system: { quantity: 1, equipped: false, type: { value: "shield" } } }
  ]);
  await fx.source.update(buildHeldItemHandUpdate(["left"], fx.source));
  await fx.source.update(buildHeldItemReleaseHandUpdate(fx.source, ["left"]));
  await weapon.update(buildHeldItemHandUpdate(["left"], weapon));
  await shield.update(buildHeldItemHandUpdate(["right"], shield));
  assert.equal(fx.service.getActorSnapshot(fx.hero).slots.find(slot => slot.id === "leftHand").itemId, fx.source.id);
  assert.equal(fx.source.system.equipped, true);
  const spell = { type: "spell", flags: { dnd5e: { cachedFor: ".Item.rope.Activity.cast" } }, system: { linkedActivity: { item: fx.source } } };
  const context = { spellbook: { item: { items: [spell] } } };
  filterMagicItemSpellbook(fx.hero, context);
  assert.deepEqual(context.spellbook.item.items, [spell]);
});

test("the GM worker replaces a doll entry while preserving both occupied real hands", async t => {
  const fx = setup({ quantity: 1, itemFlags: { heroDollSlots: ["leftHand", "rightHand"] } });
  t.after(() => fx.restore());
  fx.source.data.type = "weapon";
  const [oldWeapon, shield, oldFocus] = await fx.hero.createEmbeddedDocuments("Item", [
    { _id: "old-weapon", name: "Старое оружие", type: "weapon", system: { quantity: 1, equipped: true }, flags: { "rebreya-main": { heldHands: ["left"] } } },
    { _id: "shield", name: "Щит", type: "equipment", system: { quantity: 1, equipped: true }, flags: { "rebreya-main": { heldHands: ["right"] } } },
    { _id: "old-focus", name: "Фокус", type: "equipment", system: { quantity: 1, equipped: true } }
  ]);
  fx.hero.flags["rebreya-main"].heroDoll = { version: 1, slots: { leftHand: { itemId: oldFocus.id } } };
  await fx.run({ ...fx.payload, slotId: "leftHand" });
  assert.equal(fx.source.getFlag("rebreya-main", "heldHands"), undefined);
  assert.equal(fx.source.system.equipped, true);
  assert.equal(oldFocus.system.equipped, false);
  assert.deepEqual(oldWeapon.getFlag("rebreya-main", "heldHands"), ["left"]);
  assert.deepEqual(shield.getFlag("rebreya-main", "heldHands"), ["right"]);
  assert.equal(oldWeapon.system.equipped, true);
});

test("the GM worker assigns and clears a held item without moving its grip",async t=>{
  const fx=setup({quantity:1,itemFlags:{heroDollSlots:["leftHand","rightHand"],heldHands:["right"]},itemSystem:{equipped:true}});t.after(()=>fx.restore());
  fx.source.data.type="weapon";const payload={...fx.payload,slotId:"leftHand"};
  await fx.run(payload);
  assert.deepEqual(fx.source.getFlag("rebreya-main","heldHands"),["right"]);
  assert.deepEqual(fx.hero.getFlag("rebreya-main","heroDoll").slots,{leftHand:{itemId:fx.source.id}});
  await fx.service.executeAssignItemToSlot({...payload,operationId:"clear-held"},{sender:game.user},"clear");
  assert.deepEqual(fx.source.getFlag("rebreya-main","heldHands"),["right"]);
  assert.equal(fx.source.system.equipped,true);
});

test("group stack validates slot before transfer and creates only one hero unit",async t=>{
  const fx=makeInstanceDocumentsFixture({quantity:2});t.after(()=>fx.restore());
  fx.group.flags["rebreya-main"].managedPartyGroup=true;const service=new HeroDollService(fx.api);
  const payload={actorUuid:fx.hero.uuid,sourceItemUuid:fx.source.uuid,slotId:"neck",operationId:"group-1"};
  await assert.rejects(service.executeAssignItemToSlot({...payload,slotId:"leftHand"},{sender:game.user}));
  assert.equal(fx.calls.length,0);
  const result=await service.executeAssignItemToSlot(payload,{sender:game.user});
  assert.equal(fx.group.items.get(fx.source.id).system.quantity,1);assert.equal(fx.hero.items.get(result.itemId).system.quantity,1);
  assert.equal(fx.total(),2);
});

test("replacing a slot releases the previous instance and failure restores it",async t=>{
  const fx=setup();t.after(()=>fx.restore());
  const first=await fx.run();
  fx.failAt("placement","after");
  await assert.rejects(fx.run({...fx.payload,operationId:"replace-fault"}));
  assert.equal(fx.hero.getFlag("rebreya-main","heroDoll").slots.neck.itemId,first.itemId);
  assert.equal(fx.hero.items.get(first.itemId).system.equipped,true);assert.equal(fx.source.system.equipped,false);
  await fx.run({...fx.payload,operationId:"replace-ok"});
  assert.equal(fx.hero.items.get(first.itemId).system.equipped,false);assert.equal(fx.source.system.equipped,true);assert.equal(fx.total(),2);
});


test("whole upgraded group item delegates to existing transfer owner and survives deleted-source replay",async t=>{
  const fx=makeInstanceDocumentsFixture({quantity:1,itemFlags:{itemUpgrades:{installed:[{itemId:"up",slotIndex:0}]}}});t.after(()=>fx.restore());
  fx.group.flags["rebreya-main"].managedPartyGroup=true;
  await fx.group.createEmbeddedDocuments("Item",[{_id:"up",name:"Upgrade",type:"loot",system:{quantity:1,container:fx.source.id},flags:{"rebreya-main":{installedUpgrade:{hostItemId:fx.source.id,slotIndex:0}}}}]);
  const service=new HeroDollService(fx.api);
  const payload={actorUuid:fx.hero.uuid,sourceItemUuid:fx.source.uuid,slotId:"neck",operationId:"whole-1"};
  const result=await service.executeAssignItemToSlot(payload,{sender:game.user});
  assert.equal(fx.group.items.contents.length,0);assert.equal(fx.hero.items.get(result.itemId).system.quantity,1);
  assert.equal((await service.executeAssignItemToSlot(payload,{sender:game.user})).itemId,result.itemId);
  assert.equal(fx.hero.items.get(result.itemId).system.equipped,true);
  assert.equal(fx.hero.items.get(result.itemId).flags["rebreya-main"].itemUpgrades.installed[0].itemId,fx.hero.items.contents.find(i=>i.name==="Upgrade").id);
  assert.equal(fx.total(),2);
});
