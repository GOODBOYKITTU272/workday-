import { describe, expect, it } from "vitest";

import {
  type AutomationLogInsert,
  type ClaimedApplicationRun,
  type ManualReviewItemInsert,
  type RunProcessorDeps,
  type RunStepInsert,
  buildManualReviewItemPayload,
  createManualReviewItemForRun,
  processOneApplicationRun
} from "../src/run-processor";
import { type WorkdayPageOpenCheckResult } from "../src/workday-page-snapshot";

const claimedRun: ClaimedApplicationRun = {
  candidate_id: "candidate-id",
  id: "run-id",
  job_link_id: "job-link-id",
  mode: "dry_run",
  status: "starting"
};

const trustedSnapshot = {
  confidence: "high" as const,
  final_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
  hostname: "acme.wd5.myworkdayjobs.com",
  load_status: "loaded" as const,
  page_kind: "job_page" as const,
  page_kind_confidence: "high" as const,
  page_title: "Engineer",
  tenant_key: "acme",
  tenant_name: "acme",
  timestamp: "2026-07-28T00:00:00.000Z",
  workday_base_url: "https://acme.wd5.myworkdayjobs.com"
};

function createDeps(overrides: Partial<RunProcessorDeps> = {}) {
  const runUpdates: unknown[] = [];
  const runSteps: RunStepInsert[] = [];
  const automationLogs: AutomationLogInsert[] = [];
  const manualReviewItems: ManualReviewItemInsert[] = [];

  const deps: RunProcessorDeps = {
    claimNextRun: async () => claimedRun,
    insertAutomationLog: async (payload) => {
      automationLogs.push(payload);
    },
    insertManualReviewItem: async (payload) => {
      manualReviewItems.push(payload);
      return { created: true };
    },
    insertRunStep: async (payload) => {
      runSteps.push(payload);
      return { id: `step-${runSteps.length}` };
    },
    loadReadiness: async (run) => ({
      activeResumeCount: 1,
      candidate: { id: run.candidate_id },
      jobLink: {
        candidate_id: run.candidate_id,
        id: run.job_link_id,
        url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
        workday_tenant_key: "acme"
      },
      run,
      zohoMailboxCount: 1
    }),
    openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
      ok: true,
      discovery: {
        action_type: "apply_available",
        confidence: "high",
        safe_label_category: "apply",
        selector_category: "button",
        source: "selector_signal",
        timestamp: "2026-07-28T00:00:00.000Z"
      },
      snapshot: trustedSnapshot,
      url: trustedSnapshot.final_url
    }),
    now: () => "2026-07-28T00:00:00.000Z",
    updateRun: async (_runId, payload) => {
      runUpdates.push(payload);
    },
    ...overrides
  };

  return { automationLogs, deps, manualReviewItems, runSteps, runUpdates };
}

