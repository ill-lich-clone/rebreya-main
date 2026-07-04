/**
 * Rebreya Site API client.
 *
 * Talks to the public rebreya.com API (versioned `/api/v1/`) for catalogue sync
 * and, when authenticated, character sync. Designed to be usable both inside
 * Foundry (uses globalThis.fetch) and under `node --test` (fetch + token store
 * are injectable, and nothing touches Foundry globals at import time).
 *
 * See docs: rebreya-site-foundry-integration-tz.md §6, §10.2.
 */

export const DEFAULT_BASE_URL = "https://rebreya.com";
export const API_PREFIX = "/api/v1";

// --- Typed errors (integration TZ §10.2) --------------------------------------

export class RebreyaApiError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    if (cause) this.cause = cause;
  }
}
/** No token available for a request that requires authentication. */
export class AuthRequired extends RebreyaApiError {}
/** Access token rejected and it could not be refreshed. */
export class TokenExpired extends RebreyaApiError {}
/** Network failure or 5xx after retries — the API is unreachable. */
export class ApiUnavailable extends RebreyaApiError {}
/** Response did not match the expected shape / schema version. */
export class SchemaMismatch extends RebreyaApiError {}
/** Server asked us to slow down (HTTP 429). */
export class RateLimited extends RebreyaApiError {
  constructor(message, opts = {}) {
    super(message, opts);
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
  }
}

// --- URL helpers --------------------------------------------------------------

/**
 * Normalise whatever the user typed into a clean origin (`https://host[:port]`)
 * with no trailing slash and no `/api...` suffix. Rejects internal hosts so a
 * stray `127.0.0.1:8001` (which the API used to leak in pagination links) can
 * never become the base.
 */
