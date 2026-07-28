import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { type AutomationLogInsert, type ManualReviewItemInsert, type RunProcessorDeps, type RunStepInsert, processOneApplicationRun } from "../src/run-processor";
import { buildPostApplyDecisionRoute, buildPostLoginDecisionRoute, type WorkdayPageOpenCheckResult } from "../src/workday-page-snapshot";

const repoRoot = process.cwd();

describe("MVP dry-run release readiness", () => {
  it("runs the mocked Workday dry-run flow to manual review without unsafe writes", async () => {
    const runUpdates: unknown[] = [];
    const runSteps: RunStepInsert[] = [];
    const automationLogs: AutomationLogInsert[] = [];
    const manualReviewItems: ManualReviewItemInsert[] = [];
    const calls: string[] = [];
    const snapshot = {
      confidence: "high" as const,
      final_url: "https://acme.wd5.myworkdayjobs.com/External/sign-in",
      hostname: "acme.wd5.myworkdayjobs.com",
      load_status: "loaded" as const,
      page_kind: "sign_in_page" as const,
      page_kind_confidence: "high" as const,
      page_title: "Sign in",
      tenant_key: "acme",
      tenant_name: "acme",
      timestamp: "2026-07-28T00:00:00.000Z",
      workday_base_url: "https://acme.wd5.myworkdayjobs.com"
    };
    const deps: RunProcessorDeps = {
      attemptWorkdayLogin: async () => {
        calls.push("safe_login_attempt");

        return {
          confidence: "medium",
          hostname: "acme.wd5.myworkdayjobs.com",
          ok: true,
          post_login_state: "login_success_possible",
          tenant_key: "acme",
          timestamp: "2026-07-28T00:00:00.000Z"
        };
      },
      captureQuestionnaireSnapshot: async () => {
        calls.push("questionnaire_safe_snapshot");

        return {
          blocked_reason: null,
          checkbox_field_count: 1,
          confidence: "high",
          execution_allowed: false,
          field_count: 6,
          hostname: "acme.wd5.myworkdayjobs.com",
          ok: true,
          questionnaire_snapshot_detected: true,
          radio_field_count: 1,
          required_field_count: 2,
          requires_human_review: true,
          select_field_count: 1,
          tenant_key: "acme",
          text_field_count: 2,
          textarea_field_count: 1,
          timestamp: "2026-07-28T00:00:00.000Z",
          unknown_field_count: 0,
          upload_field_signal_detected: true
        };
      },
      checkWorkdayLoginReadiness: async () => {
        calls.push("login_readiness");

        return { ok: true };
      },
      claimNextRun: async () => ({ candidate_id: "candidate-id", id: "run-id", job_link_id: "job-link-id", mode: "dry_run", status: "queued" }),
      detectQuestionnairePage: async () => {
        calls.push("questionnaire_discovery");

        return {
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
          resume_upload_signal_detected: true,
          tenant_key: "acme",
          timestamp: "2026-07-28T00:00:00.000Z"
        };
      },
      inspectWorkdayLoginPage: async () => {
        calls.push("login_page_inspection");

        return {
          confidence: "high",
          email_field_candidate_detected: true,
          login_page_detected: true,
          ok: true,
          password_field_candidate_detected: true,
          sign_in_action_candidate_detected: true,
          timestamp: "2026-07-28T00:00:00.000Z"
        };
      },
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
      now: () => "2026-07-28T00:00:00.000Z",
      openWorkdayPage: async (): Promise<WorkdayPageOpenCheckResult> => ({
        apply_click: {
          action_type: "apply_available",
          after_hostname: snapshot.hostname,
          after_page_kind: "sign_in_page",
          after_page_kind_confidence: "high",
          after_tenant_key: "acme",
          after_tenant_name: "acme",
          after_url: snapshot.final_url,
          after_workday_base_url: snapshot.workday_base_url,
          before_page_kind: "job_page",
          before_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
          click_result: "clicked",
          error_code: null,
          reason: "clicked",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        discovery: {
          action_type: "sign_in_available",
          confidence: "high",
          safe_label_category: "sign_in",
          selector_category: "button",
          source: "selector_signal",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        ok: true,
        snapshot,
        url: snapshot.final_url
      }),
      updateRun: async (_runId, payload) => {
        runUpdates.push(payload);
      }
    };

    await expect(processOneApplicationRun(deps)).resolves.toEqual({ runId: "run-id", status: "apply_click_complete" });

    expect(calls).toEqual(["login_readiness", "login_page_inspection", "safe_login_attempt", "questionnaire_discovery", "questionnaire_safe_snapshot"]);
    expect(runUpdates).toEqual([expect.objectContaining({ current_step: "workday_apply_click", status: "manual_review_required" })]);
    expect(runSteps[0]?.metadata).toEqual(
      expect.objectContaining({
        apply_click: expect.objectContaining({ click_result: "clicked" }),
        login_attempt: expect.objectContaining({ ok: true, post_login_state: "login_success_possible" }),
        login_page_inspection: expect.objectContaining({ login_page_detected: true, ok: true }),
        login_readiness: { blocked_reason: null, ok: true },
        post_login_decision: expect.objectContaining({
          execution_allowed: false,
          post_login_route: "route_to_questionnaire_discovery_later",
          requires_human_review: true
        }),
        questionnaire_detection: expect.objectContaining({ execution_allowed: false, requires_human_review: true }),
        questionnaire_snapshot: expect.objectContaining({ execution_allowed: false, field_count: 6, requires_human_review: true })
      })
    );
    expect(manualReviewItems).toEqual([
      expect.objectContaining({
        error_code: "WORKDAY_QUESTIONNAIRE_SAFE_SNAPSHOT_REVIEW_REQUIRED",
        item_type: "routing_review",
        questionnaire_snapshot_detected: true,
        status: "open"
      })
    ]);
    expect(JSON.stringify({ automationLogs, manualReviewItems, runSteps })).not.toMatch(
      /submit|setInputFiles|inputValue|innerHTML|outerHTML|raw_html|raw_text|question label|placeholder|candidate@example\.com|super-secret|token abc123|otp code|verification link/i
    );
  });

  it("keeps every terminal route blocked for execution and requiring human review", () => {
    const postApplyStates = [
      "already_applied",
      "application_started",
      "create_account_required",
      "job_unavailable",
      "login_required",
      "tenant_mismatch",
      "unknown",
      "untrusted_redirect"
    ] as const;
    const postLoginStates = [
      "account_locked_possible",
      "invalid_credentials_possible",
      "login_success_possible",
      "otp_required",
      "still_on_login_page",
      "unknown",
      "verification_required"
    ] as const;

    for (const post_apply_state of postApplyStates) {
      expect(
        buildPostApplyDecisionRoute({
          confidence: "high",
          post_apply_reason: post_apply_state === "unknown" ? "no_signal" : "application_started_signal",
          post_apply_state
        }).execution_allowed
      ).toBe(false);
      expect(
        buildPostApplyDecisionRoute({
          confidence: "high",
          post_apply_reason: post_apply_state === "unknown" ? "no_signal" : "application_started_signal",
          post_apply_state
        }).requires_human_review
      ).toBe(true);
    }

    for (const post_login_state of postLoginStates) {
      const decision = buildPostLoginDecisionRoute({
        confidence: "high",
        hostname: "acme.wd5.myworkdayjobs.com",
        ok: true,
        post_login_state,
        tenant_key: "acme",
        timestamp: "2026-07-28T00:00:00.000Z"
      });

      expect(decision.execution_allowed).toBe(false);
      expect(decision.requires_human_review).toBe(true);
    }
  });

  it("keeps migration mirrors and MVP readiness docs in place", () => {
    for (const migration of readdirSync(join(repoRoot, "supabase/migrations")).filter((file) => file.endsWith(".sql"))) {
      const supabaseSql = readFileSync(join(repoRoot, "supabase/migrations", migration), "utf8");
      const packagePath = join(repoRoot, "packages/database/migrations", basename(migration));

      expect(existsSync(packagePath)).toBe(true);
      expect(readFileSync(packagePath, "utf8")).toBe(supabaseSql);
    }

    const docsPath = join(repoRoot, "docs/MVP_DRY_RUN_READINESS.md");

    expect(existsSync(docsPath)).toBe(true);
    expect(readFileSync(docsPath, "utf8")).toMatch(/manual_review_required|No submit|Supabase migrations|Rollback/i);
  });
});
