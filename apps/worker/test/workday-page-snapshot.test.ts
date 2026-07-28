import { describe, expect, it } from "vitest";

import {
  captureSafePageSnapshot,
  classifyWorkdayLandingPage,
  discoverWorkdayLandingActions,
  redactPageSnapshotForLogs,
  runWorkdayPageOpenCheck
} from "../src/workday-page-snapshot";

describe("workday page snapshot foundation", () => {
  it("opens a trusted Workday job URL and returns safe metadata", async () => {
    const visited: string[] = [];
    const closed: string[] = [];
    const visibleLabels = ["Apply now"];
    const launcher = {
      launch: async () => ({
        close: async () => {
          closed.push("browser");
        },
        newContext: async () => ({
          close: async () => {
            closed.push("context");
          },
          newPage: async () => ({
            close: async () => {
              closed.push("page");
            },
            goto: async (url: string) => {
              visited.push(url);
            },
            getByRole: (_role: "button" | "link", options: { name: RegExp | string }) => ({
              isVisible: async () =>
                visibleLabels.some((label) => (typeof options.name === "string" ? label === options.name : options.name.test(label)))
            }),
            title: async () => "Engineer",
            url: () => "https://acme.wd5.myworkdayjobs.com/External/job/Engineer"
          })
        })
      })
    };

    await expect(
      runWorkdayPageOpenCheck("https://acme.wd5.myworkdayjobs.com/External/job/Engineer?source=linkedin#apply", {
        launcher,
        now: () => "2026-07-28T00:00:00.000Z"
      })
    ).resolves.toEqual({
      ok: true,
      snapshot: {
        confidence: "high",
        final_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
        hostname: "acme.wd5.myworkdayjobs.com",
        load_status: "loaded",
        page_kind_confidence: "high",
        page_kind: "job_page",
        page_title: "Engineer",
        tenant_key: "acme",
        tenant_name: "acme",
        timestamp: "2026-07-28T00:00:00.000Z",
        workday_base_url: "https://acme.wd5.myworkdayjobs.com"
      },
      discovery: {
        action_type: "apply_available",
        confidence: "high",
        safe_label_category: "apply",
        selector_category: "button",
        source: "selector_signal",
        timestamp: "2026-07-28T00:00:00.000Z"
      },
      url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer"
    });
    expect(visited).toEqual(["https://acme.wd5.myworkdayjobs.com/External/job/Engineer"]);
    expect(closed).toEqual(["page", "context", "browser"]);
  });

  it("rejects redirects to untrusted final URLs after navigation", async () => {
    const visited: string[] = [];
    const closed: string[] = [];
    const launcher = {
      launch: async () => ({
        close: async () => {
          closed.push("browser");
        },
        newContext: async () => ({
          close: async () => {
            closed.push("context");
          },
          newPage: async () => ({
            close: async () => {
              closed.push("page");
            },
            goto: async (url: string) => {
              visited.push(url);
            },
            title: async () => "Redirected",
            url: () => "https://evil.com/phishing"
          })
        })
      })
    };

    await expect(
      runWorkdayPageOpenCheck("https://acme.wd5.myworkdayjobs.com/External/job/Engineer", {
        launcher,
        now: () => "2026-07-28T00:00:00.000Z"
      })
    ).resolves.toEqual({
      error: "Redirected to an untrusted URL.",
      error_code: "UNTRUSTED_REDIRECT",
      final_url: "https://evil.com/phishing",
      hostname: "evil.com",
      load_status: "blocked",
      ok: false,
      page_kind: "untrusted_redirect",
      url: "https://evil.com/phishing"
    });
    expect(visited).toEqual(["https://acme.wd5.myworkdayjobs.com/External/job/Engineer"]);
    expect(closed).toEqual(["page", "context", "browser"]);
  });

  it("rejects redirects to trusted-looking but untrusted Workday hostnames", async () => {
    const launcher = {
      launch: async () => ({
        close: async () => undefined,
        newContext: async () => ({
          close: async () => undefined,
          newPage: async () => ({
            close: async () => undefined,
            goto: async () => undefined,
            title: async () => "Redirected",
            url: () => "https://workday.evil.com/phishing"
          })
        })
      })
    };

    await expect(
      runWorkdayPageOpenCheck("https://acme.wd5.myworkdayjobs.com/External/job/Engineer", {
        launcher
      })
    ).resolves.toEqual({
      error: "Redirected to an untrusted URL.",
      error_code: "UNTRUSTED_REDIRECT",
      final_url: "https://workday.evil.com/phishing",
      hostname: "workday.evil.com",
      load_status: "blocked",
      ok: false,
      page_kind: "untrusted_redirect",
      url: "https://workday.evil.com/phishing"
    });
  });

  it("rejects redirects to non-https final URLs", async () => {
    const launcher = {
      launch: async () => ({
        close: async () => undefined,
        newContext: async () => ({
          close: async () => undefined,
          newPage: async () => ({
            close: async () => undefined,
            goto: async () => undefined,
            title: async () => "Redirected",
            url: () => "http://wd5.myworkdayjobs.com/path"
          })
        })
      })
    };

    await expect(
      runWorkdayPageOpenCheck("https://acme.wd5.myworkdayjobs.com/External/job/Engineer", {
        launcher
      })
    ).resolves.toEqual({
      error: "Redirected to a non-HTTPS URL.",
      error_code: "UNTRUSTED_REDIRECT",
      final_url: "http://wd5.myworkdayjobs.com/path",
      hostname: "wd5.myworkdayjobs.com",
      load_status: "blocked",
      ok: false,
      page_kind: "untrusted_redirect",
      url: "http://wd5.myworkdayjobs.com/path"
    });
  });

  it("rejects untrusted final URLs inside the snapshot helper itself", async () => {
    const page = {
      close: async () => undefined,
      title: async () => "Redirected",
      url: () => "https://evil.com/phishing"
    };

    await expect(
      captureSafePageSnapshot(
        page,
        {
          confidence: "high",
          error: undefined,
          is_workday_url: true,
          normalized_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
          reason: "detected",
          tenant_key: "acme",
          tenant_name: "acme",
          workday_base_url: "https://acme.wd5.myworkdayjobs.com"
        },
        "2026-07-28T00:00:00.000Z"
      )
    ).resolves.toEqual({
      error: "Redirected to an untrusted URL.",
      error_code: "UNTRUSTED_REDIRECT",
      final_url: "https://evil.com/phishing",
      hostname: "evil.com",
      load_status: "blocked",
      ok: false,
      page_kind: "untrusted_redirect",
      url: "https://evil.com/phishing"
    });
  });

  it("rejects non-https Workday URLs before launching a browser", async () => {
    const launcher = {
      launch: async () => {
        throw new Error("browser should not launch");
      }
    };

    await expect(runWorkdayPageOpenCheck("http://acme.wd5.myworkdayjobs.com/jobs/job/Engineer", { launcher })).resolves.toEqual({
      error: "HTTPS Workday URLs only.",
      error_code: "unsupported_protocol",
      ok: false,
      url: "http://acme.wd5.myworkdayjobs.com/jobs/job/Engineer"
    });
  });

  it("redacts raw html and browser state from log snapshots", () => {
    expect(
      redactPageSnapshotForLogs({
        confidence: "high",
        cookies: [{ name: "sid", value: "secret" }],
        final_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
        hostname: "acme.wd5.myworkdayjobs.com",
        load_status: "loaded",
        page_kind_confidence: "high",
        localStorage: { token: "secret" },
        page_kind: "job_page",
        page_title: "Engineer",
        raw_html: "<html>secret</html>",
        screenshot_path: "/tmp/screenshot.png",
        sessionStorage: { token: "secret" },
        tenant_key: "acme",
        tenant_name: "acme",
        timestamp: "2026-07-28T00:00:00.000Z",
        workday_base_url: "https://acme.wd5.myworkdayjobs.com"
      })
    ).toEqual({
      confidence: "high",
      final_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
      hostname: "acme.wd5.myworkdayjobs.com",
      load_status: "loaded",
      page_kind_confidence: "high",
      page_kind: "job_page",
      page_title: "Engineer",
      tenant_key: "acme",
      tenant_name: "acme",
      timestamp: "2026-07-28T00:00:00.000Z",
      workday_base_url: "https://acme.wd5.myworkdayjobs.com"
    });
  });

  it.each([
    ["sign_in_page", "https://acme.wd5.myworkdayjobs.com/login", "Workday Sign In", "high"],
    ["create_account_page", "https://acme.wd5.myworkdayjobs.com/create-account", "Create Account", "high"],
    ["already_signed_in_page", "https://acme.wd5.myworkdayjobs.com/home", "Workday Home", "medium"],
    ["error_page", "https://acme.wd5.myworkdayjobs.com/error", "Error", "high"],
    ["unavailable_page", "https://acme.wd5.myworkdayjobs.com/unavailable", "Job Unavailable", "high"],
    ["unknown", "https://acme.wd5.myworkdayjobs.com/landing", "Welcome", "low"]
  ])("classifies %s safely", (expectedKind, url, title, expectedConfidence) => {
    expect(classifyWorkdayLandingPage(url, title)).toEqual({
      confidence: expectedConfidence,
      page_kind: expectedKind
    });
  });

  it.each([
    [
      "apply_available",
      "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
      "Engineer",
      ["Apply now"],
      {
        action_type: "apply_available",
        confidence: "high",
        safe_label_category: "apply",
        selector_category: "button",
        source: "selector_signal"
      }
    ],
    [
      "sign_in_available",
      "https://acme.wd5.myworkdayjobs.com/login",
      "Workday Sign In",
      ["Sign In"],
      {
        action_type: "sign_in_available",
        confidence: "high",
        safe_label_category: "sign_in",
        selector_category: "button",
        source: "selector_signal"
      }
    ],
    [
      "create_account_available",
      "https://acme.wd5.myworkdayjobs.com/create-account",
      "Create Account",
      ["Create Account"],
      {
        action_type: "create_account_available",
        confidence: "high",
        safe_label_category: "create_account",
        selector_category: "button",
        source: "selector_signal"
      }
    ],
    [
      "job_unavailable",
      "https://acme.wd5.myworkdayjobs.com/unavailable",
      "Job Unavailable",
      ["Job Unavailable"],
      {
        action_type: "job_unavailable",
        confidence: "high",
        safe_label_category: "job_unavailable",
        selector_category: "button",
        source: "selector_signal"
      }
    ],
    [
      "already_signed_in",
      "https://acme.wd5.myworkdayjobs.com/home",
      "Workday Home",
      ["My Applications"],
      {
        action_type: "already_signed_in",
        confidence: "high",
        safe_label_category: "already_signed_in",
        selector_category: "button",
        source: "selector_signal"
      }
    ],
    [
      "no_action_found",
      "https://acme.wd5.myworkdayjobs.com/landing",
      "Welcome",
      [],
      {
        action_type: "no_action_found",
        confidence: "medium",
        safe_label_category: "none",
        selector_category: "none",
        source: "url"
      }
    ]
  ])("discovers %s safely", async (_label, url, title, visibleLabels, expected) => {
    const page = {
      getByRole: (_role: "button" | "link", options: { name: RegExp | string }) => ({
        isVisible: async () =>
          visibleLabels.some((label) => (typeof options.name === "string" ? label === options.name : options.name.test(label)))
      })
    };

    await expect(
      discoverWorkdayLandingActions(page as never, {
        confidence: "high",
        final_url: url,
        hostname: "acme.wd5.myworkdayjobs.com",
        load_status: "loaded",
        page_kind_confidence: "high",
        page_kind: expected.action_type === "sign_in_available" ? "sign_in_page" : expected.action_type === "create_account_available" ? "create_account_page" : expected.action_type === "already_signed_in" ? "already_signed_in_page" : expected.action_type === "job_unavailable" ? "unavailable_page" : expected.action_type === "apply_available" ? "job_page" : "job_page",
        page_title: title,
        tenant_key: "acme",
        tenant_name: "acme",
        timestamp: "2026-07-28T00:00:00.000Z",
        workday_base_url: "https://acme.wd5.myworkdayjobs.com"
      }, "2026-07-28T00:00:00.000Z")
    ).resolves.toEqual({
      ...expected,
      timestamp: "2026-07-28T00:00:00.000Z"
    });
    expect(JSON.stringify(expected)).not.toContain("Apply now");
  });
});
