export const CREATURE_HARVEST_SETTING = "creatureHarvestRecords";

export class CreatureHarvestRepository {
  constructor({ worldSettings }) {
    this.worldSettings = worldSettings;
  }

  read(uuid) {
    return this.worldSettings.readObject(CREATURE_HARVEST_SETTING)[uuid] ?? null;
  }

  patch(uuid, fields) {
    return this.worldSettings.mutateObject(CREATURE_HARVEST_SETTING, current => {
      current[uuid] = { ...current[uuid], ...fields };
    });
  }

  remove(uuid) {
    return this.worldSettings.mutateObject(CREATURE_HARVEST_SETTING, current => {
      if (!Object.hasOwn(current, uuid)) return false;
      return Reflect.deleteProperty(current, uuid);
    }, { shouldCommit: removed => removed });
  }
}
