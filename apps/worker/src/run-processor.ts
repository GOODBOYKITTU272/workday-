import { createWorkerSupabaseClient } from "./worker-env.js";
import { type WorkerRunReadinessInput, validateWorkerRunReadiness } from "./queue-readiness.js";

export type ClaimedApplicationRun = {
  candidate_id: string;
  id: string;
  job_link_id: string;
  mode: string;
  status: string;
};

export type RunProcessorResult =
  | { status: "no_work" }
  | { issues: string[]; runId: string; status: "readiness_failed" }
  | { runId: string; status: "placeholder_complete" }
  | { errorCode: string; runId: null | string; status: "error" };

export type RunProcessorDeps = {
  claimNextRun: () => Promise<ClaimedApplicationRun | null>;
  insertAutomationLog: (payload: AutomationLogInsert) => Promise<void>;
  insertRunStep: (payload: RunStepInsert) => Promise<{ id: null | string }>;
  loadReadiness: (run: ClaimedApplicationRun) => Promise<WorkerRunReadinessInput>;
  now?: () => string;
  updateRun: (runId: string, payload: ApplicationRunUpdate) => Promise<void>;
};

export type ApplicationRunUpdate = {
  completed_at?: string;
  current_step?: string;
  error_code?: string | null;
  error_message?: string | null;
  readiness_score?: string;
  status: "failed" | "manual_review_required";
};

export type RunStepInsert = {
  application_run_id: string;
  completed_at: string;
  error_code?: string | null;
  error_message?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  step_name: string;
  step_order: number;
  step_status: "failed" | "success";
};

export type AutomationLogInsert = {
  application_run_id: string;
  context?: Record<string, unknown>;
  error_code?: string | null;
  level: "error" | "info" | "warn";
  message: string;
  run_step_id?: null | string;
};

const READINESS_STEP_NAME = "readiness_checked";
const UNKNOWN_WORKER_ERROR = "UNKNOWN_WORKER_ERROR";

export async function processOneApplicationRun(deps: RunProcessorDeps = createSupabaseRunProcessorDeps()) {
  let claimedRun: ClaimedApplicationRun | null = null;

  try {
    claimedRun = await deps.claimNextRun();

    if (!claimedRun) {
      return { status: "no_work" } satisfies RunProcessorResult;
    }

    const readiness = validateWorkerRunReadiness(await deps.loadReadiness(claimedRun));

    if (!readiness.ok) {
      await finishReadinessFailure(deps, claimedRun, readiness.issues);

      return { issues: readiness.issues, runId: claimedRun.id, status: "readiness_failed" } satisfies RunProcessorResult;
    }

    await finishPlaceholderSuccess(deps, claimedRun);

    return { runId: claimedRun.id, status: "placeholder_complete" } satisfies RunProcessorResult;
  } catch {
    if (claimedRun) {
      try {
        await finishUnknownError(deps, claimedRun);
      } catch {
        // The caller gets a safe error result even if the database cleanup write fails.
      }
    }

    return { errorCode: UNKNOWN_WORKER_ERROR, runId: claimedRun?.id ?? null, status: "error" } satisfies RunProcessorResult;
  }
}

function createSupabaseRunProcessorDeps(): RunProcessorDeps {
  const client = createWorkerSupabaseClient();

  return {
    async claimNextRun() {
      const { data, error } = await client.rpc("claim_next_application_run");

      if (error) {
        throw error;
      }

      return (data?.[0] as ClaimedApplicationRun | undefined) ?? null;
    },
    async insertAutomationLog(payload) {
      const { error } = await client.from("automation_logs").insert(payload);

      if (error) {
        throw error;
      }
    },
    async insertRunStep(payload) {
      const { data, error } = await client.from("run_steps").insert(payload).select("id").single();

      if (error) {
        throw error;
      }

      return { id: data.id as string };
    },
    async loadReadiness(run) {
      const [{ data: candidate, error: candidateError }, { data: jobLink, error: jobLinkError }] = await Promise.all([
        client.from("candidates").select("id").eq("id", run.candidate_id).maybeSingle(),
        client.from("job_links").select("id,candidate_id").eq("id", run.job_link_id).maybeSingle()
      ]);

      if (candidateError || jobLinkError) {
        throw candidateError ?? jobLinkError;
      }

      const [{ count: activeResumeCount, error: resumeError }, { count: zohoMailboxCount, error: zohoError }] =
        await Promise.all([
          client
            .from("candidate_resumes")
            .select("id", { count: "exact", head: true })
            .eq("candidate_id", run.candidate_id)
            .eq("is_active", true),
          client.from("zoho_mailboxes").select("id", { count: "exact", head: true }).eq("candidate_id", run.candidate_id)
        ]);

      if (resumeError || zohoError) {
        throw resumeError ?? zohoError;
      }

      return {
        activeResumeCount: activeResumeCount ?? 0,
        candidate: candidate ? { id: candidate.id as string } : null,
        jobLink: jobLink ? { candidate_id: jobLink.candidate_id as string, id: jobLink.id as string } : null,
        run,
        zohoMailboxCount: zohoMailboxCount ?? 0
      };
    },
    async updateRun(runId, payload) {
      const { error } = await client.from("application_runs").update(payload).eq("id", runId);

      if (error) {
        throw error;
      }
    }
  };
}

