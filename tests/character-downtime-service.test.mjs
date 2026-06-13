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
        img: "icons/magic/fire/wand-fire.webp",
        sourceType: "magicItem",
        rarity: "rare",
        priceGold: 1200,
        rebreya: {
          managed: true,
          sourceType: "magicItem",
          magicItemId: "wand",
          signature: "magic:wands:wand",
          heroDollSlots: ["mainHand", "offHand"],
          rank: 4,
          foundryType: "loot",
          foundryFolder: "magic-items/wands",
          priceGold: 1200
        },
        documentSnapshot: {
          name: "Fire Wand",
          type: "loot",
          img: "icons/magic/fire/wand-fire.webp",
          system: {
            price: {
              value: 1200,
              denomination: "gp"
            }
          },
          flags: {
            "rebreya-main": {
              sourceType: "magicItem",
              magicItemId: "wand",
              signature: "magic:wands:wand"
            }
          }
        }
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
  assert.equal(context.selectedTemplate.itemChoiceActions[0].selectedItem.rebreya.magicItemId, "wand");
  assert.deepEqual(context.selectedTemplate.itemChoiceActions[0].selectedItem.rebreya.heroDollSlots, ["mainHand", "offHand"]);
  assert.match(context.selectedTemplate.itemChoiceActions[0].selectedItemJson, /"magicItemId":"wand"/u);
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
        sourceType: "magicItem",
        img: "icons/magic/fire/wand-fire.webp",
        rebreya: {
          managed: true,
          sourceType: "magicItem",
          magicItemId: "wand",
          signature: "magic:wands:wand",
          heroDollSlots: ["mainHand", "offHand"],
          rank: 4,
          foundryType: "loot",
          foundryFolder: "magic-items/wands",
          priceGold: 1200
        },
        documentSnapshot: {
          name: "Fire Wand",
          type: "loot",
          img: "icons/magic/fire/wand-fire.webp",
          system: {
            price: {
              value: 1200,
              denomination: "gp"
            }
          },
          flags: {
            "rebreya-main": {
              sourceType: "magicItem",
              magicItemId: "wand",
              signature: "magic:wands:wand"
            }
          }
        }
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
          sourceType: "magicItem",
          sourceId: "wand",
          magicItemId: "wand",
          img: "icons/magic/fire/wand-fire.webp",
          rebreya: {
            managed: true,
            sourceType: "magicItem",
            magicItemId: "wand",
            signature: "magic:wands:wand",
            heroDollSlots: ["mainHand", "offHand"],
            rank: 4,
            foundryType: "loot",
            foundryFolder: "magic-items/wands",
            priceGold: 1200
          },
          documentSnapshot: {
            name: "Fire Wand",
            type: "loot",
            img: "icons/magic/fire/wand-fire.webp",
            system: {
              price: {
                value: 1200,
                denomination: "gp"
              }
            },
            flags: {
              "rebreya-main": {
                sourceType: "magicItem",
                magicItemId: "wand",
                signature: "magic:wands:wand"
              }
            }
          }
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

test("CharacterDowntimeService derives magic item purchase trade and formula from selected item metadata", () => {
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
          label: "Торги",
          actionType: "optionChoice",
          selectionMode: "single",
          options: [{
            id: "forbidden",
            label: "Запрещённые",
            value: -5
          }, {
            id: "bad",
            label: "Невыгодные",
            value: -1
          }, {
            id: "normal",
            label: "Нормальные",
            value: 0
          }]
        }, {
          id: "magic-item-purchase-price",
          label: "Цена",
          actionType: "formulaRoll",
          formulaByRarity: {
            rare: "1d6 * 1000"
          },
          tradeStepActionId: "magic-item-purchase-trade-step",
          itemActionId: "magic-item-purchase-item"
        }]
      }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "Compendium.world.rebreya-downtime.Item.magic-item-purchase",
    targetActionSelections: [{
      actionId: "magic-item-purchase-item",
      item: {
        uuid: "Compendium.world.rebreya-magic-items.Item.belt-fire-giant",
        name: "Пояс силы огненного великана",
        sourceType: "magicItem",
        rebreya: {
          sourceType: "magicItem",
          magicItemId: "belt-fire-giant",
          rarity: "Редкий",
          bargaining: "Невыгодные",
          itemBargaining: "Невыгодные",
          signature: JSON.stringify({
            rarity: "Редкий",
            bargaining: "Невыгодные",
            costText: "2d6kh1*1000 зм"
          }),
          priceGold: 5500
        }
      }
    }]
  });

  assert.equal(context.selectedTemplate.optionActions[0].selectedOptionLabel, "Невыгодные");
  assert.equal(context.selectedTemplate.formulaActions[0].selectedFormula, "2d6kh1*1000");
  assert.equal(context.selectedTemplate.formulaActions[0].summary, "2d6kh1*1000");
});

