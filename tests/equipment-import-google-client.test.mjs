import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createGoogleSheetsClient,
  createServiceAccountJwt,
  loadGoogleServiceAccount
} from "../tools/equipment-import/google-sheets-client.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
const SERVICE_ACCOUNT = Object.freeze({
  type: "service_account",
  client_email: "equipment-importer@example.iam.gserviceaccount.com",
  private_key: PRIVATE_KEY,
  token_uri: "https://oauth2.googleapis.com/token"
});

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("service-account JWT is a short-lived RS256 assertion with read-only Sheets scope", () => {
  const jwt = createServiceAccountJwt({
    serviceAccount: SERVICE_ACCOUNT,
    now: 1_700_000_000_000
  });
  const [encodedHeader, encodedPayload, signature] = jwt.split(".");
  const header = decodeSegment(encodedHeader);
  const payload = decodeSegment(encodedPayload);

  assert.deepEqual(header, { alg: "RS256", typ: "JWT" });
  assert.equal(payload.iss, SERVICE_ACCOUNT.client_email);
  assert.equal(payload.scope, "https://www.googleapis.com/auth/spreadsheets.readonly");
  assert.equal(payload.aud, SERVICE_ACCOUNT.token_uri);
  assert.ok(payload.exp > payload.iat);
  assert.ok(payload.exp - payload.iat <= 3600);
  assert.equal(
    verify("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, Buffer.from(signature, "base64url")),
    true
  );
});

test("credential loader honors explicit path, environment path, then ignored default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rebreya-google-client-"));
  try {
    const explicitPath = join(directory, "explicit.json");
    const environmentPath = join(directory, "environment.json");
    await writeFile(explicitPath, JSON.stringify(SERVICE_ACCOUNT), "utf8");
    await writeFile(environmentPath, JSON.stringify({ ...SERVICE_ACCOUNT, client_email: "environment@example.test" }), "utf8");

    const explicit = await loadGoogleServiceAccount({
      credentialsPath: explicitPath,
      env: { GOOGLE_APPLICATION_CREDENTIALS: environmentPath },
      cwd: directory
    });
    const environment = await loadGoogleServiceAccount({
      env: { GOOGLE_APPLICATION_CREDENTIALS: environmentPath },
      cwd: directory
    });

    assert.equal(explicit.client_email, SERVICE_ACCOUNT.client_email);
    assert.equal(environment.client_email, "environment@example.test");
    assert.equal("credentialsPath" in explicit, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("range fetch requests formatted rows and restores requested range order", async () => {
  const calls = [];
  const client = createGoogleSheetsClient({
    now: () => 1_700_000_000_000,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === SERVICE_ACCOUNT.token_uri) {
        return jsonResponse({ access_token: "token-value", expires_in: 3600 });
      }
      return jsonResponse({
        spreadsheetId: "sheet-id",
        valueRanges: [{ range: "'Second'!A1:B2", majorDimension: "ROWS", values: [["b"]] }]
      });
    }
  });

  const ranges = ["'First'!A1:B2", "'Second'!A1:B2"];
  const result = await client.fetchRanges({
    spreadsheetId: "sheet/id",
    ranges,
    serviceAccount: SERVICE_ACCOUNT
  });

  assert.deepEqual(result, [
    { range: "'First'!A1:B2", values: [] },
    { range: "'Second'!A1:B2", values: [["b"]] }
  ]);
  const valuesCall = calls.at(-1);
  const url = new URL(valuesCall.url);
  assert.equal(url.pathname, "/v4/spreadsheets/sheet%2Fid/values:batchGet");
  assert.deepEqual(url.searchParams.getAll("ranges"), ranges);
  assert.equal(url.searchParams.get("majorDimension"), "ROWS");
  assert.equal(url.searchParams.get("valueRenderOption"), "FORMATTED_VALUE");
  assert.equal(valuesCall.options.headers.Authorization, "Bearer token-value");
  assert.doesNotMatch(valuesCall.url, /BEGIN PRIVATE KEY|token-value/);
});

