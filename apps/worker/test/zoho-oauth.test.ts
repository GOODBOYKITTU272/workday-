import { describe, expect, it } from "vitest";

import { decryptToken, encryptToken } from "../src/token-crypto";
import {
  buildZohoOAuthUrl,
  exchangeZohoAuthorizationCodeForEncryptedUpdate,
  generateZohoOAuthState,
  validateZohoOAuthCallback,
  validateZohoOAuthState
} from "../src/zoho-oauth";
import { buildEncryptedZohoTokenUpdate, buildZohoOAuthFailureUpdate } from "../src/zoho-tokens";
import { createWorkerSupabaseClient, getWorkerEnv } from "../src/worker-env";

const encryptionKey = "0123456789abcdef0123456789abcdef";

describe("Zoho OAuth worker foundation", () => {
  it("validates required worker environment", () => {
    expect(() => getWorkerEnv({})).toThrow("SUPABASE_URL is required");

    expect(
      getWorkerEnv({
        ENCRYPTION_KEY: encryptionKey,
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        SUPABASE_URL: "https://example.supabase.co",
        ZOHO_CLIENT_ID: "client-id",
        ZOHO_CLIENT_SECRET: "client-secret",
        ZOHO_REDIRECT_URI: "https://worker.example.com/oauth/callback"
      })
    ).toEqual({
      encryptionKey,
      supabaseServiceRoleKey: "service-role-key",
      supabaseUrl: "https://example.supabase.co",
      zohoClientId: "client-id",
      zohoClientSecret: "client-secret",
      zohoRedirectUri: "https://worker.example.com/oauth/callback"
    });
  });

  it("encrypts and decrypts token values", () => {
    const encrypted = encryptToken("test-access-token", encryptionKey);

    expect(encrypted).not.toContain("test-access-token");
    expect(decryptToken(encrypted, encryptionKey)).toBe("test-access-token");
  });

  it("rejects tampered tokens and wrong encryption keys", () => {
    const encrypted = encryptToken("test-access-token", encryptionKey);
    const tampered = encrypted.replace(/.$/, (last) => (last === "A" ? "B" : "A"));

    expect(() => decryptToken(tampered, encryptionKey)).toThrow();
    expect(() => decryptToken(encrypted, "abcdef0123456789abcdef0123456789")).toThrow();
  });

  it("builds a safe encrypted mailbox update payload", () => {
    const payload = buildEncryptedZohoTokenUpdate(
      {
        accessToken: "test-access-token",
        expiresAt: "2026-07-28T10:00:00.000Z",
        refreshToken: "test-refresh-token"
      },
      encryptionKey,
      "2026-07-28T09:00:00.000Z"
    );

    expect(payload).toMatchObject({
      connection_status: "connected",
      last_error: null,
      last_success_at: "2026-07-28T09:00:00.000Z",
      token_expires_at: "2026-07-28T10:00:00.000Z"
    });
    expect(JSON.stringify(payload)).not.toContain("test-access-token");
    expect(JSON.stringify(payload)).not.toContain("test-refresh-token");
  });

  it("builds a schema-safe OAuth failure payload", () => {
    expect(buildZohoOAuthFailureUpdate("invalid grant")).toEqual({
      connection_status: "failed",
      last_error: "invalid grant"
    });
  });

  it("creates a worker-only Supabase service client from server env", () => {
    const client = createWorkerSupabaseClient({
      encryptionKey,
      supabaseServiceRoleKey: "service-role-key",
      supabaseUrl: "https://example.supabase.co",
      zohoClientId: "client-id",
      zohoClientSecret: "client-secret",
      zohoRedirectUri: "https://worker.example.com/oauth/callback"
    });

    expect(client).toBeDefined();
  });

  it("builds a Zoho OAuth URL with signed state", () => {
    const state = generateZohoOAuthState({ encryptionKey, mailboxId: "mailbox-id", nonce: "nonce", nowMs: 1000 });
    const url = new URL(
      buildZohoOAuthUrl({
        clientId: "client-id",
        redirectUri: "https://worker.example.com/oauth/callback",
        state
      })
    );

    expect(url.origin + url.pathname).toBe("https://accounts.zoho.com/oauth/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("validates state and callback input", () => {
    const state = generateZohoOAuthState({ encryptionKey, mailboxId: "mailbox-id", nonce: "nonce", nowMs: 1000 });

    expect(validateZohoOAuthState({ encryptionKey, nowMs: 2000, state })).toEqual({
      mailboxId: "mailbox-id",
      ok: true
    });
    expect(validateZohoOAuthCallback({ code: "auth-code", encryptionKey, nowMs: 2000, state })).toEqual({
      code: "auth-code",
      mailboxId: "mailbox-id",
      ok: true
    });
    expect(validateZohoOAuthCallback({ code: "", encryptionKey, nowMs: 2000, state })).toEqual({
      error: "Authorization code is required.",
      ok: false
    });
    expect(validateZohoOAuthCallback({ code: "auth-code", encryptionKey, nowMs: 2000, state: `${state}tampered` }).ok).toBe(false);
  });

  it("exchanges authorization codes into encrypted update payloads without returning secrets", async () => {
    const fetcher = async (_url: string, init: { body?: BodyInit | null }) => {
      const body = init.body?.toString() ?? "";

      expect(body).toContain("client_secret=client-secret");

      return new Response(
        JSON.stringify({
          access_token: "test-access-token",
          expires_in: 3600,
          refresh_token: "test-refresh-token"
        }),
        { status: 200 }
      );
    };

    const payload = await exchangeZohoAuthorizationCodeForEncryptedUpdate({
      code: "auth-code",
      encryptionKey,
      env: {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://worker.example.com/oauth/callback"
      },
      fetcher,
      nowMs: Date.parse("2026-07-28T09:00:00.000Z")
    });

    expect(JSON.stringify(payload)).not.toContain("client-secret");
    expect(JSON.stringify(payload)).not.toContain("auth-code");
    expect(JSON.stringify(payload)).not.toContain("test-access-token");
    expect(JSON.stringify(payload)).not.toContain("test-refresh-token");
    expect(payload.connection_status).toBe("connected");
    expect(payload.token_expires_at).toBe("2026-07-28T10:00:00.000Z");
  });
});
