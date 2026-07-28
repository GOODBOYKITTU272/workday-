import { describe, expect, it } from "vitest";

import {
  attemptTrustedWorkdayLogin,
  captureSafePageSnapshot,
  buildPostApplyDecisionRoute,
  buildPostLoginDecisionRoute,
  classifyWorkdayLandingPage,
  classifyPostApplyLandingState,
  discoverWorkdayLandingActions,
  inspectTrustedWorkdayLoginPage,
  runWorkdayApplyClickDryRun,
  redactPageSnapshotForLogs,
  runWorkdayPageOpenCheck
} from "../src/workday-page-snapshot";
import { encryptWorkdayPassword } from "../src/workday-password";

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
              isVisible: async () => visibleLabels.some((label) => (typeof options.name === "string" ? label === options.name : options.name.test(label)))
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
        isVisible: async () => visibleLabels.some((label) => (typeof options.name === "string" ? label === options.name : options.name.test(label)))
      })
    };

    await expect(
      discoverWorkdayLandingActions(
        page as never,
        {
          confidence: "high",
          final_url: url,
          hostname: "acme.wd5.myworkdayjobs.com",
          load_status: "loaded",
          page_kind_confidence: "high",
          page_kind:
            expected.action_type === "sign_in_available"
              ? "sign_in_page"
              : expected.action_type === "create_account_available"
                ? "create_account_page"
                : expected.action_type === "already_signed_in"
                  ? "already_signed_in_page"
                  : expected.action_type === "job_unavailable"
                    ? "unavailable_page"
                    : expected.action_type === "apply_available"
                      ? "job_page"
                      : "job_page",
          page_title: title,
          tenant_key: "acme",
          tenant_name: "acme",
          timestamp: "2026-07-28T00:00:00.000Z",
          workday_base_url: "https://acme.wd5.myworkdayjobs.com"
        },
        "2026-07-28T00:00:00.000Z"
      )
    ).resolves.toEqual({
      ...expected,
      timestamp: "2026-07-28T00:00:00.000Z"
    });
    expect(JSON.stringify(expected)).not.toContain("Apply now");
  });

  it("clicks one safe Apply action and stops on the next page", async () => {
    const actions: string[] = [];
    const launcher = {
      launch: async () => ({
        close: async () => undefined,
        newContext: async () => ({
          close: async () => undefined,
          newPage: async () => ({
            close: async () => undefined,
            goto: async () => undefined,
            getByRole: (role: "button" | "link", options: { name: RegExp | string }) => {
              const labels = role === "button" ? ["Apply now"] : [];

              return {
                click: async () => {
                  actions.push(`${role}:click:${typeof options.name === "string" ? options.name : options.name.toString()}`);
                },
                count: async () => labels.length,
                isEnabled: async () => true,
                isVisible: async () => labels.some((label) => (typeof options.name === "string" ? label === options.name : options.name.test(label)))
              };
            },
            title: async () => "Engineer",
            url: () => "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
            waitForLoadState: async () => undefined
          })
        })
      })
    };

    await expect(
      runWorkdayApplyClickDryRun("https://acme.wd5.myworkdayjobs.com/External/job/Engineer", {
        launcher,
        expectedTenantKey: "acme",
        now: () => "2026-07-28T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      apply_click: {
        action_type: "apply_available",
        click_result: "clicked",
        reason: "clicked"
      },
      ok: true
    });

    expect(actions).toEqual(["button:click:/^\\s*apply(?: now| for this job)?\\s*$/i"]);
  });

  it("classifies a post-Apply sign-in page as login_required", () => {
    expect(
      classifyPostApplyLandingState(
        {
          confidence: "high",
          final_url: "https://acme.wd5.myworkdayjobs.com/sign-in",
          hostname: "acme.wd5.myworkdayjobs.com",
          load_status: "loaded",
          page_kind_confidence: "high",
          page_kind: "sign_in_page",
          page_title: "Workday Sign In",
          tenant_key: "acme",
          tenant_name: "acme",
          timestamp: "2026-07-28T00:00:00.000Z",
          workday_base_url: "https://acme.wd5.myworkdayjobs.com"
        },
        {
          action_type: "sign_in_available",
          confidence: "high",
          safe_label_category: "sign_in",
          selector_category: "button",
          source: "selector_signal",
          timestamp: "2026-07-28T00:00:00.000Z"
        }
      )
    ).toEqual({
      confidence: "high",
      post_apply_reason: "login_signal",
      post_apply_state: "login_required"
    });
  });

  it("classifies a post-Apply create-account page as create_account_required", () => {
    expect(
      classifyPostApplyLandingState(
        {
          confidence: "high",
          final_url: "https://acme.wd5.myworkdayjobs.com/create-account",
          hostname: "acme.wd5.myworkdayjobs.com",
          load_status: "loaded",
          page_kind_confidence: "high",
          page_kind: "create_account_page",
          page_title: "Create Account",
          tenant_key: "acme",
          tenant_name: "acme",
          timestamp: "2026-07-28T00:00:00.000Z",
          workday_base_url: "https://acme.wd5.myworkdayjobs.com"
        },
        {
          action_type: "create_account_available",
          confidence: "high",
          safe_label_category: "create_account",
          selector_category: "button",
          source: "selector_signal",
          timestamp: "2026-07-28T00:00:00.000Z"
        }
      )
    ).toEqual({
      confidence: "high",
      post_apply_reason: "create_account_signal",
      post_apply_state: "create_account_required"
    });
  });

  it("classifies a post-Apply already-applied page as already_applied", () => {
    expect(
      classifyPostApplyLandingState(
        {
          confidence: "high",
          final_url: "https://acme.wd5.myworkdayjobs.com/apply/status",
          hostname: "acme.wd5.myworkdayjobs.com",
          load_status: "loaded",
          page_kind_confidence: "high",
          page_kind: "already_signed_in_page",
          page_title: "Already Applied",
          tenant_key: "acme",
          tenant_name: "acme",
          timestamp: "2026-07-28T00:00:00.000Z",
          workday_base_url: "https://acme.wd5.myworkdayjobs.com"
        },
        {
          action_type: "already_applied",
          confidence: "high",
          safe_label_category: "already_applied",
          selector_category: "button",
          source: "selector_signal",
          timestamp: "2026-07-28T00:00:00.000Z"
        }
      )
    ).toEqual({
      confidence: "high",
      post_apply_reason: "already_applied_signal",
      post_apply_state: "already_applied"
    });
  });

  it("classifies a high-confidence post-Apply application page as application_started", () => {
    expect(
      classifyPostApplyLandingState(
        {
          confidence: "high",
          final_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer/application",
          hostname: "acme.wd5.myworkdayjobs.com",
          load_status: "loaded",
          page_kind_confidence: "high",
          page_kind: "job_page",
          page_title: "Application Details",
          tenant_key: "acme",
          tenant_name: "acme",
          timestamp: "2026-07-28T00:00:00.000Z",
          workday_base_url: "https://acme.wd5.myworkdayjobs.com"
        },
        {
          action_type: "no_action_found",
          confidence: "medium",
          safe_label_category: "none",
          selector_category: "none",
          source: "url",
          timestamp: "2026-07-28T00:00:00.000Z"
        }
      )
    ).toEqual({
      confidence: "high",
      post_apply_reason: "application_started_signal",
      post_apply_state: "application_started"
    });
  });

  it("classifies a post-Apply job-unavailable page as job_unavailable", () => {
    expect(
      classifyPostApplyLandingState(
        {
          confidence: "high",
          final_url: "https://acme.wd5.myworkdayjobs.com/unavailable",
          hostname: "acme.wd5.myworkdayjobs.com",
          load_status: "loaded",
          page_kind_confidence: "high",
          page_kind: "unavailable_page",
          page_title: "Job Unavailable",
          tenant_key: "acme",
          tenant_name: "acme",
          timestamp: "2026-07-28T00:00:00.000Z",
          workday_base_url: "https://acme.wd5.myworkdayjobs.com"
        },
        {
          action_type: "job_unavailable",
          confidence: "high",
          safe_label_category: "job_unavailable",
          selector_category: "button",
          source: "selector_signal",
          timestamp: "2026-07-28T00:00:00.000Z"
        }
      )
    ).toEqual({
      confidence: "high",
      post_apply_reason: "job_unavailable_signal",
      post_apply_state: "job_unavailable"
    });
  });

  it("classifies a post-Apply untrusted redirect safely", () => {
    expect(
      classifyPostApplyLandingState(
        {
          confidence: "high",
          final_url: "https://evil.com/phishing",
          hostname: "evil.com",
          load_status: "loaded",
          page_kind_confidence: "high",
          page_kind: "unknown",
          page_title: "Redirected",
          tenant_key: null,
          tenant_name: null,
          timestamp: "2026-07-28T00:00:00.000Z",
          workday_base_url: null
        },
        {
          action_type: "unknown",
          confidence: "low",
          safe_label_category: "none",
          selector_category: "none",
          source: "url",
          timestamp: "2026-07-28T00:00:00.000Z"
        },
        {
          action_type: "apply_available",
          after_hostname: "evil.com",
          after_page_kind: "untrusted_redirect",
          after_page_kind_confidence: "low",
          after_tenant_key: null,
          after_tenant_name: null,
          after_url: "https://evil.com/phishing",
          after_workday_base_url: null,
          before_page_kind: "job_page",
          before_url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
          click_result: "blocked",
          error_code: "UNTRUSTED_REDIRECT_AFTER_APPLY",
          reason: "untrusted_redirect_after_apply",
          timestamp: "2026-07-28T00:00:00.000Z"
        }
      )
    ).toEqual({
      confidence: "high",
      post_apply_reason: "untrusted_redirect_after_apply",
      post_apply_state: "untrusted_redirect"
    });
  });

  it("routes an unknown post-Apply page to manual review", () => {
    expect(
      buildPostApplyDecisionRoute({
        confidence: "low",
        post_apply_reason: "no_signal",
        post_apply_state: "unknown"
      })
    ).toEqual(
      expect.objectContaining({
        execution_allowed: false,
        post_apply_state: "unknown",
        recommended_next_route: "unknown_manual_review",
        requires_human_review: true,
        route_reason: "low_or_unknown_confidence"
      })
    );
  });

  it.each([
    [
      "login_required",
      {
        confidence: "high" as const,
        post_apply_reason: "login_signal" as const,
        post_apply_state: "login_required" as const
      },
      "route_to_login_flow"
    ],
    [
      "create_account_required",
      {
        confidence: "medium" as const,
        post_apply_reason: "create_account_signal" as const,
        post_apply_state: "create_account_required" as const
      },
      "route_to_create_account_flow"
    ],
    [
      "application_started",
      {
        confidence: "high" as const,
        post_apply_reason: "application_started_signal" as const,
        post_apply_state: "application_started" as const
      },
      "route_to_questionnaire_discovery"
    ],
    [
      "job_unavailable",
      {
        confidence: "high" as const,
        post_apply_reason: "job_unavailable_signal" as const,
        post_apply_state: "job_unavailable" as const
      },
      "stop_job_unavailable"
    ],
    [
      "tenant_mismatch",
      {
        confidence: "high" as const,
        post_apply_reason: "tenant_mismatch_after_apply" as const,
        post_apply_state: "tenant_mismatch" as const
      },
      "stop_tenant_mismatch"
    ],
    [
      "untrusted_redirect",
      {
        confidence: "high" as const,
        post_apply_reason: "untrusted_redirect_after_apply" as const,
        post_apply_state: "untrusted_redirect" as const
      },
      "stop_untrusted_redirect"
    ],
    [
      "already_applied",
      {
        confidence: "high" as const,
        post_apply_reason: "already_applied_signal" as const,
        post_apply_state: "already_applied" as const
      },
      "stop_already_applied"
    ]
  ])("routes %s deterministically", (_label, classification, recommendedRoute) => {
    expect(buildPostApplyDecisionRoute(classification)).toEqual(
      expect.objectContaining({
        execution_allowed: false,
        recommended_next_route: recommendedRoute,
        requires_human_review: true
      })
    );
  });

  it("blocks Apply clicks when the expected tenant does not match the detected tenant", async () => {
    const actions: string[] = [];
    const launcher = {
      launch: async () => ({
        close: async () => undefined,
        newContext: async () => ({
          close: async () => undefined,
          newPage: async () => ({
            close: async () => undefined,
            goto: async () => undefined,
            getByRole: (role: "button" | "link", options: { name: RegExp | string }) => {
              const labels = role === "button" ? ["Apply now"] : [];

              return {
                click: async () => {
                  actions.push(`${role}:click:${typeof options.name === "string" ? options.name : options.name.toString()}`);
                },
                count: async () => labels.length,
                isEnabled: async () => true,
                isVisible: async () => labels.some((label) => (typeof options.name === "string" ? label === options.name : options.name.test(label)))
              };
            },
            title: async () => "Engineer",
            url: () => "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
            waitForLoadState: async () => undefined
          })
        })
      })
    };

    await expect(
      runWorkdayApplyClickDryRun("https://acme.wd5.myworkdayjobs.com/External/job/Engineer", {
        expectedTenantKey: "beta",
        launcher,
        now: () => "2026-07-28T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      apply_click: {
        action_type: "apply_available",
        click_result: "blocked",
        error_code: "TENANT_MISMATCH",
        reason: "tenant_mismatch_before_apply"
      },
      ok: true
    });

    expect(actions).toEqual([]);
  });

  it("blocks Apply clicks when the expected tenant is missing", async () => {
    const actions: string[] = [];
    const launcher = {
      launch: async () => ({
        close: async () => undefined,
        newContext: async () => ({
          close: async () => undefined,
          newPage: async () => ({
            close: async () => undefined,
            goto: async () => undefined,
            getByRole: (role: "button" | "link", options: { name: RegExp | string }) => {
              const labels = role === "button" ? ["Apply now"] : [];

              return {
                click: async () => {
                  actions.push(`${role}:click:${typeof options.name === "string" ? options.name : options.name.toString()}`);
                },
                count: async () => labels.length,
                isEnabled: async () => true,
                isVisible: async () => labels.some((label) => (typeof options.name === "string" ? label === options.name : options.name.test(label)))
              };
            },
            title: async () => "Engineer",
            url: () => "https://acme.wd5.myworkdayjobs.com/External/job/Engineer",
            waitForLoadState: async () => undefined
          })
        })
      })
    };

    await expect(
      runWorkdayApplyClickDryRun("https://acme.wd5.myworkdayjobs.com/External/job/Engineer", {
        launcher,
        now: () => "2026-07-28T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      apply_click: {
        action_type: "apply_available",
        click_result: "blocked",
        error_code: "EXPECTED_TENANT_MISSING",
        reason: "expected_tenant_missing"
      },
      ok: true
    });

    expect(actions).toEqual([]);
  });

  it("blocks Apply clicks when the detected tenant is missing", async () => {
    const actions: string[] = [];
    const launcher = {
      launch: async () => ({
        close: async () => undefined,
        newContext: async () => ({
          close: async () => undefined,
          newPage: async () => ({
            close: async () => undefined,
            goto: async () => undefined,
            getByRole: (role: "button" | "link", options: { name: RegExp | string }) => {
              const labels = role === "button" ? ["Apply now"] : [];

              return {
                click: async () => {
                  actions.push(`${role}:click:${typeof options.name === "string" ? options.name : options.name.toString()}`);
                },
                count: async () => labels.length,
                isEnabled: async () => true,
                isVisible: async () => labels.some((label) => (typeof options.name === "string" ? label === options.name : options.name.test(label)))
              };
            },
            title: async () => "Engineer",
            url: () => "https://wd5.myworkday.com/",
            waitForLoadState: async () => undefined
          })
        })
      })
    };

    await expect(
      runWorkdayApplyClickDryRun("https://wd5.myworkday.com/", {
        expectedTenantKey: "acme",
        launcher,
        now: () => "2026-07-28T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      apply_click: {
        action_type: "apply_available",
        click_result: "blocked",
        error_code: "FINAL_TENANT_MISSING",
        reason: "final_tenant_missing"
      },
      ok: true
    });

    expect(actions).toEqual([]);
  });
});

