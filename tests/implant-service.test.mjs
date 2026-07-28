import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  ImplantService,
  getImplantCompatibility,
  getModificationPointCapacity
} from "../scripts/data/implant-service.js";

function collection(values) {
  const rows = [...values];
  rows.get = (id) => rows.find((entry) => entry.id === id) ?? null;
  return rows;
}

function raceItem(name, raceId = "") {
  return {
    id: `race-${raceId || name}`,
    name,
    type: "race",
    flags: {
      [MODULE_ID]: {
        sourceType: "race",
        raceId
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function implantItem({
  id = "armor",
  name = "Навесная броня",
  type = "Общая",
  kind = "mechanical",
  pointsMin = 1,
  pointsMax = 1,
  installed = false,
  united = false,
  spentPoints = pointsMin,
  automationKey = "mounted-armor-ac",
  gearId = automationKey === "mounted-armor-ac" ? "navesnaya-bronya" : "",
  quantity = 1,
  installedCount = installed ? 1 : 0,
  artisanToolId
} = {}) {
  return {
    id,
    uuid: `Actor.hero.Item.${id}`,
    name,
    type: "equipment",
    system: { quantity },
    flags: {
      [MODULE_ID]: {
        gearId,
        implant: {
          pointsText: pointsMin === pointsMax ? String(pointsMin) : `${pointsMin}–${pointsMax}`,
          pointsMin,
          pointsMax,
          type,
          kind,
          magical: kind === "magical",
          installable: true,
          effect: automationKey === "mounted-armor-ac" ? "Вы получаете +1 к КД." : "",
          requirements: "—",
          automationKey
        },
        implantInstallation: {
          installed,
          installedCount,
          united,
          spentPoints,
          ...(artisanToolId ? { artisanToolId } : {})
        }
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function actorStub({ prof = 3, items = [], spells = null } = {}) {
  const nativeSpellMaximums = Object.fromEntries(
    Object.entries(spells ?? {}).map(([key, slot]) => [key, Number(slot?.max ?? 0)])
  );
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    name: "Герой",
    isOwner: true,
    system: {
      attributes: {
        prof
      },
      ...(spells ? { spells: structuredClone(spells) } : {})
    },
    items: collection(items),
    effects: collection([]),
    itemUpdates: [],
    effectCreates: [],
    effectUpdates: [],
    effectDeletes: [],
    actorUpdates: [],
    refreshDerivedSpellMaximums() {
      if (!this.system.spells) return;
      for (const [key, maximum] of Object.entries(nativeSpellMaximums)) {
        this.system.spells[key].max = maximum;
      }
      const capability = this.effects
        .flatMap((effect) => effect.flags?.[MODULE_ID]?.automation?.capabilities ?? [])
        .find(({ type }) => type === "spellCondenser");
      if (!capability) return;
      const highestAvailable = Object.entries(nativeSpellMaximums)
        .filter(([key, maximum]) => /^spell\d+$/u.test(key) && maximum > 0)
        .map(([key]) => Number(key.slice(5)))
        .reduce((highest, level) => Math.max(highest, level), 0);
      const level = Math.min(Number(capability.spentPoints), highestAvailable);
      if (level > 0) this.system.spells[`spell${level}`].max += 1;
    },
    async update(changed) {
      this.actorUpdates.push(changed);
      for (const [path, value] of Object.entries(changed)) {
        const parts = path.split(".");
        let target = this;
        while (parts.length > 1) {
          const part = parts.shift();
          target[part] ??= {};
          target = target[part];
        }
        target[parts[0]] = value;
      }
      return this;
    },
    async updateEmbeddedDocuments(type, updates) {
      if (type === "Item") {
        this.itemUpdates.push(...updates);
        for (const update of updates) {
          const item = this.items.get(update._id);
          item.flags[MODULE_ID].implantInstallation = update[`flags.${MODULE_ID}.implantInstallation`];
        }
      }
      else if (type === "ActiveEffect") {
        this.effectUpdates.push(...updates);
        for (const update of updates) {
          const effect = this.effects.get(update._id);
          Object.assign(effect, update);
          effect.flags ??= {};
          effect.flags[MODULE_ID] = update[`flags.${MODULE_ID}`] ?? effect.flags[MODULE_ID];
        }
        this.refreshDerivedSpellMaximums();
      }
      return updates;
    },
    async createEmbeddedDocuments(type, rows) {
      assert.equal(type, "ActiveEffect");
      const created = rows.map((row, index) => ({
        ...row,
        id: `effect-${this.effects.length + index + 1}`,
        getFlag(scope, key) {
          return this.flags?.[scope]?.[key];
        }
      }));
      this.effectCreates.push(...rows);
      this.effects.push(...created);
      this.refreshDerivedSpellMaximums();
      return created;
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "ActiveEffect");
      this.effectDeletes.push(...ids);
      return ids;
    }
  };
  return actor;
}

function combatStatusServiceStub(initial = null) {
  return {
    current: initial,
    setCalls: [],
    valueCalls: [],
    clearCalls: [],
    getStatus() {
      return this.current;
    },
    async setStatus(_actor, statusId, options) {
      this.setCalls.push({ statusId, options });
      this.current = {
        active: true,
        statusId,
        value: options.value,
        meta: options.meta ?? {}
      };
      return true;
    },
    async setStatusValue(_actor, statusId, value, meta) {
      this.valueCalls.push({ statusId, value, meta });
      this.current = {
        active: true,
        statusId,
        value,
        meta: meta ?? {}
      };
      return true;
    },
    async clearStatus(_actor, statusId) {
      this.clearCalls.push(statusId);
      this.current = null;
      return true;
    }
  };
}

test("modification point capacity follows humanoid, Synth, and Ironborn rules", () => {
  assert.equal(getModificationPointCapacity(actorStub({ prof: 3 })), 2);
  assert.equal(
    getModificationPointCapacity(actorStub({ prof: 3, items: [raceItem("Синтеты", "синтеты")] })),
    6
  );
  assert.equal(
    getModificationPointCapacity(actorStub({ prof: 4, items: [raceItem("Железорождённые", "железорождённые")] })),
    8
  );
});

test("mechanical compatibility requires manual union for an ordinary General implant", () => {
  const actor = actorStub();
  assert.equal(
    getImplantCompatibility(actor, implantItem()).status,
    "union"
  );
  assert.equal(
    getImplantCompatibility(actorStub({
      items: [raceItem("Синтеты", "синтеты")]
    }), implantItem()).status,
    "safe"
  );
});

test("built-in workshop persists the selected artisan tool in the aggregate capability", async () => {
  const workshop = implantItem({
    id: "workshop",
    name: "Встроенный станок",
    gearId: "vstroennyy-stanok"
  });
  const smithTools = {
    id: "tool-smith",
    name: "Инструменты кузнеца",
    type: "tool",
    system: { type: { value: "art" } }
  };
  const actor = actorStub({ prof: 4, items: [workshop, smithTools] });
  const service = new ImplantService();

  await service.applyLoadout(actor, [{
    itemId: workshop.id,
    installed: true,
    installedCount: 1,
    united: true,
    spentPoints: 1,
    artisanToolId: "tool-smith"
  }]);

  assert.equal(workshop.flags[MODULE_ID].implantInstallation.artisanToolId, "tool-smith");
  assert.deepEqual(
    actor.effects[0].flags[MODULE_ID].automation.capabilities.find(({ type }) => type === "artisanToolBonus"),
    {
      implantId: "vstroennyy-stanok",
      count: 1,
      type: "artisanToolBonus",
      value: 2,
      toolItemId: "tool-smith"
    }
  );
});

test("impulse legs reuse the aggregate effect for a turn-scoped speed multiplier", async () => {
  const legs = implantItem({
    id: "legs",
    name: "Импульсные ноги",
    gearId: "impulsnye-nogi"
  });
  const actor = actorStub({ prof: 4, items: [legs] });
  const service = new ImplantService();
  await service.applyLoadout(actor, [{
    itemId: legs.id,
    installed: true,
    installedCount: 1,
    united: true,
    spentPoints: 1
  }]);
  const effectId = actor.effects[0].id;

  assert.equal(await service.setMovementMultiplier(actor, 2), true);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].id, effectId);
  assert.deepEqual(
    actor.effects[0].changes.filter((change) => change.priority === 40),
    ["burrow", "climb", "fly", "swim", "walk"].map((movement) => ({
      key: `system.attributes.movement.${movement}`,
      mode: 1,
      value: "2",
      priority: 40
    }))
  );

  assert.equal(await service.setMovementMultiplier(actor, 1), true);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].changes.some((change) => change.priority === 40), false);
});

test("magical compatibility follows caster tier and blocks constructs", () => {
  const magical = implantItem({
    name: "Кости Тролля",
    type: "Волшебные",
    kind: "magical",
    automationKey: ""
  });
  assert.equal(getImplantCompatibility(actorStub(), magical).status, "union");
  assert.equal(
    getImplantCompatibility(actorStub({
      items: [{
        id: "class",
        type: "class",
        system: { spellcasting: { progression: "half" } }
      }]
    }), magical).status,
    "safe"
  );
  assert.equal(
    getImplantCompatibility(actorStub({
      items: [raceItem("Железорождённые", "железорождённые")]
    }), magical).status,
    "impossible"
  );

  const titanic = implantItem({
    name: "Панцирь кристального левиафана",
    type: "Титаническая",
    kind: "magical",
    automationKey: ""
  });
  assert.equal(
    getImplantCompatibility(actorStub({
      items: [
        raceItem("Минотавры", "минотавры"),
        {
          id: "full-class",
          type: "class",
          system: { spellcasting: { progression: "full" } }
        }
      ]
    }), titanic).status,
    "safe"
  );
});

test("mounted armor contributes +1 AC only after installation and required union", async () => {
  const armor = implantItem();
  const actor = actorStub({ items: [armor] });
  const service = new ImplantService();

  await service.applyLoadout(actor, [{
    itemId: armor.id,
    installed: true,
    united: false,
    spentPoints: 1
  }]);

  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].name, "Импланты");
  assert.equal(actor.effects[0].getFlag(MODULE_ID, "implantAggregate"), true);
  assert.deepEqual(actor.effects[0].changes, []);

  await service.applyLoadout(actor, [{
    itemId: armor.id,
    installed: true,
    united: true,
    spentPoints: 1
  }]);

  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effectCreates.length, 1);
  assert.equal(actor.effectUpdates.length, 1);
  assert.deepEqual(actor.effects[0].changes, [{
    key: "system.attributes.ac.bonus",
    mode: 2,
    value: "1",
    priority: 20
  }]);
});

