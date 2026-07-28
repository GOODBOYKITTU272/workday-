import { describe, expect, test } from "vitest";

import { canManageJobLinks, normalizeJobUrl, validateJobLinkInput } from "../src/job-links/model";

describe("job link model", () => {
  test("validates candidate and Workday URL", () => {
    expect(validateJobLinkInput({ candidateId: "", url: "" })).toEqual({
      candidateId: "Candidate is required.",
      url: "Job URL is required."
    });

    expect(validateJobLinkInput({ candidateId: "candidate-id", url: "not-a-url" })).toEqual({
      url: "Enter a valid URL."
    });

    expect(validateJobLinkInput({ candidateId: "candidate-id", url: "https://example.com/jobs/1" })).toEqual({
      url: "Enter a Workday job URL for V1."
    });

    expect(validateJobLinkInput({ candidateId: "candidate-id", url: "https://company.wd1.myworkdayjobs.com/jobs/job/123" })).toEqual({});
  });

  test("normalizes job URLs for duplicate detection", () => {
    expect(normalizeJobUrl(" HTTPS://Company.WD1.MyWorkdayJobs.com/jobs/job/123/#top ")).toBe(
      "https://company.wd1.myworkdayjobs.com/jobs/job/123"
    );
    expect(normalizeJobUrl("https://company.wd1.myworkdayjobs.com/jobs/job/123/")).toBe(
      "https://company.wd1.myworkdayjobs.com/jobs/job/123"
    );
  });

  test("allows only admin and operator roles to manage job links", () => {
    expect(canManageJobLinks("admin")).toBe(true);
    expect(canManageJobLinks("operator")).toBe(true);
    expect(canManageJobLinks("viewer")).toBe(false);
    expect(canManageJobLinks(null)).toBe(false);
  });
});
