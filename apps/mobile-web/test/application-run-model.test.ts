import { describe, expect, test } from "vitest";

import { buildRunReadiness, canCreateApplicationRuns, toApplicationRunPayload, validateRunCreation } from "../src/runs/model";

describe("application run model", () => {
  test("blocks run creation until required candidate context exists", () => {
    const readiness = buildRunReadiness({
      activeResumeCount: 0,
      candidateId: "candidate-id",
      jobLinkId: "",
      zohoMailboxCount: 0
    });

    expect(readiness.canCreate).toBe(false);
    expect(readiness.missing).toEqual(["active resume", "Zoho mailbox", "job link"]);
    expect(validateRunCreation(readiness)).toEqual({ jobLinkId: "Select a job link." });
  });

  test("creates only queued dry-run payloads", () => {
    const readiness = buildRunReadiness({
      activeResumeCount: 1,
      candidateId: "candidate-id",
      jobLinkId: "job-link-id",
      zohoMailboxCount: 1
    });

    expect(validateRunCreation(readiness)).toEqual({});
    expect(toApplicationRunPayload(readiness, "user-id")).toEqual({
      candidate_id: "candidate-id",
      job_link_id: "job-link-id",
      mode: "dry_run",
      started_by: "user-id",
      status: "queued"
    });
  });

  test("allows only admin and operator roles to create runs", () => {
    expect(canCreateApplicationRuns("admin")).toBe(true);
    expect(canCreateApplicationRuns("operator")).toBe(true);
    expect(canCreateApplicationRuns("viewer")).toBe(false);
    expect(canCreateApplicationRuns(null)).toBe(false);
  });
});
