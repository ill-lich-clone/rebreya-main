import test from "node:test";
import assert from "node:assert/strict";
import { buildCompositeItemGraph } from "../scripts/data/composite-item-graph.js";
import { buildLootgenPreparedItem, readLootgenPreparedComposition } from "../scripts/data/lootgen-prepared-item.js";
import { buildInventoryIngressDescriptor, captureInventoryIngressIdentity } from "../scripts/data/inventory-ingress-descriptor.js";

async function fixture(){
  const descriptor={version:2,instanceKey:"h",sourceType:"gear",sourceId:"sword",quantity:1,isBroken:false,container:null,upgrades:[{instanceKey:"u",sourceId:"zacharovanie-ostroty",slotIndex:1,choices:{}}]};
  let id=0;const graph=await buildCompositeItemGraph(descriptor,{createDocumentId:()=>String(++id).padStart(16,'0'),manifest:[{productId:'zacharovanie-ostroty',decision:'simple-implemented',profile:{compatibility:['weapon']}}],
    buildBase:async()=>({name:'Sword',type:'weapon',system:{quantity:1,price:{value:10,denomination:'gp'}},flags:{'rebreya-main':{sourceType:'gear',sourceId:'sword'}}}),
    buildUpgrade:async()=>({name:'Sharp',type:'loot',system:{quantity:1},flags:{}})});
  return {descriptor,graph,item:buildLootgenPreparedItem(descriptor,{graph,unitValue:1200})};
}

test("prepared item carries complete price for ingress without inflating persisted base price",async()=>{
  const f=await fixture(),prepared=readLootgenPreparedComposition(f.item);
  assert.equal(prepared.unitValue,1200);assert.equal(f.item.system.price.value,10);
  const descriptor=buildInventoryIngressDescriptor(f.item);
  assert.equal(descriptor.unitValue,1200);assert.equal(descriptor.dismantlable,false);
  const identity=captureInventoryIngressIdentity(descriptor,1);
  assert.equal(identity.compositionKey,prepared.compositionKey);
  assert.throws(()=>captureInventoryIngressIdentity(descriptor,2));
});

test("prepared composition validates full root/child links, price and canonical identity",async()=>{
  for(const mutate of [item=>item.flags['rebreya-main'].lootgenComposition.unitValue=-1,
    item=>item.flags['rebreya-main'].lootgenComposition.compositionKey='forged',
    item=>item.flags['rebreya-main'].runtimeItemGraph.nodes.pop(),
    item=>item.flags['rebreya-main'].runtimeItemGraph.nodes[1].system.container='foreign']){
    const f=await fixture();mutate(f.item);assert.throws(()=>readLootgenPreparedComposition(f.item));
  }
  assert.equal(readLootgenPreparedComposition({flags:{}}),null);
});
