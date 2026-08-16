const JOURNAL_UNAVAILABLE_ERROR = "Запись журнала недоступна.";
const DOCUMENT_LINK_CLASSES = new Set([
  "content-link",
  "document-link",
  "entity-link",
  "inline-roll",
  "inline-result",
  "rollable",
  "draggable",
  "drag-handler"
]);

function clean(value) {
  return String(value ?? "").trim();
}

function unavailable() {
  return new Error(JOURNAL_UNAVAILABLE_ERROR);
}

function journalPages(journal) {
  if (Array.isArray(journal?.pages?.contents)) return [...journal.pages.contents];
  if (typeof journal?.pages?.values === "function") return Array.from(journal.pages.values());
  return [];
}

function pageSort(page) {
  const value = Number(page?.sort);
  return Number.isFinite(value) ? value : 0;
}

export function createStorageJournalHtmlParser(documentProvider = () => globalThis.document) {
  if (typeof documentProvider !== "function") {
    throw new TypeError("Storage Journal HTML parser requires a document provider.");
  }
  return (html) => {
    const template = documentProvider()?.createElement?.("template");
    if (!template) throw new Error("HTML parser unavailable.");
    template.innerHTML = String(html);
    const fragment = template.content;
    if (typeof fragment?.querySelector !== "function" || typeof fragment?.querySelectorAll !== "function") {
      throw new Error("HTML parser unavailable.");
    }
    return {
      querySelector: (selector) => fragment.querySelector(selector),
      querySelectorAll: (selector) => fragment.querySelectorAll(selector),
      serialize() {
        const serialized = template.innerHTML;
        if (typeof serialized !== "string") throw new Error("HTML serializer unavailable.");
        return serialized;
      }
    };
  };
}

function sanitizeJournalHtml(fragment) {
  if (typeof fragment?.querySelector !== "function"
    || typeof fragment?.querySelectorAll !== "function"
    || typeof fragment?.serialize !== "function") {
    throw unavailable();
  }
  if (fragment.querySelector("section.secret:not(.revealed)")) throw unavailable();

  for (const element of Array.from(fragment.querySelectorAll("*"))) {
    if (typeof element?.removeAttribute !== "function"
      || typeof element?.getAttribute !== "function"
      || typeof element?.setAttribute !== "function") {
      throw unavailable();
    }
    for (const attribute of Array.from(element.attributes ?? [])) {
      const name = clean(attribute?.name).toLowerCase();
      if (name === "id"
        || name === "href"
        || name === "draggable"
        || name === "contenteditable"
        || name.startsWith("data-")
        || name.startsWith("on")) {
        element.removeAttribute(name);
      }
    }
    const classes = clean(element.getAttribute("class"))
      .split(/\s+/u)
      .filter((token) => token && !DOCUMENT_LINK_CLASSES.has(token.toLowerCase()));
    if (classes.length) element.setAttribute("class", classes.join(" "));
    else element.removeAttribute("class");
  }

  const serialized = fragment.serialize();
  if (typeof serialized !== "string") throw unavailable();
  return serialized;
}

export class StorageJournalReader {
  constructor({ fromUuid, enrichHtml, parseHtml } = {}) {
    if (typeof fromUuid !== "function" || typeof enrichHtml !== "function" || typeof parseHtml !== "function") {
      throw new TypeError("StorageJournalReader requires Journal resolution, HTML enrichment, and parsing.");
    }
    this.fromUuid = fromUuid;
    this.enrichHtml = enrichHtml;
    this.parseHtml = parseHtml;
  }

  async read(journalUuid) {
    try {
      const journal = await this.fromUuid(clean(journalUuid));
      if (journal?.documentName !== "JournalEntry") throw unavailable();

      const pages = journalPages(journal).sort((left, right) => (
        pageSort(left) - pageSort(right)
        || clean(left?.id).localeCompare(clean(right?.id))
      ));
      const pageSnapshots = [];
      for (const page of pages) {
        const type = clean(page?.type);
        const snapshot = {
          pageId: clean(page?.id),
          name: clean(page?.name),
          type,
          sort: pageSort(page),
          title: {
            show: page?.title?.show === true,
            level: Number.isFinite(Number(page?.title?.level)) ? Number(page.title.level) : 0
          },
          src: clean(page?.src),
          caption: clean(page?.caption ?? page?.image?.caption)
        };
        if (type === "text") {
          const html = await this.enrichHtml(clean(page?.text?.content), {
            relativeTo: page,
            secrets: false,
            documents: false,
            links: false,
            embeds: false,
            rolls: false,
            custom: false
          });
          if (typeof html !== "string") throw unavailable();
          const fragment = this.parseHtml(html);
          snapshot.html = sanitizeJournalHtml(fragment);
        }
        pageSnapshots.push(snapshot);
      }
      return { name: clean(journal.name), pages: pageSnapshots };
    }
    catch (_error) {
      throw unavailable();
    }
  }
}