describe("buildPostLoginDecisionRoute", () => {
  it.each([
    ["login_success_possible", "route_to_questionnaire_discovery_later"],
    ["otp_required", "route_to_otp_manual_review"],
    ["verification_required", "route_to_verification_manual_review"],
    ["invalid_credentials_possible", "stop_invalid_credentials_manual_review"],
    ["account_locked_possible", "stop_account_locked_manual_review"],
    ["still_on_login_page", "still_on_login_manual_review"],
    ["unknown", "unknown_post_login_manual_review"]
  ] as const)("routes %s to %s without allowing execution", (postLoginState, postLoginRoute) => {
    expect(
      buildPostLoginDecisionRoute({
        confidence: "high",
        hostname: "acme.wd5.myworkdayjobs.com",
        ok: true,
        post_login_state: postLoginState,
        tenant_key: "acme",
        timestamp: "2026-07-28T00:00:00.000Z"
      })
    ).toEqual({
      confidence: "high",
      execution_allowed: false,
      hostname: "acme.wd5.myworkdayjobs.com",
      post_login_route: postLoginRoute,
      post_login_state: postLoginState,
      requires_human_review: true,
      tenant_key: "acme",
      timestamp: "2026-07-28T00:00:00.000Z"
    });
  });
});

describe("inspectTrustedWorkdayLoginPage", () => {
  function createLoginPageLauncher(config: { emailFieldCount?: number; finalUrl?: string; passwordFieldCount?: number; signInButtonVisible?: boolean }) {
    const visited: string[] = [];
    const closed: string[] = [];
    const finalUrl = config.finalUrl ?? "https://acme.wd5.myworkdayjobs.com/External/sign-in";
    const passwordFieldCount = config.passwordFieldCount ?? 0;
    const emailFieldCount = config.emailFieldCount ?? 0;
    const signInButtonVisible = config.signInButtonVisible ?? false;

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
            getByRole: (_role: "button" | "link", options: { name: RegExp | string }) => ({
              click: async () => undefined,
              count: async () => (signInButtonVisible ? 1 : 0),
              isEnabled: async () => true,
              isVisible: async () => signInButtonVisible && (typeof options.name === "string" ? false : options.name.test("Sign In"))
            }),
            goto: async (url: string) => {
              visited.push(url);
            },
            locator: (selector: string) => ({
              count: async () => {
                if (selector.includes("password")) {
                  return passwordFieldCount;
                }

                if (selector.includes("email") || selector.includes("username")) {
                  return emailFieldCount;
                }

                return 0;
              }
            }),
            title: async () => "Sign In",
            url: () => finalUrl
          })
        })
      })
    };

    return { closed, launcher, visited };
  }

  it("reports high confidence when password, email, and sign-in signals are all present", async () => {
    const { launcher } = createLoginPageLauncher({
      emailFieldCount: 1,
      passwordFieldCount: 1,
      signInButtonVisible: true
    });

    await expect(
      inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", "acme", {
        launcher,
        now: () => "2026-07-28T00:00:00.000Z"
      })
    ).resolves.toEqual({
      confidence: "high",
      email_field_candidate_detected: true,
      login_page_detected: true,
      ok: true,
      password_field_candidate_detected: true,
      sign_in_action_candidate_detected: true,
      timestamp: "2026-07-28T00:00:00.000Z"
    });
  });

  it("reports low confidence when only a password field is present", async () => {
    const { launcher } = createLoginPageLauncher({ passwordFieldCount: 1 });

    await expect(inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", "acme", { launcher })).resolves.toEqual(
      expect.objectContaining({
        confidence: "low",
        login_page_detected: true,
        ok: true,
        password_field_candidate_detected: true
      })
    );
  });

  it("reports unknown confidence and login_page_detected false when no password field exists", async () => {
    const { launcher } = createLoginPageLauncher({ emailFieldCount: 1, signInButtonVisible: true });

    await expect(inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", "acme", { launcher })).resolves.toEqual(
      expect.objectContaining({
        confidence: "unknown",
        login_page_detected: false,
        ok: true,
        password_field_candidate_detected: false
      })
    );
  });

  it("blocks and never navigates when the expected tenant key is missing", async () => {
    const { launcher, visited } = createLoginPageLauncher({ passwordFieldCount: 1 });

    await expect(
      inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", null, {
        launcher
      })
    ).resolves.toEqual({ blockedReason: "expected_tenant_missing", ok: false });
    expect(visited).toEqual([]);
  });

  it("blocks and never navigates when the pre-navigation tenant does not match the expected tenant", async () => {
    const { launcher, visited } = createLoginPageLauncher({ passwordFieldCount: 1 });

    await expect(inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", "beta", { launcher })).resolves.toEqual({
      blockedReason: "tenant_mismatch_before_open",
      ok: false
    });
    expect(visited).toEqual([]);
  });

  it("blocks when redirected to an untrusted final URL", async () => {
    const { closed, launcher } = createLoginPageLauncher({
      finalUrl: "https://evil.com/phishing",
      passwordFieldCount: 1
    });

    await expect(inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", "acme", { launcher })).resolves.toEqual({
      blockedReason: "untrusted_redirect",
      ok: false
    });
    expect(closed).toEqual(["page", "context", "browser"]);
  });

  it("blocks when the final tenant does not match the expected tenant after navigation", async () => {
    const { closed, launcher } = createLoginPageLauncher({
      finalUrl: "https://beta.wd5.myworkdayjobs.com/External/sign-in",
      passwordFieldCount: 1
    });

    await expect(inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", "acme", { launcher })).resolves.toEqual({
      blockedReason: "tenant_mismatch_after_open",
      ok: false
    });
    expect(closed).toEqual(["page", "context", "browser"]);
  });

  it("rejects untrusted hostnames before ever launching a browser", async () => {
    await expect(inspectTrustedWorkdayLoginPage("https://workday.evil.com/sign-in", "acme")).resolves.toEqual({
      blockedReason: "untrusted_host",
      ok: false
    });
  });

  it("always closes the page, context, and browser on success", async () => {
    const { closed, launcher } = createLoginPageLauncher({
      emailFieldCount: 1,
      passwordFieldCount: 1,
      signInButtonVisible: true
    });

    await inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", "acme", { launcher });

    expect(closed).toEqual(["page", "context", "browser"]);
  });

  it("never returns raw labels, selectors, HTML, or field values — only booleans and enums", async () => {
    const { launcher } = createLoginPageLauncher({
      emailFieldCount: 1,
      passwordFieldCount: 1,
      signInButtonVisible: true
    });

    const result = await inspectTrustedWorkdayLoginPage("https://acme.wd5.myworkdayjobs.com/External/sign-in", "acme", { launcher });

    expect(result.ok).toBe(true);
    expect(Object.keys(result).sort()).toEqual(
      [
        "confidence",
        "email_field_candidate_detected",
        "login_page_detected",
        "ok",
        "password_field_candidate_detected",
        "sign_in_action_candidate_detected",
        "timestamp"
      ].sort()
    );
  });
});

