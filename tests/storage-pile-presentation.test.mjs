import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MODULE_ID } from "../scripts/constants.js";
import {
  deriveGroundPilePlacement,
  deriveGroundPilePresentation,
  isGroundPileToken,
  STORAGE_PILE_PRESENTATIONS
} from "../scripts/data/storage-pile-presentation.js";

test("ground pile presentation uses the item itself for one visible row", () => {
  assert.deepEqual(deriveGroundPilePresentation([
    { name: "Стрела", img: "icons/arrow.webp", typeLabel: "Боеприпас", quantity: 20 }
  ]), {
    name: "Стрела (20)",
    img: "icons/arrow.webp",
    categoryKey: "single"
  });
  assert.equal(deriveGroundPilePresentation([
    { name: "Меч", img: "icons/sword.webp", typeLabel: "Оружие", quantity: 1 }
  ]).name, "Меч");
});

test("single managed gear and material rows use their canonical top-down textures", () => {
  assert.deepEqual(deriveGroundPilePresentation([{
    sourceType: "gear",
    sourceId: "revol-ver",
    name: "Револьвер",
    img: "icons/revolver-item-icon.webp",
    typeLabel: "Огнестрельное оружие",
    quantity: 1,
    itemData: {
      img: "icons/revolver-item-icon.webp",
      flags: {
        [MODULE_ID]: {
          sourceType: "gear",
          sourceId: "revol-ver",
          gearId: "revol-ver"
        }
      }
    }
  }]), {
    name: "Револьвер",
    img: `modules/${MODULE_ID}/assets/top-down/items/gear/revol-ver.webp`,
    categoryKey: "single",
    topDownItem: true,
    tokenSize: 0.5,
    textureScale: 1,
    rotationSeed: "gear:revol-ver"
  });

  assert.equal(deriveGroundPilePresentation([{
    sourceType: "material",
    sourceId: "material-10",
    name: "Копыто чудовища",
    img: "icons/hoof-item-icon.webp",
    typeLabel: "Материал",
    quantity: 1,
    itemData: {
      flags: {
        [MODULE_ID]: {
          sourceType: "material",
          sourceId: "material-10",
          materialId: "material-10"
        }
      }
    }
  }]).img, `modules/${MODULE_ID}/assets/top-down/items/material/material-10.webp`);
});

test("single managed armor uses a full grid cell with its curated texture scale", () => {
  assert.deepEqual(deriveGroundPilePresentation([{
    rowId: "source-laty",
    sourceType: "gear",
    sourceId: "laty",
    name: "Латы",
    img: "icons/plate-item-icon.webp",
    typeLabel: "Доспех",
    quantity: 1,
    itemData: {
      flags: {
        [MODULE_ID]: {
          sourceType: "gear",
          sourceId: "laty",
          gearId: "laty"
        }
      }
    }
  }]), {
    name: "Латы",
    img: `modules/${MODULE_ID}/assets/top-down/items/gear/laty.webp`,
    categoryKey: "single",
    topDownItem: true,
    tokenSize: 1,
    textureScale: 1.5,
    rotationSeed: "source-laty"
  });
});

test("single managed furniture exposes its curated rectangular footprint and cardinal rotation", () => {
  const bigTable = deriveGroundPilePresentation([{
    rowId: "table-row",
    sourceType: "gear",
    sourceId: "stol-bolshoy",
    name: "Стол, большой",
    typeLabel: "Снаряжение",
    quantity: 1,
    itemData: {
      flags: {
        [MODULE_ID]: { sourceType: "gear", sourceId: "stol-bolshoy", gearId: "stol-bolshoy" }
      }
    }
  }]);
  assert.equal(bigTable.tokenWidth, 3);
  assert.equal(bigTable.tokenHeight, 2);
  assert.equal(bigTable.rotationMode, "cardinal");
  assert.equal(bigTable.rotationSeed, "table-row");

  const bed = deriveGroundPilePresentation([{
    sourceType: "gear",
    sourceId: "krovat",
    name: "Кровать",
    typeLabel: "Снаряжение",
    quantity: 1,
    itemData: {
      flags: {
        [MODULE_ID]: { sourceType: "gear", sourceId: "krovat", gearId: "krovat" }
      }
    }
  }]);
  assert.equal(bed.tokenWidth, 1);
  assert.equal(bed.tokenHeight, 2);
  assert.equal(bed.rotationMode, "cardinal");
});

