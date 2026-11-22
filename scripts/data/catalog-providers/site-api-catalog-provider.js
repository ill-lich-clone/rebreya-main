/**
 * Catalog provider backed by the rebreya.com public API.
 *
 * Thin normalization layer over RebreyaSiteApi: full listings, by-slug/by-id
 * detail, and incremental `changes(resource, since)` via the API's
 * `?updated_since=` filter. Every record keeps the site's `id`, `slug`,
 * `updated_at` and `content_hash` — the identity/no-op-update contract the
 * compendium builders rely on (integration ТЗ §7.1).
 */
import { CatalogProvider } from "./catalog-provider-contract.js";

export class SiteApiCatalogProvider extends CatalogProvider {
  /** @param {{iterate:Function, list:Function, getBySlug:Function}} api RebreyaSiteApi */
  constructor(api) {
    super();
    if (!api) throw new Error("SiteApiCatalogProvider requires a RebreyaSiteApi instance.");
    this.api = api;
  }

  async list(resource, options = {}) {
    const records = [];
    for await (const record of this.api.iterate(resource, options.params ?? {})) {
      records.push(record);
    }
    return records;
  }

  async get(resource, idOrSlug, _options = {}) {
    try {
      return await this.api.getBySlug(resource, String(idOrSlug));
    } catch (_error) {
      return null;
    }
  }

  async changes(resource, since, options = {}) {
    const params = { ...(options.params ?? {}) };
    if (since) params.updated_since = since;
    return this.list(resource, { params });
  }
}
