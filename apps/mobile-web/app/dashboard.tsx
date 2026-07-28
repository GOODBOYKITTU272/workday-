import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppShell } from "../src/layout/AppShell";
import { supabase } from "../src/auth/supabase";
import { buildDashboardCards, type DashboardCounts } from "../src/dashboard/model";

const emptyCounts: DashboardCounts = {
  candidates: 0,
  jobLinks: 0,
  manualReviewOpen: 0,
  runs: 0
};

export default function DashboardScreen() {
  const [counts, setCounts] = useState<DashboardCounts>(emptyCounts);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadCounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [candidates, jobLinks, runs, manualReviewOpen] = await Promise.all([
      supabase.from("candidates").select("id", { count: "exact", head: true }),
      supabase.from("job_links").select("id", { count: "exact", head: true }),
      supabase.from("application_runs").select("id", { count: "exact", head: true }),
      supabase.from("manual_review_items").select("id", { count: "exact", head: true }).eq("status", "open")
    ]);
    const firstError = candidates.error ?? jobLinks.error ?? runs.error ?? manualReviewOpen.error;

    if (firstError) {
      setError(firstError.message);
      setCounts(emptyCounts);
    } else {
      setCounts({
        candidates: candidates.count ?? 0,
        jobLinks: jobLinks.count ?? 0,
        manualReviewOpen: manualReviewOpen.count ?? 0,
        runs: runs.count ?? 0
      });
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  return (
    <AppShell title="Dashboard">
      <StatusBar style="light" />
      <View className="gap-5">
        {error ? (
          <View className="rounded-lg border border-red-300 bg-card p-5">
            <Text className="text-sm font-semibold text-red-300">Dashboard data error</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">{error}</Text>
            <Pressable className="mt-4 min-h-11 items-center justify-center rounded-md border border-border px-4" onPress={() => void loadCounts()}>
              <Text className="text-sm font-semibold text-zinc-100">Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <ActivityIndicator color="#f4f4f5" />
          </View>
        ) : (
          <View className="gap-3 md:flex-row">
            {buildDashboardCards(counts).map((card) => (
              <View className="flex-1 rounded-lg border border-border bg-card p-5" key={card.label}>
                <Text className="text-sm font-medium text-zinc-400">{card.label}</Text>
                <Text className="mt-3 text-3xl font-bold text-zinc-100">{card.value}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </AppShell>
  );
}
