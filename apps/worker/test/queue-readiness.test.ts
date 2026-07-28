import { describe, expect, it } from "vitest";

import { isClaimableRunStatus, validateWorkerRunReadiness } from "../src/queue-readiness";

const readyInput = {
  activeResumeCount: 1,
  candidate: { id: "candidate-id" },
  jobLink: { candidate_id: "candidate-id", id: "job-link-id" },
  run: { candidate_id: "candidate-id", id: "run-id", job_link_id: "job-link-id", mode: "dry_run", status: "queued" },
  zohoMailboxCount: 1
};

describe("worker queue readiness", () => {
  it("allows only safe claimable run statuses", () => {
    expect(isClaimableRunStatus("queued")).toBe(true);
    expect(isClaimableRunStatus("starting")).toBe(true);
    expect(isClaimableRunStatus("approved_for_submit")).toBe(false);
    expect(isClaimableRunStatus("submitted")).toBe(false);
  });

  it("accepts a queued dry-run with candidate, matching job link, active resume, and Zoho mailbox", () => {
    expect(validateWorkerRunReadiness(readyInput)).toEqual({ ok: true, issues: [] });
  });

  it("rejects rows that should not be claimed by the worker", () => {
    expect(
      validateWorkerRunReadiness({
        ...readyInput,
        activeResumeCount: 0,
        jobLink: { candidate_id: "other-candidate", id: "job-link-id" },
        run: { ...readyInput.run, mode: "controlled_submit", status: "approved_for_submit" },
        zohoMailboxCount: 0
      })
    ).toEqual({
      ok: false,
      issues: [
        "run mode must be dry_run",
        "run status is not claimable",
        "job link must belong to candidate",
        "active resume is required",
        "Zoho mailbox is required"
      ]
    });
  });
});
