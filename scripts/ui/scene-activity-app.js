import { SCENE_ACTIVITY_ACTIONS } from "../data/scene-activity-rules.js?v=1.4.271";
const {ApplicationV2,HandlebarsApplicationMixin}=foundry.applications.api;
const clone=value=>structuredClone(value);
const icons={inspect:"fa-eye",help:"fa-hands-helping",prepare:"fa-toolbox",rest:"fa-mug-hot",custom:"fa-pen"};
const permissionKey=view=>JSON.stringify([view.canManage,view.session?.selectableActorUuids,view.members]);
export class SceneActivityApp extends HandlebarsApplicationMixin(ApplicationV2){
  static DEFAULT_OPTIONS={classes:["rebreya-main","rm-scene-activity-app"],window:{title:"Десятиминутная сцена",icon:"fa-solid fa-hourglass-half",resizable:false,minimizable:false},position:{width:1000,height:720}};
  static PARTS={main:{root:true,template:"modules/rebreya-main/templates/scene-activity-app.hbs"}};
  constructor(api,snapshot,{onClosed=()=>{},onVisibilityChange=()=>{}}={}){
    super();Object.assign(this,{api,snapshot:clone(snapshot),onClosed,onVisibilityChange});this.drafts=new Map();this.pending=new Map();this.collapsed=false;this.disposed=false;this.busy=false;this.status="";
    this.selectedActorUuid=snapshot.session?.selectableActorUuids?.[0]??"";
    this.initiatingActorUuid=snapshot.members[0]?.uuid??"";this.invited=new Set(snapshot.members.filter(m=>m.uuid!==this.initiatingActorUuid).slice(0,64).map(m=>m.uuid));
  }
  setDraft(actorUuid,draft){if(!this.snapshot.session?.selectableActorUuids.includes(actorUuid))return;this.drafts.set(actorUuid,{actionId:draft.actionId??"inspect",text:String(draft.text??"").slice(0,500)});}
  #draft(){const saved=this.snapshot.session?.selectionByActor?.[this.selectedActorUuid];return this.drafts.get(this.selectedActorUuid)??{actionId:saved?.actionId??"inspect",text:saved?.text??""};}
  async _prepareContext(){
    const view=this.snapshot,session=view.session,names=new Map(view.members.map(m=>[m.uuid,m.name]));
    const draft=this.#draft(),selectable=session?.selectableActorUuids??[];
    return {...view,setup:!session,canChoose:selectable.includes(this.selectedActorUuid),selectedActorUuid:this.selectedActorUuid,
      busyName:names.get(session?.initiatingActorUuid)??"Персонаж",draft,status:this.status,busy:this.busy,
      actorOptions:selectable.map(uuid=>({uuid,name:names.get(uuid)??uuid,selected:uuid===this.selectedActorUuid})),multipleActors:selectable.length>1,
      actions:Object.entries(SCENE_ACTIVITY_ACTIONS).map(([id,label])=>({id,label,icon:icons[id],checked:id===draft.actionId})),
      roster:(session?.participantActorUuids??[]).map(uuid=>({uuid,name:names.get(uuid)??uuid,action:SCENE_ACTIVITY_ACTIONS[session.selectionByActor[uuid]?.actionId]??"Ещё не выбрано",text:session.selectionByActor[uuid]?.text??""})),
      groups:(view.groups??[]).map(g=>({...g,selected:g.id===view.groupActorId})),initiatingActorUuid:this.initiatingActorUuid,
      initiators:view.members.map(m=>({...m,selected:m.uuid===this.initiatingActorUuid})),
      participants:view.members.filter(m=>m.uuid!==this.initiatingActorUuid).map(m=>({...m,checked:this.invited.has(m.uuid)}))};
  }
  async applySnapshot(snapshot){
    if(this.disposed)return;const previous=this.snapshot;
    if(snapshot.groupRevision<previous.groupRevision||(snapshot.session?.sessionId===previous.session?.sessionId&&snapshot.session?.revision<previous.session?.revision))return;
    this.snapshot=clone(snapshot);
    if(snapshot.session&&!snapshot.session.selectableActorUuids.includes(this.selectedActorUuid))this.selectedActorUuid=snapshot.session.selectableActorUuids[0]??"";
    if(!snapshot.session){
      if(!snapshot.members.some(m=>m.uuid===this.initiatingActorUuid)){
        this.initiatingActorUuid=snapshot.members[0]?.uuid??"";
        this.invited=new Set(snapshot.members.filter(m=>m.uuid!==this.initiatingActorUuid).slice(0,64).map(m=>m.uuid));
      }else this.invited=new Set([...this.invited].filter(uuid=>uuid!==this.initiatingActorUuid&&snapshot.members.some(m=>m.uuid===uuid)));
    }
    if(!this.rendered||this.collapsed)return;
    if(permissionKey(previous)!==permissionKey(snapshot)||Boolean(previous.session)!==Boolean(snapshot.session))await this.render(true);
    if(this.disposed){await super.close();return;}
    this.#syncReadonly();
  }
  #syncReadonly(){
    const root=this.element;if(!root?.querySelectorAll)return;
    const status=root.querySelector('[data-role="status"]');if(status)status.textContent=this.status;
    const session=this.snapshot.session;
    for(const node of root.querySelectorAll('[data-participant]')){
      const choice=session?.selectionByActor?.[node.dataset.participant];
      const label=node.querySelector('[data-role="choice"]'),text=node.querySelector('[data-role="detail"]');
      if(label)label.textContent=SCENE_ACTIVITY_ACTIONS[choice?.actionId]??"Ещё не выбрано";if(text)text.textContent=choice?.text??"";
    }
    for(const node of root.querySelectorAll('[data-mutation]'))node.disabled=this.busy;
    if(session){
      const draft=this.#draft();
      for(const input of root.querySelectorAll('[data-field="action"]'))input.checked=input.value===draft.actionId;
      const text=root.querySelector('[data-field="text"]');if(text&&text.value!==draft.text)text.value=draft.text;
    }
  }
  async #request(action,fields){
    if(this.busy||this.disposed)return false;
    // Exclude revision from the draft identity: a transport retry must keep its original revision and operation ID.
    const key=JSON.stringify([action,Object.entries(fields).filter(([name])=>!name.startsWith("expected"))]);
    if(!this.pending.has(key))this.pending.set(key,{...clone(fields),operationId:foundry.utils.randomID()});
    const payload=this.pending.get(key);this.busy=true;this.status="Сохраняем…";this.#syncReadonly();let success=false;
    try{await this.api[`${action}SceneActivity`](payload);this.pending.delete(key);this.status="Заявка сохранена.";success=true;}
    catch(error){this.status=error?.message??"Не удалось сохранить заявку.";if(["stale-revision","operation-conflict"].includes(error?.code))this.pending.delete(key);}
    finally{this.busy=false;this.#syncReadonly();}
    try{await this.api.refreshSceneActivityApps?.();}catch(error){if(success)this.status="Сохранено. Не удалось обновить список заявок.";this.#syncReadonly();}
    return success;
  }
  async submitChoice(){
    const session=this.snapshot.session;if(!session?.selectableActorUuids.includes(this.selectedActorUuid))return false;
    const draft=this.#draft();if(draft.actionId==="custom"&&!draft.text.trim()){this.status="Опишите своё действие.";this.#syncReadonly();return false;}
    return this.#request("choose",{sessionId:session.sessionId,actorUuid:this.selectedActorUuid,actionId:draft.actionId,text:draft.text,expectedRevision:session.revision});
  }
  async start(){
    if(!this.snapshot.canManage||this.snapshot.session)return false;
    const participants=[...this.invited].filter(uuid=>uuid!==this.initiatingActorUuid&&this.snapshot.members.some(m=>m.uuid===uuid));
    if(!participants.length){this.status="Выберите хотя бы одного участника.";this.#syncReadonly();return false;}
    return this.#request("start",{groupActorId:this.snapshot.groupActorId,expectedGroupRevision:this.snapshot.groupRevision,
      initiatingActorUuid:this.initiatingActorUuid,participantActorUuids:participants,durationMinutes:10});
  }
  async finish(action="finish"){
    if(!this.snapshot.canManage||!this.snapshot.session||!["finish","cancel"].includes(action))return false;
    return this.#request(action,{sessionId:this.snapshot.session.sessionId,expectedRevision:this.snapshot.session.revision});
  }
  async reopen(){if(this.disposed)return;this.collapsed=false;await this.render(true);if(this.disposed){await super.close();return;}this.onVisibilityChange(this);return this;}
  async close(options={}){
    this.listeners?.abort();await super.close(options);
    if(this.snapshot.session&&!this.disposed){this.collapsed=true;this.onVisibilityChange(this);}else this.onClosed(this);
    return this;
  }
  async dispose(){if(this.disposed)return;this.disposed=true;this.pending.clear();await this.close();}
  async _onRender(context,options){
    await super._onRender(context,options);this.listeners?.abort();this.listeners=new AbortController();const root=this.element;if(!root?.addEventListener)return;
    const signal=this.listeners.signal;
    root.addEventListener("input",event=>{
      if(event.target.dataset.field!=="text")return;this.setDraft(this.selectedActorUuid,{...this.#draft(),text:event.target.value});
      const count=root.querySelector('[data-role="char-count"]');if(count)count.textContent=`${event.target.value.length}/500`;
    },{signal});
    root.addEventListener("change",async event=>{
      const input=event.target,field=input.dataset.field;
      if(field==="action")this.setDraft(this.selectedActorUuid,{...this.#draft(),actionId:input.value});
      if(field==="actor"){this.selectedActorUuid=input.value;await this.render(true);}
      if(field==="initiator"){this.initiatingActorUuid=input.value;this.invited=new Set(this.snapshot.members.filter(m=>m.uuid!==input.value).slice(0,64).map(m=>m.uuid));await this.render(true);}
      if(field==="participant"){if(input.checked)this.invited.add(input.value);else this.invited.delete(input.value);}
      if(field==="group"){
        try{await this.api.openSceneActivityApp({groupActorId:input.value});}catch(error){this.status=error.message;this.#syncReadonly();}
      }
    },{signal});
    root.addEventListener("click",async event=>{
      const action=event.target.closest('[data-scene-action]')?.dataset.sceneAction;if(!action)return;
      event.preventDefault();
      if(action==="collapse")await this.close();if(action==="choose")await this.submitChoice();if(action==="start")await this.start();
      if(action==="finish"||action==="cancel")await this.finish(action);
    },{signal});
    this.#syncReadonly();
  }
}

let indicator=null,indicatorListeners=null;
export function renderSceneActivityIndicator(apps){
  if(!globalThis.document?.body)return;
  const active=apps.filter(app=>app.snapshot.session&&!app.disposed);indicatorListeners?.abort();
  if(!active.length){indicator?.remove();indicator=null;return;}
  if(!indicator){indicator=document.createElement("nav");indicator.className="rm-scene-activity-indicator";indicator.setAttribute("aria-label","Открытые сцены");document.body.append(indicator);}
  indicator.replaceChildren();indicatorListeners=new AbortController();
  for(const app of active){const button=document.createElement("button");button.type="button";button.textContent=`10 минут · ${app.snapshot.groupName}`;button.title="Вернуться к сцене";
    button.addEventListener("click",()=>app.reopen().catch(error=>globalThis.ui?.notifications?.error?.(error.message)),{signal:indicatorListeners.signal});indicator.append(button);}
}
