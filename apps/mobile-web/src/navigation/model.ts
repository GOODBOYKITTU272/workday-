export type NavigationItemId =
  | "dashboard"
  | "candidates"
  | "job-links"
  | "runs"
  | "manual-review"
  | "answer-bank"
  | "settings";

export type NavigationItem = {
  id: NavigationItemId;
  href: string;
  label: string;
};

export const navigationItems: NavigationItem[] = [
  { id: "dashboard", href: "/dashboard", label: "Dashboard" },
  { id: "candidates", href: "/candidates", label: "Candidates" },
  { id: "job-links", href: "/job-links", label: "Job Links" },
  { id: "runs", href: "/runs", label: "Runs" },
  { id: "manual-review", href: "/manual-review", label: "Manual Review" },
  { id: "answer-bank", href: "/answer-bank", label: "Answer Bank" },
  { id: "settings", href: "/settings", label: "Settings" }
];

export function getActiveNavItem(pathname: string): NavigationItemId | null {
  return navigationItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.id ?? null;
}
