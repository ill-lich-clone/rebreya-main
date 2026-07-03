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
    let normalized;
    try {
      normalized = normalizeBaseUrl(rawBase);
    } catch (_error) {
      normalized = normalizeBaseUrl(DEFAULT_SITE_BASE_URL);
    }
    if (!this._api || this._apiBaseUrl !== normalized) {
      this._api = this._apiFactory({
        baseUrl: normalized,
        getTokens: () => this.adapter.getTokens(),
        setTokens: (t) => this.adapter.setTokens(t),
      });
      this._apiBaseUrl = normalized;
    }
    return this._api;
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
