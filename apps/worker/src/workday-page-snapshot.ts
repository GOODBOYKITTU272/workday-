import { detectWorkdayTenantFromUrl, isTrustedWorkdayHost, type WorkdayTenantDetectionResult } from "@applywizz/shared";

import { createBrowserContext } from "./browser.js";

type BrowserLauncher = Parameters<typeof createBrowserContext>[0];

export type WorkdayPageKind =
  | "already_signed_in_page"
  | "create_account_page"
  | "error_page"
  | "job_page"
  | "sign_in_page"
  | "unavailable_page"
  | "unknown";
export type WorkdayPageLoadStatus = "error" | "loaded";
export type WorkdayLandingPageConfidence = "high" | "low" | "medium";

export type WorkdayLandingPageClassification = {
  confidence: WorkdayLandingPageConfidence;
  page_kind: WorkdayPageKind;
};

export type SafeWorkdayPageSnapshot = {
  confidence: WorkdayTenantDetectionResult["confidence"];
  final_url: string;
  hostname: string;
  load_status: WorkdayPageLoadStatus;
  page_kind_confidence: WorkdayLandingPageConfidence;
  page_kind: WorkdayPageKind;
  page_title: string | null;
  tenant_key: string | null;
  tenant_name: string | null;
  timestamp: string;
  workday_base_url: string | null;
};

export type WorkdayPageOpenCheckResult =
  | {
      error: string;
      error_code: "UNTRUSTED_REDIRECT";
      final_url: string;
      hostname: string;
      load_status: "blocked";
      ok: false;
      page_kind: "untrusted_redirect";
      url: string;
    }
  | { ok: false; error: string; error_code: "invalid_url" | "page_open_failed" | "untrusted_host" | "unsupported_protocol"; url: string }
  | { ok: true; snapshot: SafeWorkdayPageSnapshot; url: string };

type WorkdayPageBlockedRedirectResult = {
  error: string;
  error_code: "UNTRUSTED_REDIRECT";
  final_url: string;
  hostname: string;
  load_status: "blocked";
  ok: false;
  page_kind: "untrusted_redirect";
  url: string;
};

type PageLike = {
  goto: (url: string, options?: { timeout?: number; waitUntil?: "commit" | "domcontentloaded" | "load" | "networkidle" }) => Promise<unknown>;
  title: () => Promise<string>;
  url: () => string;
  close: () => Promise<void>;
};

const WORKDAY_OPEN_TIMEOUT_MS = 30_000;

export async function openTrustedWorkdayJobPage(
  rawUrl: string,
  options?: {
    launcher?: BrowserLauncher;
    now?: () => string;
  }
) {
  const parsed = validateTrustedWorkdayJobUrl(rawUrl);

  if (!parsed.ok) {
    return parsed;
  }

  let browser: Awaited<ReturnType<typeof createBrowserContext>>["browser"] | null = null;
  let context: Awaited<ReturnType<typeof createBrowserContext>>["context"] | null = null;
  let page: PageLike | null = null;

  try {
    const created = await createBrowserContext(options?.launcher);
    browser = created.browser;
    context = created.context;
    page = await context.newPage();

    await page.goto(parsed.normalizedUrl, {
      timeout: WORKDAY_OPEN_TIMEOUT_MS,
      waitUntil: "domcontentloaded"
    });

    const finalValidation = validateTrustedWorkdayFinalUrl(page.url());

    if (!finalValidation.ok) {
      return finalValidation;
    }

    const snapshotOrBlocked = await captureSafePageSnapshot(page, finalValidation.detection, options?.now?.());

    if ("ok" in snapshotOrBlocked) {
      return snapshotOrBlocked;
    }

    return {
      ok: true,
      snapshot: snapshotOrBlocked,
      url: snapshotOrBlocked.final_url
    } satisfies WorkdayPageOpenCheckResult;
  } catch {
    return {
      error: "Failed to open Workday job page.",
      error_code: "page_open_failed",
      ok: false,
      url: rawUrl.trim()
    } satisfies WorkdayPageOpenCheckResult;
  } finally {
    await page?.close();
    await context?.close();
    await browser?.close();
  }
}