test("spell condenser grants one current slot once and clamps it after level changes or removal", async () => {
  const condenser = implantItem({
    id: "condenser",
    name: "Конденсатор магии (М)",
    pointsMin: 1,
    pointsMax: 5,
    automationKey: "",
    gearId: "kondensator-magii"
  });
  const actor = actorStub({
    prof: 4,
    items: [
      raceItem("Синтеты", "синтеты"),
      condenser
    ],
    spells: {
      spell1: { value: 4, max: 4 },
      spell2: { value: 3, max: 3 },
      spell3: { value: 2, max: 2 },
      spell4: { value: 0, max: 0 },
      spell5: { value: 0, max: 0 }
    }
  });
  const service = new ImplantService();

  await service.applyLoadout(actor, [{
    itemId: condenser.id,
    installed: true,
    united: false,
    spentPoints: 3
  }]);

  assert.equal(actor.system.spells.spell3.max, 3);
  assert.equal(actor.system.spells.spell3.value, 3);

  await service.reconcileActor(actor, { reason: "repeat" });

  assert.equal(actor.system.spells.spell3.value, 3);

  await service.applyLoadout(actor, [{
    itemId: condenser.id,
    installed: true,
    united: false,
    spentPoints: 2
  }]);

  assert.equal(actor.system.spells.spell3.max, 2);
  assert.equal(actor.system.spells.spell3.value, 2);
  assert.equal(actor.system.spells.spell2.max, 4);
  assert.equal(actor.system.spells.spell2.value, 4);

  await service.applyLoadout(actor, [{
    itemId: condenser.id,
    installed: false,
    united: false,
    spentPoints: 2
  }]);

  assert.equal(actor.system.spells.spell2.max, 3);
  assert.equal(actor.system.spells.spell2.value, 3);
});

