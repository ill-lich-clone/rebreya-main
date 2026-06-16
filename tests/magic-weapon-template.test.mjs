import assert from "node:assert/strict";
import test from "node:test";

globalThis.CONST = {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2,
  },
};

globalThis.foundry = {
  utils: {
    deepClone: (value) => structuredClone(value),
    escapeHTML: (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;"),
    getProperty: (object, path) => {
      if (!object || !path) return undefined;
      return String(path)
        .split(".")
        .reduce((value, part) => (value == null ? undefined : value[part]), object);
    },
    setProperty: (object, path, value) => {
      const parts = String(path).split(".");
      let target = object;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        target[part] ??= {};
        target = target[part];
      }
      target[parts.at(-1)] = value;
      return true;
    },
  },
};

globalThis.ui = {
  notifications: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
};

globalThis.game = {
  user: {
    id: "player-1",
  },
};

const {
  buildMagicWeaponTemplateOptions,
  createMagicWeaponTemplateUpdate,
  handleActorRenderMagicWeapons,
  handleCreatedMagicWeaponItem,
  parseMagicWeaponBonus,
  promptMagicWeaponTemplate,
} = await import("../scripts/integrations/magic-weapon-template.js");

function makeLongsword() {
  return {
    id: "longsword",
    name: "Длинный меч",
    equipmentType: "Оружие",
    itemType: "Воинское рукопашное",
    cost: {
      gold: 15,
      silver: 0,
      copper: 0,
    },
    weight: 3,
    weapon: {
      damageFormula: "1d8",
      damageType: "slashing",
      versatileDamageFormula: "1d10",
      properties: ["ver"],
      mastery: "Sap",
      attackTraits: {
        mku: 1,
      },
      attackTraitsText: "МКУ 1",
      lichWeaponPropertyValues: {
        mku: 1,
      },
    },
  };
}

function makeDagger() {
  return {
    id: "dagger",
    name: "Кинжал",
    equipmentType: "Оружие",
    itemType: "Простое рукопашное",
    cost: {
      gold: 2,
      silver: 0,
      copper: 0,
    },
    weight: 1,
    weapon: {
      damageFormula: "1d4",
      damageType: "piercing",
      properties: ["thr", "fin", "lgt"],
      range: {
        value: 20,
        long: 60,
        reach: 0,
        units: "ft",
      },
    },
  };
}

function makeFirearm() {
  return {
    id: "automatic-rifle",
    name: "Автоматическая винтовка",
    equipmentType: "Огнестрельное оружие",
    itemType: "Продвинутое",
    weight: 8,
    weapon: {
      damageFormula: "2d8",
      damageType: "piercing",
      properties: [],
    },
  };
}

function makeArmor() {
  return {
    id: "chain-mail",
    name: "Кольчуга",
    equipmentType: "Броня",
    armor: {
      type: "heavy",
      value: 16,
    },
  };
}

class FakeItem {
  constructor({
    name = "Оружие +2",
    type = "weapon",
    actorType = "character",
    system = {},
    flags = {},
  } = {}) {
    this.name = name;
    this.type = type;
    this.system = {
      quantity: 1,
      rarity: "rare",
      properties: ["mgc"],
      ...system,
    };
    this.flags = flags;
    this.parent = actorType ? { type: actorType, isOwner: true } : null;
    this.updates = [];
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }

  toObject() {
    return {
      name: this.name,
      type: this.type,
      system: structuredClone(this.system),
      flags: structuredClone(this.flags),
    };
  }

  async update(data, options) {
    this.updates.push({ data, options });
    return this;
  }
}

class FakeActor {
  constructor({
    type = "character",
    isOwner = true,
    items = [],
  } = {}) {
    this.type = type;
    this.isOwner = isOwner;
    this.items = items;
    for (const item of items) {
      item.parent = this;
    }
  }
}

test("parseMagicWeaponBonus matches only generic +1/+2/+3 weapon templates", () => {
  assert.equal(parseMagicWeaponBonus({ name: "Оружие +1" }), 1);
  assert.equal(parseMagicWeaponBonus({ name: "Оружие +2" }), 2);
  assert.equal(parseMagicWeaponBonus({ name: "Оружие +3" }), 3);
  assert.equal(parseMagicWeaponBonus({ name: "Weapon +2" }), 2);
  assert.equal(parseMagicWeaponBonus({ name: "Длинный меч +2" }), null);
  assert.equal(parseMagicWeaponBonus({ name: "Оружие +4" }), null);
});

