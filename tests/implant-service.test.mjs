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
  automationKey = "mounted-armor-ac"
} = {}) {
  return {
    id,
    uuid: `Actor.hero.Item.${id}`,
    name,
    type: "equipment",
    flags: {
      [MODULE_ID]: {
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
          united,
          spentPoints
        }
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function actorStub({ prof = 3, items = [] } = {}) {
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    name: "Герой",
    isOwner: true,
    system: {
      attributes: {
        prof
      }
    },
    items: collection(items),
    effects: collection([]),
    itemUpdates: [],
    effectCreates: [],
    effectUpdates: [],
    effectDeletes: [],
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
