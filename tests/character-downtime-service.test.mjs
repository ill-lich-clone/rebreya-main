import test from "node:test";
import assert from "node:assert/strict";

import { GROUP_CONTEXT_ERRORS } from "../scripts/data/group-context-service.js";
import { CharacterDowntimeService } from "../scripts/data/character-downtime-service.js";

function createActor({ id = "actor-a", name = "Hero", type = "character" } = {}) {
  return {
    id,
    name,
    type
  };
}

function createModuleApi({ snapshot, error, calls = [] } = {}) {
  return {
    getDowntimeSnapshot(options) {
      calls.push(["getDowntimeSnapshot", options]);
      if (error) {
        throw error;
      }

      return snapshot ?? {
        members: [],
        requests: [],
        actionCatalog: [],
        canSubmit: false
      };
    },
    async createDowntimeRequest(payload) {
      calls.push(["createDowntimeRequest", payload]);
      return {
        id: "downtime-2",
        ...payload
      };
    }
  };
}

test("CharacterDowntimeService maps current actor downtime into a player-facing context", () => {
  const calls = [];
  const service = new CharacterDowntimeService(createModuleApi({
    calls,
    snapshot: {
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 4,
          reservedWeeks: 2,
          spentWeeks: 1,
          totalGrantedWeeks: 7
        }
      }, {
        actorId: "actor-b",
        actorName: "Borin",
        canSubmit: false,
        balance: {
          availableWeeks: 99,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 99
        }
      }],
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Asha",
        actionId: "research",
        actionLabel: "Исследование",
        title: "Карта",
        description: "Найти проход",
        weeks: 1,
        status: "approved",
        checks: [{
          id: "check-1",
          label: "Выживание",
          dc: 15,
          ability: "wis",
          result: {
            total: 18,
            success: true
          }
        }],
        result: "Маршрут найден"
      }, {
        id: "downtime-2",
        actorId: "actor-b",
        title: "Other",
        weeks: 1,
        status: "pending",
        checks: [],
        result: ""
      }],
      actionCatalog: [
        { id: "unique", label: "Уникальная заявка" },
        { id: "research", label: "Исследование" }
      ]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "research",
    weeks: 2,
    title: "Новый поиск",
    description: "Проверить архивы"
  });

  assert.deepEqual(calls, [["getDowntimeSnapshot", { actorId: "actor-a" }]]);
  assert.equal(context.hasGroup, true);
  assert.equal(context.actorId, "actor-a");
  assert.equal(context.actorName, "Asha");
  assert.equal(context.canSubmit, true);
  assert.equal(context.submitDisabled, false);
  assert.deepEqual(context.balance, {
    availableWeeks: 4,
    reservedWeeks: 2,
    spentWeeks: 1,
    totalGrantedWeeks: 7
  });
  assert.deepEqual(context.actionOptions.map((option) => [option.value, option.selected]), [
    ["unique", false],
    ["research", true]
  ]);
  assert.equal(context.requests.length, 1);
  assert.equal(context.requests[0].id, "downtime-1");
  assert.equal(context.requests[0].statusLabel, "Одобрено");
  assert.equal(context.requests[0].checks[0].summary, "Выживание | DC 15 | wis");
  assert.equal(context.requests[0].checks[0].resultLabel, "18, успех");
});

test("CharacterDowntimeService converts known group errors into a warning context", () => {
  const service = new CharacterDowntimeService(createModuleApi({
    error: new Error(GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP)
  }));

  const context = service.getActorContext(createActor({ id: "actor-a" }));

  assert.equal(context.hasGroup, false);
  assert.equal(context.warning, GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP);
  assert.equal(context.submitDisabled, true);
  assert.equal(context.requests.length, 0);
});

test("CharacterDowntimeService rethrows unexpected downtime context errors", () => {
  const unexpectedError = new Error("resolver exploded");
  const service = new CharacterDowntimeService(createModuleApi({
    error: unexpectedError
  }));

  assert.throws(
    () => service.getActorContext(createActor({ id: "actor-a" })),
    unexpectedError
  );
});

test("CharacterDowntimeService creates requests for the current sheet actor only", async () => {
  const calls = [];
  const service = new CharacterDowntimeService(createModuleApi({ calls }));

  const request = await service.createRequest(createActor({ id: "actor-a" }), {
    actorId: "actor-b",
    actionId: "training",
    weeks: 2,
    title: "Тренировка",
    description: "Найти наставника"
  });

  assert.equal(request.actorId, "actor-a");
  assert.deepEqual(calls, [[
    "createDowntimeRequest",
    {
      actorId: "actor-a",
      actionId: "training",
      weeks: 2,
      title: "Тренировка",
      description: "Найти наставника"
    }
  ]]);
});