test("parseMagicWeaponBonus can resolve generic magic weapons from Rebreya flags", () => {
  assert.equal(
    parseMagicWeaponBonus({
      name: "Шаблон оружия",
      flags: {
        "rebreya-main": {
          sourceType: "magicItem",
          itemType: "Оружие",
          itemSubtype: "Любое",
          magicItemId: "оружие-3",
        },
      },
    }),
    3,
  );
});

test("buildMagicWeaponTemplateOptions lists Rebreya weapon templates only", () => {
  const options = buildMagicWeaponTemplateOptions({
    gear: [makeArmor(), makeLongsword(), makeDagger()],
  });

  assert.deepEqual(
    options.map((option) => option.id),
    ["longsword", "dagger"],
  );
});

test("buildMagicWeaponTemplateOptions excludes firearms from generic magic weapon templates", () => {
  const options = buildMagicWeaponTemplateOptions({
    gear: [makeLongsword(), makeFirearm(), makeDagger()],
  });

  assert.deepEqual(
    options.map((option) => option.id),
    ["longsword", "dagger"],
  );
});

test("createMagicWeaponTemplateUpdate applies base weapon data while preserving magic source", () => {
  const item = new FakeItem({
    system: {
      description: {
        value: `<section class="rebreya-gear-item">
          <ul>
            <li><strong>Тип:</strong> Магический предмет</li>
            <li><strong>Вид предмета:</strong> Оружие</li>
          </ul>
          <p>Вы получаете бонус к броскам атаки и урона, совершённым этим магическим оружием.</p>
        </section>`,
      },
    },
    flags: {
      "rebreya-main": {
        sourceType: "magicItem",
        magicItemId: "weapon-plus-2",
        signature: JSON.stringify({
          description: "Вы получаете бонус к броскам атаки и урона, совершённым этим магическим оружием.",
        }),
      },
    },
  });

  const update = createMagicWeaponTemplateUpdate(item, makeLongsword(), 2, {
    iconLookup: new Map([
      ["длинный меч", "modules/rebreya-main/templates/icons/weapons/dlinnyy-mech.webp"],
    ]),
  });

  assert.equal(update.name, "Длинный меч +2");
  assert.equal(update.img, "modules/rebreya-main/templates/icons/weapons/dlinnyy-mech.webp");
  assert.equal(update.system.type.baseItem, "longsword");
  assert.equal(update.system.damage.base.number, 1);
  assert.equal(update.system.damage.base.denomination, 8);
  assert.equal(update.system.damage.versatile.number, 1);
  assert.equal(update.system.damage.versatile.denomination, 10);
  assert.equal(update.system.magicalBonus, 2);
  assert.equal(update.system.quantity, 1);
  assert.equal(update.system.rarity, "rare");
  assert.ok(update.system.properties.includes("mgc"));
  assert.ok(update.system.properties.includes("ver"));
  assert.equal(update.flags["rebreya-main"].sourceType, "magicItem");
  assert.equal(update.flags["rebreya-main"].magicItemId, "weapon-plus-2");
  assert.equal(update.flags["rebreya-main"].magicWeaponTemplate, true);
  assert.equal(update.flags["rebreya-main"].magicWeaponBonus, 2);
  assert.equal(update.flags["rebreya-main"].magicWeaponGearId, "longsword");
  assert.equal(update.flags["rebreya-main"].gearId, "longsword");
  assert.deepEqual(update.flags["rebreya-main"].attackTraits, { mku: 1 });
  assert.deepEqual(update.flags["rebreya-main"].lichWeaponPropertyValues, { mku: 1 });
  assert.equal(update.flags["rebreya-main"].attackTraitsText, "МКУ 1");
  assert.doesNotMatch(update.system.description.value, /Тип:\s*Магический предмет/iu);
  assert.match(update.system.description.value, /Вы получаете бонус к броскам атаки и урона, совершённым этим магическим оружием\./u);
  assert.equal((update.system.description.value.match(/Вы получаете бонус к броскам атаки и урона, совершённым этим магическим оружием\./gu) ?? []).length, 1);
});

