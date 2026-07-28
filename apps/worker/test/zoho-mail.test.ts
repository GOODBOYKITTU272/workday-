import { describe, expect, it } from "vitest";

import { encryptToken } from "../src/token-crypto";
import {
  buildZohoMailSearchUrl,
  buildZohoRefreshAccessTokenUpdate,
  decryptZohoMailboxSecrets,
  loadZohoMailboxSecrets,
  parseWorkdayVerificationEmail,
  searchZohoMessages
} from "../src/zoho-mail";

const encryptionKey = "0123456789abcdef0123456789abcdef";

describe("Zoho mail reader foundation", () => {
  it("decrypts mailbox tokens from service-role rows", () => {
    const secrets = decryptZohoMailboxSecrets(
      {
        access_token_encrypted: encryptToken("access-token", encryptionKey),
        id: "mailbox-id",
        refresh_token_encrypted: encryptToken("refresh-token", encryptionKey),
        token_expires_at: "2026-07-28T10:00:00.000Z",
        zoho_account_id: "123456"
      },
      encryptionKey
    );

    expect(secrets).toEqual({
      accessToken: "access-token",
      accountId: "123456",
      mailboxId: "mailbox-id",
      refreshToken: "refresh-token",
      tokenExpiresAt: "2026-07-28T10:00:00.000Z"
    });
  });

  it("loads encrypted mailbox tokens through the service-role client", async () => {
    const selected: string[] = [];
    const secretRow = {
      access_token_encrypted: encryptToken("access-token", encryptionKey),
      id: "mailbox-id",
      refresh_token_encrypted: encryptToken("refresh-token", encryptionKey),
      token_expires_at: null,
      zoho_account_id: "123456"
    };
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("zoho_mailboxes");

        return {
          select: (columns: string) => {
            selected.push(columns);

            return {
              eq: (column: string, value: string) => {
                expect(column).toBe("id");
                expect(value).toBe("mailbox-id");

                return {
                  single: async () => ({ data: secretRow, error: null })
                };
              }
            };
          }
        };
      }
    };

    await expect(loadZohoMailboxSecrets(supabase, "mailbox-id", encryptionKey)).resolves.toMatchObject({
      accessToken: "access-token",
      accountId: "123456",
      refreshToken: "refresh-token"
    });
    expect(selected[0]).toBe("id, zoho_account_id, access_token_encrypted, refresh_token_encrypted, token_expires_at");
  });

  it("refreshes access tokens into encrypted update payloads without returning plaintext tokens", async () => {
    const payload = await buildZohoRefreshAccessTokenUpdate({
      encryptionKey,
      env: {
        clientId: "client-id",
        clientSecret: "client-secret"
      },
      fetcher: async (_url, init) => {
        const body = init.body.toString();

        expect(body).toContain("refresh_token=refresh-token");
        expect(body).toContain("client_secret=client-secret");

        return new Response(JSON.stringify({ access_token: "new-access-token", expires_in: 3600 }), { status: 200 });
      },
      nowMs: Date.parse("2026-07-28T09:00:00.000Z"),
      refreshToken: "refresh-token"
    });

    expect(JSON.stringify(payload)).not.toContain("new-access-token");
    expect(JSON.stringify(payload)).not.toContain("refresh-token");
    expect(payload.connection_status).toBe("connected");
    expect(payload.token_expires_at).toBe("2026-07-28T10:00:00.000Z");
  });

  it("builds a Zoho message search URL and uses token auth without returning the token", async () => {
    const url = new URL(buildZohoMailSearchUrl({ accountId: "123456", limit: 5, searchKey: "workday" }));

    expect(url.origin + url.pathname).toBe("https://mail.zoho.com/api/accounts/123456/messages/search");
    expect(url.searchParams.get("searchKey")).toBe("workday");
    expect(url.searchParams.get("limit")).toBe("5");

    const messages = await searchZohoMessages({
      accessToken: "access-token",
      accountId: "123456",
      fetcher: async (_url, init) => {
        expect(init.headers.Authorization).toBe("Zoho-oauthtoken access-token");

        return new Response(
          JSON.stringify({
            data: [
              {
                content: "Your Workday verification code is 842193.",
                fromAddress: "no-reply@myworkday.com",
                receivedTime: "2026-07-28T09:00:00.000Z",
                subject: "Workday security code"
              }
            ]
          }),
          { status: 200 }
        );
      },
      limit: 5,
      searchKey: "workday"
    });

    expect(JSON.stringify(messages)).not.toContain("access-token");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.subject).toBe("Workday security code");
  });

  it("extracts a high-confidence Workday OTP from mocked email text", () => {
    expect(
      parseWorkdayVerificationEmail({
        body: "Use security code 842193 to continue signing in to Workday.",
        fromAddress: "no-reply@myworkday.com",
        subject: "Your Workday verification code"
      })
    ).toEqual({
      confidence: "high",
      kind: "found_otp",
      otpCode: "842193"
    });
  });

  it("extracts a high-confidence Workday verification link from mocked email HTML", () => {
    expect(
      parseWorkdayVerificationEmail({
        body: '<p>Confirm your email:</p><a href="https://wd5.myworkday.com/acme/verifyEmail?token=abc">Verify email</a>',
        fromAddress: "notifications@myworkday.com",
        subject: "Verify your Workday email"
      })
    ).toEqual({
      confidence: "high",
      kind: "found_verification_link",
      verificationLink: "https://wd5.myworkday.com/acme/verifyEmail?token=abc"
    });
  });

  it("returns no_match for unrelated messages and ambiguous multi-code messages", () => {
    expect(
      parseWorkdayVerificationEmail({
        body: "Welcome to the newsletter.",
        fromAddress: "hello@example.com",
        subject: "Weekly update"
      })
    ).toEqual({ kind: "no_match", reason: "no_workday_signal" });

    expect(
      parseWorkdayVerificationEmail({
        body: "Codes 111111 and 222222 were requested.",
        fromAddress: "no-reply@myworkday.com",
        subject: "Workday security code"
      })
    ).toEqual({ kind: "no_match", reason: "ambiguous_otp" });
  });
});
