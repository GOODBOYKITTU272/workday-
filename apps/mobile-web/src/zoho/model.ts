import type { AppRole } from "../auth/model";

export type ZohoConnectionStatus = "not_connected" | "connected" | "expired" | "failed" | "revoked";

export type ZohoMailboxRecord = {
  id: string;
  candidate_id: string;
  connection_status: ZohoConnectionStatus;
  created_at: string;
  email: string;
  last_error: string | null;
  last_otp_check_at: string | null;
  last_success_at: string | null;
  token_expires_at: string | null;
  updated_at: string;
  zoho_account_id: string | null;
};

export type ZohoMailboxInput = {
  candidateId: string;
  connection_status?: ZohoConnectionStatus;
  email: string;
  last_error?: string;
  zoho_account_id?: string;
};

export type ZohoMailboxValidationErrors = {
  candidateId?: string;
  email?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canManageZohoMailbox(role: AppRole | null | undefined) {
  return role === "admin" || role === "operator";
}

export function validateZohoMailboxInput(input: ZohoMailboxInput): ZohoMailboxValidationErrors {
  const errors: ZohoMailboxValidationErrors = {};
  const email = input.email.trim();

  if (!input.candidateId) {
    errors.candidateId = "Candidate is required.";
  }

  if (!email) {
    errors.email = "Email is required.";
  } else if (!emailPattern.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  return errors;
}

export function toZohoMailboxPayload(input: ZohoMailboxInput) {
  return {
    candidate_id: input.candidateId,
    connection_status: input.connection_status ?? "not_connected",
    email: input.email.trim().toLowerCase(),
    last_error: input.last_error?.trim() || null,
    zoho_account_id: input.zoho_account_id?.trim() || null
  };
}

export function isMailboxEmailMismatch(candidateEmail: string, mailboxEmail: string | null | undefined) {
  if (!mailboxEmail) {
    return false;
  }

  return candidateEmail.trim().toLowerCase() !== mailboxEmail.trim().toLowerCase();
}