test("range fetch keeps values when Sheets trims the requested grid bounds", async () => {
  const client = createGoogleSheetsClient({
    now: () => 1_700_000_000_000,
    fetchImpl: async (url) => {
      if (String(url) === SERVICE_ACCOUNT.token_uri) {
        return jsonResponse({ access_token: "token-value", expires_in: 3600 });
      }
      return jsonResponse({
        spreadsheetId: "sheet-id",
        valueRanges: [{
          range: "'Magic Items'!A1:S1003",
          majorDimension: "ROWS",
          values: [["Name", "Value"]]
        }]
      });
    }
  });

  const result = await client.fetchRanges({
    spreadsheetId: "sheet-id",
    ranges: ["'Magic Items'!A1:V1004"],
    serviceAccount: SERVICE_ACCOUNT
  });

  assert.deepEqual(result, [{
    range: "'Magic Items'!A1:V1004",
    values: [["Name", "Value"]]
  }]);
});

test("metadata fetch retries transient failures with bounded increasing delays", async () => {
  let metadataAttempts = 0;
  const delays = [];
  const client = createGoogleSheetsClient({
    now: () => 1_700_000_000_000,
    random: () => 0.5,
    sleep: async (delay) => { delays.push(delay); },
    fetchImpl: async (url) => {
      if (String(url) === SERVICE_ACCOUNT.token_uri) {
        return jsonResponse({ access_token: "token-value", expires_in: 3600 });
      }
      metadataAttempts += 1;
      if (metadataAttempts < 3) return jsonResponse({ error: "temporary" }, 503);
      return jsonResponse({
        spreadsheetId: "sheet-id",
        sheets: [{ properties: { sheetId: 1, title: "Hidden", hidden: true } }]
      });
    }
  });

  const metadata = await client.fetchSpreadsheetMetadata({
    spreadsheetId: "sheet-id",
    serviceAccount: SERVICE_ACCOUNT,
    maxRetries: 4
  });

  assert.equal(metadataAttempts, 3);
  assert.deepEqual(delays, [300, 550]);
  assert.equal(metadata.sheets[0].properties.title, "Hidden");
});

test("permanent API errors fail immediately and sanitize private keys and access tokens", async () => {
  let apiAttempts = 0;
  const client = createGoogleSheetsClient({
    now: () => 1_700_000_000_000,
    fetchImpl: async (url) => {
      if (String(url) === SERVICE_ACCOUNT.token_uri) {
        return jsonResponse({ access_token: "super-secret-access-token", expires_in: 3600 });
      }
      apiAttempts += 1;
      return new Response(`${PRIVATE_KEY}\nsuper-secret-access-token`, { status: 403 });
    }
  });

  await assert.rejects(
    () => client.fetchSpreadsheetMetadata({
      spreadsheetId: "sheet-id",
      serviceAccount: SERVICE_ACCOUNT,
      maxRetries: 4
    }),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(error.attempts, 1);
      assert.doesNotMatch(error.message, /BEGIN PRIVATE KEY|super-secret-access-token/);
      return true;
    }
  );
  assert.equal(apiAttempts, 1);
});

test("transient failures stop after four retries", async () => {
  let apiAttempts = 0;
  const client = createGoogleSheetsClient({
    now: () => 1_700_000_000_000,
    random: () => 0,
    sleep: async () => {},
    fetchImpl: async (url) => {
      if (String(url) === SERVICE_ACCOUNT.token_uri) {
        return jsonResponse({ access_token: "token-value", expires_in: 3600 });
      }
      apiAttempts += 1;
      return jsonResponse({ error: "temporary" }, 429);
    }
  });

  await assert.rejects(
    () => client.fetchSpreadsheetMetadata({
      spreadsheetId: "sheet-id",
      serviceAccount: SERVICE_ACCOUNT,
      maxRetries: 4
    }),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.attempts, 5);
      return true;
    }
  );
  assert.equal(apiAttempts, 5);
});
