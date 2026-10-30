import { MODULE_ID } from "../constants.js";
import { LEGACY_AMMUNITION, validateMagazine, getAmmunitionDamage } from "../combat/ammunition-magazine.js?v=1.5.26";

export class MagazineDraft {
  constructor(value){this.value=structuredClone(value);}
  selectGroup(index,key){
    const {groupSize,capacity}=this.value,start=index*groupSize;
    if(start>this.value.rounds.length)throw new Error("Сначала заполните предыдущую ячейку.");
    if(key && key!==LEGACY_AMMUNITION && !this.value.sources[key])throw new Error("Выберите доступный боеприпас.");
    this.value.rounds.splice(start,groupSize,...(key?Array(Math.min(groupSize,capacity-start)).fill(key):[]));
  }
  fill(key){
    const current=this.value.rounds.filter(x=>x===key).length,loaded=this.value.originalRounds??[];
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
  usePattern(rounds){validateMagazine(rounds,this.value.groupSize,this.value.capacity);this.value.rounds=[...rounds];}
  usePreset(index){this.usePattern(this.value.presets[index]?.rounds??[]);}
  savePreset(name){
    const clean=String(name??"").trim();if(!clean || clean.length>80)throw new Error("Введите название пресета (до 80 символов).");
    validateMagazine(this.value.rounds,this.value.groupSize,this.value.capacity);
    const preset={name:clean,rounds:[...this.value.rounds]},index=this.value.presets.findIndex(p=>p.name===clean);
    if(index>=0)this.value.presets[index]=preset;else this.value.presets.push(preset);
  }
}

const {ApplicationV2,HandlebarsApplicationMixin}=foundry.applications.api;
export class AmmunitionMagazineApp extends HandlebarsApplicationMixin(ApplicationV2){
  static DEFAULT_OPTIONS={classes:["rebreya-main","rm-ammunition-magazine"],window:{title:"Снаряжение магазина",icon:"fa-solid fa-bars-staggered",resizable:true},position:{width:700,height:650}};
  static PARTS={main:{template:`modules/${MODULE_ID}/templates/ammunition-magazine.hbs`}};
  constructor(service,actor,weapon,options={}){
    super(options);this.service=service;this.actor=actor;this.weapon=weapon;
    const data=service.getMagazineEditorData(actor,weapon);data.originalRounds=[...data.rounds];this.draft=new MagazineDraft(data);this.error="";this.busy=false;this.selectedPreset=null;
  }
  async _prepareContext(){
    const value=this.draft.value,choices=value.stock.map(row=>({key:row.key,name:row.data?.name??"Старые заряды: разновидность неизвестна",quantity:row.quantity,manual:getAmmunitionDamage(row.data).manual}));
    const cells=[];
    for(let offset=0;offset<value.capacity;offset+=value.groupSize){
      const rounds=value.rounds.slice(offset,offset+value.groupSize),key=rounds[0]??"";
      cells.push({index:offset/value.groupSize,number:1+offset/value.groupSize,size:Math.min(value.groupSize,value.capacity-offset),count:rounds.length,
        locked:offset>value.rounds.length,mixed:new Set(rounds).size>1,choices:choices.map(row=>({...row,selected:row.key===key}))});
    }
    const count=key=>value.rounds.filter(x=>x===key).length;
    return {weaponName:this.weapon.name,current:value.rounds.length,capacity:value.capacity,groupSize:value.groupSize,cells,
      stock:choices.map(row=>({...row,remaining:row.quantity+value.originalRounds.filter(x=>x===row.key).length-count(row.key)})),
      presets:value.presets.map((p,index)=>({...p,index,selected:index===this.selectedPreset})),hasLast:value.lastPattern.length>0,busy:this.busy,error:this.error,canResolve:game.user?.isGM && value.rounds.includes(LEGACY_AMMUNITION),resolveChoices:choices.filter(row=>row.key!==LEGACY_AMMUNITION)};
  }
  async _onRender(context,options){
    await super._onRender(context,options);const root=this.element;
    root.querySelector(".rm-ammo-body").addEventListener("change",event=>{
      if(!event.target.matches("[data-ammo-cell], [data-ammo-preset], [data-ammo-resolve]"))return;
      try{
        if(event.target.matches("[data-ammo-cell]"))this.draft.selectGroup(Number(event.target.dataset.ammoCell),event.target.value);
        if(event.target.matches("[data-ammo-preset]")){this.selectedPreset=event.target.value===""?null:Number(event.target.value);if(this.selectedPreset!==null)this.draft.usePreset(this.selectedPreset);}
        if(event.target.matches("[data-ammo-resolve]")){
          const key=event.target.value;if(key){this.draft.value.legacyResolutionKey=key;this.draft.value.rounds=this.draft.value.rounds.map(k=>k===LEGACY_AMMUNITION?key:k);}
        }
        this.error="";
      }catch(error){this.error=error.message;}
      this.render();
    });
    root.querySelector(".rm-ammo-body").addEventListener("click",event=>{
      const button=event.target.closest("[data-ammo-action]");if(!button || this.busy)return;
      event.preventDefault();void this.#action(button,root);
    });
  }
  async #action(button,root){
    try{
      this.error="";const action=button.dataset.ammoAction;
      if(action==="fill")this.draft.fill(button.dataset.key);
      if(action==="up" || action==="down")this.draft.move(Number(button.dataset.index),action==="up"?-1:1);
      if(action==="save")this.draft.savePreset(root.querySelector("[data-ammo-preset-name]").value);
      if(action==="delete" && this.selectedPreset!==null){this.draft.value.presets.splice(this.selectedPreset,1);this.selectedPreset=null;}
      if(action==="clear")this.draft.value.rounds=[];
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
