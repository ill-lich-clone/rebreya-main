/** Local projection only. The app registry is supplied by the composition root. */
export class SceneActivityController {
  constructor({api,registry,createApp,onChange=()=>{}}){Object.assign(this,{api,registry,createApp,onChange});this.views=new Map();this.versions=new Map();this.request=0;this.applied=0;this.groups=[];this.applyQueue=Promise.resolve();}
  changed(){this.onChange([...this.registry.values()]);}
  #ensure(key,view){
    let app=this.registry.get(key);
    if(!app){app=this.createApp(view,{onClosed:closed=>{if(this.registry.get(key)===closed)this.registry.delete(key);this.changed();},onVisibilityChange:()=>this.changed()});this.registry.set(key,app);}
    return app;
  }
  async #remove(key,app){await app.dispose();if(this.registry.get(key)===app)this.registry.delete(key);}
  async #accept(view){
    const groupId=view.groupActorId,previous=this.versions.get(groupId),session=view.session;
    if(previous && (view.groupRevision<previous.groupRevision || (session&&session.sessionId===previous.sessionId&&session.revision<previous.revision)))return;
    this.versions.set(groupId,{groupRevision:view.groupRevision,sessionId:session?.sessionId??null,revision:session?.revision??0});
    this.views.set(groupId,view);
    for(const [key,app]of this.registry){
      if(app.snapshot.groupActorId!==groupId)continue;
      if(session ? key!==session.sessionId : Boolean(app.snapshot.session)||!view.canManage)await this.#remove(key,app);
      else if(!session)await app.applySnapshot({...view,groups:this.groups});
    }
    if(session){
      const fresh=!this.registry.has(session.sessionId),app=this.#ensure(session.sessionId,{...view,groups:this.groups});
      await app.applySnapshot({...view,groups:this.groups});if(fresh)await app.reopen();
    }
  }
  async refresh(){
    const request=++this.request,groups=await this.api.listSceneActivityGroups();
    const outcomes=await Promise.all(groups.map(async group=>{
      try{return {groupId:group.id,view:await this.api.getSceneActivitySnapshot({groupActorId:group.id})};}
      catch(error){return {groupId:group.id,error};}
    }));
    // Rendering/closing is asynchronous in Foundry. Serialize application so a late
    // render cannot recreate a session after a newer terminal snapshot removed it.
    const applying=this.applyQueue.then(()=>this.#applyBatch(request,groups,outcomes));
    this.applyQueue=applying.catch(()=>{});return applying;
  }
  async #applyBatch(request,groups,outcomes){
    if(request<this.applied)return;this.applied=request;this.groups=groups;
    const allowed=new Set(groups.map(group=>group.id));
    for(const [key,app]of this.registry)if(!allowed.has(app.snapshot.groupActorId))await this.#remove(key,app);
    for(const groupId of this.views.keys())if(!allowed.has(groupId))this.views.delete(groupId);
    for(const outcome of outcomes){
      if(outcome.view)await this.#accept(outcome.view);
      else if(outcome.error?.code==="unauthorized"){
        this.views.delete(outcome.groupId);
        for(const [key,app]of this.registry)if(app.snapshot.groupActorId===outcome.groupId)await this.#remove(key,app);
      }else throw outcome.error;
    }
    this.changed();
  }
  async open({groupActorId,sessionId}={}){
    await this.refresh();const selected=groupActorId??this.groups[0]?.id,view=this.views.get(selected);
    if(!view || (sessionId&&view.session?.sessionId!==sessionId))throw new Error("Сцена недоступна или уже завершена.");
    if(!view.session&&!view.canManage)throw new Error("Для этой группы нет открытой сцены.");
    const key=view.session?.sessionId??`setup:${selected}`;
    for(const [other,app]of this.registry)if(other.startsWith("setup:")&&other!==key)await this.#remove(other,app);
    const app=this.#ensure(key,{...view,groups:this.groups});await app.reopen();this.changed();return app;
  }
}
