import { describe, expect, it } from "vitest";

import {
  SMOKE_TEST_URL,
  getBrowserContextOptions,
  getBrowserLaunchOptions,
  runBrowserSmokeTest
} from "../src/browser";

describe("worker browser helper", () => {
  it("uses a controlled headless launch config", () => {
    expect(getBrowserLaunchOptions()).toEqual({ headless: true, timeout: 30_000 });
  });

  it("uses a stable viewport without proxy or evasion settings", () => {
    expect(getBrowserContextOptions()).toEqual({ viewport: { height: 720, width: 1280 } });
  });

  it("opens only the local smoke-test data page and closes browser resources", async () => {
    const closed: string[] = [];
    const visited: string[] = [];
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
            title: async () => "ApplyWizz Worker Smoke Test"
          })
        })
      })
    };

    await expect(runBrowserSmokeTest(launcher)).resolves.toEqual({
      ok: true,
      title: "ApplyWizz Worker Smoke Test",
      url: SMOKE_TEST_URL
    });
    expect(visited).toEqual([SMOKE_TEST_URL]);
    expect(closed).toEqual(["page", "context", "browser"]);
  });
});
