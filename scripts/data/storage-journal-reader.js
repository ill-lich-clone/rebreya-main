const JOURNAL_UNAVAILABLE_ERROR = "Запись журнала недоступна.";

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
          if (typeof fragment?.querySelector !== "function"
            || fragment.querySelector("section.secret:not(.revealed)")) {
            throw unavailable();
          }
          snapshot.html = html;
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
