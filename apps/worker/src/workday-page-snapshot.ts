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
export type WorkdayLandingActionType =
  | "already_applied"
  | "already_signed_in"
  | "apply_available"
  | "create_account_available"
  | "job_unavailable"
  | "no_action_found"
  | "sign_in_available"
  | "unknown";
export type WorkdayLandingActionSource = "selector_signal" | "title" | "url";
export type WorkdayLandingActionLabelCategory =
  | "already_applied"
  | "already_signed_in"
  | "apply"
  | "create_account"
  | "job_unavailable"
  | "none"
  | "sign_in";
export type WorkdayLandingActionSelectorCategory = "button" | "link" | "none";
export type WorkdayApplyClickReason =
  | "apply_action_not_clickable"
  | "apply_action_not_found"
  | "apply_action_low_confidence"
  | "click_failed"
  | "clicked"
  | "expected_tenant_missing"
  | "final_tenant_missing"
  | "multiple_apply_actions"
  | "tenant_mismatch_after_apply"
  | "tenant_mismatch_before_apply"
  | "untrusted_redirect_after_apply";

export type WorkdayApplyClickResult = {
  action_type: "apply_available";
  after_hostname: string;
  after_page_kind: WorkdayPageKind | "untrusted_redirect";
  after_page_kind_confidence: WorkdayLandingPageConfidence;
  after_tenant_key: string | null;
  after_tenant_name: string | null;
  after_url: string;
  after_workday_base_url: string | null;
  before_page_kind: WorkdayPageKind;
  before_url: string;
  click_result: "blocked" | "clicked" | "error";
  error_code:
    | null
    | "APPLY_ACTION_NOT_CLICKABLE"
    | "APPLY_ACTION_NOT_FOUND"
    | "APPLY_ACTION_LOW_CONFIDENCE"
    | "APPLY_CLICK_FAILED"
    | "EXPECTED_TENANT_MISSING"
    | "FINAL_TENANT_MISSING"
    | "MULTIPLE_APPLY_ACTIONS"
    | "TENANT_MISMATCH"
    | "TENANT_MISMATCH_AFTER_APPLY"
    | "UNTRUSTED_REDIRECT_AFTER_APPLY";
  reason: WorkdayApplyClickReason;
  timestamp: string;
};

export type WorkdayLandingPageClassification = {
  confidence: WorkdayLandingPageConfidence;
  page_kind: WorkdayPageKind;
};

export type WorkdayLandingActionDiscovery = {
  action_type: WorkdayLandingActionType;
  confidence: WorkdayLandingPageConfidence;
  safe_label_category: WorkdayLandingActionLabelCategory;
  selector_category: WorkdayLandingActionSelectorCategory;
  source: WorkdayLandingActionSource;
  timestamp: string;
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
  | { apply_click?: WorkdayApplyClickResult; discovery: WorkdayLandingActionDiscovery; ok: true; snapshot: SafeWorkdayPageSnapshot; url: string };

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
  getByRole: (
    role: "button" | "link",
    options: { name: RegExp | string }
  ) => {
    click: () => Promise<void>;
    count: () => Promise<number>;
    isEnabled: () => Promise<boolean>;
    isVisible: () => Promise<boolean>;
  };
  waitForLoadState?: (state?: "domcontentloaded" | "load" | "networkidle", options?: { signal?: AbortSignal; timeout?: number }) => Promise<void>;
  title: () => Promise<string>;
  url: () => string;
  close: () => Promise<void>;
};

const WORKDAY_OPEN_TIMEOUT_MS = 30_000;

