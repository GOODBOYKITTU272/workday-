import { detectWorkdayTenantFromUrl } from "@applywizz/shared";

export type WorkerWorkdayAccountStatus =
  | "unknown"
  | "created"
  | "existing"
  | "login_success"
  | "login_failed"
  | "otp_required"
  | "locked"
  | "disabled";

export type WorkerWorkdayAccountReadinessInput = {
  account: { account_status: WorkerWorkdayAccountStatus; tenant_key: string } | null;
  candidateEmail: string | null | undefined;
  jobLink: { url: string; workday_tenant_key: string | null } | null;
};

export function detectWorkerWorkdayTenant(rawUrl: string) {
  return detectWorkdayTenantFromUrl(rawUrl);
}

export function buildWorkerWorkdayAccountReadiness(input: WorkerWorkdayAccountReadinessInput) {
  const parsed = input.jobLink ? detectWorkerWorkdayTenant(input.jobLink.url) : null;
  const tenantKey = input.jobLink?.workday_tenant_key || parsed?.tenant_key || null;
  const accountMatchesTenant = Boolean(input.account && tenantKey && input.account.tenant_key === tenantKey);

  return {
    accountExists: accountMatchesTenant,
    accountStatus: accountMatchesTenant ? (input.account?.account_status ?? null) : null,
    candidateEmailExists: Boolean(input.candidateEmail?.trim()),
    needsAccountCreation: Boolean(tenantKey && !accountMatchesTenant),
    tenantDetected: Boolean(tenantKey),
    tenantKey,
    workdayBaseUrl: parsed?.workday_base_url ?? null
  };
}
