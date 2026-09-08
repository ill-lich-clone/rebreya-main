import { sha256Hex } from "../shared/sha256.js?v=1.4.268";

export const SCENE_ACTIVITY_ACTIONS=Object.freeze({inspect:"Осмотреться",help:"Помочь",prepare:"Подготовиться",rest:"Отдохнуть",custom:"Своё действие"});
const unsafe=new Set(["__proto__","prototype","constructor"]);
const object=value=>value!==null && typeof value==="object" && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=value=>typeof value==="string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(value) && !unsafe.has(value);
const actor=value=>typeof value==="string" && /^Actor\.[A-Za-z0-9_-]{1,128}$/u.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0;
const uniqueActors=value=>Array.isArray(value)&&value.length<=64&&value.every(actor)&&new Set(value).size===value.length;
const copy=value=>structuredClone(value);
export class SceneActivityError extends Error {
  constructor(code){super({"invalid-request":"Некорректная заявка сцены.","invalid-state":"Сохранённое состояние сцены повреждено.",unauthorized:"Нет права на это действие в сцене.","stale-revision":"Сцена изменилась. Проверьте свежие заявки и повторите действие.","operation-conflict":"Этот идентификатор уже использован для другого действия.","already-open":"Для этой группы уже открыта сцена.","session-closed":"Сцена уже закрыта или недоступна."}[code]??code);this.name="SceneActivityError";this.code=code;}
}
const fail=code=>{throw new SceneActivityError(code);};
export function sceneActivityExactKeys(value,keys){return object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function validChoice(value){return object(value)&&Object.hasOwn(SCENE_ACTIVITY_ACTIONS,value.actionId)&&typeof value.text==="string"&&value.text.length<=500&&value.text===value.text.trim()&&(value.actionId!=="custom"||value.text.length>0);}

/** Exact domain intents. Finish status is supplied by the trusted route, never a player field. */
export function validateSceneActivityIntent(kind,intent){
  const keys=kind==="start"?["operationId","groupActorId","expectedGroupRevision","initiatingActorUuid","participantActorUuids","durationMinutes"]
    :kind==="choose"?["operationId","sessionId","actorUuid","actionId","text","expectedRevision"]
    :kind==="finish"?["operationId","sessionId","expectedRevision","status"]:null;
  if(!keys||!sceneActivityExactKeys(intent,keys)||!id(intent.operationId))fail("invalid-request");
  if(kind==="start"){
    if(!id(intent.groupActorId)||!revision(intent.expectedGroupRevision)||!actor(intent.initiatingActorUuid)
      ||!uniqueActors(intent.participantActorUuids)||!intent.participantActorUuids.length||intent.durationMinutes!==10
      ||intent.participantActorUuids.includes(intent.initiatingActorUuid))fail("invalid-request");
  }else if(!id(intent.sessionId)||!revision(intent.expectedRevision))fail("invalid-request");
  if(kind==="choose"&&(!actor(intent.actorUuid)||!validChoice({...intent,text:typeof intent.text==="string"?intent.text.trim():intent.text})||intent.text.length>500))fail("invalid-request");
  if(kind==="finish"&&!["completed","cancelled"].includes(intent.status))fail("invalid-request");
  return copy(intent);
}
function validSession(session){
  return sceneActivityExactKeys(session,["sessionId","revision","status","groupActorId","initiatingActorUuid","participantActorUuids","durationMinutes","openedAt","selectionByActor"])
    &&id(session.sessionId)&&id(session.groupActorId)&&revision(session.revision)&&session.revision>0
    &&["open","completed","cancelled"].includes(session.status)&&actor(session.initiatingActorUuid)
    &&uniqueActors(session.participantActorUuids)&&session.participantActorUuids.length>0&&!session.participantActorUuids.includes(session.initiatingActorUuid)
    &&session.durationMinutes===10&&revision(session.openedAt)&&object(session.selectionByActor)
    &&Object.entries(session.selectionByActor).every(([key,value])=>session.participantActorUuids.includes(key)
      &&sceneActivityExactKeys(value,["actionId","text","selectedBy"])&&validChoice(value)&&id(value.selectedBy));
}
function validResult(result){return sceneActivityExactKeys(result,["sessionId","groupActorId","revision","groupRevision","status","changed","replayed"])
  &&id(result.sessionId)&&id(result.groupActorId)&&revision(result.revision)&&result.revision>0&&revision(result.groupRevision)
  &&["open","completed","cancelled"].includes(result.status)&&typeof result.changed==="boolean"&&typeof result.replayed==="boolean";}

export function normalizeSceneActivityState(raw){
  if(raw==null || (object(raw)&&!Object.keys(raw).length))return {version:1,activeByGroup:{},groupRevisions:{},history:[],recentOperations:[]};
  if(!sceneActivityExactKeys(raw,["version","activeByGroup","groupRevisions","history","recentOperations"])||raw.version!==1
    ||!object(raw.activeByGroup)||!object(raw.groupRevisions)||!Array.isArray(raw.history)||raw.history.length>64
    ||!Array.isArray(raw.recentOperations)||raw.recentOperations.length>256)fail("invalid-state");
  if(!Object.entries(raw.groupRevisions).every(([key,value])=>id(key)&&revision(value))
    ||!Object.entries(raw.activeByGroup).every(([key,value])=>id(key)&&validSession(value)&&value.groupActorId===key&&value.status==="open"&&raw.groupRevisions[key]>0)
    ||!raw.history.every(value=>validSession(value)&&value.status!=="open"&&raw.groupRevisions[value.groupActorId]>0)
    ||!raw.recentOperations.every(value=>sceneActivityExactKeys(value,["operationId","senderId","fingerprint","result"])
      &&id(value.operationId)&&id(value.senderId)&&/^[a-f0-9]{64}$/u.test(value.fingerprint)&&validResult(value.result)))fail("invalid-state");
  const sessions=[...Object.values(raw.activeByGroup),...raw.history];
  if(new Set(sessions.map(s=>s.sessionId)).size!==sessions.length||new Set(raw.recentOperations.map(r=>r.operationId)).size!==raw.recentOperations.length)fail("invalid-state");
  return copy(raw);
}
export function sceneActivityFingerprint(kind,intent,senderId){
  const validated=validateSceneActivityIntent(kind,intent);
  return sha256Hex(JSON.stringify([kind,senderId,Object.keys(validated).sort().map(key=>[key,validated[key]])]));
}
function authenticate(context,gmOnly=false){if(!id(context?.senderId)||(gmOnly&&context.isGM!==true))fail("unauthorized");}
function retry(state,kind,intent,context){
  const receipt=state.recentOperations.find(entry=>entry.operationId===intent.operationId);if(!receipt)return null;
  if(receipt.senderId!==context.senderId||receipt.fingerprint!==sceneActivityFingerprint(kind,intent,context.senderId))fail("operation-conflict");
  return {state,result:{...copy(receipt.result),changed:false,replayed:true}};
}
function nextRevision(value){if(!revision(value)||value===Number.MAX_SAFE_INTEGER)fail("invalid-state");return value+1;}
function outcome(state,session,changed=true){return {sessionId:session.sessionId,groupActorId:session.groupActorId,revision:session.revision,
  groupRevision:state.groupRevisions[session.groupActorId],status:session.status,changed,replayed:false};}
function commit(state,session,kind,intent,context){
  const result=outcome(state,session);
  state.recentOperations.push({operationId:intent.operationId,senderId:context.senderId,fingerprint:sceneActivityFingerprint(kind,intent,context.senderId),result:copy(result)});
  state.recentOperations=state.recentOperations.slice(-256);return {state,result};
}
function openSession(state,sessionId){const session=Object.values(state.activeByGroup).find(entry=>entry.sessionId===sessionId);if(!session)fail("session-closed");return session;}

export function startSceneActivity(raw,intent,context){
  validateSceneActivityIntent("start",intent);authenticate(context,true);const state=normalizeSceneActivityState(raw);
  const previous=retry(state,"start",intent,context);if(previous)return previous;
  if(![intent.initiatingActorUuid,...intent.participantActorUuids].every(uuid=>context.groupMemberActorUuids?.includes(uuid)))fail("unauthorized");
  if((state.groupRevisions[intent.groupActorId]??0)!==intent.expectedGroupRevision)fail("stale-revision");
  if(state.activeByGroup[intent.groupActorId])fail("already-open");
  const sessionId=context.createSessionId?.();if(!id(sessionId)||!revision(context.now)
    ||[...Object.values(state.activeByGroup),...state.history].some(s=>s.sessionId===sessionId))fail("invalid-state");
  const session={sessionId,revision:1,status:"open",groupActorId:intent.groupActorId,initiatingActorUuid:intent.initiatingActorUuid,
    participantActorUuids:copy(intent.participantActorUuids),durationMinutes:10,openedAt:context.now,selectionByActor:{}};
  state.activeByGroup[intent.groupActorId]=session;state.groupRevisions[intent.groupActorId]=nextRevision(state.groupRevisions[intent.groupActorId]??0);
  return commit(state,session,"start",intent,context);
}
export function chooseSceneActivity(raw,intent,context){
  validateSceneActivityIntent("choose",intent);authenticate(context);const state=normalizeSceneActivityState(raw);
  if(!context.groupMemberActorUuids?.includes(intent.actorUuid)||(context.isGM!==true&&!context.ownedActorUuids?.includes(intent.actorUuid)))fail("unauthorized");
  const previous=retry(state,"choose",intent,context);if(previous)return previous;
  const session=openSession(state,intent.sessionId);if(!session.participantActorUuids.includes(intent.actorUuid))fail("unauthorized");
  if(session.revision!==intent.expectedRevision)fail("stale-revision");
  const text=intent.text.trim(),current=session.selectionByActor[intent.actorUuid];
  if(current?.actionId===intent.actionId&&current.text===text)return {state,result:outcome(state,session,false)};
  session.selectionByActor[intent.actorUuid]={actionId:intent.actionId,text,selectedBy:context.senderId};session.revision=nextRevision(session.revision);
  return commit(state,session,"choose",intent,context);
}
export function finishSceneActivity(raw,intent,context){
  validateSceneActivityIntent("finish",intent);authenticate(context,true);const state=normalizeSceneActivityState(raw);
  const previous=retry(state,"finish",intent,context);if(previous)return previous;
  const session=openSession(state,intent.sessionId);if(session.revision!==intent.expectedRevision)fail("stale-revision");
  session.status=intent.status;session.revision=nextRevision(session.revision);delete state.activeByGroup[session.groupActorId];
  state.groupRevisions[session.groupActorId]=nextRevision(state.groupRevisions[session.groupActorId]);state.history.push(session);state.history=state.history.slice(-64);
  return commit(state,session,"finish",intent,context);
}
export function projectSceneActivityForUser(raw,context){
  const state=normalizeSceneActivityState(raw),session=state.activeByGroup[context.groupActorId];
  const view={groupActorId:context.groupActorId,groupRevision:state.groupRevisions[context.groupActorId]??0,session:null};
  if(!session)return view;
  const selectableActorUuids=session.participantActorUuids.filter(uuid=>context.groupMemberActorUuids?.includes(uuid)&&(context.isGM||context.ownedActorUuids?.includes(uuid)));
  const busyOwner=context.ownedActorUuids?.includes(session.initiatingActorUuid)&&context.groupMemberActorUuids?.includes(session.initiatingActorUuid);
  if(!context.isGM&&!selectableActorUuids.length&&!busyOwner)return view;
  view.session={...copy(session),canManage:context.isGM===true,selectableActorUuids};return view;
}