test("ground-pile placement metadata is exposed only for canonical furniture footprints", () => {
  const managed = (gearId, name) => ({
    sourceType: "gear",
    sourceId: gearId,
    name,
    typeLabel: "Снаряжение",
    quantity: 1,
    itemData: {
      flags: {
        [MODULE_ID]: { sourceType: "gear", sourceId: gearId, gearId }
      }
    }
  });

  assert.deepEqual(deriveGroundPilePlacement(managed("krovat", "Кровать")), {
    width: 1,
    height: 2,
    rotationMode: "cardinal"
  });
  assert.deepEqual(deriveGroundPilePlacement(managed("stul", "Стул")), {
    width: 1,
    height: 1,
    rotationMode: "cardinal"
  });
  assert.equal(deriveGroundPilePlacement({
    sourceType: "gear",
    sourceId: "krovat",
    name: "Сторонняя кровать",
    img: "icons/external-bed.webp",
    quantity: 1,
    itemData: { flags: {} }
  }), null);
});

test("single external rows retain their current Item image fallback", () => {
  assert.equal(deriveGroundPilePresentation([{
    sourceType: "gear",
    sourceId: "rapira",
    name: "Сторонняя рапира",
    img: "icons/external-rapier.webp",
    typeLabel: "Оружие",
    quantity: 1,
    itemData: { flags: {} }
  }]).img, "icons/external-rapier.webp");
});

test("single broken ground item exposes its durability state in the token name", () => {
  assert.deepEqual(deriveGroundPilePresentation([{
    name: "Латы",
    img: "icons/plate.webp",
    typeLabel: "Доспех",
    quantity: 1,
    itemData: {
      name: "Латы",
      type: "equipment",
      flags: {
        [MODULE_ID]: {
          durability: {
            version: 1,
            eligible: true,
            state: "broken",
            breakStage: 1,
            hp: { value: 0, max: 30 }
          }
        }
      }
    }
  }]), {
    name: "Латы (сломан)",
    img: "icons/plate.webp",
    categoryKey: "single"
  });
});

test("Journal references do not turn a single ground item into a pile", () => {
  assert.deepEqual(deriveGroundPilePresentation([
    { name: "Меч", img: "icons/sword.webp", typeLabel: "Оружие", quantity: 1 },
    {
      rowKind: "journal",
      sourceType: "journal",
      sourceId: "JournalEntry.notes",
      name: "Полевые заметки",
      quantity: 1
    }
  ]), {
    name: "Меч",
    img: "icons/sword.webp",
    categoryKey: "single"
  });
});

test("canonical Journal-only piles use unread, read, and multi-note presentations", () => {
  const journal = (rowId, name) => ({
    rowKind: "journal",
    rowId,
    stackKey: "",
    sourceId: `JournalEntry.${rowId}`,
    sourceType: "journal",
    name,
    img: "icons/book.webp",
    quantity: 1
  });

  assert.deepEqual(deriveGroundPilePresentation([
    journal("gartar", "Заметки Гартара")
  ]), {
    name: "Заметки Гартара",
    img: `modules/${MODULE_ID}/assets/storage/piles/journal-note.png`,
    categoryKey: "journal-note"
  });
  assert.equal(deriveGroundPilePresentation(
    [journal("gartar", "Заметки Гартара")],
    { readJournalRowIds: ["gartar"] }
  ).name, "Заметки Гартара (прочитано)");
  assert.deepEqual(deriveGroundPilePresentation([
    journal("first", "Первая"),
    journal("second", "Вторая")
  ]), {
    name: "Куча заметок",
    img: `modules/${MODULE_ID}/assets/storage/piles/journal-notes.png`,
    categoryKey: "journal-notes"
  });
});

test("ordinary rows and coins keep priority over Journal-only presentation", () => {
  const journal = {
    rowKind: "journal",
    rowId: "note",
    stackKey: "",
    sourceId: "JournalEntry.note",
    sourceType: "journal",
    name: "Запись",
    quantity: 1
  };
  assert.deepEqual(deriveGroundPilePresentation([
    { name: "Книга", img: "icons/book.webp", typeLabel: "Снаряжение", quantity: 1 },
    journal
  ]), {
    name: "Книга",
    img: "icons/book.webp",
    categoryKey: "single"
  });
  assert.deepEqual(deriveGroundPilePresentation([journal], { coins: { gp: 2 } }), {
    name: "Золотая монета",
    img: "icons/commodities/currency/coins-plain-gold.webp",
    categoryKey: "coins"
  });
  assert.deepEqual(deriveGroundPilePresentation([journal], { preserveEmptyCoinPile: true }), {
    name: "Куча монет (пусто)",
    img: `modules/${MODULE_ID}/assets/storage/piles/coins.png`,
    categoryKey: "coins"
  });
});

