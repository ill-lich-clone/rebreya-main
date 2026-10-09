import { HERO_DOLL_GHOST_IMAGE } from "../data/hero-doll-presets.js?v=1.4.364-hero-presets";

const escape = value => String(value ?? "").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

export async function handleHeroDollPresetAction(action, {
  actor, service, presetId, slotId, dialog = globalThis.foundry?.applications?.api?.DialogV2
}) {
  if (action === "apply") return service.applyPreset(actor,presetId);
  if (action === "save") return service.savePreset(actor,presetId);
  if (action === "clear-ghost") return service.clearGhost(actor,slotId);
  const preset = service.getActorSnapshot(actor).presets?.find(entry=>entry.id===presetId);
  if (action === "delete") {
    if (!await dialog.confirm({window:{title:"Удалить комплект"},content:`<p>Удалить комплект «${escape(preset?.name)}»? Текущая кукла сохранится.</p>`,rejectClose:false})) return;
    return service.deletePreset(actor,presetId);
  }
  if (!["create","rename"].includes(action)) return;
  const name = await dialog.prompt({window:{title:action==="create"?"Новый комплект":"Название комплекта"},
    content:`<form><label>Название<input type="text" name="name" value="${escape(action==="rename"?preset?.name:"")}" maxlength="128" required autofocus></label></form>`,
    ok:{label:"Сохранить",callback:(_event,button)=>String(button?.form?.elements?.name?.value ?? "").trim()},rejectClose:false});
  if (!name) return;
  return action === "create" ? service.createPreset(actor,name) : service.renamePreset(actor,presetId,name);
}

export function bindHeroDollPresetControls(panel, {actor,service,rerender=async()=>{},signal,openMenu,onError=error=>globalThis.ui?.notifications?.error(error.message)} = {}) {
  const select = panel.querySelector("[data-hero-doll-preset-select]");
  const controls = [...panel.querySelectorAll("[data-preset-command]")];
  const selected = () => select?.value ?? "";
  let busy = false;
  const syncButtons = () => {
    for (const button of controls) button.disabled = busy || actor.isOwner === false
      || (["apply","save"].includes(button.dataset.presetCommand) && !selected());
  };
  syncButtons();
  select?.addEventListener("change",()=>{service.selectPreset(actor,selected());syncButtons();},{signal});
  const perform = async action => {
    if (busy || signal?.aborted) return;
    busy=true;syncButtons();if(select)select.disabled=true;
    try {await handleHeroDollPresetAction(action,{actor,service,presetId:selected()});await rerender();}
    catch(error){onError(error);}
    finally {busy=false;if(select)select.disabled=actor.isOwner===false;syncButtons();}
  };
  panel.addEventListener("click",async event=>{
    const button=event.target.closest?.("[data-preset-command]");
    if (!button || !panel.contains(button) || button.disabled) return;
    event.preventDefault();event.stopPropagation();
    if (button.dataset.presetCommand === "manage") {
      openMenu?.({x:Number(event.clientX ?? 0),y:Number(event.clientY ?? 0),title:"Комплекты куклы",actions:[
        {id:"create",label:"Новый комплект",icon:"fa-solid fa-plus",callback:()=>perform("create")},
        {id:"rename",label:"Переименовать",icon:"fa-solid fa-pen",disabled:!selected(),callback:()=>perform("rename")},
        {id:"delete",label:"Удалить комплект",icon:"fa-solid fa-trash",disabled:!selected(),callback:()=>perform("delete")}
      ]});
      return;
    }
    await perform(button.dataset.presetCommand);
  },{signal});
  for (const image of panel.querySelectorAll("[data-hero-doll-ghost-image]")) {
    image.addEventListener("error",()=>{image.src=HERO_DOLL_GHOST_IMAGE;},{signal,once:true});
  }
}
