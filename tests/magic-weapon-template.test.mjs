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
  buildMagicArmorTemplateOptions,
  buildMagicShieldTemplateOptions,
  buildMagicWeaponTemplateOptions,
  createMagicArmorTemplateUpdate,
  createMagicShieldTemplateUpdate,
  createMagicWeaponTemplateUpdate,
  handleCreatedMagicArmorItem,
  handleActorRenderMagicWeapons,
  handleCreatedMagicWeaponItem,
  parseMagicArmorBonus,
  parseMagicShieldBonus,
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
    equipmentType: "Доспех",
    armor: {
      type: "heavy",
      baseItem: "chainmail",
      value: 16,
    },
  };
}

function makeChefArmor() {
  return {
    id: "chef-armor",
    name: "Боевая броня шеф-повара",
    equipmentType: "Доспех",
    armor: {
      type: "light",
      baseItem: "",
      value: 11,
      dex: null,
      strength: 0,
      properties: [],
    },
  };
}

function makeBuckler() {
  return {
    id: "buckler",
    name: "Баклер",
    equipmentType: "Доспех",
    armor: {
      type: "shield",
      baseItem: "",
      value: 1,
      dex: null,
      strength: 0,
      properties: [],
    },
  };
}

function makeTowerShield() {
  return {
    id: "tower-shield",
    name: "Башенный щит",
    equipmentType: "Доспех",
    armor: {
      type: "shield",
      baseItem: "",
      value: 2,
      dex: null,
      strength: 16,
      properties: ["stealthDisadvantage"],
    },
  };
}

