import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setManagedIconProjection, syncManagedDocuments } from "../scripts/data/managed-compendium-sync.js";

const pack = { collection: "world.rebreya-feats", documentClass: { createDocuments: async () => {} } };
const key = "world.rebreya-feats\0feat1";
afterEach(() => setManagedIconProjection(null));

function fixture({ img = "storage/rebreya-main/feat1-v1.webp", signature = "sig", nextSignature = "sig", existing = true } = {}) {
  const writes = [];
  const creates = [];
  const document = {
    id: "feat1", img, type: "feat",
    getFlag(_scope, name) { return name === "signature" ? signature : "feat1"; },
    toObject() { return { _id: this.id, img: this.img, system: { uses: 1 } }; },
    async update(data) { writes.push(data); this.img = data.img; }
  };
  const options = {
    pack: { ...pack, documentClass: { createDocuments: async (data) => { creates.push(...data); } } },
    entries: [{ id: "feat1", signature: nextSignature }],
    documents: existing ? [document] : [],
    sourceIdOfEntry: (entry) => entry.id,
    sourceIdOfDocument: () => "feat1",
    signatureOfEntry: (entry) => JSON.stringify([entry.signature, "old-feat.webp"]),
    signatureOfDocument: (doc) => JSON.stringify([doc.getFlag("rebreya-main", "signature"), doc.img]),
    documentIdOfEntry: (entry) => entry.id,
    documentMatchesEntry: (doc) => doc.toObject().img === "old-feat.webp",
    createData: () => ({ _id: "feat1", img: "old-feat.webp", system: { uses: 2 } }),
    updateData: () => ({ img: "old-feat.webp", system: { uses: 2 } })
  };
  return { options, document, writes, creates };
}

test("existing composed icon is unchanged on a second managed sync", async () => {
  setManagedIconProjection(new Map([[key, { path: "storage/rebreya-main/feat1-v1.webp", baselineImg: "old-feat.webp" }]]));
  const f = fixture();
  const result = await syncManagedDocuments(f.options);
  assert.equal(result.unchanged, 1);
  assert.equal(f.writes.length, 0);
});

test("new badge path updates only the projected image when source signature is stable", async () => {
  setManagedIconProjection(new Map([[key, { path: "storage/rebreya-main/feat1-v2.webp", baselineImg: "old-feat.webp" }]]));
  const f = fixture();
  const result = await syncManagedDocuments(f.options);
  assert.equal(result.updated, 1);
  assert.equal(f.writes[0].img, "storage/rebreya-main/feat1-v2.webp");
  assert.equal(f.document.id, "feat1");
});

test("mechanics update keeps projected image", async () => {
  setManagedIconProjection(new Map([[key, { path: "storage/rebreya-main/feat1-v1.webp", baselineImg: "old-feat.webp" }]]));
  const f = fixture({ nextSignature: "new-mechanics" });
  await syncManagedDocuments(f.options);
  assert.equal(f.writes[0].img, "storage/rebreya-main/feat1-v1.webp");
  assert.deepEqual(f.writes[0].system, { uses: 2 });
});

test("created managed document receives the projected image", async () => {
  setManagedIconProjection(new Map([[key, { path: "storage/rebreya-main/feat1-v1.webp", baselineImg: "old-feat.webp" }]]));
  const f = fixture({ existing: false });
  await syncManagedDocuments(f.options);
  assert.equal(f.creates[0]._id, "feat1");
  assert.equal(f.creates[0].img, "storage/rebreya-main/feat1-v1.webp");
});
