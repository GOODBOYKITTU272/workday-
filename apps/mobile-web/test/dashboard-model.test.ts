import { describe, expect, test } from "vitest";

import { buildDashboardCards } from "../src/dashboard/model";

describe("dashboard model", () => {
  test("builds dry-run status cards from table counts", () => {
    expect(
      buildDashboardCards({
        candidates: 2,
        jobLinks: 3,
        manualReviewOpen: 1,
        runs: 4
      })
    ).toEqual([
      { label: "Candidates", value: "2" },
      { label: "Job Links", value: "3" },
      { label: "Runs", value: "4" },
      { label: "Open Manual Review", value: "1" }
    ]);
  });
});
