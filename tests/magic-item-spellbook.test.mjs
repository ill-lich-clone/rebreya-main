import test from "node:test";
import assert from "node:assert/strict";
let subject; try { subject=await import("../scripts/integrations/magic-item-spellbook.js"); } catch(error) { if(error.code!=="ERR_MODULE_NOT_FOUND")throw error; }
const makeHost=(id,magic=true)=>({id,type:"equipment",system:{equipped:false,properties:new Set(magic?["mgc"]:[])},flags:{"rebreya-main":magic?{sourceType:"magicItem"}:{}}});
const spell=(name,host,linked=true)=>({name,type:"spell",flags:{dnd5e:linked?{cachedFor:`.Item.${host?.id}.Activity.cast`}:{}},system:{linkedActivity:host?{item:host}:null}});
const actor=(slots={})=>({type:"character",flags:{"rebreya-main":{heroDoll:{slots}}}});
const context=items=>({spellbook:{item:{items:[...items]},spell1:{items:[{name:"Личное"}]}}});
test("spell list follows the exact magic item on the doll and preserves other spells",()=>{
 assert.equal(typeof subject?.filterMagicItemSpellbook,"function");
 const one=makeHost("one"),two=makeHost("two"),other=makeHost("other",false),a=actor({ring1:{itemId:"one"}});
 const entries=[spell("one",one),spell("two",two),spell("other",other),spell("feat",{id:"feat",type:"feat",system:{}}),spell("personal",null,false)];
 const c=context(entries),before=structuredClone(a);subject.filterMagicItemSpellbook(a,c);
 assert.deepEqual(c.spellbook.item.items.map(x=>x.name),["one","other","feat","personal"]);assert.deepEqual(c.spellbook.spell1.items,[{name:"Личное"}]);assert.deepEqual(a,before);
 a.flags["rebreya-main"].heroDoll.slots={ring2:{itemId:"two"}};const d=context(entries);subject.filterMagicItemSpellbook(a,d);
 assert.deepEqual(d.spellbook.item.items.map(x=>x.name),["two","other","feat","personal"]);
});
test("missing links and other actor types remain untouched",()=>{
 assert.equal(typeof subject?.filterMagicItemSpellbook,"function");
 const h=makeHost("one"),orphan=spell("orphan",null);const c=context([spell("linked",h),orphan]);
 subject.filterMagicItemSpellbook({type:"npc"},c);assert.equal(c.spellbook.item.items.length,2);
 const d=context([orphan]);subject.filterMagicItemSpellbook(actor(),d);assert.equal(d.spellbook.item.items.length,1);
});
test("all existing magic item markers are recognized independently",()=>{
 const markers=[
  {system:{properties:new Set(["mgc"])}},{system:{properties:{mgc:true}}},{system:{rarity:"rare"}},
  ...["magical","isMagical","isMagic","magic","magicItemId","magicId","magicItem","magicWeaponTemplate","magicArmorTemplate","magicShieldTemplate","magicEquipmentTemplate","magicAmmunitionTemplate"].map(key=>({flags:{"rebreya-main":{[key]:true}}})),
  {flags:{dnd5e:{magical:true}}},{flags:{"rebreya-main":{sourceType:"magicItem"}}}
 ];
 for(const marker of markers){const host={id:"host",type:"equipment",...marker},c=context([spell("item spell",host)]);subject.filterMagicItemSpellbook(actor(),c);assert.equal(c.spellbook.item.items.length,0,JSON.stringify(marker));}
 for(const rarity of ["", "none", "mundane"]){const host={id:"ordinary",type:"equipment",system:{rarity}},c=context([spell("ordinary",host)]);subject.filterMagicItemSpellbook(actor(),c);assert.equal(c.spellbook.item.items.length,1);}
});
test("the dnd5e hook filters only character spell parts",()=>{
 assert.equal(typeof subject?.registerMagicItemSpellbookHook,"function");
 const hooks={on(name,fn){this.name=name;this.fn=fn;}};subject.registerMagicItemSpellbookHook(hooks);assert.equal(hooks.name,"dnd5e.prepareSheetContext");
 const a=actor(),c=context([spell("hidden",makeHost("x"))]);hooks.fn({actor:a},"inventory",c);assert.equal(c.spellbook.item.items.length,1);hooks.fn({actor:a},"spells",c);assert.equal(c.spellbook.item.items.length,0);
});
