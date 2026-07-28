import { describe, expect, it } from "vitest";

import { redactPageSnapshotForLogs, runWorkdayPageOpenCheck } from "../src/workday-page-snapshot";

describe("workday page snapshot foundation", () => {
  it("opens a trusted Workday job URL and returns safe metadata", async () => {
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
        page_kind: "job_page",
        page_title: "Engineer",
        tenant_key: "acme",
        tenant_name: "acme",
        timestamp: "2026-07-28T00:00:00.000Z",
        workday_base_url: "https://acme.wd5.myworkdayjobs.com"
      },
      url: "https://acme.wd5.myworkdayjobs.com/External/job/Engineer"
    });
    expect(visited).toEqual(["https://acme.wd5.myworkdayjobs.com/External/job/Engineer"]);
    expect(closed).toEqual(["page", "context", "browser"]);
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
      page_kind: "job_page",
      page_title: "Engineer",
      tenant_key: "acme",
      tenant_name: "acme",
      timestamp: "2026-07-28T00:00:00.000Z",
      workday_base_url: "https://acme.wd5.myworkdayjobs.com"
    });
  });
});
