import { describe, expect, it } from "vitest";

import {
  canManageWorkdayAccounts,
  isWorkdayAccountEmailMismatch,
  toWorkdayAccountPayload,
  validateWorkdayAccountInput
} from "../src/workday/model";

describe("Workday account model", () => {
  it("allows admin and operator management only", () => {
    expect(canManageWorkdayAccounts("admin")).toBe(true);
    expect(canManageWorkdayAccounts("operator")).toBe(true);
    expect(canManageWorkdayAccounts("viewer")).toBe(false);
  });

  it("validates required candidate, tenant, email, and optional base URL", () => {
    expect(
      validateWorkdayAccountInput({
        candidateId: "",
        email: "not-an-email",
        tenant_key: "",
        workday_base_url: "not a url"
      })
    ).toEqual({
      candidateId: "Candidate is required.",
      email: "Enter a valid email address.",
      tenant_key: "Tenant key is required.",
      workday_base_url: "Enter a valid URL."
    });
  });

  it("builds a safe metadata payload without password fields", () => {
    const payload = toWorkdayAccountPayload({
      account_status: "existing",
      candidateId: "candidate-id",
      email: "Candidate@Example.com",
      last_error: "",
      tenant_key: "Acme",
      tenant_name: "Acme Corp",
      username: "candidate",
      workday_base_url: "https://wd5.myworkday.com/acme"
    });

    expect(payload).toEqual({
      account_status: "existing",
      candidate_id: "candidate-id",
      email: "candidate@example.com",
      last_error: null,
      tenant_key: "Acme",
      tenant_name: "Acme Corp",
      username: "candidate",
      workday_base_url: "https://wd5.myworkday.com/acme"
    });
    expect(Object.keys(payload)).not.toContain("password_encrypted");
  });

  it("detects candidate email mismatch", () => {
    expect(isWorkdayAccountEmailMismatch("candidate@example.com", "candidate@example.com")).toBe(false);
    expect(isWorkdayAccountEmailMismatch("candidate@example.com", "other@example.com")).toBe(true);
  });
});
