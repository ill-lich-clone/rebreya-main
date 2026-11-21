import test from "node:test";
import assert from "node:assert/strict";

import {
  RebreyaSiteApi,
  normalizeBaseUrl,
  buildApiUrl,
  AuthRequired,
  TokenExpired,
  ApiUnavailable,
  RateLimited,
  SchemaMismatch,
} from "../scripts/integrations/rebreya-site-api.js";

// --- Mock fetch helpers -------------------------------------------------------

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    status,
    headers: { get: (name) => headers[name] ?? headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** Queue of responses (or thrown errors) returned in order; records calls. */
function mockFetch(steps) {
  const calls = [];
  const queue = [...steps];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = queue.shift();
    if (step === undefined) throw new Error(`unexpected extra fetch to ${url}`);
    if (typeof step === "function") return step(url, init);
    if (step instanceof Error) throw step;
    return step;
  };
  fn.calls = calls;
  return fn;
}

function tokenStore(initial = {}) {
  let tokens = { ...initial };
  return {
    getTokens: () => tokens,
    setTokens: (t) => { tokens = { ...t }; },
    current: () => tokens,
  };
}

// --- normalizeBaseUrl ---------------------------------------------------------

test("normalizeBaseUrl adds https and strips trailing slash", () => {
  assert.equal(normalizeBaseUrl("rebreya.com"), "https://rebreya.com");
  assert.equal(normalizeBaseUrl("https://rebreya.com/"), "https://rebreya.com");
  assert.equal(normalizeBaseUrl("http://rebreya.com"), "http://rebreya.com");
});

test("normalizeBaseUrl strips any /api path and query", () => {
  assert.equal(normalizeBaseUrl("https://rebreya.com/api/v1/"), "https://rebreya.com");
  assert.equal(normalizeBaseUrl("https://rebreya.com/dnd-5e?x=1"), "https://rebreya.com");
});

test("normalizeBaseUrl keeps an explicit port", () => {
  assert.equal(normalizeBaseUrl("https://staging.rebreya.com:8443"), "https://staging.rebreya.com:8443");
});

test("normalizeBaseUrl rejects internal hosts (guards the old 127.0.0.1 leak)", () => {
  assert.throws(() => normalizeBaseUrl("http://127.0.0.1:8001"), /Локальный/);
  assert.throws(() => normalizeBaseUrl("localhost:3000"), /Локальный/);
});

test("normalizeBaseUrl empty falls back to default", () => {
  assert.equal(normalizeBaseUrl(""), "https://rebreya.com");
  assert.equal(normalizeBaseUrl(null), "https://rebreya.com");
});

// --- buildApiUrl --------------------------------------------------------------

test("buildApiUrl builds a versioned resource URL", () => {
  assert.equal(buildApiUrl("https://rebreya.com", "/spells/"), "https://rebreya.com/api/v1/spells/");
  assert.equal(buildApiUrl("https://rebreya.com", "spells/"), "https://rebreya.com/api/v1/spells/");
});

test("buildApiUrl passes a relative /api pagination link through against the base", () => {
  assert.equal(
    buildApiUrl("https://rebreya.com", "/api/spells/?page=3"),
    "https://rebreya.com/api/spells/?page=3",
  );
});

test("buildApiUrl reduces a leaked absolute link to path+query on the trusted base", () => {
  assert.equal(
    buildApiUrl("https://rebreya.com", "https://127.0.0.1:8001/api/spells/?page=3"),
    "https://rebreya.com/api/spells/?page=3",
  );
});

// --- auth header --------------------------------------------------------------

test("request attaches a bearer token when present", async () => {
  const store = tokenStore({ access: "AAA" });
  const fetchImpl = mockFetch([jsonResponse({ ok: 1 })]);
  const api = new RebreyaSiteApi({ fetchImpl, getTokens: store.getTokens, setTokens: store.setTokens });
  await api.request("/spells/");
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, "Bearer AAA");
});

