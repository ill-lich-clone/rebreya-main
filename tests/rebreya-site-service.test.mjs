import test from "node:test";
import assert from "node:assert/strict";

import { RebreyaSiteService } from "../scripts/integrations/rebreya-site-service.js";

// In-memory adapter standing in for client-scoped Foundry settings.
function fakeAdapter(initial = {}) {
  const state = {
    baseUrl: "https://rebreya.com",
    enabled: true,
    access: undefined,
    refresh: undefined,
    ...initial,
  };
  return {
    getBaseUrl: () => state.baseUrl,
    isEnabled: () => state.enabled,
    getTokens: () => ({ access: state.access, refresh: state.refresh }),
    setTokens: (t) => { state.access = t?.access || undefined; state.refresh = t?.refresh || undefined; },
    _state: state,
  };
}

// Minimal stub of RebreyaSiteApi with a settable baseUrl.
function stubApiFactory(behaviour = {}) {
  const created = [];
  const factory = (opts) => {
    const api = {
      baseUrl: opts.baseUrl,
      _opts: opts,
      manifest: behaviour.manifest ?? (async () => ({ schemaVersion: "1.0.0", siteBuild: "2026-07-03", resources: { spells: {}, classes: {} } })),
      login: behaviour.login ?? (async (u, p) => { opts.setTokens({ access: "A", refresh: "R" }); return { access: "A", refresh: "R" }; }),
      logout: () => opts.setTokens({}),
    };
    created.push(api);
    return api;
  };
  factory.created = created;
  return factory;
}

test("testConnection returns a healthy summary from the manifest", async () => {
  const svc = new RebreyaSiteService({ adapter: fakeAdapter(), apiFactory: stubApiFactory() });
  const result = await svc.testConnection();
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, "1.0.0");
  assert.equal(result.resourceCount, 2);
  assert.equal(result.baseUrl, "https://rebreya.com");
});

test("testConnection never throws — reports failure structurally", async () => {
  const factory = stubApiFactory({ manifest: async () => { const e = new Error("down"); e.name = "ApiUnavailable"; throw e; } });
  const svc = new RebreyaSiteService({ adapter: fakeAdapter(), apiFactory: factory });
  const result = await svc.testConnection();
  assert.equal(result.ok, false);
  assert.equal(result.kind, "ApiUnavailable");
  assert.match(result.error, /down/);
});

test("login stores tokens through the adapter", async () => {
  const adapter = fakeAdapter();
  const svc = new RebreyaSiteService({ adapter, apiFactory: stubApiFactory() });
  assert.equal(svc.isAuthenticated(), false);
  await svc.login("user", "pass");
  assert.equal(adapter._state.access, "A");
  assert.equal(svc.isAuthenticated(), true);
});

test("logout clears tokens", async () => {
  const adapter = fakeAdapter({ access: "A", refresh: "R" });
  const svc = new RebreyaSiteService({ adapter, apiFactory: stubApiFactory() });
  assert.equal(svc.isAuthenticated(), true);
  svc.logout();
  assert.equal(adapter._state.access, undefined);
});

test("api is rebuilt when the configured base URL changes", () => {
  const adapter = fakeAdapter();
  const factory = stubApiFactory();
  const svc = new RebreyaSiteService({ adapter, apiFactory: factory });
  const first = svc.api;
  assert.equal(factory.created.length, 1);
  const again = svc.api; // unchanged base → same instance
  assert.equal(again, first);
  assert.equal(factory.created.length, 1);
  adapter._state.baseUrl = "https://staging.rebreya.com";
  const rebuilt = svc.api;
  assert.notEqual(rebuilt, first);
  assert.equal(rebuilt.baseUrl, "https://staging.rebreya.com");
});

test("a bad configured base URL falls back to the default without throwing", () => {
  const adapter = fakeAdapter({ baseUrl: "http://127.0.0.1:8001" });
  const svc = new RebreyaSiteService({ adapter, apiFactory: stubApiFactory() });
  assert.equal(svc.api.baseUrl, "https://rebreya.com");
});

test("link tokens: per world + actor, private client store, cleared on demand", async () => {
  let stored = {};
  const adapter = {
    ...fakeAdapter(),
    worldId: () => "testovyj3",
    getLinkTokens: () => stored,
    setLinkTokens: async (v) => { stored = v; },
  };
  const svc = new RebreyaSiteService({ adapter, apiFactory: stubApiFactory() });
  assert.equal(svc.getLinkToken("A1"), null);
  await svc.setLinkToken("A1", { token: "TOK", siteId: 7 });
  assert.equal(svc.getLinkToken("A1").token, "TOK");
  assert.equal(svc.getLinkToken("A1").siteId, 7);
  assert.ok(stored["testovyj3:A1"], "keyed by world id");
  assert.equal(svc.hasLinkToken("A2"), false);
  await svc.clearLinkToken("A1");
  assert.equal(svc.getLinkToken("A1"), null);
});

test("allowLocal dev setting reaches the API factory", () => {
  const factory = stubApiFactory();
  const adapter = { ...fakeAdapter({ baseUrl: "http://127.0.0.1:8000" }), allowLocal: () => true };
  const svc = new RebreyaSiteService({ adapter, apiFactory: factory });
  assert.equal(svc.api.baseUrl, "http://127.0.0.1:8000");
  assert.equal(factory.created[0]._opts.allowLocal, true);
});