async function finishReadinessFailure(deps: RunProcessorDeps, run: ClaimedApplicationRun, issues: string[]) {
  const completedAt = getNow(deps);
  const step = await deps.insertRunStep({
    application_run_id: run.id,
    completed_at: completedAt,
    error_code: "READINESS_FAILED",
    error_message: "Run readiness failed.",
    message: "Run readiness failed before automation.",
    metadata: { issue_count: issues.length, issues },
    step_name: READINESS_STEP_NAME,
    step_order: 1,
    step_status: "failed"
  });

  await deps.insertAutomationLog({
    application_run_id: run.id,
    context: { issue_count: issues.length, issues },
    error_code: "READINESS_FAILED",
    level: "warn",
    message: "Run moved to manual review because readiness failed.",
    run_step_id: step.id
  });

  await deps.updateRun(run.id, {
    completed_at: completedAt,
    current_step: READINESS_STEP_NAME,
    error_code: "READINESS_FAILED",
    error_message: "Run readiness failed.",
    readiness_score: "blocked",
    status: "manual_review_required"
  });
}

async function finishPlaceholderSuccess(deps: RunProcessorDeps, run: ClaimedApplicationRun) {
  const completedAt = getNow(deps);
  const step = await deps.insertRunStep({
    application_run_id: run.id,
    completed_at: completedAt,
    message: "Run readiness checked. Browser automation is not implemented in Phase 16.",
    metadata: { automation_started: false, phase: "phase_16" },
    step_name: READINESS_STEP_NAME,
    step_order: 1,
    step_status: "success"
  });

  await deps.insertAutomationLog({
    application_run_id: run.id,
    context: { automation_started: false, phase: "phase_16" },
    level: "info",
    message: "Worker stopped before browser automation.",
    run_step_id: step.id
  });

  await deps.updateRun(run.id, {
    completed_at: completedAt,
    current_step: READINESS_STEP_NAME,
    error_code: "WORKER_AUTOMATION_NOT_IMPLEMENTED",
    error_message: "Worker stopped before browser automation in Phase 16.",
    readiness_score: "needs_review",
    status: "manual_review_required"
  });
}

async function finishUnknownError(deps: RunProcessorDeps, run: ClaimedApplicationRun) {
  const completedAt = getNow(deps);
  const step = await deps.insertRunStep({
    application_run_id: run.id,
    completed_at: completedAt,
    error_code: UNKNOWN_WORKER_ERROR,
    error_message: "Worker failed before automation.",
    message: "Worker failed before automation.",
    metadata: { safe_error: true },
    step_name: READINESS_STEP_NAME,
    step_order: 1,
    step_status: "failed"
  });

  await deps.insertAutomationLog({
    application_run_id: run.id,
    context: { safe_error: true },
    error_code: UNKNOWN_WORKER_ERROR,
    level: "error",
    message: "Worker failed before automation.",
    run_step_id: step.id
  });

  await deps.updateRun(run.id, {
    completed_at: completedAt,
    current_step: READINESS_STEP_NAME,
    error_code: UNKNOWN_WORKER_ERROR,
    error_message: "Worker failed before automation.",
    readiness_score: "failed",
    status: "failed"
  });
}

function getNow(deps: RunProcessorDeps) {
  return deps.now?.() ?? new Date().toISOString();
}