test("CharacterDowntimeService exposes rank and rank-priced resource constructor actions", () => {
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
      actionCatalog: [{
        id: "Compendium.world.rebreya-downtime.Item.research",
        label: "Исследование",
        targetActions: [{
          id: "research-rank",
          label: "Ранг вопроса",
          actionType: "rankChoice",
          rankChoice: {
            min: 1,
            max: 9,
            default: 1,
            rows: [
              { rank: 1, label: "Ранг 1", baseCost: 10, unitCost: 5 },
              { rank: 4, label: "Ранг 4", baseCost: 120, unitCost: 100 }
            ]
          }
        }, {
          id: "research-steps",
          label: "Шаги",
          actionType: "resources",
          resources: {
            resourceName: "Шаг исследования",
            dependsOnRank: true,
            rankSourceActionId: "research-rank",
            quantity: {
              min: 0,
              max: 5,
              default: 0,
              unit: "шаг."
            },
            rankCosts: [
              { rank: 1, baseCost: 10, unitCost: 5, max: 5 },
              { rank: 4, baseCost: 120, unitCost: 100, max: 5 }
            ],
            cost: {
              currency: "gp",
              payer: "character",
              timing: "manual"
            }
          }
        }]
      }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "Compendium.world.rebreya-downtime.Item.research",
    targetActionSelections: [{
      actionId: "research-rank",
      optionId: "rank-4"
    }, {
      actionId: "research-steps",
      value: 2
    }]
  });

  assert.equal(context.selectedTemplate.rankActions.length, 1);
  assert.equal(context.selectedTemplate.rankActions[0].selectedRank, 4);
  assert.equal(context.selectedTemplate.rankActions[0].options.find((option) => option.id === "rank-4").selected, true);
  assert.equal(context.selectedTemplate.resourceActions[0].resourceQuantity.value, 2);
  assert.equal(context.selectedTemplate.resourceActions[0].resourceQuantity.max, 5);
  assert.equal(context.selectedTemplate.resourceActions[0].computedCost.total, 320);
  assert.equal(context.selectedTemplate.resourceActions[0].outcomeSummary, "320 зм");
});

