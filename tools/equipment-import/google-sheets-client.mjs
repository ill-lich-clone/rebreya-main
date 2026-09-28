import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT = "rebreya-main-equipment-importer/1";

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function resolveNow(now) {
  const value = typeof now === "function" ? now() : now;
  return Number.isFinite(value) ? value : Date.now();
}

function validateServiceAccount(serviceAccount) {
  if (!serviceAccount || serviceAccount.type !== "service_account") {
    throw new Error("Google credentials must be a service_account JSON object");
  }
  for (const field of ["client_email", "private_key"]) {
    if (typeof serviceAccount[field] !== "string" || !serviceAccount[field].trim()) {
      throw new Error(`Google service account is missing ${field}`);
    }
  }
  return serviceAccount;
}

function sanitizeText(value, secrets = []) {
  let sanitized = String(value ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
  sanitized = sanitized.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED KEY]");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]");
  return sanitized;
}

function rangeStartIdentity(range) {
  const value = String(range ?? "");
  const separatorIndex = value.lastIndexOf("!");
  if (separatorIndex < 0) return value.toUpperCase();
  const sheet = value.slice(0, separatorIndex);
  const start = value.slice(separatorIndex + 1).split(":", 1)[0].replaceAll("$", "").toUpperCase();
  return `${sheet}!${start}`;
}

export class GoogleSheetsApiError extends Error {
  constructor(message, { status = 0, attempts = 1, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "GoogleSheetsApiError";
    this.status = status;
    this.attempts = attempts;
  }
}

export async function loadGoogleServiceAccount({
  credentialsPath = null,
  env = process.env,
  cwd = process.cwd()
} = {}) {
  const selectedPath = credentialsPath
    ?? env?.GOOGLE_APPLICATION_CREDENTIALS
    ?? resolve(cwd, "tools", "google-credentials.json");
  let raw;
  try {
    raw = await readFile(selectedPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read Google service-account credentials: ${error.code ?? "read failed"}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Google service-account credentials are not valid JSON");
  }
  return validateServiceAccount(parsed);
}

export function createServiceAccountJwt({ serviceAccount, now = Date.now() }) {
  validateServiceAccount(serviceAccount);
  const issuedAt = Math.floor(resolveNow(now) / 1000);
  const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;
  const encodedHeader = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const encodedPayload = base64UrlJson({
    iss: serviceAccount.client_email,
    scope: SHEETS_READONLY_SCOPE,
    aud: tokenUri,
    iat: issuedAt,
    exp: issuedAt + 3600
  });
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key).toString("base64url");
  return `${unsigned}.${signature}`;
}

function defaultSleep(delay) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
}

function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status <= 599) || status === 0;
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function createGoogleSheetsClient({
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
  random = Math.random,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const tokenCache = new Map();

  async function fetchWithRetry({ url, options, maxRetries, secrets, operation }) {
    const retries = Math.max(0, Number(maxRetries) || 0);
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(url, { ...options, signal: controller.signal });
      } catch (cause) {
        clearTimeout(timeout);
        if (attempt < retries) {
          const delay = Math.min(4_000, 250 * (2 ** attempt)) + Math.floor(random() * 100);
          await sleep(delay);
          continue;
        }
        throw new GoogleSheetsApiError(
          sanitizeText(`${operation} failed: ${cause?.message ?? "network error"}`, secrets),
          { status: 0, attempts: attempt + 1, cause }
        );
      }
      clearTimeout(timeout);
      const body = await readResponseBody(response);
      if (response.ok) return body;
      if (isTransientStatus(response.status) && attempt < retries) {
        const delay = Math.min(4_000, 250 * (2 ** attempt)) + Math.floor(random() * 100);
        await sleep(delay);
        continue;
      }
      const excerpt = typeof body.raw === "string" ? body.raw : JSON.stringify(body);
      const safeExcerpt = sanitizeText(excerpt, secrets).slice(0, 1_000);
      throw new GoogleSheetsApiError(
        `${operation} failed with HTTP ${response.status}: ${safeExcerpt}`,
        { status: response.status, attempts: attempt + 1 }
      );
    }
    throw new GoogleSheetsApiError(`${operation} failed`, { attempts: maxRetries + 1 });
  }

  async function getAccessToken({ serviceAccount, maxRetries }) {
    validateServiceAccount(serviceAccount);
    const currentTime = resolveNow(now);
    const cached = tokenCache.get(serviceAccount.client_email);
    if (cached && cached.expiresAt - currentTime > 60_000) return cached.token;

    const assertion = createServiceAccountJwt({ serviceAccount, now: currentTime });
    const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }).toString();
    const response = await fetchWithRetry({
      url: tokenUri,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT
        },
        body
      },
      maxRetries,
      secrets: [serviceAccount.private_key, assertion],
      operation: "Google OAuth token exchange"
    });
    if (typeof response.access_token !== "string" || !response.access_token) {
      throw new GoogleSheetsApiError("Google OAuth token response omitted access_token", { status: 200 });
    }
    const expiresIn = Number.isFinite(Number(response.expires_in)) ? Number(response.expires_in) : 3600;
    tokenCache.set(serviceAccount.client_email, {
      token: response.access_token,
      expiresAt: currentTime + (expiresIn * 1000)
    });
    return response.access_token;
  }

  async function authorizedGet({ url, serviceAccount, maxRetries, operation }) {
    const accessToken = await getAccessToken({ serviceAccount, maxRetries });
    return fetchWithRetry({
      url,
      options: {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT
        }
      },
      maxRetries,
      secrets: [serviceAccount.private_key, accessToken],
      operation
    });
  }

  return Object.freeze({
    async fetchSpreadsheetMetadata({ spreadsheetId, serviceAccount, maxRetries = 4 }) {
      const encodedId = encodeURIComponent(spreadsheetId);
      const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodedId}`);
      url.searchParams.set(
        "fields",
        "spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,index,sheetType,hidden,gridProperties))"
      );
      return authorizedGet({
        url: url.toString(),
        serviceAccount,
        maxRetries,
        operation: "Google Sheets metadata request"
      });
    },

    async fetchRanges({ spreadsheetId, ranges, serviceAccount, maxRetries = 4 }) {
      const encodedId = encodeURIComponent(spreadsheetId);
      const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodedId}/values:batchGet`);
      for (const range of ranges) url.searchParams.append("ranges", range);
      url.searchParams.set("majorDimension", "ROWS");
      url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
      const response = await authorizedGet({
        url: url.toString(),
        serviceAccount,
        maxRetries,
        operation: "Google Sheets values request"
      });
      const returnedRanges = response.valueRanges ?? [];
      const returned = new Map(returnedRanges.map((entry) => [entry.range, entry]));
      const returnedByStart = new Map(returnedRanges.map((entry) => [rangeStartIdentity(entry.range), entry]));
      return ranges.map((range) => ({
        range,
        values: (returned.get(range) ?? returnedByStart.get(rangeStartIdentity(range)))?.values ?? []
      }));
    }
  });
}
