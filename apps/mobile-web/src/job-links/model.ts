import type { AppRole } from "../auth/model";

export type JobLinkStatus =
  | "queued"
  | "running"
  | "opened"
  | "login_required"
  | "otp_required"
  | "logged_in"
  | "resume_uploaded"
  | "questionnaire_reached"
  | "questions_extracted"
  | "answers_mapped"
  | "manual_review_required"
  | "dry_run_complete"
  | "approved_for_submit"
  | "submitted"
  | "failed"
  | "duplicate"
  | "skipped";

export type JobLinkRecord = {
  id: string;
  candidate_id: string;
  company_name: string | null;
  created_at: string;
  created_by: string | null;
  job_title: string | null;
  last_error: string | null;
  last_run_id: string | null;
  normalized_url: string;
  notes: string | null;
  priority: number;
  source: string | null;
  status: JobLinkStatus;
  updated_at: string;
  url: string;
  workday_tenant_key: string | null;
};

export type JobLinkInput = {
  candidateId: string;
  company_name?: string;
  job_title?: string;
  notes?: string;
  priority?: string;
  source?: string;
  status?: JobLinkStatus;
  url: string;
  workday_tenant_key?: string;
};

export type JobLinkValidationErrors = {
  candidateId?: string;
  priority?: string;
  url?: string;
};

export function canManageJobLinks(role: AppRole | null | undefined) {
  return role === "admin" || role === "operator";
}

export function normalizeJobUrl(rawUrl: string) {
  const url = new URL(rawUrl.trim());
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (url.hostname.includes("workday")) {
    url.search = "";
  }

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

export function isWorkdayJobUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    return url.hostname.toLowerCase().includes("workday");
  } catch {
    return false;
  }
}

export function validateJobLinkInput(input: JobLinkInput): JobLinkValidationErrors {
  const errors: JobLinkValidationErrors = {};
  const url = input.url.trim();

  if (!input.candidateId) {
    errors.candidateId = "Candidate is required.";
  }

  if (!url) {
    errors.url = "Job URL is required.";
  } else {
    try {
      normalizeJobUrl(url);
    } catch {
      errors.url = "Enter a valid URL.";
    }
  }

  if (!errors.url && !isWorkdayJobUrl(url)) {
    errors.url = "Enter a Workday job URL for V1.";
  }

  if (input.priority?.trim()) {
    const priority = Number(input.priority);

    if (!Number.isInteger(priority) || priority < 0) {
      errors.priority = "Enter zero or a positive whole number.";
    }
  }

  return errors;
}

export function toJobLinkPayload(input: JobLinkInput, createdBy?: string | null) {
  const normalizedUrl = normalizeJobUrl(input.url);

  return {
    ...(createdBy === undefined ? {} : { created_by: createdBy }),
    candidate_id: input.candidateId,
    company_name: input.company_name?.trim() || null,
    job_title: input.job_title?.trim() || null,
    normalized_url: normalizedUrl,
    notes: input.notes?.trim() || null,
    priority: input.priority?.trim() ? Number(input.priority) : 0,
    source: input.source?.trim() || null,
    status: input.status ?? "queued",
    url: input.url.trim(),
    workday_tenant_key: input.workday_tenant_key?.trim() || null
  };
}
