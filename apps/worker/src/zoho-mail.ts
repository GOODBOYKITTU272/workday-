import { decryptToken } from "./token-crypto.js";
import { buildEncryptedZohoTokenUpdate, type ZohoMailboxTokenUpdate } from "./zoho-tokens.js";

const mailApiBaseUrl = "https://mail.zoho.com/api";
const tokenUrl = "https://accounts.zoho.com/oauth/v2/token";

type ZohoFetcher = (url: string, init: { body: URLSearchParams; headers: Record<string, string>; method: "POST" }) => Promise<Response>;
type ZohoMailFetcher = (url: string, init: { headers: Record<string, string>; method: "GET" }) => Promise<Response>;
type ZohoMailboxSecretClient = {
  from: (table: "zoho_mailboxes") => {
    select: (columns: string) => {
      eq: (column: "id", value: string) => {
        single: () => Promise<{ data: ZohoMailboxSecretRow | null; error: { message: string } | null }>;
      };
    };
  };
};

export type ZohoMailboxSecretRow = {
  access_token_encrypted: string | null;
  id: string;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  zoho_account_id: string | null;
};

export type ZohoMailboxSecrets = {
  accessToken: string;
  accountId: string;
  mailboxId: string;
  refreshToken: string;
  tokenExpiresAt: string | null;
};

export type ZohoMailMessage = {
  body: string;
  fromAddress: string;
  receivedTime?: string;
  subject: string;
};

export type WorkdayEmailResult =
  | { confidence: "high" | "low"; kind: "found_otp"; otpCode: string }
  | { confidence: "high" | "low"; kind: "found_verification_link"; verificationLink: string }
  | { kind: "no_match"; reason: "ambiguous_otp" | "no_workday_signal" | "no_workday_token" }
  | { error: string; kind: "expired_or_error" };

export function decryptZohoMailboxSecrets(row: ZohoMailboxSecretRow, encryptionKey: string): ZohoMailboxSecrets {
  if (!row.zoho_account_id || !row.access_token_encrypted || !row.refresh_token_encrypted) {
    throw new Error("Zoho mailbox tokens are not connected.");
  }

  return {
    accessToken: decryptToken(row.access_token_encrypted, encryptionKey),
    accountId: row.zoho_account_id,
    mailboxId: row.id,
    refreshToken: decryptToken(row.refresh_token_encrypted, encryptionKey),
    tokenExpiresAt: row.token_expires_at
  };
}

export async function loadZohoMailboxSecrets(
  supabase: ZohoMailboxSecretClient,
  mailboxId: string,
  encryptionKey: string
): Promise<ZohoMailboxSecrets> {
  const { data, error } = await supabase
    .from("zoho_mailboxes")
    .select("id, zoho_account_id, access_token_encrypted, refresh_token_encrypted, token_expires_at")
    .eq("id", mailboxId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Zoho mailbox not found.");
  }

  return decryptZohoMailboxSecrets(data, encryptionKey);
}

export async function buildZohoRefreshAccessTokenUpdate({
  encryptionKey,
  env,
  fetcher = fetch,
  nowMs = Date.now(),
  refreshToken
}: {
  encryptionKey: string;
  env: { clientId: string; clientSecret: string };
  fetcher?: ZohoFetcher;
  nowMs?: number;
  refreshToken: string;
}): Promise<ZohoMailboxTokenUpdate> {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  const response = await fetcher(tokenUrl, {
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error("Zoho token refresh failed.");
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };

  if (!json.access_token || !json.expires_in) {
    throw new Error("Zoho token refresh response is missing tokens.");
  }

  return buildEncryptedZohoTokenUpdate(
    {
      accessToken: json.access_token,
      expiresAt: new Date(nowMs + json.expires_in * 1000).toISOString(),
      refreshToken
    },
    encryptionKey,
    new Date(nowMs).toISOString()
  );
}

export function buildZohoMailSearchUrl({
  accountId,
  limit = 10,
  searchKey = "workday"
}: {
  accountId: string;
  limit?: number;
  searchKey?: string;
}) {
  const url = new URL(`${mailApiBaseUrl}/accounts/${encodeURIComponent(accountId)}/messages/search`);
  url.searchParams.set("searchKey", searchKey);
  url.searchParams.set("limit", String(limit));

  return url.toString();
}

export async function searchZohoMessages({
  accessToken,
  accountId,
  fetcher = fetch,
  limit,
  searchKey
}: {
  accessToken: string;
  accountId: string;
  fetcher?: ZohoMailFetcher;
  limit?: number;
  searchKey?: string;
}): Promise<ZohoMailMessage[]> {
  const response = await fetcher(buildZohoMailSearchUrl({ accountId, limit, searchKey }), {
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${accessToken}`
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new Error("Zoho mail search failed.");
  }

  const json = (await response.json()) as { data?: unknown };
  const rows = Array.isArray(json.data) ? json.data : [];

  return rows.map((row) => {
    const message = row as Record<string, unknown>;

    return {
      body: stringField(message.content) || stringField(message.summary),
      fromAddress: stringField(message.fromAddress) || stringField(message.sender),
      receivedTime: stringField(message.receivedTime),
      subject: stringField(message.subject)
    };
  });
}

export function parseWorkdayVerificationEmail(message: ZohoMailMessage): WorkdayEmailResult {
  const text = [message.fromAddress, message.subject, message.body].join(" ");
  const lowerText = text.toLowerCase();
  const workdayLinks = extractLinks(message.body).filter((link) => link.toLowerCase().includes("workday"));
  const hasWorkdaySignal = lowerText.includes("workday") || lowerText.includes("myworkday") || workdayLinks.length > 0;

  if (!hasWorkdaySignal) {
    return { kind: "no_match", reason: "no_workday_signal" };
  }

  const codes = Array.from(new Set(text.match(/\b\d{6}\b/g) ?? []));

  if (codes.length > 1) {
    return { kind: "no_match", reason: "ambiguous_otp" };
  }

  const confidence = lowerText.includes("myworkday") || lowerText.includes("verification") || lowerText.includes("security code") ? "high" : "low";

  if (codes.length === 1) {
    return { confidence, kind: "found_otp", otpCode: codes[0] ?? "" };
  }

  const verificationLink = workdayLinks.find((link) => /verify|confirm|activate/i.test(link));

  if (verificationLink) {
    return { confidence, kind: "found_verification_link", verificationLink };
  }

  return { kind: "no_match", reason: "no_workday_token" };
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function extractLinks(input: string) {
  return Array.from(input.matchAll(/https?:\/\/[^\s"'<>]+/g), ([link]) => link.replace(/[),.]+$/, "").replace(/&amp;/g, "&"));
}
