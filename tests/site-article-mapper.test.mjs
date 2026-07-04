import test from "node:test";
import assert from "node:assert/strict";

import {
  articleFolderPath,
  buildArticleHtml,
  buildArticleJournalData,
  DEFAULT_ARTICLES_FOLDER,
} from "../scripts/data/site-article-mapper.js";

const ARTICLE = {
  id: "142",
  name: "Эррата: Котёл Таши",
  slug: "errata-kotel-tashi",
  description: "Эррата к Котлу Таши в разделе D&D 5e.",
  details: "- Оригинальное имя: Errata (TCE)\n- Категория: Правила\n\nВторой абзац.",
  sourceUrl: "https://5e14.ttg.club/rules/errata_(tce)",
  section: "18",
  updated_at: "2026-06-01T22:19:54Z",
  content_hash: "sha256:aaa",
};

const SUBS = new Map([["18", "Правила игры"]]);

test("articleFolderPath resolves the subsection name, else default", () => {
  assert.equal(articleFolderPath(ARTICLE, SUBS), "Правила игры");
  assert.equal(articleFolderPath({ section: "999" }, SUBS), DEFAULT_ARTICLES_FOLDER);
  assert.equal(articleFolderPath({}, SUBS), DEFAULT_ARTICLES_FOLDER);
});

test("buildArticleHtml renders body paragraphs + both links", () => {
  const html = buildArticleHtml(ARTICLE);
  assert.match(html, /Оригинальное имя/);
  assert.match(html, /Второй абзац/);
  assert.match(html, /rebreya\.com\/dnd-5e\/articles\/errata-kotel-tashi/);
  assert.match(html, /5e14\.ttg\.club/);
});

test("buildArticleHtml falls back to description and survives empties", () => {
  const html = buildArticleHtml({ id: 1, description: "Короткое описание." });
  assert.match(html, /Короткое описание/);
  assert.equal(buildArticleHtml({}), "");
});

test("buildArticleJournalData produces a one-page HTML journal with identity flags", () => {
  const data = buildArticleJournalData(ARTICLE, { moduleId: "rebreya-main" });
  assert.equal(data.name, "Эррата: Котёл Таши");
  assert.equal(data.pages.length, 1);
  assert.equal(data.pages[0].type, "text");
  assert.equal(data.pages[0].text.format, 1);
  assert.match(data.pages[0].text.content, /Оригинальное имя/);
  const site = data.flags["rebreya-main"].site;
  assert.equal(site.entity, "articles");
  assert.equal(site.id, 142); // string id normalized to number
  assert.equal(site.contentHash, "sha256:aaa");
  assert.equal(data.flags["rebreya-main"].managed, true);
});

test("nameless article degrades to a stable placeholder", () => {
  const data = buildArticleJournalData({ id: 5 }, {});
  assert.equal(data.name, "Статья #5");
});
