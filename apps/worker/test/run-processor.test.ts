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
    attemptWorkdayLogin: async () => ({
      confidence: "medium",
      hostname: "acme.wd5.myworkdayjobs.com",
      ok: true,
      post_login_state: "login_success_possible",
      tenant_key: "acme",
      timestamp: "2026-07-28T00:00:00.000Z"
    }),
    checkWorkdayLoginReadiness: async () => ({ ok: true }),
    claimNextRun: async () => claimedRun,
    inspectWorkdayLoginPage: async () => ({
      confidence: "high",
      email_field_candidate_detected: true,
      login_page_detected: true,
      ok: true,
      password_field_candidate_detected: true,
      sign_in_action_candidate_detected: true,
      timestamp: "2026-07-28T00:00:00.000Z"
    }),
    detectQuestionnairePage: async () => ({
      application_form_detected: true,
      blocked_reason: null,
      confidence: "high",
      execution_allowed: false,
      form_signals_detected: true,
      hostname: "acme.wd5.myworkdayjobs.com",
      ok: true,
      questionnaire_page_detected: true,
      required_fields_signal_detected: true,
      requires_human_review: true,
      resume_upload_signal_detected: false,
      tenant_key: "acme",
      timestamp: "2026-07-28T00:00:00.000Z"
    }),
    captureQuestionnaireSnapshot: async () => ({
      blocked_reason: null,
      checkbox_field_count: 1,
      confidence: "high",
      execution_allowed: false,
      field_count: 5,
      hostname: "acme.wd5.myworkdayjobs.com",
      ok: true,
      questionnaire_snapshot_detected: true,
      radio_field_count: 0,
      required_field_count: 2,
      requires_human_review: true,
      select_field_count: 1,
      tenant_key: "acme",
      text_field_count: 2,
      textarea_field_count: 0,
      timestamp: "2026-07-28T00:00:00.000Z",
      unknown_field_count: 0,
      upload_field_signal_detected: true
    }),
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
      "route_to_questionnaire_discovery_later",
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

  describe("Workday login readiness (route_to_login_flow only)", () => {
    function createLoginRouteDeps(overrides: Partial<RunProcessorDeps> = {}) {
      return createDeps({
        openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
          ok: true,
          discovery: {
            action_type: "sign_in_available",
            confidence: "high",
            safe_label_category: "sign_in",
            selector_category: "button",
            source: "selector_signal",
            timestamp: "2026-07-28T00:00:00.000Z"
          },
          snapshot: { ...trustedSnapshot, page_kind: "sign_in_page" },
          url: trustedSnapshot.final_url
        }),
        ...overrides
      });
    }

    it("passes the candidate and tenant to the readiness check only when routed to login", async () => {
      const calls: Array<{ candidateId: string; tenantKey: string | null }> = [];
      const { deps } = createLoginRouteDeps({
        checkWorkdayLoginReadiness: async (candidateId, tenantKey) => {
          calls.push({ candidateId, tenantKey });

          return { ok: true };
        }
      });

      await processOneApplicationRun(deps);

      expect(calls).toEqual([{ candidateId: "candidate-id", tenantKey: "acme" }]);
    });

    it("does not call the readiness check for routes other than route_to_login_flow", async () => {
      let callCount = 0;
      const { deps } = createDeps({
        checkWorkdayLoginReadiness: async () => {
          callCount += 1;

          return { ok: true };
        }
      });

      await processOneApplicationRun(deps);

      expect(callCount).toBe(0);
    });

    it("creates a route_to_login_flow item with no error_code when the account is ready", async () => {
      const { manualReviewItems, runSteps, runUpdates } = await runLoginRouteScenario({
        checkWorkdayLoginReadiness: async () => ({ ok: true }),
        inspectWorkdayLoginPage: async () => ({
          confidence: "unknown",
          email_field_candidate_detected: false,
          login_page_detected: false,
          ok: true,
          password_field_candidate_detected: false,
          sign_in_action_candidate_detected: false,
          timestamp: "2026-07-28T00:00:00.000Z"
        })
      });

      expect(manualReviewItems).toEqual([
        expect.objectContaining({
          error_code: null,
          item_type: "routing_review",
          review_reason: "route_to_login_flow"
        })
      ]);
      expect(runSteps[0]?.metadata).toEqual(expect.objectContaining({ login_readiness: { blocked_reason: null, ok: true } }));
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    });

    it.each([
      ["account_missing", "WORKDAY_LOGIN_ACCOUNT_MISSING"],
      ["account_locked", "WORKDAY_LOGIN_ACCOUNT_LOCKED"],
      ["account_disabled", "WORKDAY_LOGIN_ACCOUNT_DISABLED"],
      ["password_missing", "WORKDAY_LOGIN_PASSWORD_MISSING"],
      ["password_decrypt_failed", "WORKDAY_LOGIN_PASSWORD_DECRYPT_FAILED"]
    ] as const)("sets a safe error_code for %s without blocking the run", async (blockedReason, expectedErrorCode) => {
      const { manualReviewItems, runUpdates } = await runLoginRouteScenario({
        checkWorkdayLoginReadiness: async () => ({ blockedReason, ok: false })
      });

      expect(manualReviewItems).toEqual([
        expect.objectContaining({
          error_code: expectedErrorCode,
          review_reason: "route_to_login_flow"
        })
      ]);
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    });

    it("keeps the run manual_review_required and logs nothing sensitive when the readiness check itself throws", async () => {
      const { automationLogs, manualReviewItems, runSteps, runUpdates } = await runLoginRouteScenario({
        checkWorkdayLoginReadiness: async () => {
          throw new Error("supabase connection string with credentials leaked-secret-value");
        }
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          login_readiness: { blocked_reason: "readiness_check_failed", ok: false }
        })
      );
      expect(manualReviewItems).toEqual([expect.objectContaining({ error_code: "WORKDAY_LOGIN_READINESS_CHECK_FAILED" })]);
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
      expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toContain("leaked-secret-value");
    });

    it("never includes account_status, email, or password fields in run_steps, automation_logs, or manual_review_items", async () => {
      const { automationLogs, manualReviewItems, runSteps } = await runLoginRouteScenario({
        checkWorkdayLoginReadiness: async () => ({
          blockedReason: "password_decrypt_failed",
          ok: false
        })
      });

      const writes = JSON.stringify({ automationLogs, manualReviewItems, runSteps });

      expect(writes).not.toMatch(/password_encrypted|super-secret|@example\.com/i);
    });

    async function runLoginRouteScenario(overrides: Partial<RunProcessorDeps>) {
      const { automationLogs, deps, manualReviewItems, runSteps, runUpdates } = createLoginRouteDeps(overrides);

      await expect(processOneApplicationRun(deps)).resolves.toEqual({
        runId: "run-id",
        status: "snapshot_complete"
      });

      return { automationLogs, manualReviewItems, runSteps, runUpdates };
    }
  });

  describe("Workday login page inspection (route_to_login_flow only)", () => {
    function createLoginRouteDeps(overrides: Partial<RunProcessorDeps> = {}) {
      return createDeps({
        openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
          ok: true,
          discovery: {
            action_type: "sign_in_available",
            confidence: "high",
            safe_label_category: "sign_in",
            selector_category: "button",
            source: "selector_signal",
            timestamp: "2026-07-28T00:00:00.000Z"
          },
          snapshot: { ...trustedSnapshot, page_kind: "sign_in_page" },
          url: trustedSnapshot.final_url
        }),
        ...overrides
      });
    }

    it("passes the snapshot URL and tenant to the inspection only when routed to login", async () => {
      const calls: Array<{ tenantKey: string | null; url: string }> = [];
      const { deps } = createLoginRouteDeps({
        inspectWorkdayLoginPage: async (url, tenantKey) => {
          calls.push({ tenantKey, url });

          return {
            confidence: "unknown",
            email_field_candidate_detected: false,
            login_page_detected: false,
            ok: true,
            password_field_candidate_detected: false,
            sign_in_action_candidate_detected: false,
            timestamp: "2026-07-28T00:00:00.000Z"
          };
        }
      });

      await processOneApplicationRun(deps);

      expect(calls).toEqual([{ tenantKey: "acme", url: trustedSnapshot.final_url }]);
    });

    it("does not inspect the login page for routes other than route_to_login_flow", async () => {
      let callCount = 0;
      const { deps } = createDeps({
        inspectWorkdayLoginPage: async () => {
          callCount += 1;

          return {
            confidence: "unknown",
            email_field_candidate_detected: false,
            login_page_detected: false,
            ok: true,
            password_field_candidate_detected: false,
            sign_in_action_candidate_detected: false,
            timestamp: "2026-07-28T00:00:00.000Z"
          };
        }
      });

      await processOneApplicationRun(deps);

      expect(callCount).toBe(0);
    });

    it("records safe metadata when a trusted login page is confirmed", async () => {
      const { runSteps, runUpdates } = await runLoginPageInspectionScenario({
        inspectWorkdayLoginPage: async () => ({
          confidence: "high",
          email_field_candidate_detected: true,
          login_page_detected: true,
          ok: true,
          password_field_candidate_detected: true,
          sign_in_action_candidate_detected: true,
          timestamp: "2026-07-28T00:00:00.000Z"
        })
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          login_page_inspection: {
            blocked_reason: null,
            confidence: "high",
            email_field_candidate_detected: true,
            login_page_detected: true,
            ok: true,
            password_field_candidate_detected: true,
            sign_in_action_candidate_detected: true
          }
        })
      );
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    });

    it("records manual review with safe metadata when the page cannot be confirmed as a login page", async () => {
      const { runSteps, runUpdates } = await runLoginPageInspectionScenario({
        inspectWorkdayLoginPage: async () => ({
          confidence: "unknown",
          email_field_candidate_detected: false,
          login_page_detected: false,
          ok: true,
          password_field_candidate_detected: false,
          sign_in_action_candidate_detected: false,
          timestamp: "2026-07-28T00:00:00.000Z"
        })
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          login_page_inspection: expect.objectContaining({
            confidence: "unknown",
            login_page_detected: false,
            ok: true
          })
        })
      );
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    });

    it.each(["expected_tenant_missing", "tenant_mismatch_before_open", "untrusted_redirect", "tenant_mismatch_after_open", "final_tenant_missing"] as const)(
      "keeps the run manual_review_required and records the block reason for %s",
      async (blockedReason) => {
        const { runSteps, runUpdates } = await runLoginPageInspectionScenario({
          inspectWorkdayLoginPage: async () => ({ blockedReason, ok: false })
        });

        expect(runSteps[0]?.metadata).toEqual(
          expect.objectContaining({
            login_page_inspection: { blocked_reason: blockedReason, ok: false }
          })
        );
        expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
      }
    );

    it("keeps the run manual_review_required and logs nothing sensitive when the inspection itself throws", async () => {
      const { automationLogs, manualReviewItems, runSteps, runUpdates } = await runLoginPageInspectionScenario({
        inspectWorkdayLoginPage: async () => {
          throw new Error("playwright internal trace with leaked-inspection-secret");
        }
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          login_page_inspection: { blocked_reason: "inspection_failed", ok: false }
        })
      );
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
      expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toContain("leaked-inspection-secret");
    });

    it("never includes raw HTML, selectors, cookies, storage, or field values in run_steps or automation_logs", async () => {
      const { automationLogs, runSteps } = await runLoginPageInspectionScenario({
        inspectWorkdayLoginPage: async () => ({
          confidence: "high",
          email_field_candidate_detected: true,
          login_page_detected: true,
          ok: true,
          password_field_candidate_detected: true,
          sign_in_action_candidate_detected: true,
          timestamp: "2026-07-28T00:00:00.000Z"
        })
      });

      const writes = JSON.stringify({ automationLogs, runSteps });

      expect(writes).not.toMatch(/innerHTML|outerHTML|cookie|localStorage|sessionStorage|input\[type|<html/i);
    });

    async function runLoginPageInspectionScenario(overrides: Partial<RunProcessorDeps>) {
      const { automationLogs, deps, manualReviewItems, runSteps, runUpdates } = createLoginRouteDeps(overrides);

      await expect(processOneApplicationRun(deps)).resolves.toEqual({
        runId: "run-id",
        status: "snapshot_complete"
      });

      return { automationLogs, manualReviewItems, runSteps, runUpdates };
    }
  });

  describe("Workday login attempt (route_to_login_flow, readiness ok, login page confirmed)", () => {
    function createReadyLoginRouteDeps(overrides: Partial<RunProcessorDeps> = {}) {
      return createDeps({
        openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
          ok: true,
          discovery: {
            action_type: "sign_in_available",
            confidence: "high",
            safe_label_category: "sign_in",
            selector_category: "button",
            source: "selector_signal",
            timestamp: "2026-07-28T00:00:00.000Z"
          },
          snapshot: { ...trustedSnapshot, page_kind: "sign_in_page" },
          url: trustedSnapshot.final_url
        }),
        ...overrides
      });
    }

    async function runLoginAttemptScenario(overrides: Partial<RunProcessorDeps>) {
      const { automationLogs, deps, manualReviewItems, runSteps, runUpdates } = createReadyLoginRouteDeps(overrides);

      await expect(processOneApplicationRun(deps)).resolves.toEqual({
        runId: "run-id",
        status: "snapshot_complete"
      });

      return { automationLogs, manualReviewItems, runSteps, runUpdates };
    }

    it("passes the candidate, tenant, and URL to the login attempt only when routed to login", async () => {
      const calls: Array<{ candidateId: string; tenantKey: string; url: string }> = [];
      const { deps } = createReadyLoginRouteDeps({
        attemptWorkdayLogin: async (candidateId, tenantKey, url) => {
          calls.push({ candidateId, tenantKey, url });

          return {
            confidence: "medium",
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            post_login_state: "login_success_possible",
            tenant_key: "acme",
            timestamp: "2026-07-28T00:00:00.000Z"
          };
        }
      });

      await processOneApplicationRun(deps);

      expect(calls).toEqual([{ candidateId: "candidate-id", tenantKey: "acme", url: trustedSnapshot.final_url }]);
    });

    it("does not attempt login for routes other than route_to_login_flow", async () => {
      let callCount = 0;
      const { deps } = createDeps({
        attemptWorkdayLogin: async () => {
          callCount += 1;

          return {
            confidence: "medium",
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            post_login_state: "login_success_possible",
            tenant_key: "acme",
            timestamp: "2026-07-28T00:00:00.000Z"
          };
        }
      });

      await processOneApplicationRun(deps);

      expect(callCount).toBe(0);
    });

    it("does not attempt login when readiness is not ok, even though the route is route_to_login_flow", async () => {
      let callCount = 0;
      const { deps } = createReadyLoginRouteDeps({
        attemptWorkdayLogin: async () => {
          callCount += 1;

          return { blockedReason: "login_attempt_failed" as const, ok: false };
        },
        checkWorkdayLoginReadiness: async () => ({ blockedReason: "account_missing", ok: false })
      });

      await processOneApplicationRun(deps);

      expect(callCount).toBe(0);
    });

    it("does not attempt login when the login page was not confirmed", async () => {
      let callCount = 0;
      const { deps } = createReadyLoginRouteDeps({
        attemptWorkdayLogin: async () => {
          callCount += 1;

          return { blockedReason: "login_attempt_failed" as const, ok: false };
        },
        inspectWorkdayLoginPage: async () => ({
          confidence: "unknown",
          email_field_candidate_detected: false,
          login_page_detected: false,
          ok: true,
          password_field_candidate_detected: false,
          sign_in_action_candidate_detected: false,
          timestamp: "2026-07-28T00:00:00.000Z"
        })
      });

      await processOneApplicationRun(deps);

      expect(callCount).toBe(0);
    });

    it("routes a possible login success to later questionnaire discovery with fixed safe metadata", async () => {
      const { automationLogs, manualReviewItems, runSteps, runUpdates } = await runLoginAttemptScenario({});

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          login_attempt: {
            blocked_reason: null,
            confidence: "medium",
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            post_login_state: "login_success_possible",
            tenant_key: "acme"
          },
          post_login_decision: {
            confidence: "medium",
            execution_allowed: false,
            hostname: "acme.wd5.myworkdayjobs.com",
            post_login_route: "route_to_questionnaire_discovery_later",
            post_login_state: "login_success_possible",
            requires_human_review: true,
            tenant_key: "acme",
            timestamp: "2026-07-28T00:00:00.000Z"
          },
          questionnaire_detection: {
            application_form_detected: true,
            blocked_reason: null,
            confidence: "high",
            execution_allowed: false,
            form_signals_detected: true,
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            questionnaire_page_detected: true,
            required_fields_signal_detected: true,
            requires_human_review: true,
            resume_upload_signal_detected: false,
            tenant_key: "acme"
          },
          questionnaire_snapshot: {
            blocked_reason: null,
            checkbox_field_count: 1,
            confidence: "high",
            execution_allowed: false,
            field_count: 5,
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            questionnaire_snapshot_detected: true,
            radio_field_count: 0,
            required_field_count: 2,
            requires_human_review: true,
            select_field_count: 1,
            tenant_key: "acme",
            text_field_count: 2,
            textarea_field_count: 0,
            unknown_field_count: 0,
            upload_field_signal_detected: true
          }
        })
      );
      expect(automationLogs[0]?.context).toEqual(
        expect.objectContaining({
          post_login_decision: expect.objectContaining({
            execution_allowed: false,
            post_login_route: "route_to_questionnaire_discovery_later",
            requires_human_review: true
          }),
          questionnaire_detection: expect.objectContaining({
            execution_allowed: false,
            questionnaire_page_detected: true,
            requires_human_review: true
          }),
          questionnaire_snapshot: expect.objectContaining({
            execution_allowed: false,
            field_count: 5,
            questionnaire_snapshot_detected: true,
            requires_human_review: true
          })
        })
      );
      expect(manualReviewItems).toEqual([
        expect.objectContaining({
          application_form_detected: true,
          questionnaire_snapshot_checkbox_field_count: 1,
          error_code: "WORKDAY_QUESTIONNAIRE_SAFE_SNAPSHOT_REVIEW_REQUIRED",
          form_signals_detected: true,
          hostname: "acme.wd5.myworkdayjobs.com",
          post_login_route: "route_to_questionnaire_discovery_later",
          post_login_state: "login_success_possible",
          questionnaire_detection_confidence: "high",
          questionnaire_page_detected: true,
          questionnaire_snapshot_confidence: "high",
          questionnaire_snapshot_detected: true,
          questionnaire_snapshot_field_count: 5,
          questionnaire_snapshot_radio_field_count: 0,
          questionnaire_snapshot_required_field_count: 2,
          questionnaire_snapshot_select_field_count: 1,
          questionnaire_snapshot_text_field_count: 2,
          questionnaire_snapshot_textarea_field_count: 0,
          questionnaire_snapshot_unknown_field_count: 0,
          questionnaire_snapshot_upload_field_signal_detected: true,
          required_fields_signal_detected: true,
          review_reason: "route_to_questionnaire_discovery_later",
          risk_level: "medium",
          resume_upload_signal_detected: false,
          tenant_key: "acme"
        })
      ]);
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
      expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toMatch(
        /candidate@example\.com|super-secret-password|otp code|access_token|verification link|leaked-login-secret|What is your salary|placeholder|input\[|input value|option label/i
      );
    });

    it.each([
      ["otp_required", "route_to_otp_manual_review"],
      ["verification_required", "route_to_verification_manual_review"],
      ["invalid_credentials_possible", "stop_invalid_credentials_manual_review"],
      ["account_locked_possible", "stop_account_locked_manual_review"],
      ["still_on_login_page", "still_on_login_manual_review"],
      ["unknown", "unknown_post_login_manual_review"]
    ] as const)("routes %s safely and keeps the run manual_review_required", async (postLoginState, postLoginRoute) => {
      const { runSteps, runUpdates } = await runLoginAttemptScenario({
        attemptWorkdayLogin: async () => ({
          confidence: "high",
          hostname: "acme.wd5.myworkdayjobs.com",
          ok: true,
          post_login_state: postLoginState,
          tenant_key: "acme",
          timestamp: "2026-07-28T00:00:00.000Z"
        })
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          login_attempt: expect.objectContaining({ ok: true, post_login_state: postLoginState }),
          post_login_decision: expect.objectContaining({
            execution_allowed: false,
            post_login_route: postLoginRoute,
            post_login_state: postLoginState,
            requires_human_review: true
          }),
          questionnaire_detection: null,
          questionnaire_snapshot: null
        })
      );
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    });

    it("passes the post-login tenant and URL to questionnaire detection only for questionnaire discovery route", async () => {
      const calls: Array<{ tenantKey: string | null; url: string }> = [];
      const { runUpdates } = await runLoginAttemptScenario({
        detectQuestionnairePage: async (url, tenantKey) => {
          calls.push({ tenantKey, url });

          return {
            application_form_detected: false,
            blocked_reason: null,
            confidence: "unknown",
            execution_allowed: false,
            form_signals_detected: false,
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            questionnaire_page_detected: false,
            required_fields_signal_detected: false,
            requires_human_review: true,
            resume_upload_signal_detected: false,
            tenant_key: "acme",
            timestamp: "2026-07-28T00:00:00.000Z"
          };
        }
      });

      expect(calls).toEqual([{ tenantKey: "acme", url: trustedSnapshot.final_url }]);
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    });

    it("captures the questionnaire safe snapshot only after a positive questionnaire discovery signal", async () => {
      const calls: Array<{ tenantKey: string | null; url: string }> = [];
      const { automationLogs, manualReviewItems, runSteps, runUpdates } = await runLoginAttemptScenario({
        captureQuestionnaireSnapshot: async (url, tenantKey) => {
          calls.push({ tenantKey, url });

          return {
            blocked_reason: null,
            checkbox_field_count: 1,
            confidence: "medium",
            execution_allowed: false,
            field_count: 4,
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            questionnaire_snapshot_detected: true,
            radio_field_count: 1,
            required_field_count: 1,
            requires_human_review: true,
            select_field_count: 1,
            tenant_key: "acme",
            text_field_count: 1,
            textarea_field_count: 0,
            timestamp: "2026-07-28T00:00:00.000Z",
            unknown_field_count: 0,
            upload_field_signal_detected: false
          };
        }
      });

      expect(calls).toEqual([{ tenantKey: "acme", url: trustedSnapshot.final_url }]);
      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          questionnaire_snapshot: expect.objectContaining({
            confidence: "medium",
            execution_allowed: false,
            field_count: 4,
            requires_human_review: true
          })
        })
      );
      expect(manualReviewItems).toEqual([
        expect.objectContaining({
          error_code: "WORKDAY_QUESTIONNAIRE_SAFE_SNAPSHOT_REVIEW_REQUIRED",
          questionnaire_snapshot_confidence: "medium",
          questionnaire_snapshot_detected: true,
          questionnaire_snapshot_field_count: 4
        })
      ]);
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
      expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toMatch(
        /What is your salary|candidate@example\.com|super-secret-password|token abc123|otp code|verification link|placeholder|input\[|option label/i
      );
    });

    it("does not capture a questionnaire snapshot without questionnaire discovery signals", async () => {
      let callCount = 0;
      const { runSteps, runUpdates } = await runLoginAttemptScenario({
        detectQuestionnairePage: async () => ({
          application_form_detected: false,
          blocked_reason: null,
          confidence: "unknown",
          execution_allowed: false,
          form_signals_detected: false,
          hostname: "acme.wd5.myworkdayjobs.com",
          ok: true,
          questionnaire_page_detected: false,
          required_fields_signal_detected: false,
          requires_human_review: true,
          resume_upload_signal_detected: false,
          tenant_key: "acme",
          timestamp: "2026-07-28T00:00:00.000Z"
        }),
        captureQuestionnaireSnapshot: async () => {
          callCount += 1;

          throw new Error("snapshot must not run");
        }
      });

      expect(callCount).toBe(0);
      expect(runSteps[0]?.metadata).toEqual(expect.objectContaining({ questionnaire_snapshot: null }));
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    });

    it.each(["otp_required", "verification_required", "invalid_credentials_possible", "account_locked_possible", "still_on_login_page", "unknown"] as const)(
      "does not run questionnaire detection for %s",
      async (postLoginState) => {
        let callCount = 0;
        await runLoginAttemptScenario({
          attemptWorkdayLogin: async () => ({
            confidence: "high",
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            post_login_state: postLoginState,
            tenant_key: "acme",
            timestamp: "2026-07-28T00:00:00.000Z"
          }),
          detectQuestionnairePage: async () => {
            callCount += 1;

            throw new Error("questionnaire detection must not run");
          }
        });

        expect(callCount).toBe(0);
      }
    );

    it.each(["otp_required", "verification_required", "invalid_credentials_possible", "account_locked_possible", "still_on_login_page", "unknown"] as const)(
      "does not capture a questionnaire snapshot for %s",
      async (postLoginState) => {
        let callCount = 0;
        await runLoginAttemptScenario({
          attemptWorkdayLogin: async () => ({
            confidence: "high",
            hostname: "acme.wd5.myworkdayjobs.com",
            ok: true,
            post_login_state: postLoginState,
            tenant_key: "acme",
            timestamp: "2026-07-28T00:00:00.000Z"
          }),
          captureQuestionnaireSnapshot: async () => {
            callCount += 1;

            throw new Error("snapshot must not run");
          }
        });

        expect(callCount).toBe(0);
      }
    );

    it("keeps unknown questionnaire pages in manual review without raw question text", async () => {
      const { automationLogs, manualReviewItems, runSteps, runUpdates } = await runLoginAttemptScenario({
        detectQuestionnairePage: async () => ({
          application_form_detected: false,
          blocked_reason: null,
          confidence: "unknown",
          execution_allowed: false,
          form_signals_detected: false,
          hostname: "acme.wd5.myworkdayjobs.com",
          ok: true,
          questionnaire_page_detected: false,
          required_fields_signal_detected: false,
          requires_human_review: true,
          resume_upload_signal_detected: false,
          tenant_key: "acme",
          timestamp: "2026-07-28T00:00:00.000Z"
        })
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          questionnaire_detection: expect.objectContaining({
            confidence: "unknown",
            execution_allowed: false,
            questionnaire_page_detected: false,
            requires_human_review: true
          }),
          questionnaire_snapshot: null
        })
      );
      expect(manualReviewItems).toEqual([
        expect.objectContaining({
          error_code: "WORKDAY_QUESTIONNAIRE_DISCOVERY_REVIEW_REQUIRED",
          questionnaire_detection_confidence: "unknown",
          questionnaire_page_detected: false
        })
      ]);
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
      expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toMatch(
        /What is your legal name|candidate@example\.com|super-secret-password|token abc123|otp code|verification link/i
      );
    });

    it("maps thrown questionnaire detection errors to fixed safe metadata", async () => {
      const { automationLogs, manualReviewItems, runSteps } = await runLoginAttemptScenario({
        detectQuestionnairePage: async () => {
          throw new Error("question text: What is your salary password token abc123");
        }
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          questionnaire_detection: expect.objectContaining({
            blocked_reason: "inspection_failed",
            ok: false
          })
        })
      );
      expect(manualReviewItems).toEqual([
        expect.objectContaining({
          error_code: "WORKDAY_QUESTIONNAIRE_DISCOVERY_REVIEW_REQUIRED",
          questionnaire_detection_confidence: "unknown"
        })
      ]);
      expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toMatch(/salary|password token abc123/i);
    });

    it("maps thrown questionnaire snapshot errors to fixed safe metadata", async () => {
      const { automationLogs, manualReviewItems, runSteps } = await runLoginAttemptScenario({
        captureQuestionnaireSnapshot: async () => {
          throw new Error("question label salary placeholder secret-token option label");
        }
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          questionnaire_snapshot: expect.objectContaining({
            blocked_reason: "inspection_failed",
            ok: false
          })
        })
      );
      expect(manualReviewItems).toEqual([
        expect.objectContaining({
          error_code: "WORKDAY_QUESTIONNAIRE_SAFE_SNAPSHOT_REVIEW_REQUIRED",
          questionnaire_snapshot_confidence: "unknown"
        })
      ]);
      expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toMatch(/salary|placeholder secret-token|option label/i);
    });

    it.each([
      "untrusted_redirect_after_login",
      "tenant_mismatch_after_login",
      "email_field_not_found",
      "password_field_not_found",
      "sign_in_action_not_found"
    ] as const)("sets a safe error_code and keeps the run manual_review_required for %s", async (blockedReason) => {
      const { manualReviewItems, runSteps, runUpdates } = await runLoginAttemptScenario({
        attemptWorkdayLogin: async () => ({ blockedReason, ok: false })
      });

      expect(runSteps[0]?.metadata).toEqual(expect.objectContaining({ login_attempt: { blocked_reason: blockedReason, ok: false } }));
      expect(manualReviewItems).toEqual([
        expect.objectContaining({
          error_code: `WORKDAY_LOGIN_ATTEMPT_${blockedReason.toUpperCase()}`
        })
      ]);
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
    });

    it("keeps the run manual_review_required and logs nothing sensitive when the login attempt itself throws", async () => {
      const { automationLogs, manualReviewItems, runSteps, runUpdates } = await runLoginAttemptScenario({
        attemptWorkdayLogin: async () => {
          throw new Error("playwright trace containing leaked-login-secret and super-secret-password");
        }
      });

      expect(runSteps[0]?.metadata).toEqual(
        expect.objectContaining({
          login_attempt: { blocked_reason: "login_attempt_failed", ok: false }
        })
      );
      expect(runUpdates[0]).toEqual(expect.objectContaining({ status: "manual_review_required" }));
      expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toContain("leaked-login-secret");
    });

    it("never includes a password, email, or raw error message in run_steps, automation_logs, or manual_review_items", async () => {
      const { automationLogs, manualReviewItems, runSteps } = await runLoginAttemptScenario({
        attemptWorkdayLogin: async () => {
          throw new Error("email candidate@example.com password super-secret-password token abc123");
        }
      });

      const writes = JSON.stringify({ automationLogs, manualReviewItems, runSteps });

      expect(writes).not.toMatch(/candidate@example\.com|super-secret-password|token abc123/i);
    });
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
      post_login_route: null,
      post_login_state: null,
      application_form_detected: null,
      form_signals_detected: null,
      questionnaire_detection_confidence: null,
      questionnaire_page_detected: null,
      questionnaire_snapshot_checkbox_field_count: null,
      questionnaire_snapshot_confidence: null,
      questionnaire_snapshot_detected: null,
      questionnaire_snapshot_field_count: null,
      questionnaire_snapshot_radio_field_count: null,
      questionnaire_snapshot_required_field_count: null,
      questionnaire_snapshot_select_field_count: null,
      questionnaire_snapshot_text_field_count: null,
      questionnaire_snapshot_textarea_field_count: null,
      questionnaire_snapshot_unknown_field_count: null,
      questionnaire_snapshot_upload_field_signal_detected: null,
      required_fields_signal_detected: null,
      resume_upload_signal_detected: null,
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
      post_login_route: null,
      post_login_state: null,
      application_form_detected: null,
      form_signals_detected: null,
      questionnaire_detection_confidence: null,
      questionnaire_page_detected: null,
      questionnaire_snapshot_checkbox_field_count: null,
      questionnaire_snapshot_confidence: null,
      questionnaire_snapshot_detected: null,
      questionnaire_snapshot_field_count: null,
      questionnaire_snapshot_radio_field_count: null,
      questionnaire_snapshot_required_field_count: null,
      questionnaire_snapshot_select_field_count: null,
      questionnaire_snapshot_text_field_count: null,
      questionnaire_snapshot_textarea_field_count: null,
      questionnaire_snapshot_unknown_field_count: null,
      questionnaire_snapshot_upload_field_signal_detected: null,
      required_fields_signal_detected: null,
      resume_upload_signal_detected: null,
      review_reason: "route_to_login_flow",
      risk_level: "high",
      route_reason: "login_signal",
      status: "open",
      tenant_key: "acme"
    });
  });
});

describe("createManualReviewItemForRun", () => {
  const payload = buildManualReviewItemPayload({
    category: "readiness_blocked",
    riskLevel: "high",
    run: claimedRun
  });

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
