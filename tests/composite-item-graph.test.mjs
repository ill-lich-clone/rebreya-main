import test from "node:test";
import assert from "node:assert/strict";
import { buildCompositeItemGraph } from "../scripts/data/composite-item-graph.js";

const descriptor=()=>({version:2,instanceKey:"h",sourceType:"gear",sourceId:"sword",quantity:1,isBroken:false,container:null,upgrades:[{instanceKey:"u",sourceId:"zacharovanie-ostroty",slotIndex:1,choices:{}}]});
const row={productId:"zacharovanie-ostroty",profile:{compatibility:["weapon"]},decision:"simple-implemented"};
function options(){let id=0;return {manifest:[row],createDocumentId:()=>String(++id).padStart(16,"0"),buildBase:async()=>({_id:"old",name:"Sword",type:"weapon",ownership:{old:3},system:{quantity:8,container:"foreign",equipped:true},flags:{"rebreya-main":{heldHands:["left"],itemUpgrades:{capacity:1,installed:[{itemId:"foreign",slotIndex:1}]},inventoryMutation:{id:"old"}}}}),buildUpgrade:async()=>({name:"Sharp",type:"loot",system:{quantity:1},flags:{}})};}

test("one detached graph uses fresh ids and exact bidirectional installed links", async()=>{
  const graph=await buildCompositeItemGraph(descriptor(),options()),[host,child]=graph.documents;
  assert.equal(graph.documents.length,2);assert.equal(new Set(graph.documents.map(d=>d._id)).size,2);
  assert.equal(graph.rootItemId,host._id);assert.equal(host.system.quantity,1);assert.equal(host.system.container,null);assert.equal(host.system.equipped,false);
  assert.equal(host.ownership,undefined);assert.equal(host.flags['rebreya-main'].inventoryMutation,undefined);
  assert.deepEqual(host.flags['rebreya-main'].itemUpgrades.installed,[{itemId:child._id,slotIndex:1}]);
  assert.equal(child.system.equipped,undefined);
  assert.equal(child.system.container,host._id);assert.equal(child.flags['rebreya-main'].installedUpgrade.hostItemId,host._id);
  assert.deepEqual(child.flags['rebreya-main'].upgradeChoices,{});
  assert.equal(child.flags['rebreya-main'].gearId,'zacharovanie-ostroty');
  assert.deepEqual(graph.links,[{hostItemId:host._id,upgradeItemId:child._id,slotIndex:1}]);
});

test("invalid identities, unavailable/ incompatible profiles and host capacity reject before materialization",async()=>{
  await assert.rejects(buildCompositeItemGraph(descriptor(),{...options(),createDocumentId:()=>"same"}));
  await assert.rejects(buildCompositeItemGraph(descriptor(),{...options(),manifest:[]}));
  await assert.rejects(buildCompositeItemGraph(descriptor(),{...options(),manifest:[{...row,profile:{compatibility:["armor"]}}]}));
  const d=descriptor();d.upgrades.push({...d.upgrades[0],instanceKey:"u2",slotIndex:2});
  await assert.rejects(buildCompositeItemGraph(d,options()),e=>e.code==="capacity");
});
