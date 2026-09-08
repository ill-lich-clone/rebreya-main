import { projectLootgenDescriptorTree } from "../data/lootgen-item-descriptor.js?v=1.4.268";
import { readLootgenPreparedComposition } from "../data/lootgen-prepared-item.js?v=1.4.268";

const MODULE_ID="rebreya-main";
const number=new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0});
const escape=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const fail=()=>{throw new Error("Сохранённый состав или разбивка стоимости контейнера повреждены.");};
const amount=value=>Number.isSafeInteger(value)&&value>=0;
function plural(count,forms){const last=count%10,tail=count%100;return forms[tail>=11&&tail<=14?2:last===1?0:last>=2&&last<=4?1:2];}

/** Read only saved descriptors, native graph names and generation-time prices. Never reads the catalog or rolls. */
export function projectLootgenContainerPreview(row) {
  if(row?.descriptor?.container==null)return null;
  const prepared=readLootgenPreparedComposition(row.itemData);
  if(!prepared?.descriptor.container || prepared.unitValue!==row.totalValue)fail();
  const projected=projectLootgenDescriptorTree(prepared.descriptor),graph=row.itemData.flags[MODULE_ID].runtimeItemGraph.nodes;
  const hosts=new Map(graph.filter(node=>node.flags?.[MODULE_ID]?.storageContainerMember?.composition)
    .map(node=>[node.flags[MODULE_ID].storageContainerMember.composition.instanceKey,node]));
  const prices=row.compositionValues==null?null:new Map(row.compositionValues.map(entry=>[entry.instanceKey,entry]));
  if(prices && (prices.size!==projected.length || prices.size!==row.compositionValues.length))fail();
  const depths=new Map();
  const nodes=projected.map(({descriptor,parentInstanceKey,currencyValue})=>{
    const host=hosts.get(descriptor.instanceKey),depth=parentInstanceKey===null?0:(depths.get(parentInstanceKey)+1);
    depths.set(descriptor.instanceKey,depth);
    const breakdown=prices?.get(descriptor.instanceKey)??null;
    if(prices && (!breakdown || !["baseValue","upgradeValue","contentsValue","currencyValue","totalValue"].every(key=>amount(breakdown[key]))
      || breakdown.currencyValue!==currencyValue
      || breakdown.baseValue+breakdown.upgradeValue+breakdown.contentsValue+breakdown.currencyValue!==breakdown.totalValue))fail();
    const upgrades=descriptor.upgrades.map(upgrade=>{
      const link=host.flags[MODULE_ID].itemUpgrades.installed.find(link=>link.slotIndex===upgrade.slotIndex);
      return {name:graph.find(node=>node._id===link.itemId)?.name??upgrade.sourceId,choices:structuredClone(upgrade.choices)};
    });
    return {id:descriptor.instanceKey,parentId:parentInstanceKey,depth,name:host.name,quantity:descriptor.quantity,
      isContainer:descriptor.container!==null,upgrades,breakdown:breakdown?structuredClone(breakdown):null};
  });
  if(prices){
    if(nodes[0].breakdown.totalValue!==prepared.unitValue)fail();
    for(const node of nodes)if(node.breakdown.contentsValue!==nodes.filter(child=>child.parentId===node.id).reduce((sum,child)=>sum+child.breakdown.totalValue,0))fail();
  }
  return {nodes,totalValue:prepared.unitValue,containedQuantity:nodes.slice(1).reduce((sum,node)=>sum+node.quantity,0),
    upgradeCount:nodes.reduce((sum,node)=>sum+node.upgrades.length,0)};
}

export function getLootgenContainerSummary(row) {
  const preview=projectLootgenContainerPreview(row);if(!preview)return "";
  return `Внутри: ${preview.containedQuantity} ${plural(preview.containedQuantity,["предмет","предмета","предметов"])} · ${preview.upgradeCount} ${plural(preview.upgradeCount,["усовершенствование","усовершенствования","усовершенствований"])}`;
}

function renderUpgrade(upgrade){
  const type=upgrade.choices?.damageType,configured=globalThis.CONFIG?.DND5E?.damageTypes?.[type];
  const label=typeof configured==="string"?configured:configured?.label??type;
  const choice=type?` · ${globalThis.game?.i18n?.localize?.(label)??label}`:"";
  return `<li>${escape(upgrade.name)}${escape(choice)}</li>`;
}

export function renderLootgenContainerPreview(row) {
  const preview=projectLootgenContainerPreview(row);if(!preview)return "";
  const render=node=>{
    const children=preview.nodes.filter(child=>child.parentId===node.id),price=node.breakdown;
    const details=price?`<dl class="rm-lootgen-tree__prices">${[["Основа",price.baseValue],["Усовершенствования",price.upgradeValue],
      ["Содержимое",price.contentsValue],["Монеты внутри",price.currencyValue],["Итого",price.totalValue]]
      .map(([label,value])=>`<div><dt>${label}</dt><dd>${number.format(value)} value</dd></div>`).join("")}</dl>`:"";
    return `<li class="rm-lootgen-tree__node"><details open><summary><span>${escape(node.name)} ×${number.format(node.quantity)}</span>
      ${price?`<strong>${number.format(price.totalValue)} value</strong>`:""}</summary>${details}
      ${node.upgrades.length?`<ul class="rm-lootgen-tree__upgrades">${node.upgrades.map(renderUpgrade).join("")}</ul>`:""}
      ${children.length?`<ul class="rm-lootgen-tree__children">${children.map(render).join("")}</ul>`:""}</details></li>`;
  };
  return `<section class="rm-lootgen-tree"><p class="rm-lootgen-tree__intro">Состав при генерации · ${number.format(preview.totalValue)} value</p>
    ${preview.nodes[0].breakdown?"":"<p>Разбивка стоимости недоступна для этого сохранённого результата.</p>"}
    <ul class="rm-lootgen-tree__roots">${render(preview.nodes[0])}</ul></section>`;
}