function makeModernArmor() {
  return {
    id: "modern-cloak",
    name: "Тяжёлый плащ",
    equipmentType: "Доспех",
    armor: {
      type: "light",
      baseItem: "",
      value: 11,
      dex: null,
      strength: 0,
      properties: [],
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

test("parseMagicArmorBonus matches only generic +1/+2/+3 armor templates", () => {
  assert.equal(parseMagicArmorBonus({ name: "Доспех +1" }), 1);
  assert.equal(parseMagicArmorBonus({ name: "Доспех +2" }), 2);
  assert.equal(parseMagicArmorBonus({ name: "Доспех +3" }), 3);
  assert.equal(parseMagicArmorBonus({ name: "Armor +2" }), 2);
  assert.equal(parseMagicArmorBonus({ name: "Кольчуга +2" }), null);
  assert.equal(parseMagicArmorBonus({ name: "Доспех +4" }), null);
});

test("parseMagicArmorBonus can resolve generic magic armor from Rebreya flags", () => {
  assert.equal(
    parseMagicArmorBonus({
      name: "Шаблон доспеха",
      flags: {
        "rebreya-main": {
          sourceType: "magicItem",
          itemType: "Доспех",
          itemSubtype: "Любой",
          magicItemId: "dospekh-3",
        },
      },
    }),
    3,
  );
});

test("parseMagicShieldBonus matches only generic +1/+2/+3 shield templates", () => {
  assert.equal(parseMagicShieldBonus({ name: "Щит +1" }), 1);
  assert.equal(parseMagicShieldBonus({ name: "Щит +2" }), 2);
  assert.equal(parseMagicShieldBonus({ name: "Щит +3" }), 3);
  assert.equal(parseMagicShieldBonus({ name: "Shield +2" }), 2);
  assert.equal(parseMagicShieldBonus({ name: "Баклер +2" }), null);
  assert.equal(parseMagicShieldBonus({ name: "Щит +4" }), null);
});

test("parseMagicShieldBonus can resolve generic magic shields from Rebreya flags", () => {
  assert.equal(
    parseMagicShieldBonus({
      name: "Шаблон щита",
      flags: {
        "rebreya-main": {
          sourceType: "magicItem",
          itemType: "Доспех",
          itemSubtype: "Щит",
          magicItemId: "shchit-2",
        },
      },
    }),
    2,
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

test("buildMagicArmorTemplateOptions keeps only the allowed ordinary armor templates", () => {
  const options = buildMagicArmorTemplateOptions({
    gear: [makeArmor(), makeChefArmor(), makeModernArmor()],
  });

  assert.deepEqual(
    options.map((option) => option.id),
    ["chef-armor", "chain-mail"],
  );
});

test("buildMagicShieldTemplateOptions keeps only the allowed ordinary shield templates", () => {
  const options = buildMagicShieldTemplateOptions({
    gear: [makeBuckler(), makeTowerShield(), makeModernArmor()],
  });

  assert.deepEqual(
    options.map((option) => option.id),
    ["buckler", "tower-shield"],
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

test("createMagicArmorTemplateUpdate applies base armor data while preserving magic source", () => {
  const armorTemplate = makeChefArmor();
  const item = new FakeItem({
    name: "Доспех +2",
    type: "equipment",
    system: {
      description: {
        value: `<section class="rebreya-gear-item">
          <ul>
            <li><strong>Тип:</strong> Магический предмет</li>
            <li><strong>Вид предмета:</strong> Доспех</li>
          </ul>
          <p>Вы получаете бонус к КД, пока носите этот доспех.</p>
        </section>`,
      },
    },
    flags: {
      "rebreya-main": {
        sourceType: "magicItem",
        magicItemId: "armor-plus-2",
        signature: JSON.stringify({
          description: "Вы получаете бонус к КД, пока носите этот доспех.",
        }),
      },
    },
  });

  const update = createMagicArmorTemplateUpdate(item, armorTemplate, 2, {
    iconLookup: new Map([
      [armorTemplate.name.toLowerCase().replace(/-/gu, " "), "modules/rebreya-main/templates/icons/chef-armor.webp"],
    ]),
  });

  assert.equal(update.name, "Боевая броня шеф-повара +2");
  assert.equal(update.img, "modules/rebreya-main/templates/icons/chef-armor.webp");
  assert.equal(update.system.type.value, "light");
  assert.equal(update.system.type.baseItem, "");
  assert.equal(update.system.armor.value, 11);
  assert.equal(update.system.armor.magicalBonus, 2);
  assert.ok(update.system.properties.includes("mgc"));
  assert.equal(update.flags["rebreya-main"].sourceType, "magicItem");
  assert.equal(update.flags["rebreya-main"].magicItemId, "armor-plus-2");
  assert.equal(update.flags["rebreya-main"].magicArmorTemplate, true);
  assert.equal(update.flags["rebreya-main"].magicArmorBonus, 2);
  assert.equal(update.flags["rebreya-main"].magicArmorGearId, "chef-armor");
  assert.equal(update.flags["rebreya-main"].gearId, "chef-armor");
  assert.doesNotMatch(update.system.description.value, /Тип:\s*Магический предмет/iu);
  assert.match(update.system.description.value, /Вы получаете бонус к КД, пока носите этот доспех\./u);
});

test("createMagicShieldTemplateUpdate applies base shield data while preserving magic source", () => {
  const item = new FakeItem({
    name: "Щит +3",
    type: "equipment",
    system: {
      description: {
        value: `<section class="rebreya-gear-item">
          <ul>
            <li><strong>Тип:</strong> Магический предмет</li>
            <li><strong>Подтип:</strong> Щит</li>
          </ul>
          <p>Пока вы держите этот щит, вы получаете бонус к КД.</p>
        </section>`,
      },
    },
    flags: {
      "rebreya-main": {
        sourceType: "magicItem",
        magicItemId: "shield-plus-3",
        signature: JSON.stringify({
          description: "Пока вы держите этот щит, вы получаете бонус к КД.",
        }),
      },
    },
  });

  const update = createMagicShieldTemplateUpdate(item, makeBuckler(), 3, {
    iconLookup: new Map([
      ["баклер", "modules/rebreya-main/templates/icons/buckler.webp"],
    ]),
  });

  assert.equal(update.name, "Баклер +3");
  assert.equal(update.img, "modules/rebreya-main/templates/icons/buckler.webp");
  assert.equal(update.system.type.value, "shield");
  assert.equal(update.system.armor.value, 1);
  assert.equal(update.system.armor.magicalBonus, 3);
  assert.ok(update.system.properties.includes("mgc"));
  assert.equal(update.flags["rebreya-main"].magicShieldTemplate, true);
  assert.equal(update.flags["rebreya-main"].magicShieldBonus, 3);
  assert.equal(update.flags["rebreya-main"].magicShieldGearId, "buckler");
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

test("handleCreatedMagicArmorItem prompts and updates generic armor and shield items", async () => {
  const armorItem = new FakeItem({
    name: "Доспех +2",
    type: "equipment",
  });
  armorItem.flags = {
    "rebreya-main": {
      sourceType: "magicItem",
      itemType: "Доспех",
      itemSubtype: "Любой",
      magicItemId: "dospekh-2",
    },
  };

  const shieldItem = new FakeItem({
    name: "Щит +1",
    type: "equipment",
  });
  shieldItem.flags = {
    "rebreya-main": {
      sourceType: "magicItem",
      itemType: "Доспех",
      itemSubtype: "Щит",
      magicItemId: "shchit-1",
    },
  };

  const moduleApi = {
    getModel: async () => ({
      gear: [makeChefArmor(), makeBuckler(), makeModernArmor()],
    }),
  };

  const seen = [];
  const prompt = async (context) => {
    seen.push({
      bonus: context.bonus,
      itemLabel: context.itemLabel,
      options: context.options.map((option) => option.id),
    });
    return context.options[0].id;
  };

  assert.equal(await handleCreatedMagicArmorItem(armorItem, {}, "player-1", moduleApi, { prompt }), true);
  assert.equal(await handleCreatedMagicArmorItem(shieldItem, {}, "player-1", moduleApi, { prompt }), true);
  assert.deepEqual(seen, [
    {
      bonus: 2,
      itemLabel: "Доспех",
      options: ["chef-armor"],
    },
    {
      bonus: 1,
      itemLabel: "Щит",
      options: ["buckler"],
    },
  ]);
  assert.equal(armorItem.updates[0].data.name, "Боевая броня шеф-повара +2");
  assert.equal(shieldItem.updates[0].data.name, "Баклер +1");
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
