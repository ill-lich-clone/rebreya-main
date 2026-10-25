export function installHeroDollLatencyQA({actorId,itemId}) {
  if (globalThis.__rebreyaHeroLatencyQA) throw new Error("QA already installed");
  const actor=game.actors.get(actorId), item=actor?.items.get(itemId);
  if (!actor?.getFlag("rebreya-main","heroDollLatencyQA") || !item) throw new Error("Dedicated QA fixture required");
  const now=()=>performance.timeOrigin+performance.now(), records=[], restores=[], hooks=[];
  const api=game.rebreyaMain, service=api.heroDollService;
  const assign=service.assignItemToSlot.bind(service), clear=service.clearSlot.bind(service);
  let submitting=null, active=null, sequence=0;
  const counters={customSocketEmits:0,worldSettingWrites:0};
  const wrap=(object,key,factory)=>{const own=Object.hasOwn(object,key), original=object[key]; object[key]=factory(original); restores.push(()=>{if(own)object[key]=original;else delete object[key];});};
  wrap(api.worldMutationCoordinator,"run",original=>function(key,operation){
    if(key!=="inventory-organization:"+actorId || !submitting) return original.call(this,key,operation);
    const record=submitting;
    return original.call(this,key,async()=>{active=record;record.queueStart=now();try{return await operation();}finally{active=null;}});
  });
  for(const [object,key] of [[item,"item"],[actor,"actor"]]) wrap(object,"update",original=>async function(...args){
    const record=active, entry={start:now()};if(record)(record[key+"Updates"]??=[]).push(entry);
    try{return await original.apply(this,args);}catch(error){entry.error=error.message;throw error;}finally{entry.end=now();}
  });
  for(const type of ["Item","Actor"]) {
    const callback=(document,change)=>{if((type==="Item"?document.parent?.id:document.id)!==actorId)return;
      if(active)(active[type.toLowerCase()+"Hooks"]??=[]).push({time:now(),keys:Object.keys(change)});
    };
    hooks.push(["update"+type,Hooks.on("update"+type,callback)]);
  }
  wrap(game.socket,"emit",original=>function(channel,...args){if(channel==="module.rebreya-main")counters.customSocketEmits++;return original.call(this,channel,...args);});
  wrap(game.settings,"set",original=>function(namespace,key,...args){if(game.settings.settings.get(namespace+"."+key)?.scope==="world")counters.worldSettingWrites++;return original.call(this,namespace,key,...args);});
  const state=()=>({slots:foundry.utils.deepClone(actor.getFlag("rebreya-main","heroDoll")?.slots??{}),equipped:item.system.equipped,heldHands:item.getFlag("rebreya-main","heldHands")??[],quantity:item.system.quantity,itemId:item.id,itemCount:actor.items.size});
  const expectedVisible=record=>{
    const root=actor.sheet.element;if(!root)return false;
    const buttons=[...root.querySelectorAll("[data-hero-doll-slot]")];
    if(!buttons.length)return false;
    return ["ring1","ring2","ring3"].every(slot=>{
      const button=buttons.find(e=>e.dataset.slotId===slot);
      return button && button.getBoundingClientRect().width > 0 && (button.getAttribute("aria-label")?.includes(item.name)=== (record.mode==="assign"&&slot===record.slot));
    });
  };
  const observer=new MutationObserver(()=>{for(const r of records)if(!r.visible&&expectedVisible(r)){r.visible=now();requestAnimationFrame(()=>{r.paint=now();});}});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["aria-label"]});
  const invoke=(mode,slot,group)=>{
    const record={id:++sequence,group,mode,slot,start:now(),before:state()};records.push(record);submitting=record;
    let promise;
    try{promise=mode==="clear"?clear(actor,slot):assign(actor,slot,{uuid:item.uuid});}finally{submitting=null;}
    return Promise.resolve(promise).then(result=>{record.end=now();record.after=state();return result;},error=>{record.end=now();record.error={code:error.code,message:error.message};record.after=state();throw error;});
  };
  const waitVisible=async record=>{const deadline=performance.now()+15000;while(!record.visible&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));if(!record.visible)throw new Error("Visible state timeout: "+record.id);};
  const run=async(count=10)=>{
    for(let n=0;n<count;n++){
      await invoke("assign","ring1","equip");await waitVisible(records.at(-1));
      await invoke("clear","ring1","unequip");await waitVisible(records.at(-1));
    }
    await invoke("assign","ring1","setup");await waitVisible(records.at(-1));
    for(let n=0;n<count;n++){await invoke("assign",n%2===0?"ring2":"ring1","move");await waitVisible(records.at(-1));}
    await invoke("clear",Object.keys(state().slots).find(k=>state().slots[k]?.itemId===itemId),"setup");await waitVisible(records.at(-1));
    for(let n=0;n<count;n++){
      const first=invoke("assign","ring1","rapid-equip");const rec=records.at(-1);
      await waitVisible(rec);const second=invoke("clear","ring1","rapid-followup");
      await Promise.all([first,second]);await waitVisible(records.at(-1));
    }
    // Distinct same-Actor requests force a real local queue without deduplication.
    for(let n=0;n<count;n++)await Promise.all([invoke("assign","ring1","burst"),invoke("assign","ring2","burst"),invoke("assign","ring3","burst")]);
    await invoke("clear","ring3","cleanup");await waitVisible(records.at(-1));
    return {records,counters,final:state()};
  };
  const cleanup=()=>{observer.disconnect();for(const [hook,id]of hooks)Hooks.off(hook,id);for(const restore of restores.reverse())restore();delete globalThis.__rebreyaHeroLatencyQA;};
  wrap(service,"assignItemToSlot",original=>function(target,slot,data){return target.id===actorId&&data.uuid===item.uuid?invoke("assign",slot,"ui-equip"):original.call(this,target,slot,data);});
  wrap(service,"clearSlot",original=>function(target,slot){return target.id===actorId?invoke("clear",slot,"ui-clear"):original.call(this,target,slot);});
  globalThis.__rebreyaHeroLatencyQA={run,invoke,records,counters,state,cleanup};
  return {actorId,itemId,installed:true};
}