describe("application run processor", () => {
  it("returns no_work when no queued dry-run is claimed", async () => {
    const { automationLogs, deps, runSteps, runUpdates } = createDeps({
      claimNextRun: async () => null
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({ status: "no_work" });
    expect(runUpdates).toEqual([]);
    expect(runSteps).toEqual([]);
    expect(automationLogs).toEqual([]);
  });

  it("moves readiness failures to manual review with safe step and log details", async () => {
    const { automationLogs, deps, manualReviewItems, runSteps, runUpdates } = createDeps({
      loadReadiness: async (run) => ({
        activeResumeCount: 0,
        candidate: { id: run.candidate_id },
        jobLink: {
          candidate_id: run.candidate_id,
          id: run.job_link_id,
          url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
          workday_tenant_key: "acme"
        },
        run,
        zohoMailboxCount: 1
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      issues: ["active resume is required"],
      runId: "run-id",
      status: "readiness_failed"
    });

    expect(runSteps[0]).toEqual(
      expect.objectContaining({
        error_code: "READINESS_FAILED",
        error_message: "Run readiness failed.",
        step_name: "readiness_checked",
        step_status: "failed"
      })
    );
    expect(automationLogs[0]).toEqual(
      expect.objectContaining({
        error_code: "READINESS_FAILED",
        level: "warn",
        message: "Run moved to manual review because readiness failed."
      })
    );
    expect(runUpdates[0]).toEqual(
      expect.objectContaining({
        error_code: "READINESS_FAILED",
        readiness_score: "blocked",
        status: "manual_review_required"
      })
    );
    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        application_run_id: "run-id",
        item_type: "routing_review",
        review_reason: "readiness_blocked",
        risk_level: "high",
        status: "open"
      })
    ]);
  });

  it("captures a safe page snapshot and stops for manual review when tenant matches", async () => {
    const { automationLogs, deps, runSteps, runUpdates } = createDeps();

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "snapshot_complete"
    });

    expect(runSteps[0]).toEqual(
      expect.objectContaining({
        application_run_id: "run-id",
        message: "Workday page opened and safe snapshot captured. Worker stops before login or question extraction.",
        metadata: expect.objectContaining({
          expected_tenant_known: true,
          final_tenant_key: "acme",
          landing_action: expect.objectContaining({
            action_type: "apply_available",
            confidence: "high",
            safe_label_category: "apply",
            selector_category: "button",
            source: "selector_signal"
          }),
          page_kind_confidence: "high",
          tenant_key: "acme",
          tenant_match: true
        }),
        step_name: "workday_page_snapshot",
        step_status: "success"
      })
    );
    expect(automationLogs[0]).toEqual(
      expect.objectContaining({
        level: "info",
        message: "Workday page snapshot captured. Worker stops before login or question extraction."
      })
    );
    expect(runUpdates[0]).toEqual(
      expect.objectContaining({
        current_step: "workday_page_snapshot",
        readiness_score: "needs_review",
        status: "manual_review_required"
      })
    );
    expect(JSON.stringify({ automationLogs, runSteps, runUpdates })).not.toMatch(
      /approved_for_submit|submitted_at|access_token|refresh_token|password|otp|Apply now|Sign In|Create Account/i
    );
  });

  it("captures a safe apply click and stops for manual review when tenant matches", async () => {
    const { automationLogs, deps, manualReviewItems, runSteps, runUpdates } = createDeps({
      openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
        apply_click: {
          action_type: "apply_available",
          after_hostname: trustedSnapshot.hostname,
          after_page_kind: "job_page",
          after_page_kind_confidence: "high",
          after_tenant_key: trustedSnapshot.tenant_key,
          after_tenant_name: trustedSnapshot.tenant_name,
          after_url: trustedSnapshot.final_url,
          after_workday_base_url: trustedSnapshot.workday_base_url,
          before_page_kind: "job_page",
          before_url: trustedSnapshot.final_url,
          click_result: "clicked",
          error_code: null,
          reason: "clicked",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        discovery: {
          action_type: "no_action_found",
          confidence: "medium",
          safe_label_category: "none",
          selector_category: "none",
          source: "url",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        ok: true,
        snapshot: trustedSnapshot,
        url: trustedSnapshot.final_url
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "apply_click_complete"
    });

    expect(runSteps[0]).toEqual(
      expect.objectContaining({
        message: "Workday Apply action clicked and safe snapshot captured. Worker stops before login or question extraction.",
        metadata: expect.objectContaining({
          apply_click: expect.objectContaining({
            action_type: "apply_available",
            click_result: "clicked",
            reason: "clicked"
          }),
          final_tenant_key: "acme",
          post_apply_state: expect.objectContaining({
            post_apply_reason: "no_signal",
            post_apply_state: "unknown"
          }),
          post_apply_decision: expect.objectContaining({
            execution_allowed: false,
            recommended_next_route: "unknown_manual_review",
            requires_human_review: true,
            route_reason: "low_or_unknown_confidence"
          }),
          tenant_match: true
        }),
        step_name: "workday_apply_click",
        step_status: "success"
      })
    );
    expect(runUpdates[0]).toEqual(
      expect.objectContaining({
        current_step: "workday_apply_click",
        readiness_score: "needs_review",
        status: "manual_review_required"
      })
    );
    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        application_run_id: "run-id",
        error_code: null,
        item_type: "routing_review",
        review_reason: "unknown_manual_review",
        risk_level: "low",
        route_reason: "low_or_unknown_confidence",
        status: "open"
      })
    ]);
    expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps, runUpdates })).not.toMatch(
      /approved_for_submit|submitted_at|access_token|refresh_token|password|otp|Apply now|Sign In|Create Account/i
    );
  });

  it("stops safely when the detected tenant does not match the expected tenant", async () => {
    const { automationLogs, deps, manualReviewItems, runSteps, runUpdates } = createDeps({
      openWorkdayPage: async (jobUrl): Promise<WorkdayPageOpenCheckResult> => ({
        ok: true,
        discovery: {
          action_type: "already_signed_in",
          confidence: "high",
          safe_label_category: "already_signed_in",
          selector_category: "button",
          source: "selector_signal",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        snapshot: {
          ...trustedSnapshot,
          final_url: jobUrl,
          tenant_key: "beta",
          tenant_name: "beta"
        },
        url: jobUrl
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "tenant_mismatch"
    });

    expect(runSteps[0]).toEqual(
      expect.objectContaining({
        error_code: "TENANT_MISMATCH",
        metadata: expect.objectContaining({
          expected_tenant_known: true,
          final_tenant_key: "beta",
          page_kind_confidence: "high",
          tenant_match: false
        }),
        step_name: "workday_page_snapshot",
        step_status: "failed"
      })
    );
    expect(automationLogs[0]).toEqual(
      expect.objectContaining({
        error_code: "TENANT_MISMATCH",
        level: "warn"
      })
    );
    expect(runUpdates[0]).toEqual(
      expect.objectContaining({
        error_code: "TENANT_MISMATCH",
        readiness_score: "blocked",
        status: "manual_review_required"
      })
    );
    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        application_run_id: "run-id",
        error_code: "TENANT_MISMATCH",
        item_type: "routing_review",
        review_reason: "stop_tenant_mismatch",
        risk_level: "high",
        status: "open",
        tenant_key: "beta"
      })
    ]);
  });

  it("allows a missing expected tenant to pass through the snapshot step", async () => {
    const { deps, runSteps, runUpdates } = createDeps({
      loadReadiness: async (run) => ({
        activeResumeCount: 1,
        candidate: { id: run.candidate_id },
        jobLink: {
          candidate_id: run.candidate_id,
          id: run.job_link_id,
          url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
          workday_tenant_key: null
        },
        run,
        zohoMailboxCount: 1
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "snapshot_complete"
    });

    expect(runSteps[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          expected_tenant_known: false,
          final_tenant_key: "acme",
          page_kind_confidence: "high",
          tenant_match: null
        })
      })
    );
    expect(runUpdates[0]).toEqual(
      expect.objectContaining({
        readiness_score: "needs_review",
        status: "manual_review_required"
      })
    );
  });

  it("treats a missing final tenant as a safe snapshot completion", async () => {
    const { deps, runSteps } = createDeps({
      openWorkdayPage: async (jobUrl): Promise<WorkdayPageOpenCheckResult> => ({
        ok: true,
        discovery: {
          action_type: "no_action_found",
          confidence: "medium",
          safe_label_category: "none",
          selector_category: "none",
          source: "url",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        snapshot: {
          ...trustedSnapshot,
          final_url: jobUrl,
          tenant_key: null,
          tenant_name: null
        },
        url: jobUrl
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "snapshot_complete"
    });

    expect(runSteps[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          expected_tenant_known: true,
          final_tenant_key: null,
          page_kind_confidence: "high",
          tenant_match: null
        })
      })
    );
  });

  it("blocks untrusted redirects before any tenant-specific action", async () => {
    const { automationLogs, deps, manualReviewItems, runSteps, runUpdates } = createDeps({
      openWorkdayPage: async (jobUrl): Promise<WorkdayPageOpenCheckResult> => ({
        ok: false,
        error: "Redirected to an untrusted final URL.",
        error_code: "UNTRUSTED_REDIRECT",
        final_url: "https://evil.com/phishing",
        hostname: "evil.com",
        load_status: "blocked",
        page_kind: "untrusted_redirect",
        url: jobUrl
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "snapshot_blocked"
    });

    expect(runSteps[0]).toEqual(
      expect.objectContaining({
        error_code: "UNTRUSTED_REDIRECT",
        step_status: "failed"
      })
    );
    expect(automationLogs[0]).toEqual(
      expect.objectContaining({
        error_code: "UNTRUSTED_REDIRECT",
        level: "warn"
      })
    );
    expect(runUpdates[0]).toEqual(
      expect.objectContaining({
        error_code: "UNTRUSTED_REDIRECT",
        readiness_score: "blocked",
        status: "manual_review_required"
      })
    );
    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        application_run_id: "run-id",
        error_code: "UNTRUSTED_REDIRECT",
        item_type: "routing_review",
        review_reason: "stop_untrusted_redirect",
        risk_level: "high",
        status: "open"
      })
    ]);
  });

  it("does not create a manual review item when the page open hard-fails", async () => {
    const { deps, manualReviewItems } = createDeps({
      openWorkdayPage: async (jobUrl): Promise<WorkdayPageOpenCheckResult> => ({
        ok: false,
        error: "Failed to open Workday job page.",
        error_code: "page_open_failed",
        url: jobUrl
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "snapshot_blocked"
    });

    expect(manualReviewItems).toEqual([]);
  });

  it("creates a page_open_blocked manual review item for an untrusted host", async () => {
    const { deps, manualReviewItems, runUpdates } = createDeps({
      openWorkdayPage: async (jobUrl): Promise<WorkdayPageOpenCheckResult> => ({
        ok: false,
        error: "Untrusted Workday hostname.",
        error_code: "untrusted_host",
        url: jobUrl
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "snapshot_blocked"
    });

    expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        error_code: "untrusted_host",
        hostname: null,
        review_reason: "page_open_blocked",
        risk_level: "high"
      })
    ]);
  });

  it("creates an apply_click_blocked manual review item when the Apply action cannot be found", async () => {
    const { deps, manualReviewItems, runUpdates } = createDeps({
      openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
        apply_click: {
          action_type: "apply_available",
          after_hostname: trustedSnapshot.hostname,
          after_page_kind: "job_page",
          after_page_kind_confidence: "high",
          after_tenant_key: trustedSnapshot.tenant_key,
          after_tenant_name: trustedSnapshot.tenant_name,
          after_url: trustedSnapshot.final_url,
          after_workday_base_url: trustedSnapshot.workday_base_url,
          before_page_kind: "job_page",
          before_url: trustedSnapshot.final_url,
          click_result: "blocked",
          error_code: "APPLY_ACTION_NOT_FOUND",
          reason: "apply_action_not_found",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        discovery: {
          action_type: "apply_available",
          confidence: "high",
          safe_label_category: "apply",
          selector_category: "button",
          source: "selector_signal",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        ok: true,
        snapshot: trustedSnapshot,
        url: trustedSnapshot.final_url
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "apply_click_blocked"
    });

    expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        error_code: "APPLY_ACTION_NOT_FOUND",
        review_reason: "apply_click_blocked",
        risk_level: "high",
        tenant_key: "acme"
      })
    ]);
  });

  it.each([
    [
      "route_to_login_flow",
      {
        action_type: "sign_in_available" as const,
        confidence: "high" as const,
        safe_label_category: "sign_in" as const,
        selector_category: "button" as const,
        source: "selector_signal" as const,
        timestamp: "2026-07-28T00:00:00.000Z"
      },
      { ...trustedSnapshot, page_kind: "sign_in_page" as const }
    ],
    [
      "route_to_create_account_flow",
      {
        action_type: "create_account_available" as const,
        confidence: "high" as const,
        safe_label_category: "create_account" as const,
        selector_category: "button" as const,
        source: "selector_signal" as const,
        timestamp: "2026-07-28T00:00:00.000Z"
      },
      { ...trustedSnapshot, page_kind: "create_account_page" as const }
    ],
    [
      "stop_already_applied",
      {
        action_type: "already_applied" as const,
        confidence: "high" as const,
        safe_label_category: "already_applied" as const,
        selector_category: "button" as const,
        source: "selector_signal" as const,
        timestamp: "2026-07-28T00:00:00.000Z"
      },
      trustedSnapshot
    ],
    [
      "stop_job_unavailable",
      {
        action_type: "job_unavailable" as const,
        confidence: "high" as const,
        safe_label_category: "job_unavailable" as const,
        selector_category: "button" as const,
        source: "selector_signal" as const,
        timestamp: "2026-07-28T00:00:00.000Z"
      },
      { ...trustedSnapshot, page_kind: "unavailable_page" as const }
    ]
  ])("creates a %s manual review item from a landing-page snapshot", async (expectedCategory, discovery, snapshot) => {
    const { deps, manualReviewItems, runUpdates } = createDeps({
      openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
        ok: true,
        discovery,
        snapshot,
        url: snapshot.final_url
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "snapshot_complete"
    });

    expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        item_type: "routing_review",
        review_reason: expectedCategory,
        status: "open"
      })
    ]);
  });

  it("creates a route_to_questionnaire_discovery manual review item after a high-confidence application-started click", async () => {
    const { deps, manualReviewItems } = createDeps({
      openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
        apply_click: {
          action_type: "apply_available",
          after_hostname: trustedSnapshot.hostname,
          after_page_kind: "job_page",
          after_page_kind_confidence: "high",
          after_tenant_key: trustedSnapshot.tenant_key,
          after_tenant_name: trustedSnapshot.tenant_name,
          after_url: `${trustedSnapshot.final_url}/questionnaire`,
          after_workday_base_url: trustedSnapshot.workday_base_url,
          before_page_kind: "job_page",
          before_url: trustedSnapshot.final_url,
          click_result: "clicked",
          error_code: null,
          reason: "clicked",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        discovery: {
          action_type: "no_action_found",
          confidence: "medium",
          safe_label_category: "none",
          selector_category: "none",
          source: "url",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        ok: true,
        snapshot: {
          ...trustedSnapshot,
          final_url: `${trustedSnapshot.final_url}/questionnaire`,
          page_title: "Continue Application"
        },
        url: `${trustedSnapshot.final_url}/questionnaire`
      })
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "apply_click_complete"
    });

    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        item_type: "routing_review",
        review_reason: "route_to_questionnaire_discovery",
        risk_level: "high"
      })
    ]);
  });

  it("updates a claimed run safely when an unknown error occurs", async () => {
    const { automationLogs, deps, runSteps, runUpdates } = createDeps({
      loadReadiness: async () => {
        throw new Error("sensitive-runtime-detail");
      }
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      errorCode: "UNKNOWN_WORKER_ERROR",
      runId: "run-id",
      status: "error"
    });

    const writes = JSON.stringify({ automationLogs, runSteps, runUpdates });
    expect(runSteps[0]).toEqual(
      expect.objectContaining({
        error_code: "UNKNOWN_WORKER_ERROR",
        error_message: "Worker failed before automation.",
        step_status: "failed"
      })
    );
    expect(runUpdates[0]).toEqual(
      expect.objectContaining({
        error_code: "UNKNOWN_WORKER_ERROR",
        error_message: "Worker failed before automation.",
        status: "failed"
      })
    );
    expect(writes).not.toContain("sensitive-runtime-detail");
  });
});

