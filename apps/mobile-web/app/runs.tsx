import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { CandidateRecord } from "../src/candidates/model";
import type { JobLinkRecord } from "../src/job-links/model";
import { AppShell } from "../src/layout/AppShell";
import type { ApplicationRunRecord, RunStatusFilter } from "../src/runs/model";
import { getRunStatusTone, isRunInStatusFilter } from "../src/runs/model";
import { supabase } from "../src/auth/supabase";

const applicationRunColumns =
  "id,job_link_id,candidate_id,started_by,status,mode,current_step,readiness_score,total_questions_found,total_answers_mapped,total_answers_filled,total_manual_review_items,total_high_risk_items,error_code,error_message,started_at,completed_at,approved_by,approved_at,submitted_at,created_at,updated_at";
const candidateColumns = "id,full_name,email";
const jobLinkColumns = "id,candidate_id,created_by,url,normalized_url,company_name,job_title,workday_tenant_key,source,status,last_run_id,last_error,priority,notes,created_at,updated_at";
const filters: RunStatusFilter[] = ["all", "queued", "running", "failed", "dry_run_complete", "manual_review_required"];

type RunCandidate = Pick<CandidateRecord, "email" | "full_name" | "id">;

export default function RunsScreen() {
  const [candidates, setCandidates] = useState<RunCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RunStatusFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [jobLinks, setJobLinks] = useState<JobLinkRecord[]>([]);
  const [runs, setRuns] = useState<ApplicationRunRecord[]>([]);

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data: runData, error: runError } = await supabase
      .from("application_runs")
      .select(applicationRunColumns)
      .order("created_at", { ascending: false });

    if (runError) {
      setError(runError.message);
      setRuns([]);
      setCandidates([]);
      setJobLinks([]);
      setIsLoading(false);
      return;
    }

    const nextRuns = (runData ?? []) as ApplicationRunRecord[];
    setRuns(nextRuns);

    const candidateIds = [...new Set(nextRuns.map((run) => run.candidate_id))];
    const jobLinkIds = [...new Set(nextRuns.map((run) => run.job_link_id))];

    const [{ data: candidateData, error: candidateError }, { data: jobLinkData, error: jobLinkError }] = await Promise.all([
      candidateIds.length
        ? supabase.from("candidates").select(candidateColumns).in("id", candidateIds)
        : Promise.resolve({ data: [], error: null }),
      jobLinkIds.length
        ? supabase.from("job_links").select(jobLinkColumns).in("id", jobLinkIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (candidateError || jobLinkError) {
      setError(candidateError?.message ?? jobLinkError?.message ?? "Run metadata failed to load.");
      setCandidates([]);
      setJobLinks([]);
    } else {
      setCandidates((candidateData ?? []) as RunCandidate[]);
      setJobLinks((jobLinkData ?? []) as JobLinkRecord[]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const visibleRuns = useMemo(() => runs.filter((run) => isRunInStatusFilter(run.status, filter)), [filter, runs]);
  const candidatesById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const jobLinksById = useMemo(() => new Map(jobLinks.map((jobLink) => [jobLink.id, jobLink])), [jobLinks]);

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