test("all passive implant changes share one aggregate effect and are replaced on removal", async () => {
  const armor = implantItem({ id: "armor" });
  const vision = implantItem({
    id: "vision",
    name: "Модуль ночного зрения",
    gearId: "modul-nochnogo-zreniya",
    automationKey: ""
  });
  const actor = actorStub({
    items: [raceItem("Синтеты", "синтеты"), armor, vision]
  });
  const service = new ImplantService();

  await service.applyLoadout(actor, [
    { itemId: armor.id, installed: true, united: false, spentPoints: 1 },
    { itemId: vision.id, installed: true, united: false, spentPoints: 1 }
  ]);

  assert.equal(actor.effects.length, 1);
  assert.deepEqual(actor.effects[0].changes, [
    { key: "system.attributes.ac.bonus", mode: 2, value: "1", priority: 20 },
    { key: "system.attributes.senses.darkvision", mode: 4, value: "60", priority: 20 }
  ]);

  await service.applyLoadout(actor, [
    { itemId: armor.id, installed: false, united: false, spentPoints: 1 },
    { itemId: vision.id, installed: true, united: false, spentPoints: 1 }
  ]);

  assert.equal(actor.effectCreates.length, 1);
  assert.equal(actor.effectUpdates.length, 1);
  assert.deepEqual(actor.effects[0].changes, [
    { key: "system.attributes.senses.darkvision", mode: 4, value: "60", priority: 20 }
  ]);
});

