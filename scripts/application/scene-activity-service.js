import { normalizeSceneActivityState, startSceneActivity, chooseSceneActivity, finishSceneActivity, projectSceneActivityForUser,
  validateSceneActivityIntent, sceneActivityFingerprint, sceneActivityExactKeys, SceneActivityError } from "../data/scene-activity-rules.js?v=1.4.271";

export const SCENE_ACTIVITY_SETTING="sceneActivityState";
const reducers={start:startSceneActivity,choose:chooseSceneActivity,finish:finishSceneActivity};
export class SceneActivityService {
  constructor({repository,resolveContext,refresh=()=>{}}){Object.assign(this,{repository,resolveContext,refresh});}
  start(intent,sender){return this.#transition("start",intent,sender);}
  choose(intent,sender){return this.#transition("choose",intent,sender);}
  finish(intent,sender){return this.#terminal(intent,sender,"completed");}
  cancel(intent,sender){return this.#terminal(intent,sender,"cancelled");}
  #terminal(intent,sender,status){
    if(!sceneActivityExactKeys(intent,["operationId","sessionId","expectedRevision"]))return Promise.reject(new SceneActivityError("invalid-request"));
    return this.#transition("finish",{...intent,status},sender);
  }
  #groupFor(state,intent){
    return intent.groupActorId??[...Object.values(state.activeByGroup),...state.history].find(session=>session.sessionId===intent.sessionId)?.groupActorId
      ??state.recentOperations.find(receipt=>receipt.operationId===intent.operationId&&receipt.result.sessionId===intent.sessionId)?.result.groupActorId;
  }
  async #transition(kind,raw,sender){
    const intent=validateSceneActivityIntent(kind,raw);let planned=null,result;
    try{
      result=await this.repository.mutateObject(SCENE_ACTIVITY_SETTING,async current=>{
        const groupActorId=this.#groupFor(current,intent);if(!groupActorId)throw new SceneActivityError("session-closed");
        const context=await this.resolveContext({groupActorId,sender});
        if(context.senderId!==sender?.id)throw new SceneActivityError("unauthorized");
        const transition=reducers[kind](current,intent,context);planned=transition.result;
        for(const key of Object.keys(current))delete current[key];Object.assign(current,transition.state);
        return planned;
      },{normalize:normalizeSceneActivityState,shouldCommit:outcome=>outcome.changed});
    }catch(error){
      // Only a transition which reached the write boundary can have a lost acknowledgement.
      if(planned?.changed){
        try{
          const state=this.repository.readObject(SCENE_ACTIVITY_SETTING,{normalize:normalizeSceneActivityState});
          const receipt=state.recentOperations.find(entry=>entry.operationId===intent.operationId);
          if(receipt?.senderId===sender.id&&receipt.fingerprint===sceneActivityFingerprint(kind,intent,sender.id)
            &&JSON.stringify(receipt.result)===JSON.stringify(planned))result={...receipt.result,changed:false,replayed:true};
        }catch{/* Keep the original write/authority error when durable evidence is unavailable. */}
      }
      if(!result)throw error;
    }
    try{await this.refresh({groupActorId:result.groupActorId,sessionId:result.sessionId,revision:result.revision,groupRevision:result.groupRevision});}
    catch(error){console.warn("rebreya-main | Scene saved; refresh failed.",error);}
    return result;
  }
  async getSnapshot({groupActorId,viewer}){
    const context=await this.resolveContext({groupActorId,sender:viewer});
    const state=this.repository.readObject(SCENE_ACTIVITY_SETTING,{normalize:normalizeSceneActivityState});
    return {...projectSceneActivityForUser(state,{...context,groupActorId}),canManage:context.isGM===true,groupName:context.groupName??"Группа",
      members:(context.groupMemberActorUuids??[]).map(uuid=>({uuid,name:context.actorNames?.[uuid]??uuid}))};
  }
}