test("auth-required request without a token throws AuthRequired before fetching", async () => {
  const fetchImpl = mockFetch([]);
  const api = new RebreyaSiteApi({ fetchImpl });
  await assert.rejects(() => api.request("/characters/", { auth: true }), AuthRequired);
  assert.equal(fetchImpl.calls.length, 0);
});

// --- refresh on 401 -----------------------------------------------------------

test("401 on an auth request refreshes the token and retries once", async () => {
  const store = tokenStore({ access: "OLD", refresh: "R" });
  const fetchImpl = mockFetch([
    jsonResponse({ detail: "expired" }, { status: 401 }),   // first characters call
    jsonResponse({ access: "NEW" }),                         // refresh
    jsonResponse({ results: [{ id: 1 }] }),                  // retried characters call
  ]);
  const api = new RebreyaSiteApi({ fetchImpl, getTokens: store.getTokens, setTokens: store.setTokens });
  const data = await api.request("/characters/", { auth: true });
  assert.deepEqual(data, { results: [{ id: 1 }] });
  assert.equal(store.current().access, "NEW");
  // third call carried the refreshed token
  assert.equal(fetchImpl.calls[2].init.headers.Authorization, "Bearer NEW");
});

test("401 with no refresh token throws TokenExpired", async () => {
  const store = tokenStore({ access: "OLD" });
  const fetchImpl = mockFetch([jsonResponse({}, { status: 401 })]);
  const api = new RebreyaSiteApi({ fetchImpl, getTokens: store.getTokens, setTokens: store.setTokens });
  await assert.rejects(() => api.request("/characters/", { auth: true }), TokenExpired);
});

// --- rate limit + unavailable -------------------------------------------------

test("429 throws RateLimited with Retry-After", async () => {
  const fetchImpl = mockFetch([jsonResponse({}, { status: 429, headers: { "Retry-After": "42" } })]);
  const api = new RebreyaSiteApi({ fetchImpl });
  await assert.rejects(
    () => api.request("/spells/"),
    (err) => err instanceof RateLimited && err.retryAfterSeconds === 42,
  );
});

test("network error retries then surfaces ApiUnavailable", async () => {
  const fetchImpl = mockFetch([new Error("ECONNREFUSED"), new Error("ECONNREFUSED"), new Error("ECONNREFUSED")]);
  const api = new RebreyaSiteApi({ fetchImpl, retries: 2 });
  await assert.rejects(() => api.request("/spells/"), ApiUnavailable);
  assert.equal(fetchImpl.calls.length, 3); // initial + 2 retries
});

test("5xx retries then surfaces ApiUnavailable", async () => {
  const fetchImpl = mockFetch([
    jsonResponse({}, { status: 502 }),
    jsonResponse({}, { status: 502 }),
  ]);
  const api = new RebreyaSiteApi({ fetchImpl, retries: 1 });
  await assert.rejects(() => api.request("/spells/"), ApiUnavailable);
});

// --- pagination ---------------------------------------------------------------

test("iterate follows relative next links across pages", async () => {
  const fetchImpl = mockFetch([
    jsonResponse({ results: [{ id: 1 }, { id: 2 }], next: "/api/spells/?page=2" }),
    jsonResponse({ results: [{ id: 3 }], next: null }),
  ]);
  const api = new RebreyaSiteApi({ fetchImpl });
  const ids = [];
  for await (const row of api.iterate("spells")) ids.push(row.id);
  assert.deepEqual(ids, [1, 2, 3]);
  // second call resolved the relative next against the base
  assert.equal(fetchImpl.calls[1].url, "https://rebreya.com/api/spells/?page=2");
});

// --- login / manifest ---------------------------------------------------------

test("login stores both tokens", async () => {
  const store = tokenStore();
  const fetchImpl = mockFetch([jsonResponse({ access: "A", refresh: "R" })]);
  const api = new RebreyaSiteApi({ fetchImpl, getTokens: store.getTokens, setTokens: store.setTokens });
  await api.login("user", "pass");
  assert.deepEqual(store.current(), { access: "A", refresh: "R" });
});

