import { describe, expect, it } from "vitest";

import { detectWorkdayTenantFromUrl, isTrustedWorkdayHost } from "../src/index";

describe("Workday tenant URL detection", () => {
  it("detects tenant metadata from common Workday job host patterns", () => {
    expect(detectWorkdayTenantFromUrl("https://acme.wd5.myworkdayjobs.com/External/job/Engineer?source=linkedin#apply")).toMatchObject({
      confidence: "high",
      is_workday_url: true,
      normalized_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
      tenant_key: "acme",
      tenant_name: "acme",
      workday_base_url: "https://acme.wd5.myworkdayjobs.com"
    });

    expect(detectWorkdayTenantFromUrl("https://contoso.myworkdayjobs.com/jobs/job/Product-Manager")).toMatchObject({
      confidence: "high",
      is_workday_url: true,
      tenant_key: "contoso",
      workday_base_url: "https://contoso.myworkdayjobs.com"
    });

    expect(detectWorkdayTenantFromUrl("https://wd3.myworkday.com/acme/d/task/123")).toMatchObject({
      confidence: "high",
      is_workday_url: true,
      tenant_key: "acme",
      workday_base_url: "https://wd3.myworkday.com/acme"
    });
  });

  it("recognizes trusted Workday hostnames without substring matching", () => {
    expect(isTrustedWorkdayHost(new URL("https://workday.com/jobs"))).toBe(true);
    expect(isTrustedWorkdayHost(new URL("https://wd1.myworkdayjobs.com/jobs"))).toBe(true);
    expect(isTrustedWorkdayHost(new URL("https://workday.evil.com/verify"))).toBe(false);
    expect(isTrustedWorkdayHost(new URL("https://evil-workday.com/confirm"))).toBe(false);
  });

  it("rejects phishing-style Workday URLs", () => {
    for (const rawUrl of [
      "https://workday.evil.com/jobs/123",
      "https://evil-workday.com/jobs/123",
      "https://phishing-site.com/workday/job/123"
    ]) {
      expect(detectWorkdayTenantFromUrl(rawUrl)).toEqual({
        confidence: "none",
        error: "Untrusted Workday hostname.",
        is_workday_url: false,
        normalized_url: null,
        reason: "untrusted_host",
        tenant_key: null,
        tenant_name: null,
        workday_base_url: null
      });
    }
  });

  it("strips tracking query and hash from Workday URLs", () => {
    expect(detectWorkdayTenantFromUrl("https://acme.wd1.myworkdayjobs.com/jobs/job/Engineer?utm_source=x&src=y#apply").normalized_url).toBe(
      "https://acme.wd1.myworkdayjobs.com/jobs/job/Engineer"
    );
  });

  it("returns invalid_url for malformed input", () => {
    expect(detectWorkdayTenantFromUrl("not a url")).toEqual({
      confidence: "none",
      error: "Enter a valid URL.",
      is_workday_url: false,
      normalized_url: null,
      reason: "invalid_url",
      tenant_key: null,
      tenant_name: null,
      workday_base_url: null
    });
  });
});
