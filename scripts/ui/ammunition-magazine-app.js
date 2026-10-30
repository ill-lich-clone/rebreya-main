import { MODULE_ID } from "../constants.js";
import { LEGACY_AMMUNITION, validateMagazine, getAmmunitionDamage } from "../combat/ammunition-magazine.js?v=1.5.31";
import { resolveMagazinePresentation, buildCartridgeLayout, buildMagazineBand } from "./ammunition-magazine-visuals.js?v=1.5.32";

const AMMO_DRAG_TYPE="application/x-rebreya-ammunition";
const DAMAGE_LABELS={fire:"огнём",cold:"холодом",acid:"кислотой",lightning:"электричеством",thunder:"звуком",poison:"ядом",radiant:"излучением",necrotic:"некротического",force:"силового",piercing:"колющего",bludgeoning:"дробящего",slashing:"рубящего"};

export class MagazineDraft {
  constructor(value){this.value=structuredClone(value);this.value.originalRounds??=[...this.value.rounds];}
  selectGroup(index,key){
    const {groupSize,capacity}=this.value,start=index*groupSize;
    if(!Number.isInteger(index)||index<0||start>=capacity)throw new Error("Выберите ячейку магазина.");
    if(start>this.value.rounds.length)throw new Error("Сначала заполните предыдущую ячейку.");
    if(key && key!==LEGACY_AMMUNITION && !this.value.sources[key])throw new Error("Выберите доступный боеприпас.");
    const rounds=[...this.value.rounds];
    rounds.splice(start,groupSize,...(key?Array(Math.min(groupSize,capacity-start)).fill(key):[]));
    validateMagazine(rounds,groupSize,capacity);
    if(key){
      const available=(this.value.stock.find(row=>row.key===key)?.quantity??0)+this.value.originalRounds.filter(round=>round===key).length;
      if(rounds.filter(round=>round===key).length>available)throw new Error("Не хватает патронов для целой ячейки. Можно заполнить остаток доступным количеством.");
    }
    this.value.rounds=rounds;
  }
  fill(key){
    const current=this.value.rounds.filter(x=>x===key).length,loaded=this.value.originalRounds;
    const available=(this.value.stock.find(x=>x.key===key)?.quantity??0)+loaded.filter(x=>x===key).length-current;
    let remaining=available;
    while(remaining>0 && this.value.rounds.length<this.value.capacity){
      const n=Math.min(this.value.groupSize-this.value.rounds.length%this.value.groupSize,this.value.capacity-this.value.rounds.length,remaining);
      const offset=this.value.rounds.length%this.value.groupSize;
      if(offset && this.value.rounds.at(-1)!==key)throw new Error("Сначала завершите неполную ячейку тем же типом патронов.");
      this.value.rounds.push(...Array(n).fill(key));remaining-=n;
    }
  }
  move(index,direction){
    const groups=[];for(let i=0;i<this.value.rounds.length;i+=this.value.groupSize)groups.push(this.value.rounds.slice(i,i+this.value.groupSize));
    const next=index+direction;if(next<0 || next>=groups.length)return;
    [groups[index],groups[next]]=[groups[next],groups[index]];
    const rounds=groups.flat();validateMagazine(rounds,this.value.groupSize,this.value.capacity);this.value.rounds=rounds;
  }
  resolveLegacy(key){
    if(!this.value.sources[key]||key===LEGACY_AMMUNITION)throw new Error("Выберите известную разновидность патронов.");
    this.value.legacyResolutionKey=key;
    this.value.rounds=this.value.rounds.map(round=>round===LEGACY_AMMUNITION?key:round);
    this.value.originalRounds=this.value.originalRounds.map(round=>round===LEGACY_AMMUNITION?key:round);
  }
  usePattern(rounds){validateMagazine(rounds,this.value.groupSize,this.value.capacity);this.value.rounds=[...rounds];}
  usePreset(index){this.usePattern(this.value.presets[index]?.rounds??[]);}
  savePreset(name){
    const clean=String(name??"").trim();if(!clean || clean.length>80)throw new Error("Введите название пресета (до 80 символов).");
    validateMagazine(this.value.rounds,this.value.groupSize,this.value.capacity);
    const preset={name:clean,rounds:[...this.value.rounds]},index=this.value.presets.findIndex(p=>p.name===clean);
    if(index>=0)this.value.presets[index]=preset;else this.value.presets.push(preset);
  }
}

