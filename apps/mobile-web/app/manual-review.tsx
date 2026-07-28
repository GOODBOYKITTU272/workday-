import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { CandidateRecord } from "../src/candidates/model";
import type { JobLinkRecord } from "../src/job-links/model";
import { AppShell } from "../src/layout/AppShell";
import type { ManualReviewItemRecord } from "../src/manual-review/model";
import { formatManualReviewCategory, getManualReviewTone } from "../src/manual-review/model";
import { supabase } from "../src/auth/supabase";

const manualReviewColumns =
  "id,application_run_id,candidate_id,job_link_id,review_reason,risk_level,status,post_apply_state,route_reason,tenant_key,hostname,error_code,created_at,updated_at";
const candidateColumns = "id,full_name,email";
const jobLinkColumns = "id,candidate_id,created_by,url,normalized_url,company_name,job_title,workday_tenant_key,source,status,last_run_id,last_error,priority,notes,created_at,updated_at";

type ReviewCandidate = Pick<CandidateRecord, "email" | "full_name" | "id">;

export default function ManualReviewScreen() {
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<ManualReviewItemRecord[]>([]);
  const [jobLinks, setJobLinks] = useState<JobLinkRecord[]>([]);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("manual_review_items")
      .select(manualReviewColumns)
      .eq("item_type", "routing_review")
      .order("created_at", { ascending: false });

    if (loadError) {
      setError(loadError.message);
      setItems([]);
    } else {
      const nextItems = (data ?? []) as ManualReviewItemRecord[];
      const candidateIds = [...new Set(nextItems.map((item) => item.candidate_id))];
      const jobLinkIds = [...new Set(nextItems.map((item) => item.job_link_id))];
      const [{ data: candidateData, error: candidateError }, { data: jobLinkData, error: jobLinkError }] = await Promise.all([
        candidateIds.length ? supabase.from("candidates").select(candidateColumns).in("id", candidateIds) : Promise.resolve({ data: [], error: null }),
        jobLinkIds.length ? supabase.from("job_links").select(jobLinkColumns).in("id", jobLinkIds) : Promise.resolve({ data: [], error: null })
      ]);

      if (candidateError || jobLinkError) {
        setError(candidateError?.message ?? jobLinkError?.message ?? "Manual review metadata failed to load.");
        setCandidates([]);
        setJobLinks([]);
        setItems([]);
      } else {
        setCandidates((candidateData ?? []) as ReviewCandidate[]);
        setJobLinks((jobLinkData ?? []) as JobLinkRecord[]);
        setItems(nextItems);
      }
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  return (
    <AppShell title="Manual Review">
      <View className="gap-5">
        <View className="rounded-lg border border-border bg-card p-5">
          <Text className="text-lg font-semibold text-zinc-100">Routing Review Queue</Text>
          <Text className="mt-2 text-sm leading-6 text-zinc-400">
            Runs that stopped for human review after a safe dry-run. This is a read-only queue: no approval, submit, or
            continue-automation actions happen here.
          </Text>
        </View>

        {error ? (
          <View className="rounded-lg border border-red-300 bg-card p-5">
            <Text className="text-sm font-semibold text-red-300">Manual review data error</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">{error}</Text>
            <Pressable className="mt-4 min-h-11 items-center justify-center rounded-md border border-border px-4" onPress={() => void loadItems()}>
              <Text className="text-sm font-semibold text-zinc-100">Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <ActivityIndicator color="#f4f4f5" />
          </View>
        ) : items.length === 0 ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <Text className="text-lg font-semibold text-zinc-100">No manual review items</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">Runs that need human routing decisions will appear here.</Text>
          </View>
        ) : (
          <View className="gap-3">
            {items.map((item) => {
              const candidate = candidates.find((record) => record.id === item.candidate_id);
              const jobLink = jobLinks.find((record) => record.id === item.job_link_id);

              return <ManualReviewCard candidate={candidate} item={item} jobLink={jobLink} key={item.id} />;
            })}
          </View>
        )}
      </View>
    </AppShell>
  );
}

function ManualReviewCard({ candidate, item, jobLink }: { candidate?: ReviewCandidate; item: ManualReviewItemRecord; jobLink?: JobLinkRecord }) {
  const tone = getManualReviewTone(item.risk_level);
  const toneClass =
    tone === "blocked" ? "border-yellow-300 text-yellow-200" : tone === "attention" ? "border-sky-300 text-sky-200" : "border-border text-zinc-300";

  return (
    <View className="rounded-lg border border-border bg-card p-5">
      <View className="gap-3 md:flex-row md:items-start md:justify-between">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-semibold capitalize text-zinc-100">{formatManualReviewCategory(item.review_reason)}</Text>
          <View className="mt-3 gap-2">
            <DetailRow label="Candidate" value={candidate ? `${candidate.full_name} · ${candidate.email}` : item.candidate_id} />
            <DetailRow label="Job" value={jobLink?.job_title ?? jobLink?.company_name ?? item.job_link_id} />
            <DetailRow label="Status" value={item.status} />
            <DetailRow label="Risk" value={item.risk_level} />
            <DetailRow label="Post-Apply State" value={item.post_apply_state} />
            <DetailRow label="Route Reason" value={item.route_reason} />
            <DetailRow label="Tenant" value={item.tenant_key} />
            <DetailRow label="Hostname" value={item.hostname} />
            <DetailRow label="Error Code" value={item.error_code} />
          </View>
        </View>
        <View className="items-start gap-2 md:items-end">
          <Text className={`rounded-md border px-3 py-2 text-sm font-medium ${toneClass}`}>{item.risk_level}</Text>
          <Text className="text-sm text-zinc-500">{new Date(item.created_at).toLocaleString()}</Text>
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
