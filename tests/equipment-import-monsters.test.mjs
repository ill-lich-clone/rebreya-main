import assert from "node:assert/strict";
import test from "node:test";
import { adaptMonstersCatalog } from "../tools/equipment-import/adapters/monsters.mjs";
import { SHEET_REGISTRY } from "../tools/equipment-import/sheet-registry.mjs";
import { diffEquipmentBundles, evaluateDestructiveGuards } from "../tools/equipment-import/diff.mjs";

const headers = [["Название", "Тип существа", "Ранг монстра", "Добыча!"],
  ["", "", "", "Уникальная", "Тип существа", "Общие", "Общие", "Общие", "Общие"]];
const tick = ["Гигантский клещ", "Монстр", "1", "Сердце", "Эссенция", "Хитин", "—", "Кровь чудовища"];
const adapt = (...rows) => adaptMonstersCatalog({ sheetId: 1267718446,
  sheetTitle: "Энциклопедия чудовищ V0", values: [...headers, ...rows] });

test("monster rows retain every loot column, exact rank and stable identity", () => {
  assert.equal(SHEET_REGISTRY.monsters.range, "A1:I1000");
  const epic = [tick[0], tick[1], "10"];
  const [first, second] = adapt(tick, epic);
  assert.deepEqual([first.unique, first.typeLoot, first.common, first.source.row],
    ["Сердце", "Эссенция", ["Хитин", "Кровь чудовища"], 3]);
  assert.equal(second.rank, 10);
  assert.notEqual(first.id, second.id);
  assert.equal(adapt(epic, tick)[1].id, first.id);
  assert.throws(() => adapt(tick, tick), /3.*4/);
  assert.throws(() => adapt([...tick.slice(0, 2), ""]), /rank/i);
});

test("monster catalog deletion trips the equipment guard", () => {
  const diff = diffEquipmentBundles({ currentBundle: { catalogs: { monsters: adapt(tick) } },
    nextBundle: { catalogs: { monsters: [] } } });
  assert.equal(diff.catalogs.monsters.removed.length, 1);
  assert.throws(() => evaluateDestructiveGuards({ diff }), /blocked/);
});
