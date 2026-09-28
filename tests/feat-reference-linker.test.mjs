import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFeatReferenceMatcher,
  linkFeatDescriptionHtml
} from "../scripts/data/feat-reference-linker.js";

test("linker links longest visible text and preserves the original Russian form", () => {
  const matcher = buildFeatReferenceMatcher([
    {
      uuid: "Compendium.world.rebreya-glossary.Item.prone00000000001",
      canonicalName: "Сбитый с ног",
      aliases: ["сбитого с ног"],
      kind: "term",
      sourceId: "prone"
    },
    {
      uuid: "Compendium.world.rebreya-feats.Item.feat000000000001",
      canonicalName: "Меткий стрелок",
      aliases: [],
      kind: "feat",
      sourceId: "marksman"
    }
  ]);
  const result = linkFeatDescriptionHtml(
    "<p>Цель становится сбитого с ног и получает Меткий стрелок.</p>",
    { matcher }
  );

  assert.match(
    result.html,
    /@UUID\[Compendium\.world\.rebreya-glossary\.Item\.prone00000000001\]\{сбитого с ног\}/u
  );
  assert.match(
    result.html,
    /@UUID\[Compendium\.world\.rebreya-feats\.Item\.feat000000000001\]\{Меткий стрелок\}/u
  );
  assert.equal(result.linked.length, 2);
});

test("linker skips tags anchors uuid tokens self links and ambiguous names", () => {
  const matcher = buildFeatReferenceMatcher([
    {
      uuid: "Compendium.world.rebreya-feats.Item.feat000000000001",
      canonicalName: "Меткий стрелок",
      aliases: [],
      kind: "feat",
      sourceId: "marksman"
    },
    {
      uuid: "Compendium.world.rebreya-glossary.Item.term000000000001",
      canonicalName: "Дубль",
      aliases: [],
      kind: "term",
      sourceId: "duplicate-a"
    },
    {
      uuid: "Compendium.world.rebreya-glossary.Item.term000000000002",
      canonicalName: "Дубль",
      aliases: [],
      kind: "term",
      sourceId: "duplicate-b"
    }
  ]);
  const html = '<p title="Меткий стрелок"><a>Меткий стрелок</a> @UUID[Compendium.x.Item.y]{Меткий стрелок} Меткий стрелок</p>';
  const result = linkFeatDescriptionHtml(html, {
    matcher,
    selfUuid: "Compendium.world.rebreya-feats.Item.feat000000000001"
  });

  assert.equal(result.html, html);
  assert.deepEqual(result.linked, []);
  const ambiguous = linkFeatDescriptionHtml("<p>Дубль</p>", { matcher });
  assert.equal(ambiguous.html, "<p>Дубль</p>");
  assert.deepEqual(ambiguous.ambiguous, ["Дубль"]);
});

test("linker prefers longest overlap and enforces unicode word boundaries", () => {
  const matcher = buildFeatReferenceMatcher([
    {
      uuid: "Compendium.world.rebreya-glossary.Item.openposition0001",
      canonicalName: "Открытая позиция",
      aliases: [],
      kind: "term",
      sourceId: "open-position"
    },
    {
      uuid: "Compendium.world.rebreya-glossary.Item.position00000001",
      canonicalName: "Позиция",
      aliases: [],
      kind: "term",
      sourceId: "position"
    },
    {
      uuid: "Compendium.world.rebreya-glossary.Item.hedgehog0000001",
      canonicalName: "Еж",
      aliases: [],
      kind: "term",
      sourceId: "hedgehog"
    }
  ]);
  const result = linkFeatDescriptionHtml(
    "<p>ОТКРЫТАЯ ПОЗИЦИЯ, позиция, предпозиция и Ёж.</p>",
    { matcher }
  );

  assert.match(result.html, /openposition0001\]\{ОТКРЫТАЯ ПОЗИЦИЯ\}/u);
  assert.match(result.html, /position00000001\]\{позиция\}/u);
  assert.match(result.html, /hedgehog0000001\]\{Ёж\}/u);
  assert.match(result.html, /предпозиция/u);
  assert.equal((result.html.match(/@UUID\[/gu) ?? []).length, 3);
});

