import test from "node:test";
import assert from "node:assert/strict";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";
import { StorageCommandService } from "../scripts/data/storage-command-service.js";
async function fixture({quantity=1}={}) {
  const f=makeInstanceDocumentsFixture({quantity,itemFlags:{heldHands:["left"]},itemSystem:{equipped:true}});
  f.group.flags["rebreya-main"].heroDoll={slots:{leftHand:{itemId:f.source.id}}};
  const journal=f.api.inventoryService.mutationJournal;
  await journal.start({id:"disarm:op",kind:"disarm",phase:"drop-prepared",dropped:true,senderId:"gm",targetActorUuid:f.group.uuid,sceneId:"scene",intent:{operationId:"op",targetItemUuid:f.source.uuid},destination:{x:100,y:100}});
  const capability={},ground=new Map();let creates=0,failCreate=false;
  const service=new StorageCommandService({storageService:{},inventoryService:f.api.inventoryService,resolveToken:async()=>null,measureDistance:()=>0,isVisibleTo:()=>true,journalReader:{read:async()=>{}},
    disarmCapability:capability,prepareDisarmPlacement:()=>[{path:"flags.rebreya-main.heroDoll.slots.leftHand",before:{itemId:f.source.id},after:null}],
    groundPileService:{findProcessedMutationAtPoint:({mutationId})=>ground.get(mutationId),async transferToScene(request){creates++;ground.set(request.mutationId,{token:{uuid:"Scene.scene.Token.ground"},row:request.row});if(failCreate){failCreate=false;throw Error("lost ack");}return ground.get(request.mutationId);}}});
  return {...f,service,journal,ground,capability,creates:()=>creates,failCreate:()=>{failCreate=true;},context:{capability,assertAuthority(){}}};
}
test("internal drop moves one unit, releases remaining grip and doll slot; no privileged public bypass",async()=>{
  const f=await fixture({quantity:3});
  try {
    await assert.rejects(f.service.dropDisarmedItem({operationId:"op"},{...f.context,capability:{}}));
    await f.service.dropDisarmedItem({operationId:"op"},f.context);
    assert.equal(f.source.system.quantity,2);assert.equal(f.source.system.equipped,false);assert.deepEqual(f.source.getFlag("rebreya-main","heldHands")??[],[]);
    assert.equal(f.group.flags["rebreya-main"].heroDoll.slots.leftHand,undefined);
    await f.service.dropDisarmedItem({operationId:"op"},f.context);assert.equal(f.creates(),1);assert.equal(f.source.system.quantity,2);
  }finally{f.restore();}
});
test("lost ground acknowledgement and source-delete acknowledgement recover without a second pile",async()=>{
  const f=await fixture();
  try {
    f.failCreate();f.failAt("delete","after");
    await f.service.dropDisarmedItem({operationId:"op"},f.context);
    assert.equal(f.group.items.contents.length,0);assert.equal(f.creates(),1);
    f.ground.clear();await f.service.dropDisarmedItem({operationId:"op"},f.context);assert.equal(f.creates(),1);
  }finally{f.restore();}
});
test("a successful save never authorizes a drop",async()=>{
  const f=await fixture();
  try {
    await f.journal.checkpoint("disarm:op","drop-prepared","completed",{dropped:false});
    await assert.rejects(f.service.dropDisarmedItem({operationId:"op"},f.context));assert.equal(f.creates(),0);assert.ok(f.group.items.get(f.source.id));
  }finally{f.restore();}
});

for (const [fault, timing, quantity] of [["debit", "before", 3], ["debit", "after", 3], ["placement", "before", 1], ["placement", "after", 1]]) {
  test(`drop recovers ${fault} ${timing} without duplicating the physical unit`, async () => {
    const f = await fixture({ quantity });
    try {
      f.failAt(fault, timing);
      try { await f.service.dropDisarmedItem({ operationId: "op" }, f.context); } catch (error) { assert.match(error.message, /fault/); }
      await f.service.dropDisarmedItem({ operationId: "op" }, f.context);
      assert.equal(f.creates(), 1);
      assert.equal(f.group.items.get(f.source.id)?.system.quantity ?? 0, quantity - 1);
      assert.equal(f.group.flags["rebreya-main"].heroDoll.slots.leftHand, undefined);
    } finally { f.restore(); }
  });
}

test("a container with upgraded contents survives drop and pickup as the same document graph", async () => {
  const f = await fixture();
  try {
    f.source.data.type = "container";
    await f.group.createEmbeddedDocuments("Item", [
      { _id: "inside", name: "Клинок", type: "weapon", system: { quantity: 1, container: f.source.id, uses: { spent: 2, max: "3" } }, flags: { "rebreya-main": { itemUpgrades: { installed: [{ itemId: "upgrade", slotIndex: 0 }] }, customDurability: 7 } } },
      { _id: "upgrade", name: "Материал", type: "loot", system: { quantity: 1 }, flags: { "rebreya-main": { installedUpgrade: { hostItemId: "inside", slotIndex: 0 } } } }
    ]);
    await f.service.dropDisarmedItem({ operationId: "op" }, f.context);
    assert.equal(f.group.items.contents.length, 0);
    const row = [...f.ground.values()][0].row;
    const result = await f.api.inventoryService.addLootgenRowToCharacterOnce(row, f.hero, "container-pickup");
    const root = f.hero.items.get(result.itemId);
    const inside = f.hero.items.contents.find(item => item.system.container === root.id);
    const upgrade = f.hero.items.get(inside.flags["rebreya-main"].itemUpgrades.installed[0].itemId);
    assert.equal(f.hero.items.contents.length, 3);
    assert.equal(upgrade.flags["rebreya-main"].installedUpgrade.hostItemId, inside.id);
    assert.equal(inside.system.uses.spent, 2);
    assert.equal(inside.flags["rebreya-main"].customDurability, 7);
    await f.service.dropDisarmedItem({ operationId: "op" }, f.context);
    assert.equal(f.creates(), 1);
  } finally { f.restore(); }
});