test("reconciliation removes stale aggregate bonuses after an installed item is deleted", async () => {
  const armor = implantItem();
  const actor = actorStub({
    items: [raceItem("Синтеты", "синтеты"), armor]
  });
  const service = new ImplantService();

  await service.applyLoadout(actor, [{
    itemId: armor.id,
    installed: true,
    spentPoints: 1
  }]);
  assert.equal(actor.effects[0].changes.length, 1);

  actor.items.splice(actor.items.indexOf(armor), 1);
  await service.reconcileActor(actor, { reason: "deleteItem" });

  assert.equal(actor.effectCreates.length, 1);
  assert.equal(actor.effectUpdates.length, 1);
  assert.deepEqual(actor.effects[0].changes, []);
});

test("ununited implants apply one fixed Nausea 2 and clear it after the last union", async () => {
  const first = implantItem({ id: "first", automationKey: "" });
  const second = implantItem({ id: "second", automationKey: "" });
  const actor = actorStub({ items: [first, second] });
  const combatStatusService = combatStatusServiceStub();
  const service = new ImplantService({ combatStatusService });

  await service.applyLoadout(actor, [
    { itemId: first.id, installed: true, united: false, spentPoints: 1 },
    { itemId: second.id, installed: true, united: false, spentPoints: 1 }
  ]);

  assert.equal(combatStatusService.setCalls.length, 1);
  assert.deepEqual(combatStatusService.setCalls[0], {
    statusId: "rebreya-nauseated",
    options: {
      active: true,
      value: 2,
      meta: {
        implantNausea: true,
        previousValue: null,
        previousMeta: {}
      }
    }
  });

  await service.applyLoadout(actor, [
    { itemId: first.id, installed: true, united: false, spentPoints: 1 },
    { itemId: second.id, installed: true, united: false, spentPoints: 1 }
  ]);

  assert.equal(combatStatusService.setCalls.length, 1);
  assert.equal(combatStatusService.valueCalls.length, 0);

  await service.applyLoadout(actor, [
    { itemId: first.id, installed: true, united: true, spentPoints: 1 },
    { itemId: second.id, installed: true, united: true, spentPoints: 1 }
  ]);

  assert.deepEqual(combatStatusService.clearCalls, ["rebreya-nauseated"]);
});

test("implant nausea temporarily raises a weaker foreign nausea without deleting it", async () => {
  const implant = implantItem({ automationKey: "" });
  const actor = actorStub({ items: [implant] });
  const combatStatusService = combatStatusServiceStub({
    active: true,
    statusId: "rebreya-nauseated",
    value: 1,
    meta: { source: "poison" }
  });
  const service = new ImplantService({ combatStatusService });

  await service.applyLoadout(actor, [{
    itemId: implant.id,
    installed: true,
    united: false,
    spentPoints: 1
  }]);

  assert.deepEqual(combatStatusService.valueCalls, [{
    statusId: "rebreya-nauseated",
    value: 2,
    meta: {
      source: "poison",
      implantNausea: true,
      previousValue: 1,
      previousMeta: { source: "poison" }
    }
  }]);

  await service.applyLoadout(actor, [{
    itemId: implant.id,
    installed: true,
    united: true,
    spentPoints: 1
  }]);

  assert.deepEqual(combatStatusService.valueCalls.at(-1), {
    statusId: "rebreya-nauseated",
    value: 1,
    meta: { source: "poison" }
  });
  assert.equal(combatStatusService.clearCalls.length, 0);
});

test("implant nausea leaves an equal or stronger foreign nausea unchanged", async () => {
  const implant = implantItem({ automationKey: "" });
  const actor = actorStub({ items: [implant] });
  const combatStatusService = combatStatusServiceStub({
    active: true,
    statusId: "rebreya-nauseated",
    value: 3,
    meta: { source: "disease" }
  });
  const service = new ImplantService({ combatStatusService });

  await service.applyLoadout(actor, [{
    itemId: implant.id,
    installed: true,
    united: false,
    spentPoints: 1
  }]);
  await service.applyLoadout(actor, [{
    itemId: implant.id,
    installed: true,
    united: true,
    spentPoints: 1
  }]);

  assert.equal(combatStatusService.setCalls.length, 0);
  assert.equal(combatStatusService.valueCalls.length, 0);
  assert.equal(combatStatusService.clearCalls.length, 0);
});

