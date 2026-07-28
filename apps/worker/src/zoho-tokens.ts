import { encryptToken } from "./token-crypto.js";

export type ZohoTokenInput = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
};

export type ZohoMailboxTokenUpdate = {
  access_token_encrypted: string;
  connection_status: "connected";
  last_error: null;
  last_success_at: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
};

type ZohoMailboxTokenClient = {
  from: (table: "zoho_mailboxes") => {
    update: (payload: ZohoMailboxTokenUpdate) => {
      eq: (column: "id", value: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export function buildEncryptedZohoTokenUpdate(
  input: ZohoTokenInput,
  encryptionKey: string,
  updatedAt = new Date().toISOString()
): ZohoMailboxTokenUpdate {
  return {
    access_token_encrypted: encryptToken(input.accessToken, encryptionKey),
    connection_status: "connected",
    last_error: null,
    last_success_at: updatedAt,
    refresh_token_encrypted: encryptToken(input.refreshToken, encryptionKey),
    token_expires_at: input.expiresAt
  };
}

export async function updateZohoMailboxTokens(
  supabase: ZohoMailboxTokenClient,
  mailboxId: string,
  input: ZohoTokenInput,
  encryptionKey: string
) {
  const payload = buildEncryptedZohoTokenUpdate(input, encryptionKey);
  const { error } = await supabase.from("zoho_mailboxes").update(payload).eq("id", mailboxId);

  if (error) {
    throw new Error(error.message);
  }
}
