import { describe, expect, it } from "vitest";

import {
  type AutomationLogInsert,
  type ClaimedApplicationRun,
  type RunProcessorDeps,
  type RunStepInsert,
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

  const deps: RunProcessorDeps = {
    claimNextRun: async () => claimedRun,
    insertAutomationLog: async (payload) => {
      automationLogs.push(payload);
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

  return { automationLogs, deps, runSteps, runUpdates };
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
    const { automationLogs, deps, runSteps, runUpdates } = createDeps({
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

  it("stops safely when the detected tenant does not match the expected tenant", async () => {
    const { automationLogs, deps, runSteps, runUpdates } = createDeps({
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
    const { automationLogs, deps, runSteps, runUpdates } = createDeps({
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
