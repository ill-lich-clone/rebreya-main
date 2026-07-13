import test from "node:test";
import assert from "node:assert/strict";

import {
  syncFlaggedManagedDocuments,
  syncManagedDocuments,
  syncManagedDocumentsOnActiveGm
} from "../scripts/data/managed-compendium-sync.js";

function createFixture(documents = []) {
  const operations = [];
  const documentClass = {
    async createDocuments(data, options) {
      operations.push(["create", data.map((entry) => entry.sourceId), options.pack]);
      return data;
    },
    async deleteDocuments(ids, options) {
      operations.push(["delete", [...ids], options.pack]);
      return ids;
    }
  };
  for (const document of documents) {
    document.update = async (patch) => {
      operations.push(["update", document.id, patch.signature]);
      return document;
    };
  }
  return {
    operations,
    pack: {
      collection: "world.test-pack",
      documentClass
    }
  };
}

function options(fixture, entries, documents) {
  return {
    pack: fixture.pack,
    entries,
    documents,
    sourceIdOfEntry: (entry) => entry.sourceId,
    sourceIdOfDocument: (document) => document.managed ? document.sourceId : "",
    signatureOfEntry: (entry) => entry.signature,
    signatureOfDocument: (document) => document.signature,
    createData: (entry) => ({ sourceId: entry.sourceId, signature: entry.signature }),
    updateData: (_document, entry) => ({ signature: entry.signature })
  };
}

test("managed compendium sync leaves unchanged and unmanaged documents untouched", async () => {
  const documents = [
    { id: "same", sourceId: "same", signature: "v1", managed: true },
    { id: "manual", sourceId: "manual", signature: "manual", managed: false }
  ];
  const fixture = createFixture(documents);

  const result = await syncManagedDocuments(options(fixture, [
    { sourceId: "same", signature: "v1" }
  ], documents));

  assert.deepEqual(result, { unchanged: 1, created: 0, updated: 0, deleted: 0 });
  assert.deepEqual(fixture.operations, []);
});

test("managed compendium sync creates, updates, then deletes in dependency-safe order", async () => {
  const documents = [
    { id: "changed-doc", sourceId: "changed", signature: "v1", managed: true },
    { id: "obsolete-doc", sourceId: "obsolete", signature: "v1", managed: true },
    { id: "manual", sourceId: "manual", signature: "manual", managed: false }
  ];
  const fixture = createFixture(documents);
  const prepared = [];

  const result = await syncManagedDocuments({
    ...options(fixture, [
      { sourceId: "changed", signature: "v2" },
      { sourceId: "new", signature: "v1" }
    ], documents),
    async prepareFolders(entries) {
      prepared.push(entries.map((entry) => entry.sourceId));
    }
  });

  assert.deepEqual(prepared, [["changed", "new"]]);
  assert.deepEqual(fixture.operations, [
    ["create", ["new"], "world.test-pack"],
    ["update", "changed-doc", "v2"],
    ["delete", ["obsolete-doc"], "world.test-pack"]
  ]);
  assert.deepEqual(result, { unchanged: 0, created: 1, updated: 1, deleted: 1 });
});

test("managed compendium sync prefers the stable document id and removes only legacy duplicates", async () => {
  const documents = [
    { id: "legacy-random-id", sourceId: "feature", signature: "v2", managed: true },
    { id: "stable-feature-id", sourceId: "feature", signature: "v2", managed: true }
  ];
  const fixture = createFixture(documents);

  const result = await syncManagedDocuments({
    ...options(fixture, [
      { sourceId: "feature", documentId: "stable-feature-id", signature: "v2" }
    ], documents),
    documentIdOfEntry: (entry) => entry.documentId
  });

  assert.deepEqual(fixture.operations, [
    ["delete", ["legacy-random-id"], "world.test-pack"]
  ]);
  assert.deepEqual(result, { unchanged: 1, created: 0, updated: 0, deleted: 1 });
});

test("managed compendium sync recreates a legacy random id before deleting it", async () => {
  const documents = [
    { id: "legacy-random-id", sourceId: "feature", signature: "v2", managed: true }
  ];
  const fixture = createFixture(documents);

  const result = await syncManagedDocuments({
    ...options(fixture, [
      { sourceId: "feature", documentId: "stable-feature-id", signature: "v2" }
    ], documents),
    documentIdOfEntry: (entry) => entry.documentId,
    createData: (entry) => ({
      sourceId: entry.sourceId,
      documentId: entry.documentId,
      signature: entry.signature
    })
  });

  assert.deepEqual(fixture.operations, [
    ["create", ["feature"], "world.test-pack"],
    ["delete", ["legacy-random-id"], "world.test-pack"]
  ]);
  assert.deepEqual(result, { unchanged: 0, created: 1, updated: 0, deleted: 1 });
});

test("flagged managed sync updates changed documents in place without forwarding create ids", async () => {
  const operations = [];
  const document = {
    id: "stable-feature-id",
    getFlag(scope, key) {
      if (scope !== "rebreya-main") return undefined;
      if (key === "managed") return true;
      if (key === "featureId") return "feature";
      if (key === "signature") return "v1";
      return undefined;
    },
    async update(patch) {
      operations.push(["update", patch]);
    }
  };
  const pack = {
    collection: "world.features",
    documentClass: {
      async createDocuments(data) {
        operations.push(["create", data]);
      },
      async deleteDocuments(ids) {
        operations.push(["delete", ids]);
      }
    }
  };

  const result = await syncFlaggedManagedDocuments({
    pack,
    entries: [{ featureId: "feature", documentId: "stable-feature-id", signature: "v2" }],
    documents: [document],
    moduleId: "rebreya-main",
    sourceIdFlag: "featureId",
    buildData: (entry) => ({
      _id: entry.documentId,
      name: "Updated feature",
      flags: { "rebreya-main": { signature: entry.signature } }
    })
  });

  assert.deepEqual(operations, [["update", {
    name: "Updated feature",
    flags: { "rebreya-main": { signature: "v2" } }
  }]]);
  assert.deepEqual(result, { unchanged: 0, created: 0, updated: 1, deleted: 0 });
});

test("active-GM compendium guard skips the second GM client", async () => {
  const gm1 = { id: "gm-1", isGM: true, active: true };
  const gm2 = { id: "gm-2", isGM: true, active: true };
  const users = new Map([[gm1.id, gm1], [gm2.id, gm2]]);
  users.contents = [gm1, gm2];
  users.activeGM = gm1;
  const fixture = createFixture([]);
  const syncOptions = options(fixture, [{ sourceId: "new", signature: "v1" }], []);

  assert.deepEqual(await syncManagedDocumentsOnActiveGm({ user: gm2, users }, syncOptions), {
    skipped: true,
    unchanged: 0,
    created: 0,
    updated: 0,
    deleted: 0
  });
  assert.equal((await syncManagedDocumentsOnActiveGm({ user: gm1, users }, syncOptions)).created, 1);
  assert.equal(fixture.operations.length, 1);
});
