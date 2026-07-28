import { detectWorkdayTenantFromUrl } from "@applywizz/shared";

import type { AppRole } from "../auth/model";

export type WorkdayAccountStatus =
  | "unknown"
  | "created"
  | "existing"
  | "login_success"
  | "login_failed"
  | "otp_required"
  | "locked"
  | "disabled";

export type WorkdayAccountRecord = {
  account_status: WorkdayAccountStatus;
  candidate_id: string;
  created_at: string;
  email: string;
  id: string;
  last_error: string | null;
  last_login_at: string | null;
  tenant_key: string;
  tenant_name: string | null;
  updated_at: string;
  username: string | null;
  workday_base_url: string | null;
};

export type WorkdayAccountInput = {
  account_status?: WorkdayAccountStatus;
  candidateId: string;
  email: string;
  last_error?: string;
  tenant_key: string;
  tenant_name?: string;
  username?: string;
  workday_base_url?: string;
};

export type WorkdayAccountValidationErrors = {
  candidateId?: string;
  email?: string;
  tenant_key?: string;
  workday_base_url?: string;
};

export type WorkdayAccountReadinessInput = {
  accounts: Pick<WorkdayAccountRecord, "account_status" | "tenant_key">[];
  candidateEmail: string | null | undefined;
  jobLinks: Array<{ url: string; workday_tenant_key: string | null }>;
};

export type WorkdayAccountReadiness = {
  accountExists: boolean;
  accountStatus: WorkdayAccountStatus | null;
  candidateEmailExists: boolean;
  jobLinkExists: boolean;
  tenantDetected: boolean;
  tenantKey: string | null;
  workdayBaseUrl: string | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function canManageWorkdayAccounts(role: AppRole | null | undefined) {
  return role === "admin" || role === "operator";
}

export function validateWorkdayAccountInput(input: WorkdayAccountInput): WorkdayAccountValidationErrors {
  const errors: WorkdayAccountValidationErrors = {};
  const email = input.email.trim();
  const tenantKey = input.tenant_key.trim();
  const baseUrl = input.workday_base_url?.trim();

  if (!input.candidateId) {
    errors.candidateId = "Candidate is required.";
  }

  if (!tenantKey) {
    errors.tenant_key = "Tenant key is required.";
  }

  if (!email) {
    errors.email = "Email is required.";
  } else if (!emailPattern.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (baseUrl) {
    try {
      new URL(baseUrl);
    } catch {
      errors.workday_base_url = "Enter a valid URL.";
    }
  }

  return errors;
}

export function toWorkdayAccountPayload(input: WorkdayAccountInput) {
  return {
    account_status: input.account_status ?? "unknown",
    candidate_id: input.candidateId,
    email: input.email.trim().toLowerCase(),
    last_error: input.last_error?.trim() || null,
    tenant_key: input.tenant_key.trim(),
    tenant_name: input.tenant_name?.trim() || null,
    username: input.username?.trim() || null,
    workday_base_url: input.workday_base_url?.trim() || null
  };
}

export function isWorkdayAccountEmailMismatch(candidateEmail: string, accountEmail: string | null | undefined) {
  if (!accountEmail) {
    return false;
  }

  return candidateEmail.trim().toLowerCase() !== accountEmail.trim().toLowerCase();
}

export function buildWorkdayAccountReadiness(input: WorkdayAccountReadinessInput): WorkdayAccountReadiness {
  const detected = input.jobLinks
    .map((jobLink) => {
      const parsed = detectWorkdayTenantFromUrl(jobLink.url);

      return {
        baseUrl: parsed.workday_base_url,
        tenantKey: jobLink.workday_tenant_key || parsed.tenant_key
      };
    })
    .find((item) => item.tenantKey);
  const account = detected?.tenantKey ? input.accounts.find((item) => item.tenant_key === detected.tenantKey) : null;

  return {
    accountExists: Boolean(account),
    accountStatus: account?.account_status ?? null,
    candidateEmailExists: Boolean(input.candidateEmail?.trim()),
    jobLinkExists: input.jobLinks.length > 0,
    tenantDetected: Boolean(detected?.tenantKey),
    tenantKey: detected?.tenantKey ?? null,
    workdayBaseUrl: detected?.baseUrl ?? null
  };
}
