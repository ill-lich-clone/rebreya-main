import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeDescriptionHtml,
  canonicalizeDescriptionMarkdown,
  renderDescriptionMarkdown,
  verifyDescriptionTextPreserved
} from "../scripts/data/markdown-description.js";

test("description markdown renders the supported structural blocks", () => {
  const markdown = [
    "## Конструкт",
    "",
    "*3-й уровень, умение конструктора*",
    "",
    "**Природа конструкта.** Текст.",
    "",
    "- Первый вариант",
    "  - Вложенный вариант",
    "",
    "> Сл = 8 + БМ + Интеллект",
    "",
    "| КД | Хиты |",
    "| --- | --- |",
    "| 13 | 5 + пять ваших уровней |"
  ].join("\n");

  const html = renderDescriptionMarkdown(markdown);
  assert.match(html, /<h2>Конструкт<\/h2>/u);
  assert.match(html, /<em>3-й уровень, умение конструктора<\/em>/u);
  assert.match(html, /<strong>Природа конструкта\.<\/strong>/u);
  assert.match(html, /<ul>[\s\S]*<ul>/u);
  assert.match(html, /<blockquote>/u);
  assert.match(html, /<table>[\s\S]*<thead>[\s\S]*<tbody>/u);
});

test("raw html is escaped and Foundry UUID labels retain visible text", () => {
  const markdown = "<script>alert(1)</script> @UUID[Compendium.dnd5e.items.Item.abc]{Щит [Shield]}";
  const html = renderDescriptionMarkdown(markdown);
  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /@UUID\[Compendium\.dnd5e\.items\.Item\.abc\]\{Щит \[Shield\]\}/u);
});

test("markdown and rendered html have identical canonical visible text", () => {
  const markdown = "### Единая система\n\n**Эффект.** Исходный текст автора.";
  const html = renderDescriptionMarkdown(markdown);
  assert.equal(canonicalizeDescriptionMarkdown(markdown), canonicalizeDescriptionHtml(html));
  assert.doesNotThrow(() => verifyDescriptionTextPreserved(markdown, html));
});

test("ordered lists and inline line breaks preserve visible author text", () => {
  const markdown = [
    "1. Первый вариант",
    "2. Второй вариант  ",
    "   с продолжением"
  ].join("\n");

  const html = renderDescriptionMarkdown(markdown);
  assert.match(html, /<ol>/u);
  assert.match(html, /Второй вариант<br>с продолжением/u);
  assert.doesNotThrow(() => verifyDescriptionTextPreserved(markdown, html));
});

test("visible text verification rejects a shortened rendering", () => {
  assert.throws(
    () => verifyDescriptionTextPreserved("Полный исходный текст", "<p>Исходный текст</p>"),
    /Description renderer changed visible text/u
  );
});

test("inline formatting does not add spaces before adjacent punctuation", () => {
  const markdown = "**Заклинание предка**. 14*\\-й уровень, умение ремесленника*";
  const html = renderDescriptionMarkdown(markdown);

  assert.match(html, /<strong>Заклинание предка<\/strong>\./u);
  assert.match(html, /14<em>-й уровень, умение ремесленника<\/em>/u);
  assert.doesNotThrow(() => verifyDescriptionTextPreserved(markdown, html));
});

test("safe markdown links render their labels without exposing markup syntax", () => {
  const markdown = "[щит \\[shield\\]](https://example.com/shield) и [опасная ссылка](javascript:alert(1))";
  const html = renderDescriptionMarkdown(markdown);

  assert.match(html, /<a href="https:\/\/example\.com\/shield">щит \[shield\]<\/a>/u);
  assert.doesNotMatch(html, /href="javascript:/u);
  assert.match(html, /\[опасная ссылка\]\(javascript:alert\(1\)\)/u);
  assert.doesNotThrow(() => verifyDescriptionTextPreserved(markdown, html));
});

test("escaped pipes remain visible inside markdown table cells", () => {
  const markdown = "| к4 | Эффект |\n| --- | --- |\n| 1 | Огонь \\| лёд |";
  const html = renderDescriptionMarkdown(markdown);

  assert.match(html, /<td>Огонь \| лёд<\/td>/u);
  assert.doesNotThrow(() => verifyDescriptionTextPreserved(markdown, html));
});

test("single source newlines remain explicit line breaks", () => {
  const markdown = "Первое свойство.\nВторое свойство.\nТретье свойство.";
  const html = renderDescriptionMarkdown(markdown, { preserveSingleNewlines: true });

  assert.equal(html, "<p>Первое свойство.<br>Второе свойство.<br>Третье свойство.</p>");
  assert.doesNotThrow(() => verifyDescriptionTextPreserved(markdown, html));
});

test("default markdown rendering folds technical source hard wraps", () => {
  const markdown = "Строка из PDF продолжается,\nна следующей технической строке.";

  assert.equal(
    renderDescriptionMarkdown(markdown),
    "<p>Строка из PDF продолжается, на следующей технической строке.</p>"
  );
});
