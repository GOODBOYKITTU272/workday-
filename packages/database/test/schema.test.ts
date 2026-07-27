import { describe, expect, it } from "vitest";

import { phaseTwoSchema } from "../src/schema";

describe("Phase 2 database schema manifest", () => {
  it("lists every required table", () => {
    expect(phaseTwoSchema.tables).toEqual([
      "users",
      "candidates",
      "candidate_resumes",
      "candidate_answers",
      "question_bank",
      "zoho_mailboxes",
      "workday_accounts",
      "job_links",
      "application_runs",
      "run_steps",
      "extracted_questions",
      "mapped_answers",
      "manual_review_items",
      "otp_logs",
      "screenshots",
      "automation_logs",
      "system_settings",
      "audit_logs"
    ]);
  });

  it("keeps storage buckets private", () => {
    expect(phaseTwoSchema.storageBuckets).toEqual([
      "candidate-resumes",
      "run-screenshots",
      "playwright-traces",
      "html-captures"
    ]);
  });

  it("seeds safe V1 system settings", () => {
    expect(phaseTwoSchema.seedSettings).toEqual({
      auto_submit_enabled: false,
      default_run_mode: "dry_run",
      dry_run_required: true,
      human_approval_required: true,
      max_worker_concurrency: 1,
      otp_timeout_seconds: 120
    });
  });
});
