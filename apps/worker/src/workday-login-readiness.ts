import { decryptWorkdayPassword } from "./workday-password.js";
import type { WorkerWorkdayAccountStatus } from "./workday-tenant.js";

export type WorkdayLoginAccountRecord = {
  account_status: WorkerWorkdayAccountStatus;
  email: string | null;
  password_encrypted: string | null;
} | null;

export type WorkdayLoginReadinessBlockedReason =
  | "account_disabled"
  | "account_locked"
  | "account_missing"
  | "email_missing"
  | "password_decrypt_failed"
  | "password_missing"
  | "readiness_check_failed"
  | "tenant_unknown";

export type WorkdayLoginReadinessResult = { ok: true } | { blockedReason: WorkdayLoginReadinessBlockedReason; ok: false };

export function validateWorkdayLoginAccountShape(account: WorkdayLoginAccountRecord): WorkdayLoginReadinessResult {
  if (!account) {
    return { blockedReason: "account_missing", ok: false };
  }

  if (account.account_status === "locked") {
    return { blockedReason: "account_locked", ok: false };
  }

  if (account.account_status === "disabled") {
    return { blockedReason: "account_disabled", ok: false };
  }

  if (!account.email?.trim()) {
    return { blockedReason: "email_missing", ok: false };
  }

  if (!account.password_encrypted?.trim()) {
    return { blockedReason: "password_missing", ok: false };
  }

  return { ok: true };
}

// Never returns the decrypted plaintext, only whether decryption succeeded.
export function canDecryptWorkdayLoginPassword(passwordEncrypted: string, encryptionKey: string): WorkdayLoginReadinessResult {
  try {
    decryptWorkdayPassword(passwordEncrypted, encryptionKey);

    return { ok: true };
  } catch {
    return { blockedReason: "password_decrypt_failed", ok: false };
  }
}

export function evaluateWorkdayLoginReadiness(
  tenantKey: string | null,
  account: WorkdayLoginAccountRecord,
  encryptionKey: string
): WorkdayLoginReadinessResult {
  if (!tenantKey) {
    return { blockedReason: "tenant_unknown", ok: false };
  }

  const shape = validateWorkdayLoginAccountShape(account);

  if (!shape.ok) {
    return shape;
  }

  return canDecryptWorkdayLoginPassword(account!.password_encrypted!, encryptionKey);
}