export function buildMagazineView(value,selectedGroup=0,weapon={}){
  const presentation=resolveMagazinePresentation(weapon,value.capacity),layout=buildCartridgeLayout(presentation,value.capacity);
  const source=key=>value.sources[key]??value.stock.find(row=>row.key===key)?.data;
  const tone=key=>key===LEGACY_AMMUNITION?"unknown":getAmmunitionDamage(source(key)).parts[0]?.type??"normal";
  const cells=[];
  for(let start=0;start<value.capacity;start+=value.groupSize){
    const rounds=value.rounds.slice(start,start+value.groupSize),key=rounds[0],size=Math.min(value.groupSize,value.capacity-start),index=start/value.groupSize;
    const slots=Array.from({length:size},(_,i)=>{
      const position=start+i;
      return {...layout[position],loaded:position<value.rounds.length};
    });
    const name=key===LEGACY_AMMUNITION?"Неизвестные заряды":source(key)?.name??"Пусто";
    cells.push({index,number:index+1,size,count:rounds.length,name,shortName:name.replace(/^Боеприпасы с /u,"С "),
      key,tone:tone(key),unknown:key===LEGACY_AMMUNITION,selected:index===selectedGroup,first:index===0,locked:start>value.rounds.length,
      slots,bandPath:buildMagazineBand(presentation,start,size,value.capacity,slots),mixed:new Set(rounds).size>1});
  }
  const stock=value.stock.filter(row=>row.key!==LEGACY_AMMUNITION||row.quantity>0).map(row=>{
    const data=source(row.key),damage=getAmmunitionDamage(data),remaining=row.quantity+(value.originalRounds??[]).filter(key=>key===row.key).length-value.rounds.filter(key=>key===row.key).length;
    return {...row,name:row.key===LEGACY_AMMUNITION?"Неизвестные патроны импланта":data?.name??"Боеприпас",img:data?.img??"icons/svg/item-bag.svg",tone:tone(row.key),remaining,empty:remaining<=0,manual:damage.manual,
      bonus:damage.parts.map(part=>"+"+part.formula.replaceAll("d","к")+" "+(DAMAGE_LABELS[part.type]??part.type)).join(", ")};
  });
  const legacyCount=(value.originalRounds??[]).filter(key=>key===LEGACY_AMMUNITION).length;
  return {cells,stock,presentation,legacyCount,hasSavedLegacy:legacyCount>0,hasLegacy:legacyCount>0||value.rounds.includes(LEGACY_AMMUNITION)};
}