test("duplicate aliases remain plain text and are reported once in display form", () => {
  const matcher = buildFeatReferenceMatcher([
    {
      uuid: "Compendium.world.rebreya-feats.Item.first00000000001",
      canonicalName: "Первая",
      aliases: ["Общий термин"],
      kind: "feat",
      sourceId: "first"
    },
    {
      uuid: "Compendium.world.rebreya-glossary.Item.second0000000001",
      canonicalName: "Вторая",
      aliases: ["общий  термин"],
      kind: "term",
      sourceId: "second"
    }
  ]);
  const result = linkFeatDescriptionHtml("<p>Общий термин и общий термин.</p>", { matcher });

  assert.equal(result.html, "<p>Общий термин и общий термин.</p>");
  assert.deepEqual(result.ambiguous, ["Общий термин"]);
});

test("malformed html passes through without partial linking", () => {
  const matcher = buildFeatReferenceMatcher([{
    uuid: "Compendium.world.rebreya-glossary.Item.term000000000001",
    canonicalName: "Термин",
    aliases: [],
    kind: "term",
    sourceId: "term"
  }]);
  const html = '<p title="Термин" Термин';

  assert.deepEqual(
    linkFeatDescriptionHtml(html, { matcher }),
    { html, linked: [], ambiguous: [], unresolved: [] }
  );
});

test("linker leaves known missing targets plain and reports them as unresolved", () => {
  const matcher = buildFeatReferenceMatcher([{
    uuid: "",
    canonicalName: "Провоцированные атаки ⚡",
    aliases: ["Провоцированные атаки"],
    kind: "action",
    sourceId: "glossary-opportunity-attack",
    unresolved: true
  }]);

  const result = linkFeatDescriptionHtml("<p>Провоцированные атаки.</p>", { matcher });

  assert.equal(result.html, "<p>Провоцированные атаки.</p>");
  assert.deepEqual(result.unresolved, ["Провоцированные атаки"]);
});

test("a resolved target wins over an unresolved alias regardless of input order", () => {
  const matcher = buildFeatReferenceMatcher([
    {
      uuid: "",
      canonicalName: "Общий термин",
      aliases: [],
      kind: "term",
      sourceId: "missing",
      unresolved: true
    },
    {
      uuid: "Compendium.world.rebreya-glossary.Item.ResolvedTerm0001",
      canonicalName: "Общий термин",
      aliases: [],
      kind: "term",
      sourceId: "resolved"
    }
  ]);

  const result = linkFeatDescriptionHtml("<p>Общий термин.</p>", { matcher });

  assert.match(result.html, /@UUID\[Compendium\.world\.rebreya-glossary\.Item\.ResolvedTerm0001\]/u);
  assert.deepEqual(result.unresolved, []);
});

test("linker is idempotent and links visible text inside table cells", () => {
  const matcher = buildFeatReferenceMatcher([{
    uuid: "Compendium.world.rebreya-glossary.Item.term000000000001",
    canonicalName: "Термин",
    aliases: [],
    kind: "term",
    sourceId: "term"
  }]);
  const first = linkFeatDescriptionHtml(
    "<table><tbody><tr><td>Термин</td></tr></tbody></table>",
    { matcher }
  );
  const second = linkFeatDescriptionHtml(first.html, { matcher });

  assert.match(first.html, /<td>@UUID\[Compendium\.world\.rebreya-glossary\.Item\.term000000000001\]\{Термин\}<\/td>/u);
  assert.equal(second.html, first.html);
  assert.deepEqual(second.linked, []);
});

test("linker preserves comments and raw-text element contents", () => {
  const matcher = buildFeatReferenceMatcher([{
    uuid: "Compendium.world.rebreya-feats.Item.TargetFeat000001",
    canonicalName: "Целевая черта",
    aliases: [],
    kind: "feat",
    sourceId: "target"
  }]);
  const html = [
    "<!-- Целевая черта -->",
    "<script>const label = 'Целевая черта';</script>",
    "<style>.Целевая черта { color: red; }</style>",
    "<textarea>Целевая черта</textarea>",
    "<p>Целевая черта</p>"
  ].join("");

  const result = linkFeatDescriptionHtml(html, { matcher });

  assert.equal((result.html.match(/@UUID\[/gu) ?? []).length, 1);
  assert.match(result.html, /^<!-- Целевая черта --><script>const label = 'Целевая черта';<\/script>/u);
  assert.match(result.html, /<style>\.Целевая черта \{ color: red; \}<\/style><textarea>Целевая черта<\/textarea>/u);
  assert.match(result.html, /<p>@UUID\[[^\]]+\]\{Целевая черта\}<\/p>$/u);
});
