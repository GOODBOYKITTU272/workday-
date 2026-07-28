export type ManualReviewCategory =
  | "apply_click_blocked"
  | "page_open_blocked"
  | "readiness_blocked"
  | "route_to_create_account_flow"
  | "route_to_login_flow"
  | "route_to_manual_review"
  | "route_to_questionnaire_discovery"
  | "stop_already_applied"
  | "stop_job_unavailable"
  | "stop_tenant_mismatch"
  | "stop_untrusted_redirect"
  | "unknown_manual_review";

export type ManualReviewRiskLevel = "high" | "low" | "medium" | "unknown";
export type ManualReviewStatus = "approved" | "edited" | "marked_unsafe" | "open" | "rejected" | "resolved" | "skipped";
export type ManualReviewTone = "attention" | "blocked" | "neutral";

export type ManualReviewItemRecord = {
  id: string;
  application_run_id: string;
  candidate_id: string;
  created_at: string;
  error_code: string | null;
  hostname: string | null;
  job_link_id: string;
  post_apply_state: string | null;
  review_reason: ManualReviewCategory | string;
  risk_level: ManualReviewRiskLevel;
  route_reason: string | null;
  status: ManualReviewStatus;
  tenant_key: string | null;
  updated_at: string;
};

export function getManualReviewTone(riskLevel: ManualReviewRiskLevel): ManualReviewTone {
  if (riskLevel === "high") {
    return "blocked";
  }

  if (riskLevel === "medium") {
    return "attention";
  }

  return "neutral";
}

export function formatManualReviewCategory(category: string) {
  return category.replaceAll("_", " ");
}
