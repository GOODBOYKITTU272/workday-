import { describe, expect, it } from "vitest";

import {
  type AutomationLogInsert,
  type ClaimedApplicationRun,
  type RunProcessorDeps,
  type RunStepInsert,
  processOneApplicationRun
} from "../src/run-processor";

const claimedRun: ClaimedApplicationRun = {
  candidate_id: "candidate-id",
  id: "run-id",
  job_link_id: "job-link-id",
  mode: "dry_run",
  status: "starting"
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
      jobLink: { candidate_id: run.candidate_id, id: run.job_link_id },
      run,
      zohoMailboxCount: 1
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

  it("writes a safe placeholder result after readiness passes", async () => {
    const { automationLogs, deps, runSteps, runUpdates } = createDeps();

    await expect(processOneApplicationRun(deps)).resolves.toEqual({
      runId: "run-id",
      status: "placeholder_complete"
    });

    expect(runSteps).toEqual([
      expect.objectContaining({
        application_run_id: "run-id",
        message: "Run readiness checked. Browser automation is not implemented in Phase 16.",
        step_name: "readiness_checked",
        step_status: "success"
      })
    ]);
    expect(automationLogs).toEqual([
      expect.objectContaining({
        application_run_id: "run-id",
        level: "info",
        message: "Worker stopped before browser automation."
      })
    ]);
    expect(runUpdates).toEqual([
      expect.objectContaining({
        current_step: "readiness_checked",
        error_code: "WORKER_AUTOMATION_NOT_IMPLEMENTED",
        readiness_score: "needs_review",
        status: "manual_review_required"
      })
    ]);
    expect(JSON.stringify(runUpdates)).not.toMatch(/approved_for_submit|submitted_at/);
  });

  it("moves readiness failures to manual review with safe step and log details", async () => {
    const { automationLogs, deps, runSteps, runUpdates } = createDeps({
      loadReadiness: async (run) => ({
        activeResumeCount: 0,
        candidate: { id: run.candidate_id },
        jobLink: { candidate_id: run.candidate_id, id: run.job_link_id },
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
