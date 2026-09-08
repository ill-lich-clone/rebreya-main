import { normalizeLootgenForm } from "../data/lootgen-generator.js?v=1.4.266";
import { createStableGearDocumentId } from "../data/gear-document-ids.js";
import { itemInstanceFingerprint } from "./item-instance-workflow.js";
import { WorldMutationCoordinator } from "./world-mutation-coordinator.js";

export const LOOTGEN_PREPARE_RESULT_COMMAND = "lootgen.prepare-result";

function fail(code) {
  const error = new Error(code === "lootgen-generated-result-missing"
    ? "Подготовленный результат лута удалён или недоступен. Автоматическая повторная генерация остановлена."
    : "Запрос подготовки лута не совпадает с сохранённой операцией.");
  error.code = code;
  throw error;
}

function preparationFingerprint(form,requesterId){
  const snapshot=structuredClone(form);
  // New disabled defaults must not invalidate an already persisted R8 operation.
  if(snapshot.enableFilledContainers===false && snapshot.filledContainerChance===0 && snapshot.generationDepth===1){
    for(const key of ["enableFilledContainers","filledContainerChance","generationDepth"])delete snapshot[key];
  }
  return itemInstanceFingerprint({form:snapshot,requesterId});
}

export function isValidPrepareLootgenPayload(payload) {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || Object.keys(payload).length !== 1 || !Object.hasOwn(payload,"form")) return false;
    const form = payload.form;
    if (!form || typeof form !== "object" || Array.isArray(form)
      || Object.keys(form).sort().join(",") !== Object.keys(normalizeLootgenForm(form)).sort().join(",")) return false;
    return form?.enableUpgrades === true && Number.isSafeInteger(form.budgetValue)
      && JSON.stringify(form).length <= 16384
      && itemInstanceFingerprint(form) === itemInstanceFingerprint(normalizeLootgenForm(form));
  } catch { return false; }
}

/** One durable generated result; the existing Chat publisher owns document writes. */
export class LootgenGeneratedResultService {
  constructor({journal,buildState,findMessage,createMessage,activateMessage,coordinator=new WorldMutationCoordinator()}={}) {
    Object.assign(this,{journal,buildState,findMessage,createMessage,activateMessage,coordinator});
  }

  async prepare({operationId,form}, {requesterId,authorId,assertAuthority=()=>{}}={}) {
    if (!isValidPrepareLootgenPayload({form}) || typeof operationId !== "string" || !operationId.trim()
      || operationId.trim() !== operationId || /[\u0000-\u001f\u007f]/u.test(operationId)
      || operationId.length > 256 || !requesterId || !authorId) fail("lootgen-prepare-conflict");
    const fingerprint = preparationFingerprint(form,requesterId);
    const id = `lootgen-prepare:${operationId}`;
    const messageId = createStableGearDocumentId(`lootgen-message:${operationId}`);
    const lootId = createStableGearDocumentId(`lootgen-result:${operationId}`);
    return this.coordinator.run(id, async () => {
      assertAuthority();
      let record = await this.journal.find(id);
      if (record && (record.kind !== "lootgen-generated-result" || !["prepared","message-created"].includes(record.phase) || record.fingerprint !== fingerprint
        || record.messageId !== messageId || record.lootId !== lootId)) fail("lootgen-prepare-conflict");
      let message = await this.findMessage(messageId);
      if (message) this.#assertMessage(message,{operationId,fingerprint,messageId,lootId});
      if (!message && record && (record.terminal || record.phase !== "prepared")) fail("lootgen-generated-result-missing");

      if (!record && message?.state.generationReady === true) return this.#result(message);
      if (!record) {
        const preparedState = message ? null : {
          ...structuredClone(await this.buildState(form,{operationId,messageId,lootId,authorId})),
          form: structuredClone(form), resultVersion:2, generationReady:false,
          lootId, createdBy:authorId, requestedBy:requesterId,
          prepareOperationId:operationId, prepareFingerprint:fingerprint
        };
        assertAuthority();
        record = await this.journal.start({id,kind:"lootgen-generated-result",fingerprint,messageId,lootId,
          phase:message?"message-created":"prepared",preparedState});
        if (record.kind !== "lootgen-generated-result" || record.fingerprint !== fingerprint
          || record.messageId !== messageId || record.lootId !== lootId) fail("lootgen-prepare-conflict");
      }
      if (!message) {
        if (!record.preparedState) fail("lootgen-generated-result-missing");
        assertAuthority();
        try { await this.createMessage(structuredClone(record.preparedState),{messageId}); }
        catch (error) {
          message = await this.findMessage(messageId);
          if (!message) throw error;
        }
        message ??= await this.findMessage(messageId);
        this.#assertMessage(message,{operationId,fingerprint,messageId,lootId});
      }
      if (!record.terminal && record.phase === "prepared") {
        assertAuthority();
        record = await this.journal.checkpoint(id,"prepared","message-created",{preparedState:null});
      }
      if (!record.terminal) {
        assertAuthority();
        await this.journal.finish(id,{messageId,lootId});
      }
      // Claims remain disabled until the durable creation receipt exists.
      if (message.state.generationReady !== true) {
        assertAuthority();
        await this.activateMessage(messageId);
      }
      message = await this.findMessage(messageId);
      this.#assertMessage(message,{operationId,fingerprint,messageId,lootId});
      if (message.state.generationReady !== true) fail("lootgen-generated-result-missing");
      return this.#result(message);
    });
  }

  #assertMessage(message,{operationId,fingerprint,messageId,lootId}) {
    const state = message?.state;
    if (!message) fail("lootgen-generated-result-missing");
    if (message.trusted !== true || message.id !== messageId || state?.resultVersion !== 2
      || state.prepareOperationId !== operationId || state.prepareFingerprint !== fingerprint
      || state.lootId !== lootId) fail("lootgen-prepare-conflict");
  }

  #result(message) {
    return {messageId:message.id,lootId:message.state.lootId,state:structuredClone(message.state)};
  }
}
