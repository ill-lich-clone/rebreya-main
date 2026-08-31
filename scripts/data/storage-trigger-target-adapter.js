import { STORAGE_TRIGGER_EVENTS } from "./storage-trigger-service.js";
import { readStorageStateAtPath } from "./storage-service.js?v=1.4.195-storage-administration";

export class StorageTriggerTargetAdapter {
  constructor({ storageService } = {}) {
    if (!storageService) throw new TypeError("StorageTriggerTargetAdapter requires StorageService.");
    this.storageService = storageService;
    this.allowedEvents = STORAGE_TRIGGER_EVENTS;
  }

  async read(ref, { document } = {}) {
    const state = readStorageStateAtPath(document, ref.path);
    return { enabled: true, triggers: state.triggers, document };
  }

  async saveDefinitions(ref, { definitions, expectedRevision } = {}, { document } = {}) {
    const state = await this.storageService.saveTriggerDefinitions(
      document,
      definitions,
      expectedRevision,
      { path: ref.path }
    );
    return { enabled: true, triggers: state.triggers, document };
  }

  async updateRuntime(ref, mutate, { document } = {}) {
    const state = await this.storageService.updateTriggerRuntime(document, mutate, { path: ref.path });
    return { enabled: true, triggers: state.triggers, document };
  }

  async resetExecutions(ref, { document } = {}) {
    const state = await this.storageService.resetTriggerExecutions(document, { path: ref.path });
    return { enabled: true, triggers: state.triggers, document };
  }
}