test("CharacterDowntimeService labels submitted constructor actions and mapped results", () => {
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
        actorName: "Asha",
        actionId: "research",
        actionLabel: "Research",
        title: "Research",
        weeks: 1,
        status: "pending",
        checks: [{
          id: "research-rank",
          label: "Question rank",
          actionType: "rankChoice",
          selectedRank: 5,
          selectedOptionLabel: "Rank 5"
        }, {
          id: "research-resources",
          label: "Research cost",
          actionType: "resources",
          resourceQuantity: {
            value: 2,
            unit: "steps"
          },
          computedCost: {
            total: 600,
            currency: "gp"
          },
          resources: {
            cost: {
              amount: 600,
              currency: "gp"
            }
          }
        }, {
          id: "research-check",
          label: "Research check",
          actionType: "check",
          sourceType: "ability",
          ability: "int",
          target: "int",
          result: {
            total: 17,
            thresholdOutcome: "success",
            thresholdLabel: "Success"
          }
        }, {
          id: "research-result",
          label: "Knowledge fragments",
          actionType: "downtimeResult",
          result: {
            value: 2,
            label: "2 fragments",
            outputField: "fragments"
          }
        }]
      }],
      actionCatalog: []
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }));
  const request = context.requests[0];

  assert.equal(request.checks[0].summary, "Выбор ранга: Question rank");
  assert.equal(request.checks[0].outcomeSummary, "Rank 5");
  assert.equal(request.checks[0].hasOutcomeSummary, true);
  assert.equal(request.checks[1].summary, "Ресурсы: Research cost");
  assert.equal(request.checks[1].hasOutcomeSummary, true);
  assert.equal(request.checks[2].resultLabel, "17, Success");
  assert.equal(request.checks[3].summary, "Итог: Knowledge fragments");
  assert.equal(request.checks[3].resultLabel, "2 fragments");
  assert.equal(request.checks[3].hasOutcomeSummary, false);
  assert.equal(request.checks[3].hasRollTargets, false);
  assert.deepEqual(request.checkActions.map((check) => check.id), ["research-check"]);
});

test("CharacterDowntimeService prepares long project configurable inputs", () => {
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
      actionCatalog: [{
        id: "long-project",
        label: "Long Project",
        targetActions: [{
          id: "long-project-rank",
          label: "Project rank",
          actionType: "rankChoice",
          rankChoice: {
            min: 1,
            max: 9,
            rows: [
              { rank: 1, label: "Rank 1", counterMax: 4 },
              { rank: 7, label: "Rank 7", counterMax: 8 }
            ]
          }
        }, {
          id: "long-project-counter",
          label: "Project counter",
          actionType: "projectCounter",
          projectCounter: {
            rankSourceActionId: "long-project-rank",
            maxByRank: [
              { from: 1, to: 3, max: 4 },
              { from: 4, to: 6, max: 6 },
              { from: 7, to: 9, max: 8 }
            ]
          }
        }, {
          id: "long-project-resources",
          label: "Weekly gold",
          actionType: "resources",
          resources: {
            resourceName: "Gold per week",
            quantity: {
              min: 0,
              default: 0,
              step: 1,
              unit: "gp",
              unitCost: 1
            },
            cost: {
              currency: "gp"
            }
          }
        }, {
          id: "long-project-check",
          label: "Progress check",
          actionType: "check",
          configurable: true,
          sourceType: "skill",
          ability: "int",
          target: "inv",
          targetLabel: "Investigation",
          dc: 15,
          dcByRank: {
            rankSourceActionId: "long-project-rank",
            locked: true,
            rows: [
              { rank: 1, dc: 12 },
              { rank: 2, dc: 14 },
              { rank: 3, dc: 16 },
              { rank: 4, dc: 18 },
              { rank: 5, dc: 20 },
              { rank: 6, dc: 22 },
              { rank: 7, dc: 25 },
              { rank: 8, dc: 30 },
              { rank: 9, dc: 35 }
            ]
          }
        }]
      }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "long-project",
    targetActionSelections: [{
      actionId: "long-project-rank",
      optionId: "rank-7"
    }, {
      actionId: "long-project-resources",
      value: 75
    }, {
      actionId: "long-project-check",
      sourceType: "skill",
      ability: "wis",
      target: "prc",
      targetLabel: "Perception",
      dc: 18
    }]
  });

  assert.equal(context.selectedTemplate.rankActions[0].selectedRank, 7);
  assert.equal(context.selectedTemplate.counterActions[0].projectCounter.max, 8);
  assert.equal(context.selectedTemplate.resourceActions[0].computedCost.total, 75);
  assert.equal(context.selectedTemplate.configurableCheckActions[0].configurableCheck.sourceType, "skill");
  assert.equal(context.selectedTemplate.configurableCheckActions[0].configurableCheck.ability, "wis");
  assert.equal(context.selectedTemplate.configurableCheckActions[0].configurableCheck.target, "prc");
  assert.equal(context.selectedTemplate.configurableCheckActions[0].configurableCheck.dc, 25);
  assert.equal(context.selectedTemplate.configurableCheckActions[0].configurableCheck.isDcLocked, true);
  assert.equal(context.selectedTemplate.configurableCheckActions[0].configurableCheck.targetOptions.some((option) => option.value === "prc"), true);
});

