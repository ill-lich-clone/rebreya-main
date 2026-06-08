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
      groupId: "group-a",
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
  assert.equal(context.groupId, "group-a");
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
  assert.equal(context.requests[0].checks[0].summary, "Проверка: Мудрость (Выживание) | DC 15");
  assert.equal(context.requests[0].checks[0].resultLabel, "18, успех");
});

test("CharacterDowntimeService exposes structured roll targets for assigned checks", () => {
  const service = new CharacterDowntimeService(createModuleApi({
    snapshot: {
      groupId: "group-a",
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 1,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 2
        }
      }],
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actionId: "unique",
        actionLabel: "Unique",
        title: "Scout",
        weeks: 1,
        status: "approved",
        checks: [{
          id: "check-1",
          label: "Scout Route",
          sourceType: "skill",
          ability: "wis",
          target: "prc",
          targetLabel: "Perception",
          dc: 15,
          choices: [{
            sourceType: "skill",
            ability: "wis",
            target: "prc",
            targetLabel: "Perception"
          }, {
            sourceType: "skill",
            ability: "wis",
            target: "ins",
            targetLabel: "Insight"
          }]
        }],
        result: ""
      }],
      actionCatalog: [{ id: "unique", label: "Unique" }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }));
  const check = context.requests[0].checks[0];

  assert.equal(check.hasRollTargets, true);
  assert.deepEqual(check.rollTargets.map((target) => ({
    sourceType: target.sourceType,
    ability: target.ability,
    target: target.target,
    label: target.label,
    canRoll: target.canRoll
  })), [{
    sourceType: "skill",
    ability: "wis",
    target: "prc",
    label: "Perception",
    canRoll: true
  }, {
    sourceType: "skill",
    ability: "wis",
    target: "ins",
    label: "Insight",
    canRoll: true
  }]);
});

test("CharacterDowntimeService keeps choice roll targets visible but disabled after one result", () => {
  const service = new CharacterDowntimeService(createModuleApi({
    snapshot: {
      groupId: "group-a",
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 0,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }],
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actionId: "unique",
        actionLabel: "Unique",
        title: "Scout",
        weeks: 1,
        status: "approved",
        checks: [{
          id: "check-1",
          label: "Scout Route",
          sourceType: "skill",
          ability: "wis",
          target: "prc",
          targetLabel: "Perception",
          dc: 15,
          choices: [{
            sourceType: "skill",
            ability: "wis",
            target: "prc",
            targetLabel: "Perception"
          }, {
            sourceType: "skill",
            ability: "wis",
            target: "ins",
            targetLabel: "Insight"
          }],
          result: {
            total: 18,
            success: true,
            choiceIndex: 1
          }
        }],
        result: ""
      }],
      actionCatalog: [{ id: "unique", label: "Unique" }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }));
  const check = context.requests[0].checks[0];

  assert.equal(check.hasRollTargets, true);
  assert.deepEqual(check.rollTargets.map((target) => ({
    label: target.label,
    canRoll: target.canRoll,
    isResolvedChoice: target.isResolvedChoice,
    isDisabledChoice: target.isDisabledChoice,
    buttonLabel: target.buttonLabel
  })), [{
    label: "Perception",
    canRoll: false,
    isResolvedChoice: false,
    isDisabledChoice: true,
    buttonLabel: "Perception"
  }, {
    label: "Insight",
    canRoll: false,
    isResolvedChoice: true,
    isDisabledChoice: false,
    buttonLabel: "18, успех"
  }]);
});

test("CharacterDowntimeService keeps freeform roll targets out of DC accounting", () => {
  const service = new CharacterDowntimeService(createModuleApi({
    snapshot: {
      groupId: "group-a",
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 0,
          reservedWeeks: 1,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }],
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actionId: "gambling",
        actionLabel: "Азартные игры",
        title: "Азартные игры",
        weeks: 1,
        status: "approved",
        checks: [{
          id: "check-1",
          label: "Акробатика",
          sourceType: "skill",
          ability: "dex",
          target: "acr",
          targetLabel: "Акробатика",
          dc: 0,
          outcomeMode: "freeform"
        }],
        result: ""
      }],
      actionCatalog: [{ id: "gambling", label: "Азартные игры" }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }));
  const check = context.requests[0].checks[0];

  assert.equal(check.summary, "Проверка: Ловкость (Акробатика)");
  assert.equal(check.rollTargets[0].outcomeMode, "freeform");
  assert.equal(check.rollTargets[0].dc, 0);
});

test("CharacterDowntimeService exposes selected action labels for library picker buttons", () => {
  const service = new CharacterDowntimeService(createModuleApi({
    snapshot: {
      groupId: "group-a",
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }],
      requests: [],
      actionCatalog: [
        { id: "unique", label: "Уникальная заявка" },
        { id: "Compendium.world.rebreya-downtime.Item.downtime-gambling", label: "Азартные игры" }
      ]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "Compendium.world.rebreya-downtime.Item.downtime-gambling"
  });

  assert.equal(context.selectedActionLabel, "Азартные игры");
});

