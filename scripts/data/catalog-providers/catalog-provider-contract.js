/**
 * Catalog provider contract (integration ТЗ §10.3).
 *
 * A provider hands normalized catalogue records to the compendium builders so
 * they never care where data comes from (site API, local JSON, hybrid).
 * Implementations: SiteApiCatalogProvider (site), and the existing local JSON
 * loaders can be wrapped later as LocalCatalogProvider.
 */
export class CatalogProvider {
  /** All records of a resource. @returns {Promise<object[]>} */
  async list(_resource, _options = {}) {
    throw new Error("CatalogProvider.list is not implemented.");
  }

  /** One record by id or slug. @returns {Promise<object|null>} */
  async get(_resource, _idOrSlug, _options = {}) {
    throw new Error("CatalogProvider.get is not implemented.");
  }

  /** Records changed at/after `since` (ISO 8601). @returns {Promise<object[]>} */
  async changes(_resource, _since, _options = {}) {
    throw new Error("CatalogProvider.changes is not implemented.");
  }
}
