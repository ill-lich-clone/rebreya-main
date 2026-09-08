import { validateSceneActivityIntent, sceneActivityExactKeys, sceneActivityFingerprint } from "../../data/scene-activity-rules.js?v=1.4.271";
export const SCENE_ACTIVITY_COMMANDS=Object.freeze({start:"scene-activity.start",choose:"scene-activity.choose",finish:"scene-activity.finish",cancel:"scene-activity.cancel"});
function domainIntent(action,payload){
  if(action==="start"||action==="choose")return {kind:action,intent:payload};
  if(!["finish","cancel"].includes(action)||!sceneActivityExactKeys(payload,["operationId","sessionId","expectedRevision"]))throw new TypeError("Invalid scene command.");
  return {kind:"finish",intent:{...payload,status:action==="finish"?"completed":"cancelled"}};
}
export function isValidSceneActivityPayload(action,payload){try{const {kind,intent}=domainIntent(action,payload);validateSceneActivityIntent(kind,intent);return true;}catch{return false;}}
export function authorizeSceneActivity(action,_payload,{sender,game=globalThis.game}={}){
  return Boolean(Object.hasOwn(SCENE_ACTIVITY_COMMANDS,action)&&sender?.id&&game?.users?.get?.(sender.id)===sender&&(action==="choose"||sender.isGM===true));
}
export function sceneActivityTransportId(action,payload,senderId){const {kind,intent}=domainIntent(action,payload);return `scene-activity:${sceneActivityFingerprint(kind,intent,senderId)}`;}