test("CharacterDowntimeService exposes selected template details and archives completed requests", () => {
  const service = new CharacterDowntimeService(createModuleApi({
    snapshot: {
      groupId: "group-a",
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 2,
          reservedWeeks: 1,
          spentWeeks: 3,
          totalGrantedWeeks: 6
        }
      }],
      requests: [{
        id: "downtime-active",
        actorId: "actor-a",
        actorName: "Asha",
        actionLabel: "Исследование",
        title: "Исследование",
        weeks: 1,
        status: "approved",
        checks: [{
          id: "research-check",
          label: "Проверка исследования",
          actionType: "check",
          sourceType: "ability",
          ability: "int",
          target: "int",
          targetLabel: "Интеллект"
        }]
      }, {
        id: "downtime-archived",
        actorId: "actor-a",
        actorName: "Asha",
        actionLabel: "Азартные игры",
        title: "Азартные игры",
        weeks: 1,
        status: "completed",
        checks: [],
        result: "21"
      }],
      actionCatalog: [{
        id: "Compendium.world.rebreya-downtime.Item.research",
        label: "Исследование",
        rank: "1+",
        duration: "1 рабочая неделя.",
        summary: "Изучить вопрос.",
        descriptionHtml: "<h2>Исследование</h2><h3>Нарративная заявка</h3><p>Персонаж изучает вопрос.</p><h3>Ресурсы</h3><p>Нужен доступ к источнику знаний.</p><h3>Определение последствий</h3><p>Персонаж проходит проверку Интеллекта.</p>",
        requirements: ["Библиотека"],
        rankTable: [{ rank: 1, baseCost: 10, stepCost: 5 }],
        targetActions: [{
          id: "research-resources",
          label: "Стоимость исследования",
          actionType: "resources",
          resources: {
            narrative: "Базовая сумма зависит от ранга.",
            cost: {
              amount: 10,
              currency: "gp",
              payer: "character"
            }
          }
        }, {
          id: "research-check",
          label: "Проверка исследования",
          actionType: "check",
          sourceType: "ability",
          ability: "int",
          targetLabel: "Интеллект"
        }]
      }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "Compendium.world.rebreya-downtime.Item.research"
  });

  assert.equal(context.selectedTemplate.label, "Исследование");
  assert.equal(context.selectedTemplate.rank, "1+");
  assert.equal(context.selectedTemplate.duration, "1 рабочая неделя.");
  assert.equal(context.selectedTemplate.hasDescriptionHtml, true);
  assert.equal(context.selectedTemplate.descriptionHtml, "<h2>Исследование</h2><h3>Нарративная заявка</h3><p>Персонаж изучает вопрос.</p><h3>Ресурсы</h3><p>Нужен доступ к источнику знаний.</p><h3>Определение последствий</h3><p>Персонаж проходит проверку Интеллекта.</p>");
  assert.equal(context.selectedTemplate.resourceActions[0].outcomeSummary, "10 зм");
  assert.equal(context.selectedTemplate.checkActions[0].summary, "Проверка: Интеллект");
  assert.deepEqual(context.requests.map((request) => request.id), ["downtime-active"]);
  assert.deepEqual(context.archiveRequests.map((request) => request.id), ["downtime-archived"]);
  assert.equal(context.hasArchiveRequests, true);
  assert.equal(context.requestPage.total, 1);
  assert.equal(context.archivePage.total, 1);
});

test("CharacterDowntimeService exposes and forwards downtime resource choices", async () => {
  const calls = [];
  const service = new CharacterDowntimeService(createModuleApi({
    calls,
    snapshot: {
      groupId: "group-a",
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 1,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 1
        }
      }],
      requests: [],
      actionCatalog: [{
        id: "Compendium.world.rebreya-downtime.Item.carousing",
        label: "Кутёж",
        targetActions: [{
          id: "carousing-resources",
          label: "Круг общения",
          actionType: "resources",
          resources: {
            choices: [{
              id: "commoners",
              label: "Простонародье",
              cost: {
                amount: 10,
                currency: "gp"
              }
            }, {
              id: "wealthy",
              label: "Зажиточные люди",
              cost: {
                amount: 50,
                currency: "gp"
              }
            }]
          }
        }]
      }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "Compendium.world.rebreya-downtime.Item.carousing",
    targetActionSelections: [{
      actionId: "carousing-resources",
      choiceId: "wealthy"
    }]
  });

  assert.equal(context.selectedTemplate.resourceActions[0].hasResourceChoices, true);
  assert.deepEqual(context.selectedTemplate.resourceActions[0].resourceChoices.map((choice) => [
    choice.id,
    choice.label,
    choice.outcomeSummary,
    choice.selected
  ]), [
    ["commoners", "Простонародье", "10 зм", false],
    ["wealthy", "Зажиточные люди", "50 зм", true]
  ]);

  await service.createRequest(createActor({ id: "actor-a" }), {
    actionId: "Compendium.world.rebreya-downtime.Item.carousing",
    weeks: 1,
    targetActionSelections: [{
      actionId: "carousing-resources",
      choiceId: "wealthy"
    }]
  });

  assert.deepEqual(calls.at(-1), [
    "createDowntimeRequest",
    {
      groupId: "group-a",
      actorId: "actor-a",
      actionId: "Compendium.world.rebreya-downtime.Item.carousing",
      weeks: 1,
      title: "",
      description: "",
      targetActionSelections: [{
        actionId: "carousing-resources",
        choiceId: "wealthy"
      }]
    }
  ]);
});

