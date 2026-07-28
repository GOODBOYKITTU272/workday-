import { createWorkerSupabaseClient } from "./worker-env.js";
import { type WorkerRunReadinessInput, validateWorkerRunReadiness } from "./queue-readiness.js";
import {
  type SafeWorkdayPageSnapshot,
  type WorkdayApplyClickResult,
  buildPostApplyDecisionRoute,
  type WorkdayLandingActionDiscovery,
  type WorkdayPageOpenCheckResult,
  classifyPostApplyLandingState,
  runWorkdayApplyClickDryRun
} from "./workday-page-snapshot.js";

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
  | { runId: string; status: "snapshot_complete" }
  | { runId: string; status: "apply_click_complete" }
  | { runId: string; status: "apply_click_blocked" }
  | { runId: string; status: "snapshot_blocked" }
  | { runId: string; status: "tenant_mismatch" }
  | { errorCode: string; runId: null | string; status: "error" };

export type RunProcessorDeps = {
  claimNextRun: () => Promise<ClaimedApplicationRun | null>;
  insertAutomationLog: (payload: AutomationLogInsert) => Promise<void>;
  insertManualReviewItem: (payload: ManualReviewItemInsert) => Promise<{ created: boolean }>;
  insertRunStep: (payload: RunStepInsert) => Promise<{ id: null | string }>;
  loadReadiness: (run: ClaimedApplicationRun) => Promise<WorkerRunReadinessInput>;
  openWorkdayPage: (jobUrl: string, expectedTenantKey: string | null) => Promise<WorkdayPageOpenCheckResult>;
  now?: () => string;
  updateRun: (runId: string, payload: ApplicationRunUpdate) => Promise<void>;
};

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

