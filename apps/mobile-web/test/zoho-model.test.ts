import { describe, expect, test } from "vitest";

import { canManageZohoMailbox, isMailboxEmailMismatch, validateZohoMailboxInput } from "../src/zoho/model";

describe("Zoho mailbox model", () => {
  test("validates candidate and mailbox email", () => {
    expect(validateZohoMailboxInput({ candidateId: "", email: "" })).toEqual({
      candidateId: "Candidate is required.",
      email: "Email is required."
    });

    expect(validateZohoMailboxInput({ candidateId: "candidate-id", email: "not-an-email" })).toEqual({
      email: "Enter a valid email address."
    });

    expect(validateZohoMailboxInput({ candidateId: "candidate-id", email: "zoho@example.com" })).toEqual({});
  });

  test("allows only admin and operator roles to manage mailbox metadata", () => {
    expect(canManageZohoMailbox("admin")).toBe(true);
    expect(canManageZohoMailbox("operator")).toBe(true);
    expect(canManageZohoMailbox("viewer")).toBe(false);
    expect(canManageZohoMailbox(null)).toBe(false);
  });

  test("detects mailbox email mismatches case-insensitively", () => {
    expect(isMailboxEmailMismatch("Candidate@Example.com", "candidate@example.com")).toBe(false);
    expect(isMailboxEmailMismatch("candidate@example.com", "other@example.com")).toBe(true);
    expect(isMailboxEmailMismatch("candidate@example.com", "")).toBe(false);
  });
});