test("CharacterDowntimeService exposes and forwards structured downtime selections", async () => {
  const calls = [];
  const service = new CharacterDowntimeService(createModuleApi({
    calls,
    snapshot: {
      groupId: "group-a",
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 2,
          reservedWeeks: 0,
          spentWeeks: 0,
          totalGrantedWeeks: 2
        }
      }],
      requests: [],
      actionCatalog: [{
        id: "Compendium.world.rebreya-downtime.Item.magic-item-purchase",
        label: "Покупка магического предмета",
        targetActions: [{
          id: "magic-item-purchase-item",
          label: "Предмет",
          actionType: "itemChoice",
          itemChoice: {
            sourceType: "magicItem"
          }
        }, {
          id: "magic-item-purchase-trade-step",
          label: "Тип торгов",
          actionType: "optionChoice",
          selectionMode: "single",
          options: [{
            id: "normal",
            label: "Нормальные",
            value: 0
          }, {
            id: "good",
            label: "Удачные",
            value: 2
          }]
        }, {
          id: "magic-item-purchase-search-step",
          label: "Шаг поиска",
          actionType: "numericInput",
          input: {
            min: -5,
            max: 5,
            step: 1
          }
        }]
      }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "Compendium.world.rebreya-downtime.Item.magic-item-purchase",
    targetActionSelections: [{
      actionId: "magic-item-purchase-item",
      item: {
        uuid: "Compendium.world.rebreya-magic-items.Item.wand",
        name: "Жезл огня",
        type: "loot",
        sourceType: "magicItem",
        rarity: "rare",
        priceGold: 1200
      }
    }, {
      actionId: "magic-item-purchase-trade-step",
      optionId: "good"
    }, {
      actionId: "magic-item-purchase-search-step",
      value: -1
    }]
  });

  assert.equal(context.selectedTemplate.itemChoiceActions[0].selectedItemName, "Жезл огня");
  assert.equal(context.selectedTemplate.optionActions[0].options[1].selected, true);
  assert.equal(context.selectedTemplate.numericActions[0].value, -1);
  assert.equal(context.selectedTemplate.hasInteractiveActions, true);

  await service.createRequest(createActor({ id: "actor-a" }), {
    actionId: "Compendium.world.rebreya-downtime.Item.magic-item-purchase",
    weeks: 1,
    targetActionSelections: [{
      actionId: "magic-item-purchase-item",
      item: {
        uuid: "Compendium.world.rebreya-magic-items.Item.wand",
        name: "Жезл огня",
        sourceType: "magicItem"
      }
    }, {
      actionId: "magic-item-purchase-trade-step",
      optionId: "good"
    }, {
      actionId: "magic-item-purchase-search-step",
      value: -1
    }]
  });

  assert.deepEqual(calls.at(-1), [
    "createDowntimeRequest",
    {
      groupId: "group-a",
      actorId: "actor-a",
      actionId: "Compendium.world.rebreya-downtime.Item.magic-item-purchase",
      weeks: 1,
      title: "",
      description: "",
      targetActionSelections: [{
        actionId: "magic-item-purchase-item",
        item: {
          uuid: "Compendium.world.rebreya-magic-items.Item.wand",
          name: "Жезл огня",
          sourceType: "magicItem"
        }
      }, {
        actionId: "magic-item-purchase-trade-step",
        optionId: "good"
      }, {
        actionId: "magic-item-purchase-search-step",
        value: -1
      }]
    }
  ]);
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
  const service = new CharacterDowntimeService(createModuleApi({
    calls,
    snapshot: {
      groupId: "group-a",
      members: [],
      requests: [],
      actionCatalog: [],
      canSubmit: false
    }
  }));

  const request = await service.createRequest(createActor({ id: "actor-a" }), {
    actorId: "actor-b",
    actionId: "training",
    weeks: 2,
    title: "Тренировка",
    description: "Найти наставника"
  });

  assert.equal(request.actorId, "actor-a");
  assert.deepEqual(calls, [[
    "getDowntimeSnapshot",
    {
      actorId: "actor-a"
    }
  ], [
    "createDowntimeRequest",
    {
      groupId: "group-a",
      actorId: "actor-a",
      actionId: "training",
      weeks: 2,
      title: "Тренировка",
      description: "Найти наставника"
    }
  ]]);
});

test("RebreyaMainModule exposes character downtime service for dnd5e sheet parts", async () => {
  const previousHooks = globalThis.Hooks;
  globalThis.Hooks = {
    once() {}
  };

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?character-downtime=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();

    assert.ok(moduleApi.characterDowntimeService instanceof CharacterDowntimeService);
    assert.equal(moduleApi.characterDowntimeService.moduleApi, moduleApi);
  }
  finally {
    globalThis.Hooks = previousHooks;
  }
});
