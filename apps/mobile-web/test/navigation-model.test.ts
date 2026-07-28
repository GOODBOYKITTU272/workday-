import { describe, expect, test } from "vitest";

import { getActiveNavItem, navigationItems } from "../src/navigation/model";

describe("navigation model", () => {
  test("contains the Phase 4 sidebar destinations in order", () => {
    expect(navigationItems.map((item) => item.label)).toEqual([
      "Dashboard",
      "Candidates",
      "Job Links",
      "Runs",
      "Manual Review",
      "Answer Bank",
      "Settings"
    ]);
  });

  test("selects the active sidebar item from the current path", () => {
    expect(getActiveNavItem("/runs")).toBe("runs");
    expect(getActiveNavItem("/manual-review/details")).toBe("manual-review");
    expect(getActiveNavItem("/unknown")).toBeNull();
  });
});