export type ManualReviewItemInsert = {
  application_run_id: string;
  candidate_id: string;
  error_code: null | string;
  hostname: null | string;
  item_type: "routing_review";
  job_link_id: string;
  post_apply_state: null | string;
  review_reason: ManualReviewCategory;
  risk_level: ManualReviewRiskLevel;
  route_reason: null | string;
  status: "open";
  tenant_key: null | string;
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
const WORKDAY_PAGE_SNAPSHOT_STEP_NAME = "workday_page_snapshot";
const WORKDAY_APPLY_CLICK_STEP_NAME = "workday_apply_click";
const UNKNOWN_WORKER_ERROR = "UNKNOWN_WORKER_ERROR";
const MANUAL_REVIEW_ITEM_CREATE_FAILED = "MANUAL_REVIEW_ITEM_CREATE_FAILED";

export function buildManualReviewItemPayload(input: {
  category: ManualReviewCategory;
  errorCode?: null | string;
  hostname?: null | string;
  postApplyState?: null | string;
  riskLevel: ManualReviewRiskLevel;
  routeReason?: null | string;
  run: ClaimedApplicationRun;
  tenantKey?: null | string;
}): ManualReviewItemInsert {
  return {
    application_run_id: input.run.id,
    candidate_id: input.run.candidate_id,
    error_code: input.errorCode ?? null,
    hostname: input.hostname ?? null,
    item_type: "routing_review",
    job_link_id: input.run.job_link_id,
    post_apply_state: input.postApplyState ?? null,
    review_reason: input.category,
    risk_level: input.riskLevel,
    route_reason: input.routeReason ?? null,
    status: "open",
    tenant_key: input.tenantKey ?? null
  };
}

export async function createManualReviewItemForRun(
  deps: RunProcessorDeps,
  run: ClaimedApplicationRun,
  payload: ManualReviewItemInsert
): Promise<void> {
  try {
    await deps.insertManualReviewItem(payload);
  } catch {
    try {
      await deps.insertAutomationLog({
        application_run_id: run.id,
        context: { review_reason: payload.review_reason, safe_error: true },
        error_code: MANUAL_REVIEW_ITEM_CREATE_FAILED,
        level: "error",
        message: "Manual review item could not be created safely."
      });
    } catch {
      // Manual review queue promotion is best-effort; the run's diagnosis was already recorded safely.
    }
  }
}

export async function processOneApplicationRun(deps: RunProcessorDeps = createSupabaseRunProcessorDeps()) {
  let claimedRun: ClaimedApplicationRun | null = null;

  try {
    claimedRun = await deps.claimNextRun();

    if (!claimedRun) {
      return { status: "no_work" } satisfies RunProcessorResult;
    }

    const readinessInput = await deps.loadReadiness(claimedRun);
    const readiness = validateWorkerRunReadiness(readinessInput);

    if (!readiness.ok) {
      await finishReadinessFailure(deps, claimedRun, readiness.issues);

      return { issues: readiness.issues, runId: claimedRun.id, status: "readiness_failed" } satisfies RunProcessorResult;
    }

    if (!readinessInput.jobLink) {
      throw new Error("validated readiness is missing jobLink");
    }

    const expectedTenantKey = readinessInput.jobLink.workday_tenant_key?.trim() || null;
    const pageOpenResult = await deps.openWorkdayPage(readinessInput.jobLink.url, expectedTenantKey);

    if (!pageOpenResult.ok) {
      await finishBlockedPageOpen(deps, claimedRun, pageOpenResult);

      return { runId: claimedRun.id, status: "snapshot_blocked" } satisfies RunProcessorResult;
    }

    if (pageOpenResult.apply_click) {
      if (pageOpenResult.apply_click.click_result === "clicked") {
        await finishApplyClickSuccess(
          deps,
          claimedRun,
          pageOpenResult.snapshot,
          pageOpenResult.discovery,
          pageOpenResult.apply_click,
          expectedTenantKey,
          pageOpenResult.apply_click.after_tenant_key?.trim() || null
        );

        return { runId: claimedRun.id, status: "apply_click_complete" } satisfies RunProcessorResult;
      }

      await finishApplyClickBlocked(
        deps,
        claimedRun,
        pageOpenResult.snapshot,
        pageOpenResult.discovery,
        pageOpenResult.apply_click,
        expectedTenantKey,
        pageOpenResult.apply_click.after_tenant_key?.trim() || null
      );

      return { runId: claimedRun.id, status: "apply_click_blocked" } satisfies RunProcessorResult;
    }

    const finalTenantKey = pageOpenResult.snapshot.tenant_key?.trim() || null;

    if (expectedTenantKey && finalTenantKey && expectedTenantKey !== finalTenantKey) {
      await finishTenantMismatch(deps, claimedRun, pageOpenResult.snapshot, expectedTenantKey, finalTenantKey);

      return { runId: claimedRun.id, status: "tenant_mismatch" } satisfies RunProcessorResult;
    }

    await finishSnapshotSuccess(deps, claimedRun, pageOpenResult.snapshot, pageOpenResult.discovery, expectedTenantKey, finalTenantKey);

    return { runId: claimedRun.id, status: "snapshot_complete" } satisfies RunProcessorResult;
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
    async insertManualReviewItem(payload) {
      const { error } = await client.from("manual_review_items").insert(payload);

      if (error) {
        if (error.code === "23505") {
          return { created: false };
        }

        throw error;
      }

      return { created: true };
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
        client.from("job_links").select("id,candidate_id,url,workday_tenant_key").eq("id", run.job_link_id).maybeSingle()
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
        jobLink: jobLink
          ? {
              candidate_id: jobLink.candidate_id as string,
              id: jobLink.id as string,
              url: jobLink.url as string,
              workday_tenant_key: jobLink.workday_tenant_key as string | null
            }
          : null,
        run,
        zohoMailboxCount: zohoMailboxCount ?? 0
      };
    },
    openWorkdayPage: async (jobUrl, expectedTenantKey) => runWorkdayApplyClickDryRun(jobUrl, { expectedTenantKey }),
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

  await createManualReviewItemForRun(
    deps,
    run,
    buildManualReviewItemPayload({ category: "readiness_blocked", riskLevel: "high", run })
  );
}

async function finishSnapshotSuccess(
  deps: RunProcessorDeps,
  run: ClaimedApplicationRun,
  snapshot: SafeWorkdayPageSnapshot,
  discovery: WorkdayLandingActionDiscovery,
  expectedTenantKey: string | null,
  finalTenantKey: string | null
) {
  const postApplyState = classifyPostApplyLandingState(snapshot, discovery);
  const postApplyDecision = buildPostApplyDecisionRoute(postApplyState);
  const metadata = {
    ...buildSafePageSnapshotMetadata(snapshot, expectedTenantKey, finalTenantKey),
    post_apply_decision: buildSafePostApplyDecisionMetadata(postApplyDecision),
    post_apply_state: buildSafePostApplyStateMetadata(postApplyState),
    landing_action: discovery
  };
  const completedAt = getNow(deps);
  const step = await deps.insertRunStep({
    application_run_id: run.id,
    completed_at: completedAt,
    message: "Workday page opened and safe snapshot captured. Worker stops before login or question extraction.",
    metadata,
    step_name: WORKDAY_PAGE_SNAPSHOT_STEP_NAME,
    step_order: 1,
    step_status: "success"
  });

  await deps.insertAutomationLog({
    application_run_id: run.id,
    context: metadata,
    level: "info",
    message: "Workday page snapshot captured. Worker stops before login or question extraction.",
    run_step_id: step.id
  });

  await deps.updateRun(run.id, {
    completed_at: completedAt,
    current_step: WORKDAY_PAGE_SNAPSHOT_STEP_NAME,
    error_code: null,
    error_message: null,
    readiness_score: "needs_review",
    status: "manual_review_required"
  });

  await createManualReviewItemForRun(
    deps,
    run,
    buildManualReviewItemPayload({
      category: postApplyDecision.recommended_next_route,
      hostname: snapshot.hostname,
      postApplyState: postApplyState.post_apply_state,
      riskLevel: postApplyDecision.route_confidence,
      routeReason: postApplyDecision.route_reason,
      run,
      tenantKey: finalTenantKey
    })
  );
}

async function finishApplyClickSuccess(
  deps: RunProcessorDeps,
  run: ClaimedApplicationRun,
  snapshot: SafeWorkdayPageSnapshot,
  discovery: WorkdayLandingActionDiscovery,
  applyClick: WorkdayApplyClickResult,
  expectedTenantKey: string | null,
  finalTenantKey: string | null
) {
  const postApplyState = classifyPostApplyLandingState(snapshot, discovery, applyClick);
  const postApplyDecision = buildPostApplyDecisionRoute(postApplyState);
  const metadata = {
    ...buildSafePageSnapshotMetadata(snapshot, expectedTenantKey, finalTenantKey),
    apply_click: buildSafeApplyClickMetadata(applyClick),
    post_apply_decision: buildSafePostApplyDecisionMetadata(postApplyDecision),
    post_apply_state: buildSafePostApplyStateMetadata(postApplyState),
    landing_action: discovery
  };
  const completedAt = getNow(deps);
  const step = await deps.insertRunStep({
    application_run_id: run.id,
    completed_at: completedAt,
    message: "Workday Apply action clicked and safe snapshot captured. Worker stops before login or question extraction.",
    metadata,
    step_name: WORKDAY_APPLY_CLICK_STEP_NAME,
    step_order: 2,
    step_status: "success"
  });

  await deps.insertAutomationLog({
    application_run_id: run.id,
    context: metadata,
    level: "info",
    message: "Workday Apply action clicked and safe snapshot captured. Worker stops before login or question extraction.",
    run_step_id: step.id
  });

  await deps.updateRun(run.id, {
    completed_at: completedAt,
    current_step: WORKDAY_APPLY_CLICK_STEP_NAME,
    error_code: null,
    error_message: null,
    readiness_score: "needs_review",
    status: "manual_review_required"
  });

  await createManualReviewItemForRun(
    deps,
    run,
    buildManualReviewItemPayload({
      category: postApplyDecision.recommended_next_route,
      hostname: applyClick.after_hostname,
      postApplyState: postApplyState.post_apply_state,
      riskLevel: postApplyDecision.route_confidence,
      routeReason: postApplyDecision.route_reason,
      run,
      tenantKey: finalTenantKey
    })
  );
}

async function finishApplyClickBlocked(
  deps: RunProcessorDeps,
  run: ClaimedApplicationRun,
  snapshot: SafeWorkdayPageSnapshot,
  discovery: WorkdayLandingActionDiscovery,
  applyClick: WorkdayApplyClickResult,
  expectedTenantKey: string | null,
  finalTenantKey: string | null
) {
  const postApplyState = classifyPostApplyLandingState(snapshot, discovery, applyClick);
  const postApplyDecision = buildPostApplyDecisionRoute(postApplyState);
  const metadata = {
    ...buildSafePageSnapshotMetadata(snapshot, expectedTenantKey, finalTenantKey),
    apply_click: buildSafeApplyClickMetadata(applyClick),
    post_apply_decision: buildSafePostApplyDecisionMetadata(postApplyDecision),
    post_apply_state: buildSafePostApplyStateMetadata(postApplyState),
    landing_action: discovery
  };
  const completedAt = getNow(deps);
  const step = await deps.insertRunStep({
    application_run_id: run.id,
    completed_at: completedAt,
    error_code: applyClick.error_code,
    error_message: "Apply action could not be clicked safely.",
    message: "Workday Apply action could not be clicked safely. Worker stops before login or question extraction.",
    metadata,
    step_name: WORKDAY_APPLY_CLICK_STEP_NAME,
    step_order: 2,
    step_status: "failed"
  });

  await deps.insertAutomationLog({
    application_run_id: run.id,
    context: metadata,
    error_code: applyClick.error_code,
    level: "warn",
    message: "Workday Apply action could not be clicked safely. Worker stops before login or question extraction.",
    run_step_id: step.id
  });

  await deps.updateRun(run.id, {
    completed_at: completedAt,
    current_step: WORKDAY_APPLY_CLICK_STEP_NAME,
    error_code: applyClick.error_code,
    error_message: "Apply action could not be clicked safely.",
    readiness_score: "blocked",
    status: "manual_review_required"
  });

  const clickNeverCompleted =
    applyClick.error_code !== "TENANT_MISMATCH_AFTER_APPLY" && applyClick.error_code !== "UNTRUSTED_REDIRECT_AFTER_APPLY";

  await createManualReviewItemForRun(
    deps,
    run,
    buildManualReviewItemPayload({
      category: clickNeverCompleted ? "apply_click_blocked" : postApplyDecision.recommended_next_route,
      errorCode: applyClick.error_code,
      hostname: applyClick.after_hostname,
      postApplyState: postApplyState.post_apply_state,
      riskLevel: clickNeverCompleted ? "high" : postApplyDecision.route_confidence,
      routeReason: postApplyDecision.route_reason,
      run,
      tenantKey: finalTenantKey
    })
  );
}

async function finishTenantMismatch(
  deps: RunProcessorDeps,
  run: ClaimedApplicationRun,
  snapshot: SafeWorkdayPageSnapshot,
  expectedTenantKey: string,
  finalTenantKey: string
) {
  const completedAt = getNow(deps);
  const metadata = buildSafePageSnapshotMetadata(snapshot, expectedTenantKey, finalTenantKey);

  const step = await deps.insertRunStep({
    application_run_id: run.id,
    completed_at: completedAt,
    error_code: "TENANT_MISMATCH",
    error_message: "Final Workday tenant did not match the expected tenant.",
    message: "Workday page snapshot final tenant did not match the expected tenant.",
    metadata: { ...metadata, tenant_match: false },
    step_name: WORKDAY_PAGE_SNAPSHOT_STEP_NAME,
    step_order: 1,
    step_status: "failed"
  });

  await deps.insertAutomationLog({
    application_run_id: run.id,
    context: { ...metadata, tenant_match: false },
    error_code: "TENANT_MISMATCH",
    level: "warn",
    message: "Workday page snapshot final tenant did not match the expected tenant.",
    run_step_id: step.id
  });

  await deps.updateRun(run.id, {
    completed_at: completedAt,
    current_step: WORKDAY_PAGE_SNAPSHOT_STEP_NAME,
    error_code: "TENANT_MISMATCH",
    error_message: "Final Workday tenant did not match the expected tenant.",
    readiness_score: "blocked",
    status: "manual_review_required"
  });

  await createManualReviewItemForRun(
    deps,
    run,
    buildManualReviewItemPayload({
      category: "stop_tenant_mismatch",
      errorCode: "TENANT_MISMATCH",
      hostname: snapshot.hostname,
      postApplyState: "tenant_mismatch",
      riskLevel: "high",
      run,
      tenantKey: finalTenantKey
    })
  );
}

async function finishBlockedPageOpen(
  deps: RunProcessorDeps,
  run: ClaimedApplicationRun,
  result: Exclude<WorkdayPageOpenCheckResult, { ok: true }>
) {
  const completedAt = getNow(deps);
  const status = result.error_code === "page_open_failed" ? "failed" : "manual_review_required";
  const metadata = buildBlockedPageOpenMetadata(result);

  const step = await deps.insertRunStep({
    application_run_id: run.id,
    completed_at: completedAt,
    error_code: result.error_code,
    error_message: result.error,
    message: result.error,
    metadata,
    step_name: WORKDAY_PAGE_SNAPSHOT_STEP_NAME,
    step_order: 1,
    step_status: "failed"
  });

  await deps.insertAutomationLog({
    application_run_id: run.id,
    context: metadata,
    error_code: result.error_code,
    level: status === "failed" ? "error" : "warn",
    message: result.error,
    run_step_id: step.id
  });

  await deps.updateRun(run.id, {
    completed_at: completedAt,
    current_step: WORKDAY_PAGE_SNAPSHOT_STEP_NAME,
    error_code: result.error_code,
    error_message: result.error,
    readiness_score: status === "failed" ? "failed" : "blocked",
    status
  });

  if (status === "manual_review_required") {
    await createManualReviewItemForRun(
      deps,
      run,
      buildManualReviewItemPayload({
        category: result.error_code === "UNTRUSTED_REDIRECT" ? "stop_untrusted_redirect" : "page_open_blocked",
        errorCode: result.error_code,
        hostname: "hostname" in result ? result.hostname : null,
        riskLevel: "high",
        run
      })
    );
  }
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

function buildSafePageSnapshotMetadata(
  snapshot: SafeWorkdayPageSnapshot,
  expectedTenantKey: string | null,
  finalTenantKey: string | null
) {
  return {
    confidence: snapshot.confidence,
    expected_tenant_known: Boolean(expectedTenantKey),
    final_tenant_key: finalTenantKey,
    final_url: snapshot.final_url,
    hostname: snapshot.hostname,
    load_status: snapshot.load_status,
    page_kind: snapshot.page_kind,
    page_kind_confidence: snapshot.page_kind_confidence,
    page_title: snapshot.page_title,
    tenant_key: snapshot.tenant_key,
    tenant_match: expectedTenantKey && finalTenantKey ? expectedTenantKey === finalTenantKey : null,
    tenant_name: snapshot.tenant_name,
    timestamp: snapshot.timestamp,
    workday_base_url: snapshot.workday_base_url
  };
}

function buildSafeApplyClickMetadata(applyClick: WorkdayApplyClickResult) {
  return {
    action_type: applyClick.action_type,
    after_hostname: applyClick.after_hostname,
    after_page_kind: applyClick.after_page_kind,
    after_page_kind_confidence: applyClick.after_page_kind_confidence,
    after_tenant_key: applyClick.after_tenant_key,
    after_tenant_name: applyClick.after_tenant_name,
    after_url: applyClick.after_url,
    after_workday_base_url: applyClick.after_workday_base_url,
    before_page_kind: applyClick.before_page_kind,
    before_url: applyClick.before_url,
    click_result: applyClick.click_result,
    error_code: applyClick.error_code,
    reason: applyClick.reason,
    timestamp: applyClick.timestamp
  };
}

function buildSafePostApplyStateMetadata(
  postApplyState: ReturnType<typeof classifyPostApplyLandingState>
) {
  return {
    confidence: postApplyState.confidence,
    post_apply_reason: postApplyState.post_apply_reason,
    post_apply_state: postApplyState.post_apply_state
  };
}

function buildSafePostApplyDecisionMetadata(
  postApplyDecision: ReturnType<typeof buildPostApplyDecisionRoute>
) {
  return {
    execution_allowed: postApplyDecision.execution_allowed,
    post_apply_reason: postApplyDecision.post_apply_reason,
    post_apply_state: postApplyDecision.post_apply_state,
    post_apply_state_confidence: postApplyDecision.post_apply_state_confidence,
    recommended_next_route: postApplyDecision.recommended_next_route,
    requires_human_review: postApplyDecision.requires_human_review,
    route_confidence: postApplyDecision.route_confidence,
    route_reason: postApplyDecision.route_reason,
    timestamp: postApplyDecision.timestamp
  };
}

function buildBlockedPageOpenMetadata(result: Exclude<WorkdayPageOpenCheckResult, { ok: true }>) {
  return {
    error_code: result.error_code,
    final_url: "final_url" in result ? result.final_url : result.url,
    hostname: "hostname" in result ? result.hostname : null,
    load_status: "blocked",
    page_kind: "page_kind" in result ? result.page_kind : "unknown"
  };
}

function getNow(deps: RunProcessorDeps) {
  return deps.now?.() ?? new Date().toISOString();
}