test("loadout validation rejects impossible implants and point overflow", async () => {
  const military = implantItem({ id: "military", type: "Военная", automationKey: "" });
  const actor = actorStub({ items: [military] });
  const service = new ImplantService();

  await assert.rejects(
    service.applyLoadout(actor, [{
      itemId: military.id,
      installed: true,
      united: false,
      spentPoints: 1
    }]),
    /несовместим/u
  );

  const expensive = implantItem({ id: "expensive", pointsMin: 3, pointsMax: 3, automationKey: "" });
  const limited = actorStub({ items: [expensive] });
  await assert.rejects(
    service.applyLoadout(limited, [{
      itemId: expensive.id,
      installed: true,
      united: true,
      spentPoints: 3
    }]),
    /очк/u
  );
});

test("additional limbs install by owned quantity and spend points per copy", async () => {
  const limb = implantItem({
    id: "limb",
    name: "Дополнительная конечность",
    type: "Военная",
    gearId: "dopolnitelnaya-konechnost",
    pointsMin: 2,
    pointsMax: 2,
    quantity: 3,
    automationKey: ""
  });
  const actor = actorStub({
    prof: 3,
    items: [raceItem("Железорождённые", "железорождённые"), limb]
  });
  const service = new ImplantService();

  await service.applyLoadout(actor, [{
    itemId: limb.id,
    installed: true,
    installedCount: 2,
    united: false,
    spentPoints: 2
  }]);

  assert.deepEqual(limb.flags[MODULE_ID].implantInstallation, {
    installed: true,
    installedCount: 2,
    united: false,
    spentPoints: 2
  });
  assert.equal(service.getActorSnapshot(actor).used, 4);

  limb.system.quantity = 1;
  await service.reconcileActor(actor, { reason: "quantityChanged" });
  assert.equal(limb.flags[MODULE_ID].implantInstallation.installedCount, 1);
  assert.equal(service.getActorSnapshot(actor).used, 2);

  await assert.rejects(
    service.applyLoadout(actor, [{
      itemId: limb.id,
      installed: true,
      installedCount: 4,
      united: false,
      spentPoints: 2
    }]),
    /количеств/u
  );
});

test("non-stackable implants reject an installed count above one", async () => {
  const armor = implantItem({ quantity: 4 });
  const actor = actorStub({
    items: [raceItem("Синтеты", "синтеты"), armor]
  });

  await assert.rejects(
    new ImplantService().applyLoadout(actor, [{
      itemId: armor.id,
      installed: true,
      installedCount: 2,
      united: false,
      spentPoints: 1
    }]),
    /одного экземпляра/u
  );
});

test("incomplete spreadsheet rows stay visible but cannot be installed", async () => {
  const incomplete = implantItem({
    id: "incomplete",
    name: "Паучьи лапы «Нова Индастриз»",
    type: "Сверхтяжёлая",
    pointsMin: null,
    pointsMax: null,
    automationKey: ""
  });
  incomplete.flags[MODULE_ID].implant.installable = false;
  const actor = actorStub({
    items: [raceItem("Железорождённые", "железорождённые"), incomplete]
  });
  const service = new ImplantService();

  assert.equal(service.getActorSnapshot(actor).entries[0].installable, false);
  await assert.rejects(
    service.applyLoadout(actor, [{
      itemId: incomplete.id,
      installed: true,
      united: false,
      spentPoints: 0
    }]),
    /полной стоимости/u
  );
});

test("closing the long-rest prompt skips the step without mutations", async () => {
  const armor = implantItem();
  const actor = actorStub({ items: [armor] });
  const service = new ImplantService({
    promptLoadout: async () => null
  });

  const result = await service.chooseImplantsAfterLongRest(actor, {
    progress: {
      title: (label) => `Шаг 1/1 · ${label}`,
      header: () => "<p>Шаг 1/1</p>"
    }
  });

  assert.deepEqual(result, { status: "skipped" });
  assert.equal(actor.itemUpdates.length, 0);
  assert.equal(actor.effectCreates.length, 0);
});

test("implant service registers one interactive long-rest step after Craftsman steps", () => {
  const registrations = [];
  const service = new ImplantService();
  assert.equal(service.registerLongRestSteps({
    registerStep: (definition) => registrations.push(definition)
  }), true);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, "implants.configure");
  assert.equal(registrations[0].order, 250);
  assert.equal(registrations[0].interactive, true);
});