describe("attemptTrustedWorkdayLogin", () => {
  const encryptionKey = "01234567890123456789012345678901".slice(0, 32);
  const validPassword = encryptWorkdayPassword("super-secret-password", encryptionKey);
  const loginUrl = "https://acme.wd5.myworkdayjobs.com/External/sign-in";

  function createLoginAttemptLauncher(config: {
    alertVisible?: boolean;
    emailFieldCount?: number;
    passwordFieldCount?: number;
    signInButtonCount?: number;
    urlAfterClick?: string;
    titleAfterClick?: string;
  }) {
    const visited: string[] = [];
    const closed: string[] = [];
    const actions: string[] = [];
    const emailFieldCount = config.emailFieldCount ?? 1;
    const passwordFieldCount = config.passwordFieldCount ?? 1;
    const signInButtonCount = config.signInButtonCount ?? 1;
    const urlAfterClick = config.urlAfterClick ?? "https://acme.wd5.myworkdayjobs.com/External/home";
    const titleAfterClick = config.titleAfterClick ?? "Home";
    const alertVisible = config.alertVisible ?? false;
    let currentUrl = loginUrl;

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
            getByRole: (role: "alert" | "button" | "link") => ({
              click: async () => {
                actions.push(`click:${role}`);
                currentUrl = urlAfterClick;
              },
              count: async () => (role === "button" ? signInButtonCount : 0),
              isEnabled: async () => true,
              isVisible: async () => (role === "alert" ? alertVisible : signInButtonCount > 0)
            }),
            locator: (selector: string) => ({
              count: async () => {
                if (selector.includes("password")) {
                  return passwordFieldCount;
                }

                if (selector.includes("email") || selector.includes("username")) {
                  return emailFieldCount;
                }

                return 0;
              },
              fill: async (value: string) => {
                actions.push(`fill:${selector.includes("password") ? "password" : "email"}:${value}`);
              }
            }),
            title: async () => (currentUrl === urlAfterClick ? titleAfterClick : "Sign In"),
            url: () => currentUrl,
            waitForLoadState: async () => undefined
          })
        })
      })
    };

    return { actions, closed, launcher, visited };
  }

  it("fills email then password, then clicks sign in, only in that order", async () => {
    const { actions, launcher } = createLoginAttemptLauncher({});

    const result = await attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "candidate@example.com", passwordEncrypted: validPassword }, encryptionKey, {
      launcher,
      now: () => "2026-07-28T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    expect(actions).toEqual(["fill:email:candidate@example.com", "fill:password:super-secret-password", "click:button"]);
  });

  it("reports login_success_possible when the final page is away from sign-in and error patterns", async () => {
    const { launcher } = createLoginAttemptLauncher({});

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "candidate@example.com", passwordEncrypted: validPassword }, encryptionKey, {
        launcher,
        now: () => "2026-07-28T00:00:00.000Z"
      })
    ).resolves.toEqual({
      confidence: "medium",
      hostname: "acme.wd5.myworkdayjobs.com",
      ok: true,
      post_login_state: "login_success_possible",
      tenant_key: "acme",
      timestamp: "2026-07-28T00:00:00.000Z"
    });
  });

  it("detects otp_required from the post-login URL and title", async () => {
    const { launcher } = createLoginAttemptLauncher({
      titleAfterClick: "Enter verification code",
      urlAfterClick: "https://acme.wd5.myworkdayjobs.com/External/otp"
    });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual(expect.objectContaining({ confidence: "high", ok: true, post_login_state: "otp_required" }));
  });

  it("detects verification_required from the post-login URL and title", async () => {
    const { launcher } = createLoginAttemptLauncher({
      titleAfterClick: "Verify your email",
      urlAfterClick: "https://acme.wd5.myworkdayjobs.com/External/verify"
    });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual(
      expect.objectContaining({
        confidence: "high",
        ok: true,
        post_login_state: "verification_required"
      })
    );
  });

  it("detects account_locked_possible from the post-login URL and title", async () => {
    const { launcher } = createLoginAttemptLauncher({
      titleAfterClick: "Your account is locked",
      urlAfterClick: "https://acme.wd5.myworkdayjobs.com/External/sign-in"
    });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual(
      expect.objectContaining({
        confidence: "high",
        ok: true,
        post_login_state: "account_locked_possible"
      })
    );
  });

  it("detects invalid_credentials_possible when still on the sign-in page with a visible alert", async () => {
    const { launcher } = createLoginAttemptLauncher({
      alertVisible: true,
      titleAfterClick: "Sign In",
      urlAfterClick: loginUrl
    });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual(
      expect.objectContaining({
        confidence: "medium",
        ok: true,
        post_login_state: "invalid_credentials_possible"
      })
    );
  });

  it("detects still_on_login_page when still on sign-in with no alert visible", async () => {
    const { launcher } = createLoginAttemptLauncher({
      alertVisible: false,
      titleAfterClick: "Sign In",
      urlAfterClick: loginUrl
    });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual(
      expect.objectContaining({
        confidence: "low",
        ok: true,
        post_login_state: "still_on_login_page"
      })
    );
  });

  it("blocks and never navigates when the expected tenant key is missing", async () => {
    const { launcher, visited } = createLoginAttemptLauncher({});

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, null, { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual({ blockedReason: "expected_tenant_missing", ok: false });
    expect(visited).toEqual([]);
  });

  it("blocks and never navigates on tenant mismatch before login", async () => {
    const { launcher, visited } = createLoginAttemptLauncher({});

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "beta", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual({ blockedReason: "tenant_mismatch_before_login", ok: false });
    expect(visited).toEqual([]);
  });

  it("blocks and never launches a browser for an untrusted hostname", async () => {
    await expect(
      attemptTrustedWorkdayLogin("https://workday.evil.com/sign-in", "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey)
    ).resolves.toEqual({ blockedReason: "untrusted_host", ok: false });
  });

  it("blocks without navigating when the password fails to decrypt", async () => {
    const { launcher, visited } = createLoginAttemptLauncher({});

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: "not-a-valid-token" }, encryptionKey, { launcher })
    ).resolves.toEqual({ blockedReason: "password_decrypt_failed", ok: false });
    expect(visited).toEqual([]);
  });

  it("blocks when no single email field can be confirmed", async () => {
    const { launcher } = createLoginAttemptLauncher({ emailFieldCount: 0 });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual({ blockedReason: "email_field_not_found", ok: false });
  });

  it("blocks when multiple password fields are found (ambiguous)", async () => {
    const { launcher } = createLoginAttemptLauncher({ passwordFieldCount: 2 });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual({ blockedReason: "password_field_not_found", ok: false });
  });

  it("blocks when no single sign-in action can be confirmed", async () => {
    const { launcher } = createLoginAttemptLauncher({ signInButtonCount: 0 });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual({ blockedReason: "sign_in_action_not_found", ok: false });
  });

  it("blocks when redirected to an untrusted URL after sign-in", async () => {
    const { closed, launcher } = createLoginAttemptLauncher({
      urlAfterClick: "https://evil.com/phishing"
    });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual({ blockedReason: "untrusted_redirect_after_login", ok: false });
    expect(closed).toEqual(["page", "context", "browser"]);
  });

  it("blocks when the tenant changes after sign-in", async () => {
    const { closed, launcher } = createLoginAttemptLauncher({
      urlAfterClick: "https://beta.wd5.myworkdayjobs.com/External/home"
    });

    await expect(
      attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher })
    ).resolves.toEqual({ blockedReason: "tenant_mismatch_after_login", ok: false });
    expect(closed).toEqual(["page", "context", "browser"]);
  });

  it("always closes the page, context, and browser on success", async () => {
    const { closed, launcher } = createLoginAttemptLauncher({});

    await attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "a@b.com", passwordEncrypted: validPassword }, encryptionKey, { launcher });

    expect(closed).toEqual(["page", "context", "browser"]);
  });

  it("never returns the plaintext or encrypted password, the email, or any raw page content", async () => {
    const { launcher } = createLoginAttemptLauncher({});

    const result = await attemptTrustedWorkdayLogin(loginUrl, "acme", { email: "candidate@example.com", passwordEncrypted: validPassword }, encryptionKey, {
      launcher,
      now: () => "2026-07-28T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["confidence", "hostname", "ok", "post_login_state", "tenant_key", "timestamp"].sort());
    expect(JSON.stringify(result)).not.toMatch(/super-secret-password|candidate@example\.com|input\[type/i);
  });
});
