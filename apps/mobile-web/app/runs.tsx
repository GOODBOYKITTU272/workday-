import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useAuth } from "../src/auth/AuthProvider";
import { supabase } from "../src/auth/supabase";
import type { CandidateRecord } from "../src/candidates/model";
import type { JobLinkRecord } from "../src/job-links/model";
import { AppShell } from "../src/layout/AppShell";
import type { ApplicationRunRecord, RunCreationValidationErrors, RunStatusFilter } from "../src/runs/model";
import { buildRunReadiness, canCreateApplicationRuns, getRunStatusTone, isRunInStatusFilter, toApplicationRunPayload, validateRunCreation } from "../src/runs/model";

const applicationRunColumns =
  "id,job_link_id,candidate_id,started_by,status,mode,current_step,readiness_score,total_questions_found,total_answers_mapped,total_answers_filled,total_manual_review_items,total_high_risk_items,error_code,error_message,started_at,completed_at,approved_by,approved_at,submitted_at,created_at,updated_at";
const candidateColumns = "id,full_name,email";
const jobLinkColumns = "id,candidate_id,created_by,url,normalized_url,company_name,job_title,workday_tenant_key,source,status,last_run_id,last_error,priority,notes,created_at,updated_at";
const filters: RunStatusFilter[] = ["all", "queued", "running", "failed", "dry_run_complete", "manual_review_required"];

type RunCandidate = Pick<CandidateRecord, "email" | "full_name" | "id">;

