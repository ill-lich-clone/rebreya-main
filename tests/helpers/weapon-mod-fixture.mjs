import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export async function optionalModule(path) {
  try { return await import(path); }
  catch (error) { if (error.code === "ERR_MODULE_NOT_FOUND") return {}; throw error; }
}
export const required = (module, name) => module[name] ?? (() => assert.fail(`Missing production behavior: ${name}`));
const read = async name => {
  try { return JSON.parse(await readFile(new URL(`../../data/${name}.json`, import.meta.url))); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
};
export const [gear, ruleDefinitions, hostDefinitions] = await Promise.all([read("gear"), read("weapon-mod-rules"), read("weapon-mod-hosts")]);
const catalogModule = await optionalModule(new URL("../../scripts/data/weapon-mod-catalog.js", import.meta.url));
export const buildCatalog = required(catalogModule, "buildWeaponModCatalog");
export const getCandidate = required(catalogModule, "getWeaponModCandidate");
export const getHost = required(catalogModule, "getWeaponModHostDescriptor");
export function makeItem(gearId, overrides = {}) {
  const row = gear.find(row => row.id === gearId);
  return { id: `item-${gearId}`, type: row?.equipmentType === "Обвес" ? "loot" : "weapon", name: row?.name,
    system: { quantity: 1, properties: new Set(row?.weapon?.properties ?? []), type: { value: row?.firearmClass ? `firearm${row.firearmClass === "primitive" ? "Primitive" : "Advanced"}` : "martialR" } },
    flags: { "rebreya-main": { gearId, firearmClass: row?.firearmClass ?? "", ...(row?.attachment ? { attachment: structuredClone(row.attachment) } : {}) } }, ...overrides };
}
export const makeCatalog = () => buildCatalog(gear, ruleDefinitions, hostDefinitions);

export async function makeWeaponModMutationFixture({quantity=3}={}){
  const {makeInstanceDocumentsFixture}=await import("./item-instance-documents-fixture.mjs");
  const {ItemUpgradeService}=await import("../../scripts/data/item-upgrade-service.js");
  const fx=makeInstanceDocumentsFixture({quantity}),catalog=makeCatalog(),previousChat=globalThis.ChatMessage,cards=new Map();
  fx.group.system={currency:{pp:0,gp:10000,ep:0,sp:0,cp:0}};
  const actorObject=fx.group.toObject.bind(fx.group);
  fx.group.toObject=()=>({...actorObject(),system:structuredClone(fx.group.system)});
  const {CombatAttackService}=await import("../../scripts/combat/attack-service.js");
  fx.api.combatAttackService=new CombatAttackService(fx.api);
  const component=fx.source,source=makeItem("soshki");
  Object.assign(component.data,{name:source.name,type:"loot",flags:source.flags,system:{quantity,equipped:false,container:null}});
  const hostData=makeItem("vintovka");hostData.system.properties=[...hostData.system.properties];
  const host=new globalThis.Item({...hostData,_id:"weapon",flags:{...hostData.flags,"rebreya-main":{...hostData.flags["rebreya-main"],
    itemUpgrades:{capacity:2,installed:[]}}}},fx.group);fx.group.items.contents.push(host);
  let chatFault=null;
  globalThis.ChatMessage={create:async data=>{cards.set(data._id,structuredClone(data));if(chatFault){chatFault=null;throw Error("chat write-then-throw");}return data;}};
  game.messages={contents:[...cards.values()],get:id=>cards.get(id)};
  fx.api.itemUpgradeService=new ItemUpgradeService(fx.api,{getManifest:async()=>[],getWeaponModCatalog:async()=>catalog});
  const restore=fx.restore;
  return {...fx,host,component,catalog,cards,sender:game.user,service:fx.api.itemUpgradeService,
    chatWriteThenThrow:()=>chatFault=true,
    restore(){globalThis.ChatMessage=previousChat;restore();}};
}
export const makeHost = (gearId, overrides = {}) => ({ ...getHost(makeItem(gearId), makeCatalog()), ...overrides });
export function makeAttackCase(sourceId,overrides={}){
  const row=makeCatalog().rows.find(row=>row.sourceId===sourceId),aim=row.profile.effects.find(effect=>effect.kind==="aim");
  return {host:{id:"host",actorUuid:"Actor.a",isFirearm:true},attack:{primary:true,type:"ranged",isFirearm:true},target:{uuid:"Token.target",cover:"none"},
    contributions:row.profile.effects.map((effect,index)=>({...structuredClone(effect),scope:"weapon-mod",hostItemId:"host",childItemId:"child",sourceId,effectKey:String(index),key:`${sourceId}:${index}`})),
    conditions:{movedFeet:0,prone:false,targetVisible:true,usesProficiency:true,underwater:false,aimMode:aim?.mode??null,...overrides}};
}
export const makeCandidate = (sourceId, overrides = {}) => ({ ...getCandidate(makeItem(sourceId), makeCatalog()), ...overrides });
export const makeInstalled = (sourceId, itemId, mountIds = []) => ({ itemId, sourceId, mountIds, profile: makeCandidate(sourceId).profile });
