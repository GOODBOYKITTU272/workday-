import { describe, expect, test } from "vitest";

import { getAuthRedirect, hasActiveProfile, hasRole } from "../src/auth/model";

describe("auth model", () => {
  test("routes unauthenticated users to login and authenticated users away from login", () => {
    expect(getAuthRedirect({ isLoading: false, hasSession: false, pathname: "/dashboard" })).toBe("/login");
    expect(getAuthRedirect({ isLoading: false, hasSession: true, pathname: "/login" })).toBe("/dashboard");
    expect(getAuthRedirect({ isLoading: true, hasSession: false, pathname: "/dashboard" })).toBeNull();
  });

  test("requires an active app profile for protected access", () => {
    expect(hasActiveProfile(null)).toBe(false);
    expect(
      hasActiveProfile({
        avatar_url: null,
        email: "operator@example.com",
        full_name: "Operator",
        id: "user-id",
        role: "operator",
        status: "suspended"
      })
    ).toBe(false);
    expect(
      hasActiveProfile({
        avatar_url: null,
        email: "operator@example.com",
        full_name: "Operator",
        id: "user-id",
        role: "operator",
        status: "active"
      })
    ).toBe(true);
  });

  test("matches app roles exactly", () => {
    expect(hasRole("admin", "admin")).toBe(true);
    expect(hasRole("operator", "admin")).toBe(false);
    expect(hasRole("viewer", "viewer")).toBe(true);
  });
});