describe("buildManualReviewItemPayload", () => {
  it("builds an allow-listed payload with safe defaults for missing fields", () => {
    expect(
      buildManualReviewItemPayload({
        category: "stop_tenant_mismatch",
        riskLevel: "high",
        run: claimedRun
      })
    ).toEqual({
      application_run_id: "run-id",
      candidate_id: "candidate-id",
      error_code: null,
      hostname: null,
      item_type: "routing_review",
      job_link_id: "job-link-id",
      post_apply_state: null,
      review_reason: "stop_tenant_mismatch",
      risk_level: "high",
      route_reason: null,
      status: "open",
      tenant_key: null
    });
  });

  it("carries through optional safe metadata when provided", () => {
    expect(
      buildManualReviewItemPayload({
        category: "route_to_login_flow",
        errorCode: null,
        hostname: "acme.wd5.myworkdayjobs.com",
        postApplyState: "login_required",
        riskLevel: "high",
        routeReason: "login_signal",
        run: claimedRun,
        tenantKey: "acme"
      })
    ).toEqual({
      application_run_id: "run-id",
      candidate_id: "candidate-id",
      error_code: null,
      hostname: "acme.wd5.myworkdayjobs.com",
      item_type: "routing_review",
      job_link_id: "job-link-id",
      post_apply_state: "login_required",
      review_reason: "route_to_login_flow",
      risk_level: "high",
      route_reason: "login_signal",
      status: "open",
      tenant_key: "acme"
    });
  });
});

