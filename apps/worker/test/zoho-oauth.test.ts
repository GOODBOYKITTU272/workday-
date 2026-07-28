import { describe, expect, it } from "vitest";

import { decryptToken, encryptToken } from "../src/token-crypto";
import { buildEncryptedZohoTokenUpdate } from "../src/zoho-tokens";
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
});
