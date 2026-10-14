import test from "node:test";
import assert from "node:assert/strict";
import { resolveItemSource, canViewItem } from "../scripts/infrastructure/foundry/item-source-resolver.js";

const MODULE_ID = "rebreya-main";
function item(id, { name = "Предмет", type = "loot", flags = {}, allowed = true, parent = null } = {}) {
  return { id, uuid: `Item.${id}`, documentName: "Item", name, type, flags, parent,
    testUserPermission(user, permission) { assert.equal(permission, "OBSERVER"); return Boolean(user) && allowed; },
    toObject() { return structuredClone({ _id: id, name, type, flags }); },
    sheet: { render() { assert.fail("resolver must not render a sheet"); } }
  };
}
function pack(id, documents, { visible = true, documentName = "Item", failIndex = false, failDocument = false } = {}) {
  const calls = { index: 0, documents: 0 };
  for (const document of documents) { document.pack = id; document.uuid = `Compendium.${id}.Item.${document.id}`; }
  return { collection: id, visible, documentName, calls,
    async getIndex({ fields }) {
      calls.index++;
      assert.ok(fields.includes(`flags.${MODULE_ID}`));
      if (failIndex) throw new Error("index unavailable");
      return new Map(documents.map(document => [document.id, { _id: document.id, name: document.name, type: document.type, flags: structuredClone(document.flags) }]));
    },
    async getDocument(id) { calls.documents++; if (failDocument) throw new Error("document unavailable"); return documents.find(document => document.id === id); },
    getDocuments() { assert.fail("must use indexes, not load every document"); },
    documents
  };
}
function environment(packs = [], items = []) {
  const byUuid = new Map([...items, ...packs.flatMap(entry => entry.documents)].map(document => [document.uuid, document]));
  const calls = [];
  return { game: { user: { id: "viewer" }, packs: new Map(packs.map(entry => [entry.collection, entry])), items: new Map(items.map(document => [document.id, document])) }, calls,
    async fromUuid(uuid) { calls.push(uuid); return byUuid.get(uuid); }
  };
}

test("legacy typed identity beats snapshot native id without a catalog registry", async () => {
  for (const sourceType of ["alchemyProduct", "material", "gear", "futureProduct"]) {
    const sourceId = `${sourceType}-7`;
    const original = item("source", { name: "Original", flags: { [MODULE_ID]: { [`${sourceType}Id`]: sourceId } } });
    const inventoryItem = item("embedded-id", { name: "Renamed", flags: { [MODULE_ID]: { sourceType, [`${sourceType}Id`]: sourceId } } });
    const env = environment([pack("world.products", [original])]);
    assert.equal(await resolveItemSource(inventoryItem, { sourceType: sourceType.toLowerCase(), sourceId: "embedded-id" }, env), original);
  }
});

test("stable identity beats matching name and world identity beats a weaker pack name", async () => {
  const original = item("original", { name: "Original", flags: { [MODULE_ID]: { sourceType: "newKind", sourceId: "stable" } } });
  const decoy = item("decoy");
  const env = environment([pack("thirdparty.items", [decoy])], [original]);
  assert.equal(await resolveItemSource(item("copy", { flags: { [MODULE_ID]: { sourceType: "newKind", sourceId: "stable" } } }), {}, env), original);
});

test("explicit UUID wins same-name decoy, rename and unrelated index failure", async () => {
  const original = item("original", { name: "Old name" });
  const entries = pack("world.items", [item("decoy")], { failIndex: true });
  const env = environment([entries], [original]);
  const copy = item("copy", { name: "Renamed", flags: { [MODULE_ID]: { itemSourceUuid: original.uuid } } });
  assert.equal(await resolveItemSource(copy, {}, env), original);
  assert.equal(entries.calls.index, 0);
});

test("compendium provenance resolves a real Item before scanning indexes", async () => {
  const original = item("original");
  const entries = pack("thirdparty.items", [original]);
  const env = environment([entries]);
  assert.equal(await resolveItemSource(item("copy", { flags: { core: { sourceId: original.uuid } } }), {}, env), original);
  assert.equal(entries.calls.index, 0);
});