test("manifest rejects a malformed payload", async () => {
  const fetchImpl = mockFetch([jsonResponse({ nope: true })]);
  const api = new RebreyaSiteApi({ fetchImpl });
  await assert.rejects(() => api.manifest(), SchemaMismatch);
});

test("manifest returns a well-formed payload", async () => {
  const payload = { schemaVersion: "1.0.0", resources: { spells: { count: 524 } } };
  const fetchImpl = mockFetch([jsonResponse(payload)]);
  const api = new RebreyaSiteApi({ fetchImpl });
  assert.deepEqual(await api.manifest(), payload);
});

test("truncated body (json parse failure) is retried, then succeeds", async () => {
  const badBody = { status: 200, headers: { get: () => null }, json: async () => { throw new TypeError("terminated"); } };
  const fetchImpl = mockFetch([badBody, jsonResponse({ ok: 1 })]);
  const api = new RebreyaSiteApi({ fetchImpl, retries: 1 });
  assert.deepEqual(await api.request("/spells/"), { ok: 1 });
  assert.equal(fetchImpl.calls.length, 2);
});

test("persistent bad JSON still surfaces SchemaMismatch after retries", async () => {
  const badBody = () => ({ status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("bad"); } });
  const fetchImpl = mockFetch([badBody(), badBody()]);
  const api = new RebreyaSiteApi({ fetchImpl, retries: 1 });
  await assert.rejects(() => api.request("/spells/"), SchemaMismatch);
});

test("refresh keeps the rotated refresh token (site blacklists the old one)", async () => {
  const store = tokenStore({ access: "OLD", refresh: "R1" });
  const fetchImpl = mockFetch([
    jsonResponse({ detail: "expired" }, { status: 401 }),
    jsonResponse({ access: "NEW", refresh: "R2" }),
    jsonResponse({ results: [] }),
  ]);
  const api = new RebreyaSiteApi({ fetchImpl, getTokens: store.getTokens, setTokens: store.setTokens });
  await api.request("/characters/", { auth: true });
  assert.deepEqual(store.current(), { access: "NEW", refresh: "R2" });
});

// --- Share code + link token (no password in Foundry) ------------------------

import { LinkRevoked, ShareCodeInvalid, normalizeShareCode } from "../scripts/integrations/rebreya-site-api.js";

test("normalizeShareCode: case-insensitive, dashes/spaces ignored, junk rejected", () => {
  assert.equal(normalizeShareCode(" k7qm-2xpa "), "K7QM2XPA");
  assert.equal(normalizeShareCode("K7QM 2XPA"), "K7QM2XPA");
  assert.equal(normalizeShareCode("K7QM–2XPA"), "K7QM2XPA"); // en dash pasted from a page
  assert.equal(normalizeShareCode("абв"), "");
  assert.equal(normalizeShareCode("ab"), "");
});

test("claimShareCode: POST without any Authorization, single attempt, returns token + character", async () => {
  const store = tokenStore({ access: "JWT", refresh: "R" });
  const fetchImpl = mockFetch([jsonResponse({ linkToken: "L".repeat(43), character: { id: 7, name: "Тайрен" } })]);
  const api = new RebreyaSiteApi({ fetchImpl, getTokens: store.getTokens, setTokens: store.setTokens });
  const res = await api.claimShareCode("k7qm-2xpa", "Foundry: Ребрея мейн");
  assert.equal(res.linkToken.length, 43);
  assert.equal(res.character.name, "Тайрен");
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, "https://rebreya.com/api/v1/characters/claim/");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), { code: "K7QM2XPA", label: "Foundry: Ребрея мейн" });
  assert.equal(init.headers.Authorization, "Bearer JWT"); // harmless when logged in; see next test for logged out
});