describe("createManualReviewItemForRun", () => {
  const payload = buildManualReviewItemPayload({ category: "readiness_blocked", riskLevel: "high", run: claimedRun });

  it("inserts the item and logs nothing on success", async () => {
    const { automationLogs, deps, manualReviewItems } = createDeps();

    await createManualReviewItemForRun(deps, claimedRun, payload);

    expect(manualReviewItems).toEqual([payload]);
    expect(automationLogs).toEqual([]);
  });

  it("treats a duplicate result as safe and does not log an error", async () => {
    const { automationLogs, deps } = createDeps({
      insertManualReviewItem: async () => ({ created: false })
    });

    await expect(createManualReviewItemForRun(deps, claimedRun, payload)).resolves.toBeUndefined();

    expect(automationLogs).toEqual([]);
  });

  it("logs a safe failure without leaking the raw error when the insert throws", async () => {
    const { automationLogs, deps } = createDeps({
      insertManualReviewItem: async () => {
        throw new Error("duplicate key value violates unique constraint secret-internal-detail");
      }
    });

    await expect(createManualReviewItemForRun(deps, claimedRun, payload)).resolves.toBeUndefined();

    expect(automationLogs).toEqual([
      expect.objectContaining({
        application_run_id: "run-id",
        error_code: "MANUAL_REVIEW_ITEM_CREATE_FAILED",
        level: "error",
        message: "Manual review item could not be created safely."
      })
    ]);
    expect(JSON.stringify(automationLogs)).not.toContain("secret-internal-detail");
  });

  it("never throws even when the safety log write also fails", async () => {
    const { deps } = createDeps({
      insertAutomationLog: async () => {
        throw new Error("log write failed");
      },
      insertManualReviewItem: async () => {
        throw new Error("insert failed");
      }
    });

    await expect(createManualReviewItemForRun(deps, claimedRun, payload)).resolves.toBeUndefined();
  });
});

describe("manual review item creation failure inside a full run", () => {
  it("keeps a manual_review_required run status intact when the queue insert fails", async () => {
    const { automationLogs, deps, runUpdates } = createDeps({
      insertManualReviewItem: async () => {
        throw new Error("insert failed: secret-internal-detail");
      }
    });

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "snapshot_complete"
    });

    expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    expect(automationLogs.some((log) => log.error_code === "MANUAL_REVIEW_ITEM_CREATE_FAILED")).toBe(true);
    expect(JSON.stringify(automationLogs)).not.toContain("secret-internal-detail");
  });
});