test("unique exact name prefers pack then world across native types", async () => {
  const original = item("world-weapon", { name: "Мой меч", type: "weapon" });
  const copy = item("manual", { name: "  МОЙ   МЕЧ  ", flags: { [MODULE_ID]: { sourceType: "manual" } } });
  const before = copy.toObject();
  assert.equal(await resolveItemSource(copy, {}, environment([], [original])), original);
  assert.deepEqual(copy.toObject(), before);
  const packed = item("packed", { name: "Мой меч", type: "weapon" });
  assert.equal(await resolveItemSource(copy, {}, environment([pack("thirdparty.weapons", [packed])], [original])), packed);
  assert.equal(await resolveItemSource(item("partial", { name: "меч" }), {}, environment([], [original])), null);
});

test("ambiguous strongest name tier never picks first or weaker world target", async () => {
  const world = item("world");
  const first = pack("one.items", [item("one")]);
  const second = pack("two.items", [item("two")]);
  assert.equal(await resolveItemSource(item("copy"), {}, environment([first, second], [world])), null);
  assert.equal(await resolveItemSource(item("copy"), {}, environment([pack("one.items", [item("a"), item("b")])], [world])), null);
  assert.equal(await resolveItemSource(item("copy"), {}, environment([], [item("a"), item("b")])), null);
});

test("ambiguous identity blocks weaker exact-name resolution", async () => {
  const flags = { [MODULE_ID]: { sourceType: "future", sourceId: "same" } };
  const a = item("a", { name: "a", flags });
  const b = item("b", { name: "b", flags });
  assert.equal(await resolveItemSource(item("copy", { flags }), {}, environment([pack("world.items", [a, b])], [item("world")])), null);
});

test("incomplete pack index or candidate read cannot prove uniqueness", async () => {
  for (const failure of [{ failIndex: true }, { failDocument: true }]) {
    const good = pack("good.items", [item("good")]);
    const bad = pack("bad.items", [item("bad")], failure);
    assert.equal(await resolveItemSource(item("copy"), {}, environment([good, bad], [item("world")])), null);
  }
});

test("hidden and non-Item packs are not read even for explicit UUID hints", async () => {
  for (const options of [{ visible: false }, { documentName: "JournalEntry" }]) {
    const hidden = pack("private.items", [item("private")], options);
    const env = environment([hidden]);
    const copy = item("copy", { flags: { core: { sourceId: hidden.documents[0].uuid } } });
    assert.equal(await resolveItemSource(copy, {}, env), null);
    assert.deepEqual(env.calls, []);
    assert.equal(hidden.calls.index, 0);
    assert.equal(hidden.calls.documents, 0);
  }
});

test("inaccessible candidates are excluded and embedded fallback respects ownership", async () => {
  const forbidden = item("private", { allowed: false });
  const allowed = item("allowed");
  assert.equal(await resolveItemSource(item("copy"), {}, environment([], [forbidden, allowed])), allowed);
  const actor = { documentName: "Actor" };
  assert.equal(canViewItem(item("owned", { parent: actor }), environment()), true);
  assert.equal(canViewItem(item("forbidden", { parent: actor, allowed: false }), environment()), false);
});

test("stale UUID, cold empty index and missing source return a safe result", async () => {
  const env = environment([pack("empty.items", [])], [item("world")]);
  const copy = item("copy", { flags: { core: { sourceId: "Item.deleted" } } });
  assert.equal(await resolveItemSource(copy, {}, env), env.game.items.get("world"));
  assert.equal(await resolveItemSource(item("absent", { name: "Absent" }), {}, env), null);
});

test("external actor Item and non-Item documents cannot be opened as source", async () => {
  const world = item("world");
  const env = environment([], [world]);
  env.fromUuid = async () => ({ documentName: "Actor", name: "Предмет", testUserPermission: () => true });
  assert.equal(await resolveItemSource(item("copy", { flags: { core: { sourceId: "Item.wrong" } } }), {}, env), world);
  const noSource = environment();
  noSource.fromUuid = () => assert.fail("embedded UUID must not be resolved");
  assert.equal(await resolveItemSource(item("copy", { flags: { core: { sourceId: "Actor.hero.Item.copy" } } }), {}, noSource), null);
});

test("unrelated identifier flags never supply source identity", async () => {
  const flags = { [MODULE_ID]: { sourceType: "future", linkedGoodId: "other", containerId: "other" } };
  const original = item("other", { name: "Different name", flags });
  assert.equal(await resolveItemSource(item("copy", { flags }), {}, environment([pack("world.items", [original])])), null);
});
