/**
 * Site article record → Foundry JournalEntry data (integration ТЗ §7.10).
 *
 * Pure functions — unit tested under node. One JournalEntry per article with a
 * single HTML text page; folder = the article's subsection name.
 */
import { toHtmlParagraphs } from "./site-spell-mapper.js";

const clean = (value) => String(value ?? "").trim();

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");

export const DEFAULT_ARTICLES_FOLDER = "Прочее";

/** Folder path inside the pack for an article, given the subsection lookup. */
export function articleFolderPath(record, subsectionNameById = new Map()) {
  const key = record?.section != null ? String(record.section) : "";
  return clean(subsectionNameById.get(key)) || DEFAULT_ARTICLES_FOLDER;
}

export function buildArticleHtml(record, { baseUrl = "https://rebreya.com" } = {}) {
  const parts = [];
  const body = clean(record.details) || clean(record.description);
  if (body) parts.push(toHtmlParagraphs(body));
  const links = [];
  if (record.slug) links.push(`<a href="${baseUrl}/dnd-5e/articles/${record.slug}">Открыть на rebreya.com</a>`);
  const source = clean(record.sourceUrl);
  if (source) links.push(`<a href="${escapeHtml(source)}">Первоисточник</a>`);
  if (links.length) parts.push(`<p><em>${links.join(" · ")}</em></p>`);
  return parts.join("");
}

/**
 * Full mapping: article record → JournalEntry creation data (folder id is
 * injected by the service).
 */
export function buildArticleJournalData(record, { moduleId = "rebreya-main", baseUrl = "https://rebreya.com" } = {}) {
  const name = clean(record.name) || `Статья #${record.id}`;
  return {
    name,
    pages: [
      {
        name,
        type: "text",
        title: { show: false },
        text: { format: 1, content: buildArticleHtml(record, { baseUrl }) },
      },
    ],
    flags: {
      [moduleId]: {
        managed: true,
        sourceType: "site-api",
        site: {
          baseUrl,
          entity: "articles",
          id: Number(record.id),
          slug: clean(record.slug),
          updatedAt: clean(record.updated_at),
          contentHash: clean(record.content_hash),
        },
      },
    },
  };
}