export async function captureSafePageSnapshot(
  page: PageLike,
  detection: WorkdayTenantDetectionResult,
  timestamp = new Date().toISOString()
): Promise<SafeWorkdayPageSnapshot | WorkdayPageBlockedRedirectResult> {
  const finalValidation = validateTrustedWorkdayFinalUrl(page.url());

  if (!finalValidation.ok) {
    return finalValidation;
  }

  const finalUrl = finalValidation.normalizedUrl;
  const url = new URL(finalUrl);
  const pageTitle = await page.title();

  return buildSafeWorkdayPageMetadata({
    confidence: finalValidation.detection.confidence,
    finalUrl,
    hostname: url.hostname,
    loadStatus: "loaded",
    pageTitle: pageTitle.trim() || null,
    tenantKey: finalValidation.detection.tenant_key,
    tenantName: finalValidation.detection.tenant_name,
    timestamp,
    workdayBaseUrl: finalValidation.detection.workday_base_url
  });
}

export function buildSafeWorkdayPageMetadata(input: {
  confidence: WorkdayTenantDetectionResult["confidence"];
  finalUrl: string;
  hostname: string;
  loadStatus: WorkdayPageLoadStatus;
  pageTitle: string | null;
  tenantKey: string | null;
  tenantName: string | null;
  timestamp: string;
  workdayBaseUrl: string | null;
}): SafeWorkdayPageSnapshot {
  const classification = classifyWorkdayLandingPage(input.finalUrl, input.pageTitle);

  return {
    confidence: input.confidence,
    final_url: input.finalUrl,
    hostname: input.hostname,
    load_status: input.loadStatus,
    page_kind: classification.page_kind,
    page_kind_confidence: classification.confidence,
    page_title: input.pageTitle,
    tenant_key: input.tenantKey,
    tenant_name: input.tenantName,
    timestamp: input.timestamp,
    workday_base_url: input.workdayBaseUrl
  };
}

export function redactPageSnapshotForLogs(snapshot: Record<string, unknown>) {
  return {
    confidence: snapshot.confidence as WorkdayTenantDetectionResult["confidence"] | undefined,
    final_url: snapshot.final_url as string | undefined,
    hostname: snapshot.hostname as string | undefined,
    load_status: snapshot.load_status as WorkdayPageLoadStatus | undefined,
    page_kind_confidence: snapshot.page_kind_confidence as WorkdayLandingPageConfidence | undefined,
    page_kind: snapshot.page_kind as WorkdayPageKind | undefined,
    page_title: snapshot.page_title as string | null | undefined,
    tenant_key: snapshot.tenant_key as string | null | undefined,
    tenant_name: snapshot.tenant_name as string | null | undefined,
    timestamp: snapshot.timestamp as string | undefined,
    workday_base_url: snapshot.workday_base_url as string | null | undefined
  };
}

export async function runWorkdayPageOpenCheck(rawUrl: string, options?: { launcher?: BrowserLauncher }) {
  return openTrustedWorkdayJobPage(rawUrl, options);
}

export function classifyWorkdayLandingPage(finalUrl: string, pageTitle: string | null): WorkdayLandingPageClassification {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(finalUrl.trim());
  } catch {
    return {
      confidence: "low",
      page_kind: "unknown"
    };
  }

  const pathAndTitle = `${parsedUrl.pathname} ${pageTitle ?? ""}`.toLowerCase();
  const titleOnly = (pageTitle ?? "").toLowerCase();

  if (isUnavailableWorkdayPage(pathAndTitle)) {
    return {
      confidence: "high",
      page_kind: "unavailable_page"
    };
  }

  if (isErrorWorkdayPage(pathAndTitle)) {
    return {
      confidence: "high",
      page_kind: "error_page"
    };
  }

  if (/create[\s-]?account|sign[\s-]?up|register|new[\s-]?account/.test(pathAndTitle)) {
    return {
      confidence: "high",
      page_kind: "create_account_page"
    };
  }

  if (/sign[\s-]?in|sign[\s-]?on|log[\s-]?in|login|authenticate|single[\s-]?sign[\s-]?on|sso/.test(pathAndTitle)) {
    return {
      confidence: "high",
      page_kind: "sign_in_page"
    };
  }

  if (/already[\s-]?signed[\s-]?in|my[\s-]?applications|application[\s-]?status|candidate[\s-]?home|workday[\s-]?home|dashboard/.test(pathAndTitle)) {
    return {
      confidence: titleOnly ? "medium" : "low",
      page_kind: "already_signed_in_page"
    };
  }

  if (isJobPage(pathAndTitle)) {
    return {
      confidence: isStrongJobPageSignal(parsedUrl.pathname, titleOnly) ? "high" : "medium",
      page_kind: "job_page"
    };
  }

  return {
    confidence: "low",
    page_kind: "unknown"
  };
}

