import test from "node:test";
import assert from "node:assert/strict";
import { AlchemyCraftingService, canUseCraftedPotion } from "../scripts/data/alchemy-crafting-service.js";

test("field brewing binds one check and result to a short rest for the prepared actor", async () => {
  const state = {};
  const flags = {};
  let loseFlagWrite = false;
  const hero = {
    id: "hero",
    flags: { "rebreya-main": flags },
    async setFlag(_module, key, value) {
      if (loseFlagWrite) { loseFlagWrite = false; throw new Error("actor flag write failed"); }
      flags[key] = value;
    },
    async rollToolCheck(config) { assert.equal(config.ability, "wis"); rolls++; return [{ total: 20 }]; }
  };
  let rolls = 0;
  let writes = 0;
  const rest = { id: "rest1", uuid: "ChatMessage.rest1", type: "rest", system: { type: "short" },
    speaker: { actor: hero.id }, author: { id: "owner" }, _stats: { createdTime: Date.now() + 1000 } };
  const service = new AlchemyCraftingService({
    moduleApi: {},
    repository: { readObject: () => state, async mutateObject(_key, fn) { return fn(state); } },
    gameProvider: () => ({ actors: new Map([[hero.id, hero]]), messages: new Map([[rest.id, rest]]), time: { worldTime: 1000 } })
  });
  service.context = async () => ({ actor: hero, tool: { item: { id: "kit", system: { type: { baseItem: "rebreyaAlchemy" } } } } });
  service.quote = async () => ({ errors: [], dc: 12, output: { productId: "alchemy-13", lifetimeSeconds: 86400 } });
  service.applyCraft = async (input) => { writes++; return { phase: "committed", outcome: input.outcome, expiresAt: input.expiresAt }; };
  const owner = { sender: { id: "owner" }, assertActiveGm() {} };
  const intent = { actorId: hero.id, groupId: "party", operationId: "field-1", productId: "alchemy-13", selection: { ability: "wis" } };
  await service.prepareField(intent, owner);
  const firstFlag = flags.alchemyCraftField;
  delete flags.alchemyCraftField;
  assert.equal(service.fieldSnapshot(hero).status, "prepared");
  await assert.rejects(service.prepareField({ ...intent, operationId: "other" }, owner), /подготовлена одна варка/u);
  flags.alchemyCraftField = firstFlag;
  rest.speaker.actor = "wrong";
  const completion = { actorId: hero.id, groupId: "party", operationId: "field-1", restMessageUuid: rest.uuid };
  await assert.rejects(service.completeField(completion, owner), /отдых/i);
  rest.speaker.actor = hero.id;
  loseFlagWrite = true;
  await assert.rejects(service.completeField(completion, owner), /actor flag write failed/);
  const result = await service.completeField(completion, owner);
  assert.equal(flags.alchemyCraftField.status, "completed");
  await service.completeField(completion, owner);
  assert.equal(rolls, 1);
  assert.equal(writes, 1);
  assert.equal(result.expiresAt, 87400);
  assert.equal(canUseCraftedPotion({ flags: { "rebreya-main": { alchemyCraft: { expiresAt: result.expiresAt } } } }, 87399), true);
  assert.equal(canUseCraftedPotion({ flags: { "rebreya-main": { alchemyCraft: { expiresAt: result.expiresAt } } } }, 87400), false);
  const second = { ...intent, operationId: "field-2" };
  await service.prepareField(second, owner);
  loseFlagWrite = true;
  await assert.rejects(service.cancelField(second, owner), /actor flag write failed/);
  await service.cancelField(second, owner);
  assert.equal(flags.alchemyCraftField.status, "cancelled");
});
