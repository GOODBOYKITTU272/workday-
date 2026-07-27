export type AppRole = "admin" | "operator" | "viewer";

export type AuthRedirectInput = {
  hasSession: boolean;
  isLoading: boolean;
  pathname: string;
};

export type AppUserProfile = {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: AppRole;
  status: "active" | "inactive" | "suspended";
};

export function hasRole(actual: AppRole | null | undefined, expected: AppRole) {
  return actual === expected;
}

export function isAdmin(role: AppRole | null | undefined) {
  return hasRole(role, "admin");
}

export function isOperator(role: AppRole | null | undefined) {
  return hasRole(role, "operator");
}

export function isViewer(role: AppRole | null | undefined) {
  return hasRole(role, "viewer");
}

export function hasActiveProfile(profile: AppUserProfile | null | undefined) {
  return profile?.status === "active";
}

export function getAuthRedirect({ hasSession, isLoading, pathname }: AuthRedirectInput) {
  if (isLoading) {
    return null;
  }

  if (!hasSession && pathname !== "/login") {
    return "/login";
  }

  if (hasSession && (pathname === "/" || pathname === "/login")) {
    return "/dashboard";
  }

  return null;
}
