import { describe, expect, test } from "vitest";

import { buildResumeStoragePath, validateResumeFile } from "../src/resumes/model";

describe("resume model", () => {
  test("validates candidate id, PDF type, and size", () => {
    expect(validateResumeFile({ candidateId: "", fileName: "", fileSizeBytes: 0, mimeType: "" })).toEqual({
      candidateId: "Candidate is required.",
      file: "PDF resume is required."
    });

    expect(
      validateResumeFile({
        candidateId: "candidate-id",
        fileName: "resume.docx",
        fileSizeBytes: 100,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    ).toEqual({ file: "Only PDF resumes are supported in Phase 6." });

    expect(
      validateResumeFile({
        candidateId: "candidate-id",
        fileName: "resume.pdf",
        fileSizeBytes: 11 * 1024 * 1024,
        mimeType: "application/pdf"
      })
    ).toEqual({ file: "Resume PDF must be 10 MB or smaller." });
  });

  test("builds a candidate-scoped storage path", () => {
    expect(buildResumeStoragePath("candidate-id", "resume-id")).toBe("candidate-id/resume-id.pdf");
  });
});
