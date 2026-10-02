import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getLootgenThemeProfile, createLootgenThemeContext } from "../scripts/data/lootgen-thematic-selection.js";
import { MAGIC_ITEMS } from "../magicItem.js";

const gear = JSON.parse(await readFile(new URL("../data/gear.json", import.meta.url), "utf8"));
const candidate = id => {
  const row = gear.find(row => row.id === id);
  assert.ok(row, `Missing real gear fixture: ${id}`);
  return { ...row, sourceType: "gear", sourceId: id };
};

test("themes prefer related equipment without excluding another theme", () => {
  const context = createLootgenThemeContext([candidate("ryukzak")]);
  const related = context.weight(candidate("spal-nik"));
  const other = context.weight(candidate("dvuruchnyy-mech"));
  assert.ok(related > other && other > 0);
});

test("repeated roles remain available with a lower positive weight", () => {
  const row = candidate("bakler");
  const context = createLootgenThemeContext([], { initialTheme: "combat" });
  const original = context.weight(row);
  for (let index = 0; index < 5; index++) context.accept(row);
  assert.ok(context.weight(row) > 0);
  assert.ok(context.weight(row) < original);
  const reagent = { sourceType: "material", name: "Алхимический реагент", lootTheme: { themes: ["alchemy"], role: "reagent" } };
  const alchemy = createLootgenThemeContext();
  for (let index = 0; index < 3; index++) alchemy.accept(reagent);
  assert.ok(alchemy.weight(reagent) > 0);
});

test("real catalog exceptions use structural armor, camping and tool semantics", () => {
  for (const [id, theme, role] of [
    ["bakler", "combat", "shield"], ["spal-nik", "camping", "sleep"],
    ["kolchan", "hunting", "quiver"], ["lampa", "camping", "light"],
    ["instrumenty-alkhimicheskie-0-y-rang", "alchemy", "tool"],
    ["derevyannyy-posokh-fokusirovka-druidov", "arcane", "focus"],
    ["akvamarin", "valuables", "treasure"], ["benzin-1-gallon", "technology", "fuel"],
    ["boevaya-bronya-shef-povara", "combat", "armor"]
  ]) {
    const info = getLootgenThemeProfile(candidate(id));
    assert.equal(info.themes[0], theme, id);
    assert.equal(info.role, role, id);
  }
});

test("one-handed catalog ranged weapons do not invent a two-handed restriction", () => {
  assert.equal(getLootgenThemeProfile(candidate("arbalet-ruchnoy")).twoHanded, false);
  assert.equal(getLootgenThemeProfile(candidate("dvuruchnyy-mech")).twoHanded, true);
});

test("catalog ammunition follows authored compatibility, including universal physical ammunition", () => {
  const rifle = createLootgenThemeContext([candidate("vintovka")]);
  assert.ok(rifle.weight(candidate("vintovochnyy-patron-10")) > 0);
  assert.ok(rifle.weight(candidate("adamantovaya-pulya-10")) > 0);
  for (const id of ["broneboynyy-10", "strely-20"]) {
    assert.ok(rifle.weight(candidate(id)) > 0);
    assert.ok(rifle.weight(candidate(id)) < rifle.weight(candidate("vintovochnyy-patron-10")));
  }
});

test("every selectable authored gear category has an internal theme", () => {
  const missing = gear.filter(row => row.equipmentType !== "Усовершенствование")
    .filter(row => !getLootgenThemeProfile({ ...row, sourceType: "gear" }).themes.length);
  assert.deepEqual(missing.map(row => row.id), []);
});

test("magic subtypes preserve arrows, casting staves and renamed legacy armor identities", () => {
  const magic = id => ({ ...MAGIC_ITEMS.find(item => item.id === id), sourceType: "magicItem", sourceId: id });
  assert.equal(getLootgenThemeProfile(magic("стрела-убийства")).role, "ammunition");
  assert.deepEqual(getLootgenThemeProfile(magic("стрела-убийства")).ammoFamilies, ["arrow"]);
  assert.equal(getLootgenThemeProfile({ ...magic("посох-магов"), weapon: { properties: [] } }).themes[0], "arcane");
  assert.equal(getLootgenThemeProfile(magic("адамантитовый-щит")).role, "armor", "the legacy ID does not turn renamed body armor into a shield");
});

