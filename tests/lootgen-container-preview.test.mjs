import test from "node:test";
import assert from "node:assert/strict";
import { makePreparedContainerGraph } from "./helpers/lootgen-prepared-container-fixture.mjs";
import { buildLootgenPreparedItem } from "../scripts/data/lootgen-prepared-item.js";
import { projectLootgenContainerPreview, renderLootgenContainerPreview, getLootgenContainerSummary } from "../scripts/ui/lootgen-container-preview.js";

async function fixture(){
  const {descriptor,graph}=await makePreparedContainerGraph();
  graph.documents[1].name="<Клинок>";graph.documents[2].name="<Острота>";
  return {rowId:"root",name:"Сундук",quantity:1,descriptor,totalValue:7000,itemData:buildLootgenPreparedItem(descriptor,{graph,unitValue:7000}),
    compositionValues:[{instanceKey:descriptor.instanceKey,baseValue:1000,upgradeValue:0,contentsValue:5000,currencyValue:1000,totalValue:7000},
      {instanceKey:descriptor.container.state.manualRows[0].composition.instanceKey,baseValue:3000,upgradeValue:2000,contentsValue:0,currencyValue:0,totalValue:5000}]};
}
test("saved container preview shows one tree, upgrades and exact non-overlapping value breakdown without actions",async()=>{
  const row=await fixture(),before=structuredClone(row),preview=projectLootgenContainerPreview(row),html=renderLootgenContainerPreview(row);
  assert.equal(preview.nodes.length,2);assert.equal(preview.nodes[1].depth,1);assert.equal(preview.nodes[1].upgrades.length,1);
  for(const label of ["Основа","Усовершенствования","Содержимое","Монеты внутри","Итого"])assert.ok(html.includes(label));
  assert.match(html,/&lt;Клинок&gt;/u);assert.match(html,/&lt;Острота&gt;/u);assert.doesNotMatch(html,/<Клинок>|<Острота>/u);
  assert.doesNotMatch(html,/draggable|data-lootgen-chat-action|data-action|<button/u);
  assert.match(getLootgenContainerSummary(row),/1.*предмет.*1.*усовершенствован/u);assert.deepEqual(row,before);
});
test("old prepared container previews its tree without inventing an absent price breakdown",async()=>{
  const row=await fixture();delete row.compositionValues;
  const html=renderLootgenContainerPreview(row);
  assert.match(html,/Разбивка стоимости недоступна/u);assert.match(html,/7.?000/u);assert.match(html,/&lt;Клинок&gt;/u);
});
test("inconsistent saved breakdown is not displayed as a valid price",async()=>{
  const row=await fixture();row.compositionValues[0].currencyValue++;
  assert.throws(()=>projectLootgenContainerPreview(row));
});
