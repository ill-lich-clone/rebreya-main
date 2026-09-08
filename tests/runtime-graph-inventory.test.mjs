import test from "node:test";
import assert from "node:assert/strict";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";
import { captureRuntimeItemGraph } from "../scripts/data/runtime-item-graph.js";
import { InventoryIngressPlanner } from "../scripts/application/inventory-ingress-planner.js";
import { InventoryIngressRuleCompilerCache } from "../scripts/data/inventory-ingress-rules.js";
import { buildInventoryIngressDescriptor } from "../scripts/data/inventory-ingress-descriptor.js";
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
