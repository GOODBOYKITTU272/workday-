import { describe, expect, it } from "vitest";

import { getWorkerBanner } from "../src/index";

describe("worker scaffold", () => {
  it("identifies the ApplyWizz worker", () => {
    expect(getWorkerBanner()).toContain("ApplyWizz Workday Dry-Run Automation Engine");
  });
});