test("CharacterDowntimeService maps long project counter progress and continuation payload", () => {
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
        actorName: "Asha",
        actionId: "long-project",
        actionLabel: "Long Project",
        templateUuid: "Compendium.world.rebreya-downtime.Item.long-project",
        title: "Find a patron",
        description: "Court contacts",
        weeks: 1,
        status: "pending",
        checks: [{
          id: "long-project-rank",
          label: "Project rank",
          actionType: "rankChoice",
          selectedRank: 5,
          selectedOptionId: "rank-5",
          selectedOptionLabel: "Rank 5"
        }, {
          id: "long-project-counter",
          label: "Project counter",
          actionType: "projectCounter",
          projectCounter: {
            current: 2,
            max: 6
          }
        }, {
          id: "long-project-resources",
          label: "Weekly gold",
          actionType: "resources",
          resourceQuantity: {
            value: 100,
            unit: "gp"
          },
          computedCost: {
            total: 100,
            currency: "gp"
          }
        }, {
          id: "long-project-check",
          label: "Progress check",
          actionType: "check",
          sourceType: "skill",
          ability: "int",
          target: "arc",
          targetLabel: "Arcana",
          dc: 15,
          result: {
            total: 23,
            dc: 15,
            success: true
          }
        }, {
          id: "long-project-result",
          label: "Counter shift",
          actionType: "downtimeResult",
          result: {
            value: 2,
            progressSteps: 2,
            outputField: "progressSteps"
          }
        }]
      }],
      actionCatalog: []
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }));
  const request = context.requests[0];
  const continuation = JSON.parse(request.projectCounter.continuePayloadJson);

  assert.equal(request.projectCounter.previousValue, 2);
  assert.equal(request.projectCounter.value, 4);
  assert.equal(request.projectCounter.max, 6);
  assert.equal(request.projectCounter.gained, 2);
  assert.match(request.projectCounter.imagePath, /templates\/counters\/progress-6\/progress_4\.png$/u);
  assert.equal(request.projectCounter.canContinue, true);
  assert.equal(continuation.actionId, "Compendium.world.rebreya-downtime.Item.long-project");
  assert.deepEqual(continuation.targetActionSelections.find((entry) => entry.actionId === "long-project-counter"), {
    actionId: "long-project-counter",
    value: 4
  });
  assert.deepEqual(continuation.targetActionSelections.find((entry) => entry.actionId === "long-project-check"), {
    actionId: "long-project-check",
    sourceType: "skill",
    ability: "int",
    target: "arc",
    targetLabel: "Arcana",
    dc: 15
  });
});

test("CharacterDowntimeService continues legacy long projects through the current template id", () => {
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
          spentWeeks: 1,
          totalGrantedWeeks: 2
        }
      }],
      requests: [{
        id: "downtime-project",
        actorId: "actor-a",
        actorName: "Asha",
        actionId: "long-project",
        actionLabel: "Long Project",
        title: "Find a patron",
        weeks: 1,
        status: "completed",
        checks: [{
          id: "long-project-counter",
          label: "Project counter",
          actionType: "projectCounter",
          projectCounter: {
            current: 1,
            max: 6
          }
        }]
      }],
      actionCatalog: [{
        id: "Compendium.world.rebreya-downtime.Item.current-long-project",
        templateUuid: "Compendium.world.rebreya-downtime.Item.current-long-project",
        templateItemId: "current-long-project",
        downtimeId: "long-project",
        label: "Long Project"
      }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }));
  const continuation = JSON.parse(context.currentProjects[0].projectCounter.continuePayloadJson);

  assert.equal(continuation.actionId, "Compendium.world.rebreya-downtime.Item.current-long-project");
  assert.equal(context.currentProjects[0].showStatusBadge, false);
});