export default function RunsScreen() {
  const { profile, role } = useAuth();
  const canCreate = canCreateApplicationRuns(role);
  const [activeResumeCandidateIds, setActiveResumeCandidateIds] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<RunCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunStatusFilter>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [jobLinks, setJobLinks] = useState<JobLinkRecord[]>([]);
  const [runFormErrors, setRunFormErrors] = useState<RunCreationValidationErrors>({});
  const [runs, setRuns] = useState<ApplicationRunRecord[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [selectedJobLinkId, setSelectedJobLinkId] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [zohoCandidateIds, setZohoCandidateIds] = useState<string[]>([]);

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [
      { data: runData, error: runError },
      { data: candidateData, error: candidateError },
      { data: jobLinkData, error: jobLinkError },
      { data: activeResumeData, error: activeResumeError },
      { data: zohoData, error: zohoError }
    ] = await Promise.all([
      supabase.from("application_runs").select(applicationRunColumns).order("created_at", { ascending: false }),
      supabase.from("candidates").select(candidateColumns).order("created_at", { ascending: false }),
      supabase.from("job_links").select(jobLinkColumns).order("created_at", { ascending: false }),
      supabase.from("candidate_resumes").select("candidate_id").eq("is_active", true),
      supabase.from("zoho_mailboxes").select("candidate_id")
    ]);

    const firstError = runError ?? candidateError ?? jobLinkError ?? activeResumeError ?? zohoError;

    if (firstError) {
      setError(firstError.message);
      setRuns([]);
      setCandidates([]);
      setJobLinks([]);
      setActiveResumeCandidateIds([]);
      setZohoCandidateIds([]);
      setIsLoading(false);
      return;
    }

    const nextRuns = (runData ?? []) as ApplicationRunRecord[];
    const nextCandidates = (candidateData ?? []) as RunCandidate[];
    const nextJobLinks = (jobLinkData ?? []) as JobLinkRecord[];
    setRuns(nextRuns);
    setCandidates(nextCandidates);
    setJobLinks(nextJobLinks);
    setActiveResumeCandidateIds([...(new Set((activeResumeData ?? []).map((resume) => resume.candidate_id as string)))]);
    setZohoCandidateIds([...(new Set((zohoData ?? []).map((mailbox) => mailbox.candidate_id as string)))]);
    setSelectedCandidateId((current) => current || nextCandidates[0]?.id || "");
    setSelectedJobLinkId((current) => current || nextJobLinks.find((jobLink) => jobLink.candidate_id === (nextCandidates[0]?.id || ""))?.id || "");

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const visibleRuns = useMemo(() => runs.filter((run) => isRunInStatusFilter(run.status, filter)), [filter, runs]);
  const candidatesById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const jobLinksById = useMemo(() => new Map(jobLinks.map((jobLink) => [jobLink.id, jobLink])), [jobLinks]);
  const selectableJobLinks = useMemo(() => jobLinks.filter((jobLink) => jobLink.candidate_id === selectedCandidateId), [jobLinks, selectedCandidateId]);
  const readiness = buildRunReadiness({
    activeResumeCount: activeResumeCandidateIds.includes(selectedCandidateId) ? 1 : 0,
    candidateId: selectedCandidateId,
    jobLinkId: selectedJobLinkId,
    zohoMailboxCount: zohoCandidateIds.includes(selectedCandidateId) ? 1 : 0
  });

  async function createRun() {
    if (!canCreate) {
      return;
    }

    const nextErrors = validateRunCreation(readiness);
    setRunFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsCreating(true);
    setError(null);
    setSuccess(null);

    const { error: createError } = await supabase.from("application_runs").insert(toApplicationRunPayload(readiness, profile?.id ?? null));

    if (createError) {
      setError(createError.message);
    } else {
      setSuccess("Dry-run queued.");
      await loadRuns();
    }

    setIsCreating(false);
  }

  function selectCandidate(candidateId: string) {
    const firstJobLink = jobLinks.find((jobLink) => jobLink.candidate_id === candidateId);

    setSelectedCandidateId(candidateId);
    setSelectedJobLinkId(firstJobLink?.id ?? "");
    setRunFormErrors({});
    setSuccess(null);
  }

  return (
    <AppShell title="Runs">
      <View className="gap-5">
        <View className="rounded-lg border border-border bg-card p-5">
          <Text className="text-lg font-semibold text-zinc-100">Worker Queue</Text>
          <Text className="mt-2 text-sm leading-6 text-zinc-400">
            Queued dry-runs are visible here for future workers. Phase 10 does not claim, open, scrape, approve, or submit runs.
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            {filters.map((item) => {
              const isActive = filter === item;

              return (
                <Pressable
                  className={`rounded-md border px-3 py-2 ${isActive ? "border-zinc-100 bg-zinc-100" : "border-border bg-transparent"}`}
                  key={item}
                  onPress={() => setFilter(item)}
                >
                  <Text className={`text-sm font-medium ${isActive ? "text-zinc-950" : "text-zinc-300"}`}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {canCreate ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <Text className="text-lg font-semibold text-zinc-100">Queue Dry Run</Text>
            <View className="mt-4 gap-4">
              <View className="gap-2">
                <Text className="text-sm font-medium text-zinc-300">Candidate</Text>
                {candidates.length === 0 ? (
                  <Text className="text-sm text-zinc-400">Add a candidate first.</Text>
                ) : (
                  candidates.map((candidate) => {
                    const isActive = selectedCandidateId === candidate.id;

                    return (
                      <Pressable
                        className={`rounded-md border p-3 ${isActive ? "border-zinc-100 bg-zinc-900" : "border-border bg-transparent"}`}
                        key={candidate.id}
                        onPress={() => selectCandidate(candidate.id)}
                      >
                        <Text className="text-sm font-semibold text-zinc-100">{candidate.full_name}</Text>
                        <Text className="mt-1 text-sm text-zinc-400">{candidate.email}</Text>
                      </Pressable>
                    );
                  })
                )}
              </View>
              <View className="gap-2">
                <Text className="text-sm font-medium text-zinc-300">Job Link</Text>
                {selectableJobLinks.length === 0 ? (
                  <Text className="text-sm text-zinc-400">Add a job link for the selected candidate.</Text>
                ) : (
                  selectableJobLinks.map((jobLink) => {
                    const isActive = selectedJobLinkId === jobLink.id;

                    return (
                      <Pressable
                        className={`rounded-md border p-3 ${isActive ? "border-zinc-100 bg-zinc-900" : "border-border bg-transparent"}`}
                        key={jobLink.id}
                        onPress={() => {
                          setSelectedJobLinkId(jobLink.id);
                          setRunFormErrors({});
                          setSuccess(null);
                        }}
                      >
                        <Text className="text-sm font-semibold text-zinc-100">{jobLink.job_title || "Untitled job"}</Text>
                        <Text className="mt-1 text-sm text-zinc-400">{jobLink.company_name || jobLink.normalized_url}</Text>
                      </Pressable>
                    );
                  })
                )}
                {runFormErrors.jobLinkId ? <Text className="text-sm text-red-300">{runFormErrors.jobLinkId}</Text> : null}
              </View>
              <ReadinessList readiness={readiness} />
              {runFormErrors.readiness ? <Text className="text-sm text-red-300">{runFormErrors.readiness}</Text> : null}
              <Pressable
                className="min-h-11 items-center justify-center rounded-md bg-zinc-100 px-4 disabled:opacity-50"
                disabled={isCreating || !readiness.canCreate}
                onPress={() => void createRun()}
              >
                <Text className="text-sm font-semibold text-zinc-950">{isCreating ? "Queueing..." : "Create Dry Run"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {success ? <Text className="text-sm text-emerald-300">{success}</Text> : null}

        {error ? (
          <View className="rounded-lg border border-red-300 bg-card p-5">
            <Text className="text-sm font-semibold text-red-300">Runs data error</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">{error}</Text>
            <Pressable className="mt-4 min-h-11 items-center justify-center rounded-md border border-border px-4" onPress={() => void loadRuns()}>
              <Text className="text-sm font-semibold text-zinc-100">Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <ActivityIndicator color="#f4f4f5" />
          </View>
        ) : visibleRuns.length === 0 ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <Text className="text-lg font-semibold text-zinc-100">No runs found</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">Create dry-runs from a candidate detail page.</Text>
          </View>
        ) : (
          <View className="gap-3">
            {visibleRuns.map((run) => {
              const candidate = candidatesById.get(run.candidate_id);
              const jobLink = jobLinksById.get(run.job_link_id);

              return <RunCard candidate={candidate} jobLink={jobLink} key={run.id} run={run} />;
            })}
          </View>
        )}
      </View>
    </AppShell>
  );
}

function RunCard({
  candidate,
  jobLink,
  run
}: {
  candidate?: RunCandidate;
  jobLink?: JobLinkRecord;
  run: ApplicationRunRecord;
}) {
  return (
    <View className="rounded-lg border border-border bg-card p-5">
      <View className="gap-3 md:flex-row md:items-start md:justify-between">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-semibold text-zinc-100">{jobLink?.job_title || "Untitled job"}</Text>
          <Text className="mt-1 text-sm text-zinc-400">{jobLink?.company_name || "Company not set"}</Text>
          <Text className="mt-2 text-sm text-zinc-500">{jobLink?.normalized_url || run.job_link_id}</Text>
          <View className="mt-4 gap-2">
            <DetailRow label="Candidate" value={candidate ? `${candidate.full_name} · ${candidate.email}` : run.candidate_id} />
            <DetailRow label="Mode" value={run.mode} />
            <DetailRow label="Current Step" value={run.current_step} />
            <DetailRow label="Readiness" value={run.readiness_score} />
            <DetailRow label="Error" value={run.error_message} />
          </View>
        </View>
        <View className="items-start gap-2 md:items-end">
          <RunStatusBadge status={run.status} />
          <Text className="text-sm text-zinc-500">{new Date(run.created_at).toLocaleString()}</Text>
        </View>
      </View>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-sm text-zinc-500">{label}</Text>
      <Text className="text-sm font-medium text-zinc-100">{value || "Not set"}</Text>
    </View>
  );
}

function ReadinessList({ readiness }: { readiness: ReturnType<typeof buildRunReadiness> }) {
  const items = [
    { label: "Candidate", ready: Boolean(readiness.candidateId) },
    { label: "Active resume", ready: readiness.activeResumeCount > 0 },
    { label: "Zoho mailbox", ready: readiness.zohoMailboxCount > 0 },
    { label: "Job link", ready: Boolean(readiness.jobLinkId) }
  ];

  return (
    <View className="gap-2 rounded-md border border-border p-4">
      {items.map((item) => (
        <View className="flex-row items-center justify-between gap-3" key={item.label}>
          <Text className="text-sm text-zinc-400">{item.label}</Text>
          <Text className={`text-sm font-semibold ${item.ready ? "text-emerald-300" : "text-yellow-200"}`}>
            {item.ready ? "Ready" : "Missing"}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RunStatusBadge({ status }: { status: ApplicationRunRecord["status"] }) {
  const tone = getRunStatusTone(status);
  const toneClass =
    tone === "complete"
      ? "border-emerald-300 text-emerald-200"
      : tone === "blocked"
        ? "border-yellow-300 text-yellow-200"
        : tone === "active"
          ? "border-sky-300 text-sky-200"
          : "border-border text-zinc-300";

  return <Text className={`rounded-md border px-3 py-2 text-sm font-medium ${toneClass}`}>{status}</Text>;
}
