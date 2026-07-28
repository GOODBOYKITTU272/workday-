type WorkerRunStatus = "queued" | string;
type WorkerRunMode = "dry_run" | string;

export type WorkerRunReadinessInput = {
  activeResumeCount: number;
  candidate: { id: string } | null;
  jobLink: { candidate_id: string; id: string; url: string; workday_tenant_key: string | null } | null;
  run: { candidate_id: string; id: string; job_link_id: string; mode: WorkerRunMode; status: WorkerRunStatus } | null;
  zohoMailboxCount: number;
};

export type WorkerRunReadinessResult = {
  issues: string[];
  ok: boolean;
};

export function isClaimableRunStatus(status: WorkerRunStatus) {
  return status === "queued" || status === "starting";
}

export function validateWorkerRunReadiness(input: WorkerRunReadinessInput): WorkerRunReadinessResult {
  const issues: string[] = [];

  if (!input.run) {
    issues.push("application run is required");
  }

  if (input.run && input.run.mode !== "dry_run") {
    issues.push("run mode must be dry_run");
  }

  if (input.run && !isClaimableRunStatus(input.run.status)) {
    issues.push("run status is not claimable");
  }

  if (!input.candidate) {
    issues.push("candidate is required");
  }

  if (!input.jobLink) {
    issues.push("job link is required");
  }

  if (input.run && input.jobLink && input.run.job_link_id !== input.jobLink.id) {
    issues.push("run job link mismatch");
  }

  if (input.run && input.candidate && input.run.candidate_id !== input.candidate.id) {
    issues.push("run candidate mismatch");
  }

  if (input.jobLink && input.candidate && input.jobLink.candidate_id !== input.candidate.id) {
    issues.push("job link must belong to candidate");
  }

  if (input.activeResumeCount < 1) {
    issues.push("active resume is required");
  }

  if (input.zohoMailboxCount < 1) {
    issues.push("Zoho mailbox is required");
  }

  return {
    issues,
    ok: issues.length === 0
  };
}
