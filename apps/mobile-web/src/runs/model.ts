import type { AppRole } from "../auth/model";

export type ApplicationRunStatus =
  | "queued"
  | "starting"
  | "opening_job_link"
  | "detecting_page_state"
  | "login_or_create_account"
  | "waiting_for_otp"
  | "otp_verified"
  | "uploading_resume"
  | "resume_uploaded"
  | "reaching_questionnaire"
  | "capturing_html"
  | "extracting_questions"
  | "mapping_answers"
  | "filling_safe_answers"
  | "checking_conditional_questions"
  | "manual_review_required"
  | "dry_run_complete"
  | "human_approval_required"
  | "approved_for_submit"
  | "submitting"
  | "submitted"
  | "stopped"
  | "failed";

export type RunStatusFilter = "all" | "queued" | "running" | "failed" | "dry_run_complete" | "manual_review_required";
export type RunStatusTone = "active" | "blocked" | "complete" | "neutral";

export type ApplicationRunRecord = {
  id: string;
  approved_at: string | null;
  approved_by: string | null;
  candidate_id: string;
  completed_at: string | null;
  created_at: string;
  current_step: string | null;
  error_code: string | null;
  error_message: string | null;
  job_link_id: string;
  mode: "dry_run" | "controlled_submit";
  readiness_score: "ready" | "needs_review" | "blocked" | "failed" | null;
  started_at: string | null;
  started_by: string | null;
  status: ApplicationRunStatus;
  submitted_at: string | null;
  total_answers_filled: number;
  total_answers_mapped: number;
  total_high_risk_items: number;
  total_manual_review_items: number;
  total_questions_found: number;
  updated_at: string;
};

export type RunReadinessInput = {
  activeResumeCount: number;
  candidateId: string;
  jobLinkId: string;
  zohoMailboxCount: number;
};

export type RunReadiness = RunReadinessInput & {
  canCreate: boolean;
  missing: string[];
};

export type RunCreationValidationErrors = {
  jobLinkId?: string;
  readiness?: string;
};

export function canCreateApplicationRuns(role: AppRole | null | undefined) {
  return role === "admin" || role === "operator";
}

export function buildRunReadiness(input: RunReadinessInput): RunReadiness {
  const missing: string[] = [];

  if (!input.candidateId) {
    missing.push("candidate");
  }

  if (input.activeResumeCount < 1) {
    missing.push("active resume");
  }

  if (input.zohoMailboxCount < 1) {
    missing.push("Zoho mailbox");
  }

  if (!input.jobLinkId) {
    missing.push("job link");
  }

  return {
    ...input,
    canCreate: missing.length === 0,
    missing
  };
}

export function validateRunCreation(readiness: RunReadiness): RunCreationValidationErrors {
  if (!readiness.jobLinkId) {
    return { jobLinkId: "Select a job link." };
  }

  if (!readiness.canCreate) {
    return { readiness: `Missing: ${readiness.missing.join(", ")}.` };
  }

  return {};
}

export function toApplicationRunPayload(readiness: RunReadiness, startedBy?: string | null) {
  return {
    candidate_id: readiness.candidateId,
    job_link_id: readiness.jobLinkId,
    mode: "dry_run",
    started_by: startedBy ?? null,
    status: "queued"
  };
}

export function getRunStatusTone(status: ApplicationRunStatus): RunStatusTone {
  if (status === "dry_run_complete") {
    return "complete";
  }

  if (status === "failed" || status === "stopped" || status === "manual_review_required") {
    return "blocked";
  }

  if (status !== "queued") {
    return "active";
  }

  return "neutral";
}

export function isRunInStatusFilter(status: ApplicationRunStatus, filter: RunStatusFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "running") {
    return status !== "queued" && status !== "failed" && status !== "dry_run_complete" && status !== "manual_review_required";
  }

  return status === filter;
}
