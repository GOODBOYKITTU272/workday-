import { describe, expect, test } from "vitest";

import { canManageCandidates, validateCandidateInput } from "../src/candidates/model";

describe("candidate model", () => {
  test("validates required candidate fields and email format", () => {
    expect(validateCandidateInput({ email: "", full_name: "" })).toEqual({
      email: "Email is required.",
      full_name: "Name is required."
    });

    expect(validateCandidateInput({ email: "not-an-email", full_name: "Ada Lovelace" })).toEqual({
      email: "Enter a valid email address."
    });

    expect(validateCandidateInput({ email: "ada@example.com", full_name: "Ada Lovelace" })).toEqual({});
  });

  test("allows only admin and operator roles to manage candidates", () => {
    expect(canManageCandidates("admin")).toBe(true);
    expect(canManageCandidates("operator")).toBe(true);
    expect(canManageCandidates("viewer")).toBe(false);
    expect(canManageCandidates(null)).toBe(false);
  });
});
