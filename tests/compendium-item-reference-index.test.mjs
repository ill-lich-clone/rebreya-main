import test from "node:test";
import assert from "node:assert/strict";

import { createStableGearDocumentId } from "../scripts/data/gear-document-ids.js";
import { buildCompendiumItemReferenceIndex } from "../scripts/data/compendium-item-reference-index.js";
import { linkFeatDescriptionHtml } from "../scripts/data/feat-reference-linker.js";

const MODULE_ID = "rebreya-main";

function fakeDocument({
  id,
  name,
  featId = "",
  actionId = "",
  glossaryTermId = "",
  aliases = [],
  managed = true
}) {
  return {
    id,
    name,
    flags: {
      [MODULE_ID]: {
        managed,
        featId,
        actionId,
        glossaryTermId,
        aliases
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

test("reference index keeps an existing feat document id and preallocates only missing ids", () => {
  const index = buildCompendiumItemReferenceIndex({
    feats: [fakeDocument({
      id: "ExistingFeat0001",
      featId: "marksman",
      name: "Меткий стрелок"
    })],
    desiredFeats: [
      { featId: "marksman", name: "Меткий стрелок" },
      { featId: "new-feat", name: "Новая черта" },
      { featId: "source-id", name: "Черта с ID", documentId: "SourceFeatId0001" }
    ],
    actions: [],
    glossary: []
  });

  assert.equal(index.documentIdByFeatId.get("marksman"), "ExistingFeat0001");
  assert.equal(
    index.documentIdByFeatId.get("new-feat"),
    createStableGearDocumentId("feat:new-feat")
  );
  assert.equal(index.documentIdByFeatId.get("source-id"), "SourceFeatId0001");
});

test("reference index accepts managed source identities and keeps cross-pack aliases ambiguous", () => {
  const index = buildCompendiumItemReferenceIndex({
    actions: [fakeDocument({
      id: "ActionDocument01",
      actionId: "aim",
      name: "Провоцированные атаки ⚡",
      aliases: ["Провоцированные атаки"]
    })],
    glossary: [
      fakeDocument({
        id: "GlossaryTerm0001",
        glossaryTermId: "term:aim",
        name: "Прицел",
        aliases: ["Общее имя"]
      }),
      fakeDocument({
        id: "GlossaryTerm0002",
        glossaryTermId: "term:other",
        name: "Иное",
        aliases: ["общее  имя"]
      }),
      fakeDocument({
        id: "UnmanagedTerm001",
        glossaryTermId: "term:ignored",
        name: "Игнорировать",
        managed: false
      })
    ],
    feats: [],
    desiredFeats: []
  });
  const linked = linkFeatDescriptionHtml(
    "<p>Провоцированные атаки, Прицел, Общее имя и Игнорировать.</p>",
    { matcher: index.matcher }
  );

  assert.match(linked.html, /Compendium\.world\.rebreya-actions\.Item\.ActionDocument01/u);
  assert.match(linked.html, /Compendium\.world\.rebreya-glossary\.Item\.GlossaryTerm0001/u);
  assert.doesNotMatch(linked.html, /UnmanagedTerm001/u);
  assert.deepEqual(linked.ambiguous, ["Общее имя"]);
});

test("reference index reports known action aliases whose managed target is missing", () => {
  const index = buildCompendiumItemReferenceIndex({
    actions: [],
    glossary: [],
    feats: [],
    desiredFeats: [],
    expectedActions: [{
      sourceId: "glossary-opportunity-attack",
      canonicalName: "Провоцированные атаки ⚡",
      aliases: ["Провоцированные атаки"],
      kind: "action"
    }]
  });

  const result = linkFeatDescriptionHtml("<p>Провоцированные атаки.</p>", {
    matcher: index.matcher
  });

  assert.deepEqual(result.unresolved, ["Провоцированные атаки"]);
  assert.equal(result.html, "<p>Провоцированные атаки.</p>");
});
