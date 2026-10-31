export function bardicFixture({ level = 1, scale, modern = true } = {}) {
  const documents = new Map();
  const sender = { id: "gm", active: true, isGM: true };
  globalThis.game = { user: sender, users: { activeGM: sender }, time: { worldTime: 100 } };
  globalThis.ui = { notifications: { warn() {}, info() {} } };
  function actor(id, uuid = `Actor.${id}`) {
    const result = {
      id, uuid, documentName: "Actor", effects: [], items: [],
      testUserPermission: user => user?.id === "owner",
      async createEmbeddedDocuments(type, rows) {
        const effects = rows.map((row, index) => ({ ...structuredClone(row), id: `effect${index}`, parent: result,
          async update(patch) { for (const [path, value] of Object.entries(patch)) { let cursor = this; const keys = path.split("."); for (const key of keys.slice(0,-1)) cursor=cursor[key]??={}; cursor[keys.at(-1)]=value; } },
          async delete() { result.effects.splice(result.effects.indexOf(this), 1); } }));
        result.effects.push(...effects); return effects;
      }
    };
    documents.set(uuid, result); return result;
  }
  const source = actor("bard");
  source.classes = { bard: { system: { levels: level } } };
  source.getRollData = () => ({ scale: { bard: { inspiration: scale } }, abilities: { cha: { mod: 4 } } });
  const target = actor("target");
  const item = {
    id: "inspiration", uuid: `${source.uuid}.Item.inspiration`, actor: source, parent: source,
    flags: modern ? {} : { core: { sourceId: "Compendium.laaru-dnd5-hw.classfeatures.Item.hpLNiGq7y67d2EHA" } },
    _stats: modern ? { compendiumSource: "Compendium.laaru-dnd5-hw.classfeatures.Item.hpLNiGq7y67d2EHA" } : {},
    system: { uses: { spent: 1, max: "max(1, @abilities.cha.mod)", recovery: [{ period: "lr" }] }, activities: new Map(), formula: "1@scale.bard.inspiration" },
    async update(patch) { for (const [path, value] of Object.entries(patch)) {
      let cursor = this; const keys = path.split("."); for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
      cursor[keys.at(-1)] = value;
    } }
  };
  const grant = { id: "jADU6PX5XlK4kOq8", item, actor: source, type: "utility", consumption: { targets: [{ type: "itemUses", target: "", value: "1" }] } };
  const dieRoll = { id: "2Enk7AiD901iQmfz", item, actor: source, type: "utility", roll: { formula: "1@scale.bard.inspiration" } };
  item.system.activities.set(grant.id, grant); item.system.activities.set(dieRoll.id, dieRoll);
  source.items.push(item); documents.set(item.uuid, item);
  globalThis.fromUuidSync = uuid => documents.get(uuid) ?? null;
  globalThis.fromUuid = async uuid => documents.get(uuid) ?? null;
  const messages = new Map();
  const message = id => {
    const value = { id, author: sender, flags: { dnd5e: { messageType: "usage", item: { uuid: item.uuid }, activity: { id: grant.id }, targets: [{ uuid: target.uuid }], use: { consumed: { item: { [item.id]: [{ keyPath: "system.uses.spent", delta: 1 }] } } } } }, async update(patch) {
      for (const [path, data] of Object.entries(patch)) { let cursor = this; const keys = path.split("."); for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {}; cursor[keys.at(-1)] = data; }
    } };
    messages.set(id, value); return value;
  };
  game.messages = messages;
  message("bardic-test-use");
  const payload = { operationId: "bardic-test-use", sourceItemUuid: item.uuid, activityId: grant.id,
    targetActorUuid: target.uuid, sourceTokenUuid: "", targetTokenUuid: "" };
  return { source, target, item, grant, dieRoll, payload, documents, sender, actor, message };
}