test("promptMagicWeaponTemplate uses dialog window classes instead of leaking Rebreya text color into light content", async () => {
  const originalDialog = globalThis.Dialog;
  const observed = {
    config: null,
  };

  class FakeDialog {
    constructor(config) {
      observed.config = config;
    }

    render() {
      observed.config.buttons.apply.callback({
        0: {
          querySelector: () => ({ value: "longsword" }),
        },
      });
    }
  }

  globalThis.Dialog = FakeDialog;

  try {
    const selectedId = await promptMagicWeaponTemplate({
      item: { name: "Оружие +1" },
      bonus: 1,
      weapons: [{ id: "longsword", name: "Длинный меч" }],
    });

    assert.equal(selectedId, "longsword");
    assert.deepEqual(observed.config.classes, ["rebreya-main", "rebreya-trader-dialog", "rm-magic-weapon-template-window"]);
    assert.match(observed.config.content, /class="rm-magic-weapon-template-form"/u);
    assert.doesNotMatch(observed.config.content, /class="rebreya-main/u);
  }
  finally {
    globalThis.Dialog = originalDialog;
  }
});

test("handleCreatedMagicWeaponItem prompts and updates only current user's character item", async () => {
  const item = new FakeItem();
  const moduleApi = {
    getModel: async () => ({
      gear: [makeLongsword()],
    }),
  };

  const handled = await handleCreatedMagicWeaponItem(
    item,
    {},
    "player-1",
    moduleApi,
    {
      prompt: async ({ bonus, weapons }) => {
        assert.equal(bonus, 2);
        assert.deepEqual(
          weapons.map((weapon) => weapon.id),
          ["longsword"],
        );
        return "longsword";
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(item.updates.length, 1);
  assert.equal(item.updates[0].data.name, "Длинный меч +2");
  assert.equal(item.updates[0].options["rebreya-main"].skipMagicWeaponTemplate, true);
});

test("handleCreatedMagicWeaponItem still prompts on the current user's create hook even if actor ownership is not yet reflected", async () => {
  const item = new FakeItem();
  item.parent = { type: "character", isOwner: false };
  const moduleApi = {
    getModel: async () => ({
      gear: [makeLongsword()],
    }),
  };

  const handled = await handleCreatedMagicWeaponItem(
    item,
    {},
    "player-1",
    moduleApi,
    {
      prompt: async () => "longsword",
    },
  );

  assert.equal(handled, true);
  assert.equal(item.updates.length, 1);
  assert.equal(item.updates[0].data.name, "Длинный меч +2");
});

test("handleCreatedMagicWeaponItem ignores other users and non-character items", async () => {
  const otherUserItem = new FakeItem();
  const npcItem = new FakeItem({ actorType: "npc" });
  const moduleApi = {
    getModel: async () => ({
      gear: [makeLongsword()],
    }),
  };
  let promptCalls = 0;
  const prompt = async () => {
    promptCalls += 1;
    return "longsword";
  };

  assert.equal(
    await handleCreatedMagicWeaponItem(otherUserItem, {}, "gm-1", moduleApi, { prompt }),
    false,
  );
  assert.equal(
    await handleCreatedMagicWeaponItem(npcItem, {}, "player-1", moduleApi, { prompt }),
    false,
  );
  assert.equal(promptCalls, 0);
  assert.equal(otherUserItem.updates.length, 0);
  assert.equal(npcItem.updates.length, 0);
});

test("handleActorRenderMagicWeapons applies a fallback prompt for unresolved generic magic weapons on owned sheets", async () => {
  const item = new FakeItem();
  const actor = new FakeActor({
    items: [item],
  });
  const moduleApi = {
    getModel: async () => ({
      gear: [makeLongsword()],
    }),
  };

  const handled = await handleActorRenderMagicWeapons(actor, moduleApi, {
    prompt: async ({ bonus, weapons }) => {
      assert.equal(bonus, 2);
      assert.deepEqual(
        weapons.map((weapon) => weapon.id),
        ["longsword"],
      );
      return "longsword";
    },
  });

  assert.equal(handled, true);
  assert.equal(item.updates.length, 1);
  assert.equal(item.updates[0].data.name, "Длинный меч +2");
});
