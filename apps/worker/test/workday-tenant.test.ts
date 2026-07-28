import { describe, expect, it } from "vitest";

import { buildWorkerWorkdayAccountReadiness, detectWorkerWorkdayTenant } from "../src/workday-tenant";

describe("worker Workday tenant readiness foundation", () => {
  it("detects trusted Workday tenants without opening URLs", () => {
    expect(detectWorkerWorkdayTenant("https://acme.wd5.myworkdayjobs.com/jobs/job/Engineer?utm_source=x")).toMatchObject({
      confidence: "high",
      is_workday_url: true,
      normalized_url: "https://acme.wd5.myworkdayjobs.com/jobs/job/Engineer",
      tenant_key: "acme"
    });
  });

  it("rejects phishing-style Workday hostnames", () => {
    expect(detectWorkerWorkdayTenant("https://workday.evil.com/jobs/123")).toMatchObject({
      confidence: "none",
      is_workday_url: false,
      reason: "untrusted_host"
    });
  });

  it("marks whether an account exists or will need creation later", () => {
    expect(
      buildWorkerWorkdayAccountReadiness({
        account: null,
        candidateEmail: "candidate@example.com",
        jobLink: {
          url: "https://acme.wd5.myworkdayjobs.com/jobs/job/Engineer",
          workday_tenant_key: null
        }
      })
    ).toEqual({
      accountExists: false,
      accountStatus: null,
      candidateEmailExists: true,
      needsAccountCreation: true,
      tenantDetected: true,
      tenantKey: "acme",
      workdayBaseUrl: "https://acme.wd5.myworkdayjobs.com"
    });
  });
});
