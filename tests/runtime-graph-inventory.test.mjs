import test from "node:test";
import assert from "node:assert/strict";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";
import { captureRuntimeItemGraph } from "../scripts/data/runtime-item-graph.js";
import { InventoryIngressPlanner } from "../scripts/application/inventory-ingress-planner.js";
import { InventoryIngressRuleCompilerCache } from "../scripts/data/inventory-ingress-rules.js";
import { buildInventoryIngressDescriptor } from "../scripts/data/inventory-ingress-descriptor.js";

test("character import moves an upgraded container into a folder and resumes source deletion", async () => {
  const f = makeInstanceDocumentsFixture({ quantity: 1 });
  try {
    f.group.flags["rebreya-main"].managedPartyGroup = true;
    f.api.inventoryService.getInventoryActor = async () => f.group;
    await f.hero.createEmbeddedDocuments("Item", [
      { _id: "bag", name: "Bag", type: "container", system: { quantity: 1, currency: { gp: 7 } }, flags: { "rebreya-main": { itemUpgrades: { installed: [{ itemId: "up", slotIndex: 0 }] } } } },
      { _id: "up", name: "Upgrade", type: "loot", system: { quantity: 1 }, flags: { "rebreya-main": { installedUpgrade: { hostItemId: "bag", hostActorId: f.hero.id, slotIndex: 0 } } } },
      { _id: "inside", name: "Contents", type: "loot", system: { quantity: 3, container: "bag" }, flags: { custom: { note: "keep" } } }
    ]);
    const model = { gear: [], gearById: new Map(), materials: [], materialById: new Map(), materialByGoodId: new Map() };
    f.api.inventoryIngressPlanner = new InventoryIngressPlanner({
      readRules: groupActorId => f.api.inventoryService.getInventoryIngressRuleState({ groupActorId }),
      buildDescriptor: data => buildInventoryIngressDescriptor(data, { model }), resolveDismantleOutputs: () => [],
      compilerCache: new InventoryIngressRuleCompilerCache(), confirm: async () => ({ rootOverrideSourceKeys: [] })
    });
    const bag = f.hero.items.get("bag"), child = f.hero.items.get("inside"), remove = child.delete.bind(child);
    child.delete = async () => { await remove(); f.failAt("delete", "before"); };
    const options = { groupActorId: f.group.id, folderId: "bag" };
    await assert.rejects(f.api.inventoryService.importDroppedItem({ uuid: bag.uuid, mutationId: "import-tree" }, options), /fault delete before/);
    assert.equal(f.group.items.contents.length, 4);
    assert.equal(f.hero.items.get("inside"), undefined);
    await f.api.inventoryService.importDroppedItem({ uuid: bag.uuid }, options);
    assert.equal(f.hero.items.contents.length, 0);
    assert.equal(f.group.items.contents.length, 4);
    const root = f.group.items.contents.find(i => i.name === "Bag"), upgrade = f.group.items.contents.find(i => i.name === "Upgrade"), inside = f.group.items.contents.find(i => i.name === "Contents");
    assert.equal(root.system.currency.gp, 7);
    assert.equal(root.flags["rebreya-main"].itemUpgrades.installed[0].itemId, upgrade.id);
    assert.equal(upgrade.flags["rebreya-main"].installedUpgrade.hostItemId, root.id);
    assert.equal(upgrade.flags["rebreya-main"].installedUpgrade.hostActorId, f.group.id);
    assert.equal(inside.system.container, root.id);
    assert.equal(inside.system.quantity, 3);
    assert.equal(inside.flags.custom.note, "keep");
    assert.equal(f.group.flags["rebreya-main"].inventoryFolders.itemFolderIds[root.id], "bag");
  } finally { f.restore(); }
});

