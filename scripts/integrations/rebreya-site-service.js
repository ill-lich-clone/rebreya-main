/**
 * Foundry-facing wrapper around the Rebreya site API client.
 *
 * Binds token storage to client-scoped module settings (so a player's site
 * token never touches world settings or the socket — integration ТЗ §9.4) and
 * exposes high-level operations (test connection, login, logout) for the module
 * UI. The Foundry `game` access is behind an injectable adapter so the service
 * logic can be exercised under `node --test`.
 */

import { RebreyaSiteApi, normalizeBaseUrl } from "./rebreya-site-api.js";
import { MODULE_ID, SETTINGS_KEYS, DEFAULT_SITE_BASE_URL } from "../constants.js";

/** True when this page (the Foundry client) is served from localhost. */
export function isLocalPage(hostname = globalThis.location?.hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
}

/** Adapter over Foundry `game.settings` (client-scoped tokens + config). */
export function createFoundrySettingsAdapter(game) {
  const get = (key, fallback = "") => {
    try {
      const value = game?.settings?.get?.(MODULE_ID, key);
      return value == null ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  };
  const set = (key, value) => {
    try {
      return game?.settings?.set?.(MODULE_ID, key, value);
    } catch (_error) {
      return undefined;
    }
  };
  return {
    getBaseUrl: () => get(SETTINGS_KEYS.SITE_BASE_URL, DEFAULT_SITE_BASE_URL) || DEFAULT_SITE_BASE_URL,
    isEnabled: () => Boolean(get(SETTINGS_KEYS.SITE_INTEGRATION_ENABLED, false)),
    // Dev-only: honoured only while Foundry itself is opened from this machine,
    // so a forgotten checkbox cannot point a real game at a local backend.
    allowLocal: () => Boolean(get(SETTINGS_KEYS.SITE_ALLOW_LOCALHOST, false)) && isLocalPage(),
    worldId: () => String(game?.world?.id ?? ""),
    getLinkTokens: () => {
      const value = get(SETTINGS_KEYS.SITE_LINK_TOKENS, {});
      return value && typeof value === "object" ? value : {};
    },
    setLinkTokens: (value) => set(SETTINGS_KEYS.SITE_LINK_TOKENS, value ?? {}),
    getTokens: () => ({
      access: get(SETTINGS_KEYS.SITE_ACCESS_TOKEN) || undefined,
      refresh: get(SETTINGS_KEYS.SITE_REFRESH_TOKEN) || undefined,
    }),
    setTokens: (tokens) => {
      set(SETTINGS_KEYS.SITE_ACCESS_TOKEN, tokens?.access ?? "");
      set(SETTINGS_KEYS.SITE_REFRESH_TOKEN, tokens?.refresh ?? "");
    },
  };
}

export class RebreyaSiteService {
  /**
   * @param {object} opts
   * @param {ReturnType<typeof createFoundrySettingsAdapter>} opts.adapter
   * @param {(o:object)=>RebreyaSiteApi} [opts.apiFactory] injectable for tests
   */
  constructor({ adapter, apiFactory } = {}) {
    if (!adapter) throw new Error("RebreyaSiteService requires a settings adapter.");
    this.adapter = adapter;
    this._apiFactory = apiFactory ?? ((o) => new RebreyaSiteApi(o));
    this._api = null;
    this._apiBaseUrl = null;
  }

  /** Lazily (re)build the API client, tracking the configured base URL. */
  get api() {
    const rawBase = this.adapter.getBaseUrl();
    const allowLocal = Boolean(this.adapter.allowLocal?.());
    let normalized;
    try {
      normalized = normalizeBaseUrl(rawBase, { allowLocal });
    } catch (_error) {
      normalized = normalizeBaseUrl(DEFAULT_SITE_BASE_URL);
    }
    const key = `${normalized}|${allowLocal}`;
    if (!this._api || this._apiBaseUrl !== key) {
      this._api = this._apiFactory({
        baseUrl: normalized,
        allowLocal,
        getTokens: () => this.adapter.getTokens(),
        setTokens: (t) => this.adapter.setTokens(t),
      });
      this._apiBaseUrl = key;
    }
    return this._api;
  }

  // --- Link tokens (share-code import), private to this browser ---------------

  #linkKey(actorId) {
    return `${this.adapter.worldId?.() ?? ""}:${actorId}`;
  }

  /** @returns {{token:string, siteId:(number|string|null), baseUrl:string, savedAt:string}|null} */
  getLinkToken(actorId) {
    if (!actorId || !this.adapter.getLinkTokens) return null;
    const entry = this.adapter.getLinkTokens()[this.#linkKey(actorId)];
    return entry?.token ? entry : null;
  }

  hasLinkToken(actorId) {
    return Boolean(this.getLinkToken(actorId));
  }

  async setLinkToken(actorId, { token, siteId = null } = {}) {
    if (!actorId || !token || !this.adapter.setLinkTokens) return;
    const all = { ...this.adapter.getLinkTokens() };
    all[this.#linkKey(actorId)] = { token: String(token), siteId, baseUrl: this.api.baseUrl, savedAt: new Date().toISOString() };
    await this.adapter.setLinkTokens(all);
  }

  async clearLinkToken(actorId) {
    if (!actorId || !this.adapter.setLinkTokens) return;
    const all = { ...this.adapter.getLinkTokens() };
    delete all[this.#linkKey(actorId)];
    await this.adapter.setLinkTokens(all);
  }

  isEnabled() {
    return this.adapter.isEnabled();
  }

  isAuthenticated() {
    return Boolean(this.adapter.getTokens().access);
  }

  async login(username, password) {
    const data = await this.api.login(username, password);
    return { ok: true, username };
  }

  logout() {
    this.api.logout();
  }

  /**
   * Health check for the diagnostics UI. Never throws — returns a structured
   * result so the UI can show a clear message. (integration ТЗ §10.6)
   */
  async testConnection() {
    try {
      const manifest = await this.api.manifest();
      return {
        ok: true,
        baseUrl: this.api.baseUrl,
        siteBuild: manifest.siteBuild ?? null,
        schemaVersion: manifest.schemaVersion ?? null,
        resourceCount: Object.keys(manifest.resources ?? {}).length,
        authenticated: this.isAuthenticated(),
      };
    } catch (error) {
      return {
        ok: false,
        baseUrl: this.adapter.getBaseUrl(),
        error: error?.message ?? String(error),
        kind: error?.name ?? "Error",
      };
    }
  }
}
