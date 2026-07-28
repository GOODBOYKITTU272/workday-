import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { buildEncryptedZohoTokenUpdate, type ZohoMailboxTokenUpdate } from "./zoho-tokens.js";

const authorizationUrl = "https://accounts.zoho.com/oauth/v2/auth";
const tokenUrl = "https://accounts.zoho.com/oauth/v2/token";
const stateMaxAgeMs = 10 * 60 * 1000;
const scopes = ["ZohoMail.messages.READ", "ZohoMail.accounts.READ"];

type OAuthStatePayload = {
  issuedAt: number;
  mailboxId: string;
  nonce: string;
};

type OAuthEnv = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type OAuthFetcher = (url: string, init: { body: URLSearchParams; headers: Record<string, string>; method: "POST" }) => Promise<Response>;

function base64Url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function signState(payload: string, encryptionKey: string) {
  return createHmac("sha256", encryptionKey).update(payload).digest("base64url");
}

function signaturesMatch(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);

  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function generateZohoOAuthState({
  encryptionKey,
  mailboxId,
  nonce = randomBytes(16).toString("base64url"),
  nowMs = Date.now()
}: {
  encryptionKey: string;
  mailboxId: string;
  nonce?: string;
  nowMs?: number;
}) {
  const payload = base64Url(JSON.stringify({ issuedAt: nowMs, mailboxId, nonce } satisfies OAuthStatePayload));
  const signature = signState(payload, encryptionKey);

  return `${payload}.${signature}`;
}

export function validateZohoOAuthState({
  encryptionKey,
  nowMs = Date.now(),
  state
}: {
  encryptionKey: string;
  nowMs?: number;
  state: string;
}): { mailboxId: string; ok: true } | { error: string; ok: false } {
  const [payload, signature] = state.split(".");

  if (!payload || !signature || !signaturesMatch(signature, signState(payload, encryptionKey))) {
    return { error: "Invalid OAuth state.", ok: false };
  }

  let parsed: OAuthStatePayload;

  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthStatePayload;
  } catch {
    return { error: "Invalid OAuth state.", ok: false };
  }

  if (!parsed.mailboxId || !parsed.issuedAt || nowMs - parsed.issuedAt > stateMaxAgeMs) {
    return { error: "Expired OAuth state.", ok: false };
  }

  return { mailboxId: parsed.mailboxId, ok: true };
}

export function buildZohoOAuthUrl({
  clientId,
  redirectUri,
  state
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL(authorizationUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(","));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

export function validateZohoOAuthCallback({
  code,
  encryptionKey,
  nowMs = Date.now(),
  state
}: {
  code: string;
  encryptionKey: string;
  nowMs?: number;
  state: string;
}): { code: string; mailboxId: string; ok: true } | { error: string; ok: false } {
  if (!code.trim()) {
    return { error: "Authorization code is required.", ok: false };
  }

  const stateResult = validateZohoOAuthState({ encryptionKey, nowMs, state });

  if (!stateResult.ok) {
    return stateResult;
  }

  return { code: code.trim(), mailboxId: stateResult.mailboxId, ok: true };
}

export async function exchangeZohoAuthorizationCodeForEncryptedUpdate({
  code,
  encryptionKey,
  env,
  fetcher = fetch,
  nowMs = Date.now()
}: {
  code: string;
  encryptionKey: string;
  env: OAuthEnv;
  fetcher?: OAuthFetcher;
  nowMs?: number;
}): Promise<ZohoMailboxTokenUpdate> {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: env.redirectUri
  });
  const response = await fetcher(tokenUrl, {
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Zoho token exchange failed.");
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number; refresh_token?: string };

  if (!json.access_token || !json.refresh_token || !json.expires_in) {
    throw new Error("Zoho token exchange response is missing tokens.");
  }

  return buildEncryptedZohoTokenUpdate(
    {
      accessToken: json.access_token,
      expiresAt: new Date(nowMs + json.expires_in * 1000).toISOString(),
      refreshToken: json.refresh_token
    },
    encryptionKey,
    new Date(nowMs).toISOString()
  );
}