export async function openTrustedWorkdayJobPage(
  rawUrl: string,
  options?: {
    launcher?: BrowserLauncher;
    allowApplyClick?: boolean;
    expectedTenantKey?: string | null;
    now?: () => string;
  }
): Promise<WorkdayPageOpenCheckResult> {
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
    const openedPage = await context.newPage();
    page = openedPage;
    const timestamp = options?.now?.() ?? new Date().toISOString();

    await openedPage.goto(parsed.normalizedUrl, {
      timeout: WORKDAY_OPEN_TIMEOUT_MS,
      waitUntil: "domcontentloaded"
    });

    const finalValidation = validateTrustedWorkdayFinalUrl(openedPage.url());

    if (!finalValidation.ok) {
      return finalValidation;
    }

    const snapshotOrBlocked = await captureSafePageSnapshot(openedPage, finalValidation.detection, options?.now?.());

    if (isBlockedRedirectResult(snapshotOrBlocked)) {
      return snapshotOrBlocked;
    }

    const snapshot = snapshotOrBlocked;

    const discovery = await discoverWorkdayLandingActions(openedPage, snapshot, timestamp);

    if (options?.allowApplyClick && discovery.action_type === "apply_available" && discovery.confidence === "high") {
      const expectedTenantKey = options.expectedTenantKey?.trim() || null;
      const finalTenantKey = snapshot.tenant_key?.trim() || null;

      if (!expectedTenantKey) {
        return {
          apply_click: buildBlockedApplyClickResult(
            snapshot,
            "expected_tenant_missing",
            "EXPECTED_TENANT_MISSING",
            timestamp
          ),
          discovery,
          ok: true,
          snapshot,
          url: snapshot.final_url
        } satisfies WorkdayPageOpenCheckResult;
      }

      if (!finalTenantKey) {
        return {
          apply_click: buildBlockedApplyClickResult(snapshot, "final_tenant_missing", "FINAL_TENANT_MISSING", timestamp),
          discovery,
          ok: true,
          snapshot,
          url: snapshot.final_url
        } satisfies WorkdayPageOpenCheckResult;
      }

      if (expectedTenantKey !== finalTenantKey) {
        return {
          apply_click: buildBlockedApplyClickResult(snapshot, "tenant_mismatch_before_apply", "TENANT_MISMATCH", timestamp),
          discovery,
          ok: true,
          snapshot,
          url: snapshot.final_url
        } satisfies WorkdayPageOpenCheckResult;
      }

      const applyClickResult = await runSafeWorkdayApplyClickDryRun(
        openedPage,
        snapshot,
        discovery,
        timestamp,
        expectedTenantKey
      );

      return {
        apply_click: applyClickResult.apply_click,
        discovery: applyClickResult.discovery,
        ok: true,
        snapshot: applyClickResult.snapshot,
        url: applyClickResult.snapshot.final_url
      } satisfies WorkdayPageOpenCheckResult;
    }

    return {
      discovery,
      ok: true,
      snapshot,
      url: snapshot.final_url
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

export async function runWorkdayApplyClickDryRun(
  rawUrl: string,
  options?: { expectedTenantKey?: string | null; launcher?: BrowserLauncher; now?: () => string }
): Promise<WorkdayPageOpenCheckResult> {
  return openTrustedWorkdayJobPage(rawUrl, { ...options, allowApplyClick: true });
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

export async function discoverWorkdayLandingActions(
  page: Pick<PageLike, "getByRole" | "title" | "url">,
  snapshot: SafeWorkdayPageSnapshot,
  timestamp = new Date().toISOString()
): Promise<WorkdayLandingActionDiscovery> {
  const urlTitleText = `${snapshot.final_url} ${snapshot.page_title ?? ""}`.toLowerCase();

  const selectorSignals: Array<{
    action_type: Exclude<WorkdayLandingActionType, "no_action_found" | "unknown">;
    buttonPatterns: RegExp[];
    confidence: WorkdayLandingPageConfidence;
    linkPatterns?: RegExp[];
    safe_label_category: WorkdayLandingActionLabelCategory;
  }> = [
    {
      action_type: "job_unavailable",
      buttonPatterns: [/\bjob unavailable\b/i, /\bunavailable\b/i, /\bno longer available\b/i, /\brequisition filled\b/i, /\bposition filled\b/i],
      confidence: "high",
      linkPatterns: [/\bjob unavailable\b/i, /\bunavailable\b/i, /\bno longer available\b/i],
      safe_label_category: "job_unavailable"
    },
    {
      action_type: "already_applied",
      buttonPatterns: [/\balready applied\b/i, /\bapplication submitted\b/i, /\bapplication complete\b/i],
      confidence: "high",
      linkPatterns: [/\balready applied\b/i, /\bapplication submitted\b/i],
      safe_label_category: "already_applied"
    },
    {
      action_type: "already_signed_in",
      buttonPatterns: [/\balready signed in\b/i, /\bmy applications\b/i, /\bcandidate home\b/i, /\bdashboard\b/i],
      confidence: "high",
      linkPatterns: [/\balready signed in\b/i, /\bmy applications\b/i, /\bcandidate home\b/i, /\bdashboard\b/i],
      safe_label_category: "already_signed_in"
    },
    {
      action_type: "apply_available",
      buttonPatterns: [/\bapply\b/i, /\bapply now\b/i, /\bstart application\b/i, /\bstart applying\b/i],
      confidence: "high",
      linkPatterns: [/\bapply\b/i, /\bapply now\b/i, /\bstart application\b/i],
      safe_label_category: "apply"
    },
    {
      action_type: "sign_in_available",
      buttonPatterns: [/\bsign in\b/i, /\bsign on\b/i, /\blog in\b/i, /\blogin\b/i, /\bauthenticate\b/i],
      confidence: "high",
      linkPatterns: [/\bsign in\b/i, /\bsign on\b/i, /\blog in\b/i, /\blogin\b/i],
      safe_label_category: "sign_in"
    },
    {
      action_type: "create_account_available",
      buttonPatterns: [/\bcreate account\b/i, /\bregister\b/i, /\bsign up\b/i, /\bjoin now\b/i],
      confidence: "high",
      linkPatterns: [/\bcreate account\b/i, /\bregister\b/i, /\bsign up\b/i],
      safe_label_category: "create_account"
    }
  ];

  for (const signal of selectorSignals) {
    if (
      (await hasVisibleSignal(page, "button", signal.buttonPatterns)) ||
      (signal.linkPatterns ? await hasVisibleSignal(page, "link", signal.linkPatterns) : false)
    ) {
      return {
        action_type: signal.action_type,
        confidence: signal.confidence,
        safe_label_category: signal.safe_label_category,
        selector_category: (await hasVisibleSignal(page, "button", signal.buttonPatterns)) ? "button" : "link",
        source: "selector_signal",
        timestamp
      };
    }
  }

  if (/unavailable|no longer available|requisition filled|position filled|closed/.test(urlTitleText)) {
    return buildDiscovery("job_unavailable", "high", "job_unavailable", "title", timestamp);
  }

  if (/already applied|application submitted|application complete/.test(urlTitleText)) {
    return buildDiscovery("already_applied", "high", "already_applied", "title", timestamp);
  }

  if (/already signed in|my applications|candidate home|dashboard/.test(urlTitleText)) {
    return buildDiscovery("already_signed_in", snapshot.page_kind === "already_signed_in_page" ? "medium" : "low", "already_signed_in", "url", timestamp);
  }

  switch (snapshot.page_kind) {
    case "sign_in_page":
      return buildDiscovery("sign_in_available", snapshot.page_kind_confidence === "high" ? "high" : "medium", "sign_in", "title", timestamp);
    case "create_account_page":
      return buildDiscovery("create_account_available", snapshot.page_kind_confidence === "high" ? "high" : "medium", "create_account", "title", timestamp);
    case "already_signed_in_page":
      return buildDiscovery("already_signed_in", snapshot.page_kind_confidence === "high" ? "high" : "medium", "already_signed_in", "title", timestamp);
    case "unavailable_page":
      return buildDiscovery("job_unavailable", "high", "job_unavailable", "title", timestamp);
    case "job_page":
      return buildDiscovery("no_action_found", snapshot.page_kind_confidence === "high" ? "medium" : "low", "none", "url", timestamp);
    case "error_page":
      return buildDiscovery("unknown", "low", "none", "title", timestamp);
    default:
      return buildDiscovery("unknown", "low", "none", "url", timestamp);
  }
}

async function runSafeWorkdayApplyClickDryRun(
  page: PageLike,
  snapshot: SafeWorkdayPageSnapshot,
  discovery: WorkdayLandingActionDiscovery,
  timestamp: string,
  expectedTenantKey: string
): Promise<WorkdayApplyClickDryRunResult> {
  const applyLocator = await findSingleSafeApplyLocator(page);

  if (!applyLocator.ok) {
    return {
      apply_click: buildBlockedApplyClickResult(snapshot, applyLocator.reason, applyLocator.error_code, timestamp),
      discovery,
      snapshot
    };
  }

  const { locator } = applyLocator;

  const canVisible = await locator.isVisible().catch(() => false);
  const canEnabled = canVisible ? await locator.isEnabled().catch(() => false) : false;

  if (!canVisible || !canEnabled) {
    return {
      apply_click: buildBlockedApplyClickResult(
        snapshot,
        "apply_action_not_clickable",
        "APPLY_ACTION_NOT_CLICKABLE",
        timestamp
      ),
      discovery,
      snapshot
    };
  }

  try {
    await locator.click();

    if (page.waitForLoadState) {
      await page.waitForLoadState("domcontentloaded");
    }

      const afterSnapshotOrBlocked = await captureSafePageSnapshot(page, {
        confidence: snapshot.confidence,
        error: undefined,
        is_workday_url: true,
        normalized_url: snapshot.final_url,
        reason: "detected",
      tenant_key: snapshot.tenant_key,
      tenant_name: snapshot.tenant_name,
      workday_base_url: snapshot.workday_base_url
    });

    if (isBlockedRedirectResult(afterSnapshotOrBlocked)) {
      const blockedApplyClick: WorkdayApplyClickResult = {
        ...buildBlockedApplyClickResult(snapshot, "untrusted_redirect_after_apply", "UNTRUSTED_REDIRECT_AFTER_APPLY", timestamp),
        after_hostname: afterSnapshotOrBlocked.hostname,
        after_page_kind: afterSnapshotOrBlocked.page_kind,
        after_page_kind_confidence: "low",
        after_tenant_key: snapshot.tenant_key,
        after_tenant_name: snapshot.tenant_name,
        after_url: afterSnapshotOrBlocked.final_url,
        after_workday_base_url: snapshot.workday_base_url,
        click_result: "blocked",
        error_code: "UNTRUSTED_REDIRECT_AFTER_APPLY"
      };

      return {
        apply_click: blockedApplyClick,
        discovery,
        snapshot
      };
    }

    const afterSnapshot = afterSnapshotOrBlocked;
    const afterTenantKey = afterSnapshot.tenant_key?.trim() || null;

    if (!afterTenantKey) {
      return {
        apply_click: {
          ...buildBlockedApplyClickResult(snapshot, "final_tenant_missing", "FINAL_TENANT_MISSING", timestamp),
          after_hostname: afterSnapshot.hostname,
          after_page_kind: afterSnapshot.page_kind,
          after_page_kind_confidence: afterSnapshot.page_kind_confidence,
          after_tenant_key: afterTenantKey,
          after_tenant_name: afterSnapshot.tenant_name,
          after_url: afterSnapshot.final_url,
          after_workday_base_url: afterSnapshot.workday_base_url,
          click_result: "blocked",
          error_code: "FINAL_TENANT_MISSING"
        },
        discovery,
        snapshot
      };
    }

    if (afterTenantKey !== expectedTenantKey) {
      return {
        apply_click: {
          ...buildBlockedApplyClickResult(snapshot, "tenant_mismatch_after_apply", "TENANT_MISMATCH_AFTER_APPLY", timestamp),
          after_hostname: afterSnapshot.hostname,
          after_page_kind: afterSnapshot.page_kind,
          after_page_kind_confidence: afterSnapshot.page_kind_confidence,
          after_tenant_key: afterTenantKey,
          after_tenant_name: afterSnapshot.tenant_name,
          after_url: afterSnapshot.final_url,
          after_workday_base_url: afterSnapshot.workday_base_url,
          click_result: "blocked",
          error_code: "TENANT_MISMATCH_AFTER_APPLY"
        },
        discovery,
        snapshot
      };
    }

    const afterDiscovery = await discoverWorkdayLandingActions(page, afterSnapshot, timestamp);

    return {
      apply_click: {
        action_type: "apply_available",
        after_hostname: afterSnapshot.hostname,
        after_page_kind: afterSnapshot.page_kind,
        after_page_kind_confidence: afterSnapshot.page_kind_confidence,
        after_tenant_key: afterSnapshot.tenant_key,
        after_tenant_name: afterSnapshot.tenant_name,
        after_url: afterSnapshot.final_url,
        after_workday_base_url: afterSnapshot.workday_base_url,
        before_page_kind: snapshot.page_kind,
        before_url: snapshot.final_url,
        click_result: "clicked",
        error_code: null,
        reason: "clicked",
        timestamp
      },
      discovery: afterDiscovery,
      snapshot: afterSnapshot
    };
  } catch {
    return {
      apply_click: buildBlockedApplyClickResult(snapshot, "click_failed", "APPLY_CLICK_FAILED", timestamp),
      discovery,
      snapshot
    };
  }
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

function buildDiscovery(
  actionType: WorkdayLandingActionType,
  confidence: WorkdayLandingPageConfidence,
  safeLabelCategory: WorkdayLandingActionLabelCategory,
  source: WorkdayLandingActionSource,
  timestamp: string
): WorkdayLandingActionDiscovery {
  return {
    action_type: actionType,
    confidence,
    safe_label_category: safeLabelCategory,
    selector_category: "none",
    source,
    timestamp
  };
}

function buildBlockedApplyClickResult(
  snapshot: SafeWorkdayPageSnapshot,
  reason: Exclude<WorkdayApplyClickReason, "clicked">,
  errorCode: NonNullable<WorkdayApplyClickResult["error_code"]>,
  timestamp: string
): WorkdayApplyClickResult {
  return {
    action_type: "apply_available",
    after_hostname: snapshot.hostname,
    after_page_kind: snapshot.page_kind,
    after_page_kind_confidence: snapshot.page_kind_confidence,
    after_tenant_key: snapshot.tenant_key,
    after_tenant_name: snapshot.tenant_name,
    after_url: snapshot.final_url,
    after_workday_base_url: snapshot.workday_base_url,
    before_page_kind: snapshot.page_kind,
    before_url: snapshot.final_url,
    click_result: "blocked",
    error_code: errorCode,
    reason,
    timestamp
  };
}

type SafeApplyLocatorResult =
  | { error_code: "APPLY_ACTION_NOT_FOUND" | "MULTIPLE_APPLY_ACTIONS"; ok: false; reason: Exclude<WorkdayApplyClickReason, "apply_action_not_clickable" | "click_failed" | "clicked" | "untrusted_redirect_after_apply"> }
  | { locator: ReturnType<PageLike["getByRole"]>; ok: true };

type WorkdayApplyClickDryRunResult = {
  apply_click: WorkdayApplyClickResult;
  discovery: WorkdayLandingActionDiscovery;
  snapshot: SafeWorkdayPageSnapshot;
};

async function findSingleSafeApplyLocator(page: Pick<PageLike, "getByRole">): Promise<SafeApplyLocatorResult> {
  const pattern = /^\s*apply(?: now| for this job)?\s*$/i;
  const buttonLocator = page.getByRole("button", { name: pattern });
  const linkLocator = page.getByRole("link", { name: pattern });

  const [buttonCount, linkCount] = await Promise.all([buttonLocator.count(), linkLocator.count()]);
  const totalCount = buttonCount + linkCount;

  if (totalCount === 0) {
    return { error_code: "APPLY_ACTION_NOT_FOUND", ok: false, reason: "apply_action_not_found" };
  }

  if (totalCount > 1) {
    return { error_code: "MULTIPLE_APPLY_ACTIONS", ok: false, reason: "multiple_apply_actions" };
  }

  return { locator: buttonCount === 1 ? buttonLocator : linkLocator, ok: true };
}

async function hasVisibleSignal(page: Pick<PageLike, "getByRole">, role: "button" | "link", patterns: RegExp[]) {
  for (const pattern of patterns) {
    try {
      if (await page.getByRole(role, { name: pattern }).isVisible()) {
        return true;
      }
    } catch {
      // Ignore missing selectors and keep discovery conservative.
    }
  }

  return false;
}

function isBlockedRedirectResult(
  result: SafeWorkdayPageSnapshot | WorkdayPageBlockedRedirectResult
): result is WorkdayPageBlockedRedirectResult {
  return "ok" in result && result.ok === false && result.error_code === "UNTRUSTED_REDIRECT";
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
