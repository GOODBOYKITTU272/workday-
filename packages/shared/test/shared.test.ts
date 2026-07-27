import { describe, expect, it } from "vitest";

import { V1_SAFETY_DEFAULTS } from "../src/index";

describe("V1 safety defaults", () => {
  it("keeps auto-submit disabled", () => {
    expect(V1_SAFETY_DEFAULTS.autoSubmitEnabled).toBe(false);
  });
});
