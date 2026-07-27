export const APP_NAME = "ApplyWizz Workday Dry-Run Automation Engine";

export const V1_SAFETY_DEFAULTS = {
  autoSubmitEnabled: false,
  dryRunRequired: true,
  humanApprovalRequired: true
} as const;

export type AppEnvironment = "local" | "staging" | "production";
