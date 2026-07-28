import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppShell } from "../src/layout/AppShell";
import type { ManualReviewItemRecord } from "../src/manual-review/model";
import { formatManualReviewCategory, getManualReviewTone } from "../src/manual-review/model";
import { supabase } from "../src/auth/supabase";

const manualReviewColumns =
  "id,application_run_id,candidate_id,job_link_id,review_reason,risk_level,status,post_apply_state,route_reason,tenant_key,hostname,error_code,created_at,updated_at";

export default function ManualReviewScreen() {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<ManualReviewItemRecord[]>([]);

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
      setItems((data ?? []) as ManualReviewItemRecord[]);
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
            {items.map((item) => (
              <ManualReviewCard item={item} key={item.id} />
            ))}
          </View>
        )}
      </View>
    </AppShell>
  );
}

function ManualReviewCard({ item }: { item: ManualReviewItemRecord }) {
  const tone = getManualReviewTone(item.risk_level);
  const toneClass =
    tone === "blocked" ? "border-yellow-300 text-yellow-200" : tone === "attention" ? "border-sky-300 text-sky-200" : "border-border text-zinc-300";

  return (
    <View className="rounded-lg border border-border bg-card p-5">
      <View className="gap-3 md:flex-row md:items-start md:justify-between">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-semibold capitalize text-zinc-100">{formatManualReviewCategory(item.review_reason)}</Text>
          <View className="mt-3 gap-2">
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
