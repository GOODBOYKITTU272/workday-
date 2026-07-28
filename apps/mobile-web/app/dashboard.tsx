import { APP_NAME } from "@applywizz/shared";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";

import { AppShell } from "../src/layout/AppShell";

export default function DashboardScreen() {
  return (
    <AppShell title="Dashboard">
      <StatusBar style="light" />
      <View className="rounded-lg border border-border bg-card p-5">
        <Text className="text-sm font-medium text-zinc-400">{APP_NAME}</Text>
        <Text className="mt-2 text-lg font-semibold text-zinc-100">Operator dashboard</Text>
        <Text className="mt-2 text-sm leading-6 text-zinc-400">
          Core navigation is ready. Workflow data appears in later approved phases.
        </Text>
      </View>
    </AppShell>
  );
}