test("CharacterDowntimeService keeps unfinished completed long projects in current projects", () => {
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
          spentWeeks: 1,
          totalGrantedWeeks: 2
        }
      }],
      requests: [{
        id: "downtime-project",
        actorId: "actor-a",
        actorName: "Asha",
        actionId: "long-project",
        actionLabel: "Long Project",
        templateUuid: "Compendium.world.rebreya-downtime.Item.long-project",
        title: "Find a patron",
        weeks: 1,
        status: "completed",
        checks: [{
          id: "long-project-rank",
          label: "Project rank",
          actionType: "rankChoice",
          selectedRank: 5,
          selectedOptionLabel: "Rank 5"
        }, {
          id: "long-project-counter",
          label: "Project counter",
          actionType: "projectCounter",
          projectCounter: {
            current: 2,
            max: 6
          }
        }, {
          id: "long-project-check",
          label: "Progress check",
          actionType: "check",
          sourceType: "skill",
          ability: "int",
          target: "arc",
          targetLabel: "Arcana",
          dc: 20,
          result: {
            total: 13,
            dc: 20,
            success: false
          }
        }, {
          id: "long-project-result",
          label: "Counter shift",
          actionType: "downtimeResult",
          result: {
            value: 0,
            progressSteps: 0,
            outputField: "progressSteps"
          }
        }]
      }],
      actionCatalog: []
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }));

  assert.deepEqual(context.requests.map((request) => request.id), []);
  assert.deepEqual(context.archiveRequests.map((request) => request.id), []);
  assert.deepEqual(context.currentProjects.map((request) => request.id), ["downtime-project"]);
  assert.equal(context.hasCurrentProjects, true);
  assert.equal(context.currentProjectCount, 1);
  assert.equal(context.archiveCount, 0);
  assert.equal(context.currentProjects[0].projectCounter.value, 2);
  assert.equal(context.currentProjects[0].projectCounter.canContinue, true);
});

test("CharacterDowntimeService moves manually closed projects out of current projects", () => {
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
          reservedWeeks: 0,
          spentWeeks: 1,
          totalGrantedWeeks: 1
        }
      }],
      requests: [{
        id: "downtime-project",
        actorId: "actor-a",
        actorName: "Asha",
        actionId: "long-project",
        actionLabel: "Long Project",
        title: "Find a patron",
        weeks: 1,
        status: "completed",
        projectClosed: true,
        checks: [{
          id: "long-project-counter",
          label: "Project counter",
          actionType: "projectCounter",
          projectCounter: {
            current: 2,
            max: 6
          }
        }]
      }],
      actionCatalog: []
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }));

  assert.equal(context.hasCurrentProjects, false);
  assert.deepEqual(context.currentProjects, []);
  assert.deepEqual(context.archiveRequests.map((request) => request.id), ["downtime-project"]);
});

test("CharacterDowntimeService exposes editable description blocks", () => {
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
      actionCatalog: [{
        id: "long-project",
        label: "Long Project",
        targetActions: [{
          id: "long-project-description",
          label: "Описание проекта",
          actionType: "descriptionBlock",
          descriptionBlock: {
            title: "",
            description: ""
          }
        }]
      }]
    }
  }));

  const context = service.getActorContext(createActor({ id: "actor-a", name: "Asha" }), {
    actionId: "long-project",
    targetActionSelections: [{
      actionId: "long-project-description",
      title: "Башня у моря",
      description: "Найти архитектора и материалы."
    }]
  });

  assert.equal(context.selectedTemplate.hasDescriptionActions, true);
  assert.equal(context.selectedTemplate.descriptionActions[0].descriptionBlock.title, "Башня у моря");
  assert.equal(context.selectedTemplate.descriptionActions[0].descriptionBlock.description, "Найти архитектора и материалы.");
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
