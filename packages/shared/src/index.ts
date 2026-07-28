export const APP_NAME = "ApplyWizz Workday Dry-Run Automation Engine";

export const V1_SAFETY_DEFAULTS = {
  autoSubmitEnabled: false,
  dryRunRequired: true,
  humanApprovalRequired: true
} as const;

export type AppEnvironment = "local" | "staging" | "production";

export type WorkdayTenantDetectionConfidence = "high" | "medium" | "none";
export type WorkdayTenantDetectionReason = "detected" | "invalid_url" | "tenant_not_detected" | "untrusted_host";

export type WorkdayTenantDetectionResult = {
  confidence: WorkdayTenantDetectionConfidence;
  error?: string;
  is_workday_url: boolean;
  normalized_url: string | null;
  reason: WorkdayTenantDetectionReason;
  tenant_key: string | null;
  tenant_name: string | null;
  workday_base_url: string | null;
};

const trustedWorkdayRootHosts = ["workday.com", "myworkday.com", "myworkdayjobs.com"];

export function isTrustedWorkdayHost(url: URL) {
  const hostname = url.hostname.toLowerCase();

  return trustedWorkdayRootHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

export function detectWorkdayTenantFromUrl(rawUrl: string): WorkdayTenantDetectionResult {
  let url: URL;

  try {
    url = new URL(rawUrl.trim());
  } catch {
    return failedWorkdayDetection("invalid_url", "Enter a valid URL.");
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

  if (!isTrustedWorkdayHost(url)) {
    return failedWorkdayDetection("untrusted_host", "Untrusted Workday hostname.");
  }

  const tenantKey = tenantKeyFromWorkdayUrl(url);
  const baseUrl = tenantKey ? workdayBaseUrl(url, tenantKey) : url.origin;

  return {
    confidence: tenantKey ? "high" : "medium",
    is_workday_url: true,
    normalized_url: url.toString(),
    reason: tenantKey ? "detected" : "tenant_not_detected",
    tenant_key: tenantKey,
    tenant_name: tenantKey,
    workday_base_url: baseUrl
  };
}

function failedWorkdayDetection(reason: Exclude<WorkdayTenantDetectionReason, "detected" | "tenant_not_detected">, error: string): WorkdayTenantDetectionResult {
  return {
    confidence: "none",
    error,
    is_workday_url: false,
    normalized_url: null,
    reason,
    tenant_key: null,
    tenant_name: null,
    workday_base_url: null
  };
}

function tenantKeyFromWorkdayUrl(url: URL) {
  const hostname = url.hostname.toLowerCase();
  const hostnameParts = hostname.split(".");
  const firstHostPart = hostnameParts[0] ?? "";

  if (hostname.endsWith(".myworkdayjobs.com") && firstHostPart && !/^wd\d+$/.test(firstHostPart)) {
    return firstHostPart;
  }

  if (hostname.endsWith(".myworkday.com") && /^wd\d+$/.test(firstHostPart)) {
    return firstPathPart(url);
  }

  if (hostname.endsWith(".workday.com") && /^wd\d+$/.test(firstHostPart)) {
    return firstPathPart(url);
  }

  return null;
}

function workdayBaseUrl(url: URL, tenantKey: string) {
  const firstHostPart = url.hostname.split(".")[0] ?? "";

  if (/^wd\d+$/.test(firstHostPart)) {
    return `${url.origin}/${tenantKey}`;
  }

  return url.origin;
}

function firstPathPart(url: URL) {
  return url.pathname.split("/").filter(Boolean)[0] ?? null;
}
