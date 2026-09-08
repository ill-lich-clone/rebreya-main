import { UpgradeRuleError } from "./item-upgrade-rules.js?v=1.4.250";
import { buildUpgradeHostDescriptor, profileSignature } from "./item-upgrade-service.js?v=1.4.255";
import { resolveLootgenItemValue } from "./item-value.js?v=1.4.264";
import { readContainerValueNodes } from "./lootgen-container-value-adapter.js?v=1.4.264";

const MODULE_ID="rebreya-main";
const values=rows=>Array.isArray(rows)?rows:Array.from(rows?.values?.()??[]);
const flags=source=>source?.flags?.[MODULE_ID]??{};
const detached=source=>structuredClone(source?.toObject?.()??source);
const id=value=>typeof value==="string"?value.trim():"";
const present=value=>value!==undefined&&value!==null&&value!=="";
const validNumber=value=>present(value)&&Number.isFinite(Number(value))&&Number(value)>=0;
const validValue=value=>Number.isSafeInteger(value)&&value>=0;

function index(rows,key) {
  const result=new Map();
  for(const source of values(rows)) {
    const sourceId=id(key(source));
    if(!sourceId)continue;
    if(result.has(sourceId))throw new Error(`lootgen-catalog: duplicate source identity: ${sourceId}`);
    result.set(sourceId,detached(source));
  }
  return result;
}

function modelPrice(source,type) {
  const fallback=type==="material"?source.priceGold:source.priceGoldEquivalent??source.priceValue;
  const raw=source.value;
  if ((present(raw)&&!validNumber(raw)) || (present(fallback)&&!validNumber(fallback)))return {unitValue:0,priceKnown:false};
  const unitValue=resolveLootgenItemValue(raw,fallback??0);
  return {unitValue,priceKnown:(validNumber(raw)||validNumber(fallback))&&validValue(unitValue)};
}

function magicPrice(source) {
  const f=flags(source),price=source.system?.price??{},multipliers={pp:1000,gp:100,ep:50,sp:10,cp:1};
  if([f.value,f.priceGold].some(value=>present(value)&&!validNumber(value)))return {unitValue:0,priceKnown:false};
  const explicit=[f.value,f.priceGold].find(value=>validNumber(value)&&Number(value)>0);
  let unitValue;
  if(explicit!==undefined)unitValue=Math.floor(Number(explicit));
  else if(validNumber(price.value)&&Object.hasOwn(multipliers,price.denomination??"gp"))unitValue=Math.round(Number(price.value)*multipliers[price.denomination??"gp"]);
  else if([f.value,f.priceGold].some(value=>validNumber(value)&&Number(value)===0))unitValue=0;
  return {unitValue:unitValue??0,priceKnown:validValue(unitValue)};
}

/** Immutable read-only view of authoritative model/compendium sources. Unknown price is explicit. */
export function createLootgenCatalogReader({model={},gearIndex=[],magicDocuments=[],manifest=[]}={}) {
  const gear=index(model.gear??[],source=>source.id),materials=index(model.materials??[],source=>source.id);
  const gearDocuments=index(values(gearIndex).filter(source=>flags(source).managed===true),source=>flags(source).gearId??flags(source).sourceId);
  const magic=index(magicDocuments,source=>flags(source).magicItemId??source.id??source._id);
  const upgrades=index(manifest,source=>source.productId);
  function sourceFor(component) {
    if(component?.sourceType==="gear")return gear.get(id(component.sourceId));
    if(component?.sourceType==="material")return materials.get(id(component.sourceId));
    if(component?.sourceType==="magicItem")return magic.get(id(component.sourceId));
    return null;
  }
  return Object.freeze({
    readContainerValueNodes,
    resolveValueComponent(component) {
      const source=sourceFor(component);if(!source)return null;
      const entry=component.sourceType==="gear"?upgrades.get(id(component.sourceId)):null;
      const stored=flags(gearDocuments.get(id(component.sourceId))).upgrade;
      if(entry && stored && typeof stored==="object" && !Array.isArray(stored) && profileSignature(stored)!==profileSignature(entry.profile)) {
        throw new UpgradeRuleError("unavailable",{reason:"Сохранён пользовательский профиль; его автоматизация не подтверждена."});
      }
      const price=component.sourceType==="magicItem"?magicPrice(source):modelPrice(source,component.sourceType);
      if(component.sourceType==="gear" && upgrades.has(id(component.sourceId)) && !gearDocuments.has(id(component.sourceId)))price.priceKnown=false;
      return {...price,upgradeProfile:component.sourceType==="gear"?structuredClone(upgrades.get(id(component.sourceId))?.profile??null):null,includedUpgradeSourceIds:[]};
    },
    describeUpgradeHost(component) {
      const source=component?.sourceType==="gear"?gearDocuments.get(id(component.sourceId)):component?.sourceType==="magicItem"?magic.get(id(component.sourceId)):null;
      if(!source || flags(source).itemUpgrades?.installed?.length || flags(source).upgrade || flags(source).itemUpgradeTemplate===true)return null;
      const host=buildUpgradeHostDescriptor(source);
      return {...host,quantity:1,isEquipped:false,isAttuned:false,isHeld:false,isBroken:component.isBroken===true};
    }
  });
}