function validateTrustedWorkdayJobUrl(
  rawUrl: string
):
  | { detection: WorkdayTenantDetectionResult; normalizedUrl: string; ok: true; url: string }
  | { error: string; error_code: "invalid_url" | "untrusted_host" | "unsupported_protocol"; ok: false; url: string } {
  const trimmedUrl = rawUrl.trim();

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return {
      error: "Enter a valid URL.",
      error_code: "invalid_url",
      ok: false,
      url: trimmedUrl
    };
  }

  if (parsedUrl.protocol.toLowerCase() !== "https:") {
    return {
      error: "HTTPS Workday URLs only.",
      error_code: "unsupported_protocol",
      ok: false,
      url: trimmedUrl
    };
  }

  const detection = detectWorkdayTenantFromUrl(trimmedUrl);

  if (!detection.is_workday_url || !detection.normalized_url) {
    return {
      error: detection.error ?? "Untrusted Workday hostname.",
      error_code: "untrusted_host",
      ok: false,
      url: trimmedUrl
    };
  }

  return {
    detection,
    normalizedUrl: detection.normalized_url,
    ok: true,
    url: trimmedUrl
  };
}

function validateTrustedWorkdayFinalUrl(
  rawUrl: string
):
  | { detection: WorkdayTenantDetectionResult; ok: true; normalizedUrl: string; url: string }
  | {
      error: string;
      error_code: "UNTRUSTED_REDIRECT";
      final_url: string;
      hostname: string;
      load_status: "blocked";
      ok: false;
      page_kind: "untrusted_redirect";
      url: string;
    } {
  const trimmedUrl = rawUrl.trim();

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return blockedRedirect(trimmedUrl, "Redirected to an invalid URL.");
  }

  if (parsedUrl.protocol.toLowerCase() !== "https:") {
    return blockedRedirect(trimmedUrl, "Redirected to a non-HTTPS URL.");
  }

  if (!isTrustedWorkdayHost(parsedUrl)) {
    return blockedRedirect(trimmedUrl, "Redirected to an untrusted URL.");
  }

  const detection = detectWorkdayTenantFromUrl(trimmedUrl);

  if (!detection.is_workday_url || !detection.normalized_url) {
    return blockedRedirect(trimmedUrl, detection.error ?? "Redirected to an untrusted URL.");
  }

  return {
    detection,
    normalizedUrl: detection.normalized_url,
    ok: true,
    url: trimmedUrl
  };
}

function blockedRedirect(finalUrl: string, error: string): {
  error: string;
  error_code: "UNTRUSTED_REDIRECT";
  final_url: string;
  hostname: string;
  load_status: "blocked";
  ok: false;
  page_kind: "untrusted_redirect";
  url: string;
} {
  let hostname = "";

  try {
    hostname = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    hostname = "";
  }

  return {
    error,
    error_code: "UNTRUSTED_REDIRECT",
    final_url: finalUrl,
    hostname,
    load_status: "blocked",
    ok: false,
    page_kind: "untrusted_redirect",
    url: finalUrl
  };
}

function isErrorWorkdayPage(haystack: string) {
  return /error|forbidden|access denied|service unavailable|temporarily unavailable|not found|something went wrong/.test(haystack);
}

function isJobPage(haystack: string) {
  return /\/job\b|\/jobs\/job\b|\/external\/job\b|\/jobreq\b|career|position|opening|requisition/.test(haystack);
}

function isStrongJobPageSignal(pathname: string, title: string) {
  return /\/job\b|\/jobs\/job\b|\/external\/job\b|\/jobreq\b/.test(pathname) || /career|position|opening|job/.test(title);
}

function isUnavailableWorkdayPage(haystack: string) {
  return /unavailable|no longer available|job no longer available|requisition filled|position filled|posting expired|closed/.test(haystack);
}