test("manual armor and ranged weapon choose the weapon theme regardless of row order", () => {
  const armor = { name: "Кольчуга", equipmentType: "Доспех" };
  const bow = { name: "Длинный лук", equipmentType: "Оружие", weapon: { properties: ["two"] } };
  for (const seed of [[armor, bow], [bow, armor]]) {
    const context = createLootgenThemeContext(seed);
    assert.ok(context.weight(candidate("strely-20")) > 0);
    assert.ok(context.weight(candidate("arbaletnye-bolty-20")) > 0);
    assert.ok(context.weight(candidate("arbaletnye-bolty-20")) < context.weight(candidate("strely-20")));
  }
});

test("unresolved ammunition cannot imply compatibility when selected before a weapon", () => {
  const context = createLootgenThemeContext([candidate("broneboynyy-10")]);
  assert.ok(context.weight(candidate("vintovka")) > 0);
  assert.ok(context.weight(candidate("vintovka")) < createLootgenThemeContext().weight(candidate("vintovka")));
});

test("protection names do not invent shields, including armor and the Defender sword", () => {
  assert.equal(getLootgenThemeProfile(candidate("zashchitnaya-rubashka")).role, "armor");
  assert.equal(getLootgenThemeProfile({ ...MAGIC_ITEMS.find(item => item.id === "защитник"), sourceType: "magicItem" }).role, "weapon");
  const ring = { name: "Кольцо защиты", sourceType: "magicItem", itemType: "Кольцо" };
  assert.notEqual(getLootgenThemeProfile(ring).role, "shield");
});

test("magic general ammunition and universal physical rounds remain compatible with bows", () => {
  for (const seed of [candidate("adamantovaya-pulya-10"),
    { ...MAGIC_ITEMS.find(item => item.id === "опрокидывающий-боеприпас"), sourceType: "magicItem" },
    { ...MAGIC_ITEMS.find(item => item.id === "боеприпас-1"), sourceType: "magicItem" }]) {
    assert.equal(getLootgenThemeProfile(seed).role, "ammunition");
    assert.ok(createLootgenThemeContext([seed]).weight(candidate("dlinnyy-luk")) > 0);
  }
});

test("laser rifle prefers compatible thermal batteries over energy batteries", () => {
  const context = createLootgenThemeContext([candidate("lazernaya-vintovka")]);
  assert.ok(context.weight(candidate("teplovaya-batareya-20")) > 0);
  assert.ok(context.weight(candidate("batareya-4")) > 0);
  assert.ok(context.weight(candidate("batareya-4")) < context.weight(candidate("teplovaya-batareya-20")));
});

test("magic projection retains explicit two-handed swords without restricting versatile casting staves", () => {
  const sword = { ...MAGIC_ITEMS.find(item => item.id === "двуручный-серебряный-меч"), sourceType: "magicItem", weapon: { properties: ["mgc"] } };
  assert.equal(getLootgenThemeProfile(sword).twoHanded, true);
  const shieldWeight = createLootgenThemeContext([sword]).weight(candidate("bakler"));
  assert.ok(shieldWeight > 0);
  assert.ok(shieldWeight < createLootgenThemeContext([], { initialTheme: "combat" }).weight(candidate("bakler")));
  const staff = { ...MAGIC_ITEMS.find(item => item.id === "солнечный-посох"), sourceType: "magicItem", weapon: { properties: ["mgc"], baseItem: "quarterstaff" } };
  assert.equal(getLootgenThemeProfile(staff).role, "focus");
});

test("Journal references cannot masquerade as physical thematic anchors through their title", () => {
  const context = createLootgenThemeContext([{ rowKind: "journal", name: "История меча" }]);
  assert.ok(context.weight(candidate("ryukzak")) > 0);
});

test("native renamed armor keeps its structural role even when its title mentions a sword", () => {
  const info = getLootgenThemeProfile({ name: "Кольчуга «Меч»", itemData: {
    name: "Кольчуга «Меч»", type: "equipment", system: { type: { value: "heavy" } }
  } });
  assert.equal(info.role, "armor");
});