export function normalizeBaseUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return DEFAULT_BASE_URL;

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let url;
  try {
    url = new URL(candidate);
  } catch (_error) {
    throw new RebreyaApiError(`Некорректный адрес сайта: «${raw}».`);
  }

  const host = url.hostname.toLowerCase();
  if (host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0" || host === "::1") {
    throw new RebreyaApiError(`Локальный адрес «${host}» не может быть базой API сайта.`);
  }

  // Keep scheme + host (+ explicit port); drop any path/query/hash.
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname}${port}`;
}

/** Join the base, the versioned API prefix and a resource path into one URL. */
export function buildApiUrl(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  const clean = String(path ?? "");
  // Absolute URL (e.g. a leaked full link) → take only its path+query.
  if (/^https?:\/\//i.test(clean)) {
    const u = new URL(clean);
    return `${base}${u.pathname}${u.search}`;
  }
  // Already an /api path (e.g. a relative pagination `next`) → base + as-is.
  if (clean.startsWith("/api/")) return `${base}${clean}`;
  const suffix = clean.startsWith("/") ? clean : `/${clean}`;
  return `${base}${API_PREFIX}${suffix}`;
}

// --- Client -------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;

export class RebreyaSiteApi {
  /**
   * @param {object} opts
   * @param {string} [opts.baseUrl]
   * @param {typeof fetch} [opts.fetchImpl]  injectable for tests
   * @param {() => ({access?:string, refresh?:string})} [opts.getTokens]
   * @param {(tokens:{access?:string, refresh?:string}) => void} [opts.setTokens]
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.retries]
   */
  constructor({ baseUrl, fetchImpl, getTokens, setTokens, timeoutMs, retries } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl ?? DEFAULT_BASE_URL);
    this._fetch = fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    this._getTokens = typeof getTokens === "function" ? getTokens : () => ({});
    this._setTokens = typeof setTokens === "function" ? setTokens : () => {};
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = retries ?? DEFAULT_RETRIES;
  }

  get tokens() {
    return this._getTokens() ?? {};
  }

  _authHeader() {
    const access = this.tokens.access;
    return access ? { Authorization: `Bearer ${access}` } : {};
  }

  async _rawFetch(url, init) {
    if (!this._fetch) throw new ApiUnavailable("fetch недоступен в этой среде.");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    try {
      return await this._fetch(url, { ...init, signal: controller?.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Core request. Handles auth header, 401→refresh→retry (once), 429→RateLimited,
   * transient network/5xx retries, and JSON parsing.
   * @param {string} path resource path (relative to /api/v1) or a pagination link
   * @param {object} [opts]
   * @param {boolean} [opts.auth] attach bearer token (required for characters)
   */
  async request(path, { method = "GET", body = null, auth = false, retries = this.retries, _didRefresh = false } = {}) {
    const url = buildApiUrl(this.baseUrl, path);
    const headers = { Accept: "application/json", ...this._authHeader() };
    if (body != null) headers["Content-Type"] = "application/json";
    if (auth && !this.tokens.access) {
      throw new AuthRequired("Требуется авторизация на сайте rebreya.com.");
    }

    let response;
    try {
      response = await this._rawFetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (retries > 0) return this.request(path, { method, body, auth, retries: retries - 1, _didRefresh });
      throw new ApiUnavailable(`Не удалось связаться с ${this.baseUrl}.`, { cause: error });
    }

    if (response.status === 401) {
      // Try a single refresh, then retry the original request once.
      if (auth && !_didRefresh && this.tokens.refresh) {
        await this.refresh();
        return this.request(path, { method, body, auth, retries, _didRefresh: true });
      }
      throw new TokenExpired("Сессия сайта истекла — войдите заново.", { status: 401 });
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers?.get?.("Retry-After")) || null;
      throw new RateLimited("Слишком много запросов к сайту, попробуйте позже.", { status: 429, retryAfterSeconds: retryAfter });
    }
    if (response.status >= 500) {
      if (retries > 0) return this.request(path, { method, body, auth, retries: retries - 1, _didRefresh });
      throw new ApiUnavailable(`Сайт вернул ошибку ${response.status}.`, { status: response.status });
    }
    if (response.status >= 400) {
      let detail = "";
      try { detail = JSON.stringify(await response.json()); } catch (_e) { /* ignore */ }
      throw new RebreyaApiError(`Запрос отклонён (${response.status}). ${detail}`.trim(), { status: response.status });
    }

    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch (error) {
      // A connection reset mid-body yields status 200 with a truncated stream —
      // that's a transient network failure, not a schema problem: retry it.
      if (retries > 0) {
        return this.request(path, { method, body, auth, retries: retries - 1, _didRefresh });
      }
      throw new SchemaMismatch("Сайт вернул не-JSON ответ.", { cause: error });
    }
  }

  // --- Auth ------------------------------------------------------------------

  async login(username, password) {
    const data = await this.request("/auth/login/", { method: "POST", body: { username, password } });
    if (!data?.access || !data?.refresh) {
      throw new SchemaMismatch("Ответ авторизации без токенов.");
    }
    this._setTokens({ access: data.access, refresh: data.refresh });
    return data;
  }

  async refresh() {
    const refresh = this.tokens.refresh;
    if (!refresh) throw new AuthRequired("Нет refresh-токена для обновления сессии.");
    let data;
    try {
      data = await this.request("/auth/refresh/", { method: "POST", body: { refresh } });
    } catch (error) {
      if (error instanceof TokenExpired || error?.status === 401) {
        this._setTokens({});
        throw new TokenExpired("Refresh-токен недействителен — войдите заново.");
      }
      throw error;
    }
    if (!data?.access) throw new SchemaMismatch("Ответ обновления без access-токена.");
    this._setTokens({ ...this.tokens, access: data.access });
    return data;
  }

  logout() {
    this._setTokens({});
  }

  // --- Catalogue -------------------------------------------------------------

  /** Machine-readable manifest: resources, counts, schema versions. */
  async manifest() {
    const data = await this.request("/foundry/manifest/");
    if (!data?.schemaVersion || !data?.resources) {
      throw new SchemaMismatch("Манифест сайта в неожиданном формате.");
    }
    return data;
  }

  /** A single page of a resource. `params` may include page, page_size, updated_since, q. */
  async list(resource, params = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    }
    const qs = query.toString();
    return this.request(`/${resource}/${qs ? `?${qs}` : ""}`);
  }

  /**
   * Iterate every row of a resource across pages, following the (relative)
   * `next` links the API now returns. Yields one record at a time.
   */
  async *iterate(resource, params = {}) {
    let page = await this.list(resource, { page_size: 200, ...params });
    while (page) {
      const rows = Array.isArray(page) ? page : page.results ?? [];
      for (const row of rows) yield row;
      const next = Array.isArray(page) ? null : page.next;
      if (!next) break;
      page = await this.request(next); // relative link → resolved against baseUrl
    }
  }

  /** Full detail object for one entity by slug. */
  async getBySlug(resource, slug) {
    return this.request(`/${resource}/by-slug/${encodeURIComponent(slug)}/`);
  }

  // --- Characters (authenticated) --------------------------------------------

  async listCharacters() {
    return this.request("/characters/", { auth: true });
  }

  async getCharacter(id) {
    return this.request(`/characters/${encodeURIComponent(id)}/`, { auth: true });
  }

  /** Current mutable state (+ stateHash) of a linked character. */
  async getCharacterState(id) {
    return this.request(`/characters/${encodeURIComponent(id)}/state/`, { auth: true });
  }

  /** Push mutable in-session state (Foundry → site). Returns the new state + stateHash. */
  async patchCharacterState(id, statePatch) {
    return this.request(`/characters/${encodeURIComponent(id)}/state/`, {
      method: "PATCH",
      body: statePatch,
      auth: true,
    });
  }
}
