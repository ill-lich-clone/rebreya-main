import { DOOR_TRIGGER_EVENTS } from "./door-trigger-target.js";

export class DoorTriggerTargetAdapter {
  constructor({ repository } = {}) {
    if (!repository) throw new TypeError("DoorTriggerTargetAdapter requires a repository.");
    this.repository = repository;
    this.allowedEvents = DOOR_TRIGGER_EVENTS;
  }

  async read(_ref, { document } = {}) {
    return { ...this.repository.read(document), document };
  }

  async saveDefinitions(_ref, input = {}, { document } = {}) {
    return { ...await this.repository.saveDefinitions(document, input), document };
  }

  async updateRuntime(_ref, mutate, { document } = {}) {
    return { ...await this.repository.updateRuntime(document, mutate), document };
  }

  async resetExecutions(_ref, { document } = {}) {
    return { ...await this.repository.resetExecutions(document), document };
  }
}