const {ApplicationV2,HandlebarsApplicationMixin}=foundry.applications.api;
export class AmmunitionMagazineApp extends HandlebarsApplicationMixin(ApplicationV2){
  static DEFAULT_OPTIONS={classes:["rebreya-main","rm-ammunition-magazine"],window:{title:"Снаряжение магазина",icon:"fa-solid fa-bars-staggered",resizable:true},position:{width:960,height:760}};
  static PARTS={main:{template:"modules/"+MODULE_ID+"/templates/ammunition-magazine.hbs"}};
  constructor(service,actor,weapon,options={}){
    super(options);this.service=service;this.actor=actor;this.weapon=weapon;
    this.draft=new MagazineDraft(service.getMagazineEditorData(actor,weapon));this.error="";this.busy=false;this.selectedPreset=null;this.selectedGroup=0;
  }
  async _prepareContext(){
    const value=this.draft.value,view=buildMagazineView(value,this.selectedGroup,this.weapon);
    return {...view,weaponName:this.weapon.name.replace(/\s+\(\d+\/\d+\)$/u,""),current:value.rounds.length,capacity:value.capacity,groupSize:value.groupSize,selectedGroupNumber:this.selectedGroup+1,
      presets:value.presets.map((p,index)=>({...p,index,selected:index===this.selectedPreset})),hasLast:value.lastPattern.length>0,busy:this.busy,error:this.error,
      canResolve:globalThis.game?.user?.isGM && value.originalRounds.includes(LEGACY_AMMUNITION),resolveChoices:view.stock.filter(row=>row.key!==LEGACY_AMMUNITION),unloading:value.rounds.length===0&&value.originalRounds.length>0,
      clipId:("rm-ammo-"+(this.id??this.weapon.id??"draft")).replaceAll(/[^a-zA-Z0-9_-]/g,"")};
  }
  async _onRender(context,options){
    await super._onRender(context,options);const root=this.element,body=root.querySelector(".rm-ammo-body");
    body.addEventListener("change",event=>{
      if(this.busy||!event.target.matches("[data-ammo-preset], [data-ammo-resolve]"))return;
      try{
        if(event.target.matches("[data-ammo-preset]")){this.selectedPreset=event.target.value===""?null:Number(event.target.value);if(this.selectedPreset!==null)this.draft.usePreset(this.selectedPreset);}
        if(event.target.matches("[data-ammo-resolve]")&&event.target.value)this.draft.resolveLegacy(event.target.value);
        this.error="";
      }catch(error){this.error=error.message;}
      this.render();
    });
    const activate=event=>{
      const button=event.target.closest("[data-ammo-action]");if(!button||this.busy||button.getAttribute("aria-disabled")==="true")return;
      event.preventDefault();void this.#action(button,root);
    };
    body.addEventListener("click",activate);
    body.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)&&event.target.matches("[data-ammo-group]"))activate(event);});
    body.addEventListener("dragstart",event=>{
      const card=event.target.closest("[data-ammo-key]");
      if(!card||this.busy||!event.dataTransfer)return;
      event.dataTransfer.setData(AMMO_DRAG_TYPE,card.dataset.ammoKey);event.dataTransfer.effectAllowed="copy";
    });
    body.addEventListener("dragover",event=>{
      const group=event.target.closest("[data-ammo-group]");
      if(!group||this.busy||!Array.from(event.dataTransfer?.types??[]).includes(AMMO_DRAG_TYPE))return;
      event.preventDefault();event.dataTransfer.dropEffect="copy";group.classList.add("is-drop-target");
    });
    body.addEventListener("dragleave",event=>event.target.closest("[data-ammo-group]")?.classList.remove("is-drop-target"));
    body.addEventListener("drop",event=>{
      const group=event.target.closest("[data-ammo-group]"),key=event.dataTransfer?.getData(AMMO_DRAG_TYPE);
      if(!group||!key||this.busy)return;
      event.preventDefault();event.stopPropagation();group.classList.remove("is-drop-target");
      try{this.#place(Number(group.dataset.ammoGroup),key);this.error="";}catch(error){this.error=error.message;}
      this.render();
    });
  }
  #place(index,key){this.draft.selectGroup(index,key);this.selectedGroup=Math.min(index+1,Math.ceil(this.draft.value.capacity/this.draft.value.groupSize)-1);}
  async #action(button,root){
    try{
      this.error="";const action=button.dataset.ammoAction,index=Number(button.dataset.index);
      if(action==="select")this.selectedGroup=index;
      if(action==="place")this.#place(this.selectedGroup,button.dataset.key);
      if(action==="fill")this.draft.fill(button.dataset.key);
      if(action==="up"||action==="down"){this.draft.move(index,action==="up"?-1:1);this.selectedGroup=Math.max(0,Math.min(index+(action==="up"?-1:1),Math.ceil(this.draft.value.rounds.length/this.draft.value.groupSize)-1));}
      if(action==="save")this.draft.savePreset(root.querySelector("[data-ammo-preset-name]").value);
      if(action==="delete"&&this.selectedPreset!==null){this.draft.value.presets.splice(this.selectedPreset,1);this.selectedPreset=null;}
      if(action==="clear"){this.draft.value.rounds=[];this.selectedGroup=0;}
      if(action==="cancel"){await this.close();return;}
      if(action==="last"){this.draft.usePattern(this.draft.value.lastPattern);await this.#confirm();return;}
      if(action==="load"){await this.#confirm();return;}
    }catch(error){this.error=error.message;}
    await this.render();
  }
  async #confirm(){
    this.busy=true;await this.render();
    try{await this.service.commitMagazine(this.actor,this.weapon,this.draft.value);await this.close();}
    catch(error){this.error=error.message;this.busy=false;await this.render();}
  }
}