test("claimShareCode works logged out and maps 404 to ShareCodeInvalid without retrying", async () => {
  const fetchImpl = mockFetch([jsonResponse({ detail: "Код недействителен или устарел." }, { status: 404 })]);
  const api = new RebreyaSiteApi({ fetchImpl });
  await assert.rejects(() => api.claimShareCode("AAAA-BBBB"), ShareCodeInvalid);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, undefined);
  await assert.rejects(() => api.claimShareCode("?"), ShareCodeInvalid); // rejected locally, no request
  assert.equal(fetchImpl.calls.length, 1);
});

test("claimShareCode: 5xx is not retried (a single-use code must not be burnt twice)", async () => {
  const fetchImpl = mockFetch([jsonResponse({}, { status: 502 })]);
  const api = new RebreyaSiteApi({ fetchImpl });
  await assert.rejects(() => api.claimShareCode("AAAA-BBBB"), ApiUnavailable);
  assert.equal(fetchImpl.calls.length, 1);
});

test("claimShareCode: 429 surfaces RateLimited; malformed 200 is SchemaMismatch", async () => {
  const api429 = new RebreyaSiteApi({ fetchImpl: mockFetch([jsonResponse({}, { status: 429, headers: { "Retry-After": "30" } })]) });
  await assert.rejects(() => api429.claimShareCode("AAAA-BBBB"), RateLimited);
  const apiBad = new RebreyaSiteApi({ fetchImpl: mockFetch([jsonResponse({ character: {} })]) });
  await assert.rejects(() => apiBad.claimShareCode("AAAA-BBBB"), SchemaMismatch);
});

test("linked endpoints send RebreyaLink (never the JWT) and 401 → LinkRevoked without refresh", async () => {
  const store = tokenStore({ access: "JWT", refresh: "R" });
  const fetchImpl = mockFetch([
    jsonResponse({ id: 7 }),
    jsonResponse({ currentHp: 3, stateHash: "sha256:x" }),
    jsonResponse({ stateHash: "sha256:y" }),
    jsonResponse({ detail: "revoked" }, { status: 401 }),
  ]);
  const api = new RebreyaSiteApi({ fetchImpl, getTokens: store.getTokens, setTokens: store.setTokens });
  await api.getLinkedCharacter("TOK");
  await api.getLinkedState("TOK");
  await api.patchLinkedState("TOK", { currentHp: 5 });
  await assert.rejects(() => api.getLinkedCharacter("TOK"), LinkRevoked);
  assert.deepEqual(fetchImpl.calls.map((c) => c.url), [
    "https://rebreya.com/api/v1/characters/linked/",
    "https://rebreya.com/api/v1/characters/linked/state/",
    "https://rebreya.com/api/v1/characters/linked/state/",
    "https://rebreya.com/api/v1/characters/linked/",
  ]);
  for (const call of fetchImpl.calls) assert.equal(call.init.headers.Authorization, "RebreyaLink TOK");
  assert.equal(fetchImpl.calls[2].init.method, "PATCH");
  assert.equal(fetchImpl.calls.length, 4); // no refresh attempt on 401
  assert.deepEqual(store.current(), { access: "JWT", refresh: "R" }); // JWT untouched
  await assert.rejects(() => api.getLinkedCharacter(""), LinkRevoked);
});

test("allowLocal (dev setting) lets http://127.0.0.1:8000 be the base; default still refuses", async () => {
  assert.equal(normalizeBaseUrl("http://127.0.0.1:8000", { allowLocal: true }), "http://127.0.0.1:8000");
  assert.throws(() => normalizeBaseUrl("http://127.0.0.1:8000"), /Локальный/);
  const fetchImpl = mockFetch([jsonResponse({ id: 1 })]);
  const api = new RebreyaSiteApi({ baseUrl: "http://127.0.0.1:8000", allowLocal: true, fetchImpl });
  await api.getLinkedCharacter("TOK");
  assert.equal(fetchImpl.calls[0].url, "http://127.0.0.1:8000/api/v1/characters/linked/");
});