test("party take moves a nested upgraded tree once and resumes an interrupted source deletion",async()=>{
  const f=makeInstanceDocumentsFixture({quantity:1,itemFlags:{itemUpgrades:{installed:[{itemId:"up",slotIndex:0}]}}});
  try {
    f.group.flags["rebreya-main"].managedPartyGroup=true;
    f.group.system={members:[{actor:f.hero}]};
    await f.group.createEmbeddedDocuments("Item",[
      {_id:"up",name:"Upgrade",type:"loot",system:{quantity:1,container:f.source.id},flags:{"rebreya-main":{installedUpgrade:{hostItemId:f.source.id,hostActorId:f.group.id,slotIndex:0}}}},
      {_id:"bag",name:"Bag",type:"container",system:{quantity:1,container:f.source.id,currency:{gp:3}},flags:{}},
      {_id:"child",name:"Contents",type:"loot",system:{quantity:3,container:"bag"},flags:{custom:{note:"keep"}}}
    ]);
    const request={inventoryActorId:f.group.id,targetActorId:f.hero.id,itemId:f.source.id,quantity:1,mutationId:"take-tree"};
    await assert.rejects(f.api.inventoryService.executeTakeMutation({...request,quantity:0.5,mutationId:"partial-tree"}),e=>e.code==="graph-manual-review");
    assert.equal(f.hero.items.contents.length,0);
    f.failAt("delete","after");
    await assert.rejects(f.api.inventoryService.executeTakeMutation(request),/fault delete after/);
    assert.equal(f.hero.items.contents.length,4);
    await assert.rejects(f.api.inventoryService.executeTakeMutation({...request,itemId:"bag",mutationId:"competing-child"}),e=>e.code==="graph-manual-review");
    f.api.inventoryService.getInventoryActor=async()=>f.group;
    const result=await f.api.inventoryService.takeInventoryItemToCharacter(f.source.id,{actorId:f.hero.id,quantity:1});
    assert.equal(f.group.items.contents.length,0);assert.equal(f.hero.items.contents.length,4);
    const root=f.hero.items.get(result.createdItemId),upgrade=f.hero.items.contents.find(i=>i.name==="Upgrade"),bag=f.hero.items.contents.find(i=>i.name==="Bag"),child=f.hero.items.contents.find(i=>i.name==="Contents");
    assert.equal(root.flags["rebreya-main"].itemUpgrades.installed[0].itemId,upgrade.id);
    assert.equal(upgrade.flags["rebreya-main"].installedUpgrade.hostActorId,f.hero.id);
    assert.equal(bag.system.container,root.id);assert.equal(bag.system.currency.gp,3);
    assert.equal(child.system.container,bag.id);assert.equal(child.system.quantity,3);assert.equal(child.flags.custom.note,"keep");
    await root.delete();
    assert.deepEqual(await f.api.inventoryService.executeTakeMutation(request),result);
    assert.equal(f.hero.items.get(root.id),undefined);
  } finally { f.restore(); }
});
test("storage pickup restores all graph documents once through InventoryService",async()=>{
  const f=makeInstanceDocumentsFixture({quantity:1,itemFlags:{itemUpgrades:{installed:[{itemId:"up",slotIndex:0}]}}});
  try {
    await f.group.createEmbeddedDocuments("Item",[{_id:"up",name:"Зачарование",type:"loot",system:{quantity:1},flags:{"rebreya-main":{installedUpgrade:{hostItemId:f.source.id,slotIndex:0}}}}]);
    const row={quantity:1,itemData:f.source.toObject(),runtimeGraph:captureRuntimeItemGraph(f.group,f.source)};
    const result=await f.api.inventoryService.addLootgenRowToCharacterOnce(row,f.hero,"graph-pickup");
    assert.equal(f.hero.items.contents.length,2);
    const root=f.hero.items.get(result.itemId), child=f.hero.items.contents.find(i=>i.id!==root.id);
    assert.equal(root.flags["rebreya-main"].itemUpgrades.installed[0].itemId,child.id);
    assert.equal(child.flags["rebreya-main"].installedUpgrade.hostItemId,root.id);
    assert.equal(root.flags["rebreya-main"].runtimeItemGraph,undefined);
    await f.api.inventoryService.addLootgenRowToCharacterOnce(row,f.hero,"graph-pickup");assert.equal(f.hero.items.contents.length,2);
  } finally { f.restore(); }
});
test("a raw Item flag cannot impersonate a trusted storage graph",async()=>{
  const f=makeInstanceDocumentsFixture({quantity:1});
  try {
    const data=f.source.toObject();data.flags["rebreya-main"].runtimeItemGraph={version:1,rootId:"fake",nodes:[]};
    const prepared=await f.api.inventoryService.buildLootgenItemData({quantity:1,itemData:data},{allowPersistedItemData:true});
    assert.equal(prepared.flags["rebreya-main"].runtimeItemGraph,undefined);
  } finally { f.restore(); }
});

test("party storage ingress materializes a graph once and rejects importing the transport flag", async () => {
  const f = makeInstanceDocumentsFixture({ quantity: 1 });
  try {
    await f.hero.createEmbeddedDocuments("Item", [{ _id: "bag", name: "Bag", type: "container", system: { quantity: 1 }, flags: {} },
      { _id: "inside", name: "Contents", type: "loot", system: { quantity: 3, container: "bag" }, flags: {} }]);
    const bag = f.hero.items.get("bag");
    const itemData = await f.api.inventoryService.buildLootgenItemData({ quantity: 1, itemData: bag.toObject(), runtimeGraph: captureRuntimeItemGraph(f.hero, bag) }, { allowPersistedItemData: true });
    const rows = [{ sourceKey: "ground-bag", quantity: 1, itemData, legacyFolderId: null, container: null }];
    const model = { gear: [], gearById: new Map(), materials: [], materialById: new Map(), materialByGoodId: new Map() };
    const planner = new InventoryIngressPlanner({ readRules: groupActorId => f.api.inventoryService.getInventoryIngressRuleState({ groupActorId }),
      buildDescriptor: data => buildInventoryIngressDescriptor(data, { model }), resolveDismantleOutputs: () => [],
      compilerCache: new InventoryIngressRuleCompilerCache(), confirm: async () => ({ rootOverrideSourceKeys: [] }) });
    f.api.inventoryIngressPlanner = planner;
    const serializedPlan = planner.serialize(await planner.preview({ groupActorId: f.group.id, rows }), { rootOverrideSourceKeys: [] });
    let debits = 0;
    const request = { groupActorId: f.group.id, batchMutationId: "party-graph", sourceOrigin: "storage", serializedPlan };
    const callbacks = { resolveRows: async () => structuredClone(rows), debitRow: async () => { debits++; } };
    await f.api.inventoryService.commitInventoryIngressBatch(request, callbacks);
    assert.equal(f.group.items.contents.length, 3);
    const root = f.group.items.contents.find(i => i.type === "container");
    assert.equal(f.group.items.contents.find(i => i.system.container === root.id).system.quantity, 3);
    await f.api.inventoryService.commitInventoryIngressBatch(request, callbacks);
    assert.equal(debits, 1); assert.equal(f.group.items.contents.length, 3);
    await assert.rejects(f.api.inventoryService.commitInventoryIngressBatch({ ...request, batchMutationId: "forged-graph", sourceOrigin: "import" }, callbacks), e => e.code === "invalid-runtime-graph");
  } finally { f.restore(); }
});