test("ground pile presentation derives same-category and mixed pile tokens", () => {
  const weapons = deriveGroundPilePresentation([
    { name: "Меч", typeLabel: "Оружие", quantity: 1 },
    { name: "Топор", typeLabel: "Оружие", quantity: 1 }
  ]);
  assert.equal(weapons.name, "Куча оружия");
  assert.equal(weapons.categoryKey, "weapons");
  assert.match(weapons.img, /weapons\.png$/u);

  const mixed = deriveGroundPilePresentation([
    { name: "Меч", typeLabel: "Оружие", quantity: 1 },
    { name: "Зелье", typeLabel: "Зелье", quantity: 1 }
  ]);
  assert.equal(mixed.name, "Куча предметов");
  assert.equal(mixed.categoryKey, "mixed-items");
  assert.match(mixed.img, /mixed-items\.png$/u);
});

test("pure coin piles use denomination, mixed coin, and preserved-empty presentations", () => {
  assert.deepEqual(deriveGroundPilePresentation([], { coins: { gp: 8 } }), {
    name: "Золотая монета",
    img: "icons/commodities/currency/coins-plain-gold.webp",
    categoryKey: "coins"
  });
  assert.deepEqual(deriveGroundPilePresentation([], { coins: { gp: 8, sp: 3 } }), {
    name: "Куча монет",
    img: `modules/${MODULE_ID}/assets/storage/piles/coins.png`,
    categoryKey: "coins"
  });
  assert.deepEqual(deriveGroundPilePresentation([], {
    coins: { pp: 0, gp: -2, sp: "3", cp: Number.NaN }
  }), {
    name: "Серебряная монета",
    img: "icons/commodities/currency/coins-assorted-mix-silver.webp",
    categoryKey: "coins"
  });
  assert.deepEqual(deriveGroundPilePresentation([], { preserveEmptyCoinPile: true }), {
    name: "Куча монет (пусто)",
    img: `modules/${MODULE_ID}/assets/storage/piles/coins.png`,
    categoryKey: "coins"
  });
});

test("rows with coins preserve treasure and existing ordinary row presentation rules", () => {
  assert.deepEqual(deriveGroundPilePresentation([
    { name: "Рубин", img: "icons/ruby.webp", typeLabel: "Сокровища", quantity: 1 }
  ], { coins: { gp: 3 } }), {
    name: "Рубин",
    img: "icons/ruby.webp",
    categoryKey: "single"
  });
  assert.deepEqual(deriveGroundPilePresentation([
    { name: "Меч", img: "icons/sword.webp", typeLabel: "Оружие", quantity: 1 }
  ], { coins: { gp: 3 } }), {
    name: "Меч",
    img: "icons/sword.webp",
    categoryKey: "single"
  });
  assert.deepEqual(deriveGroundPilePresentation([
    { name: "Меч", typeLabel: "Оружие", quantity: 1 },
    { name: "Топор", typeLabel: "Оружие", quantity: 1 }
  ], { coins: { gp: 3 } }), {
    name: "Куча оружия",
    img: `modules/${MODULE_ID}/assets/storage/piles/weapons.png`,
    categoryKey: "weapons"
  });
  assert.deepEqual(deriveGroundPilePresentation([
    { name: "Меч", typeLabel: "Оружие", quantity: 1 },
    { name: "Зелье", typeLabel: "Зелье", quantity: 1 }
  ], { coins: { gp: 3 } }), {
    name: "Куча предметов",
    img: `modules/${MODULE_ID}/assets/storage/piles/mixed-items.png`,
    categoryKey: "mixed-items"
  });
});

test("unknown category labels safely use the mixed pile presentation", () => {
  const result = deriveGroundPilePresentation([
    { name: "Первый", typeLabel: "Неизвестное", quantity: 1 },
    { name: "Второй", typeLabel: "Неизвестное", quantity: 1 }
  ]);
  assert.equal(result.name, "Куча предметов");
  assert.equal(result.categoryKey, "mixed-items");
  assert.ok(STORAGE_PILE_PRESENTATIONS.length >= 14);
});

test("ground pile marker is owned by Rebreya token flags", () => {
  assert.equal(isGroundPileToken({
    flags: { [MODULE_ID]: { groundPile: { enabled: true } } }
  }), true);
  assert.equal(isGroundPileToken({ flags: {} }), false);
});

test("every storage pile category points to a bundled PNG token", () => {
  for (const presentation of STORAGE_PILE_PRESENTATIONS) {
    const relativePath = presentation.img.replace(`modules/${MODULE_ID}/`, "../");
    const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url));
    assert.equal(existsSync(absolutePath), true, `${presentation.key}: ${absolutePath}`);
    assert.match(absolutePath, /\.png$/u);
  }
});
