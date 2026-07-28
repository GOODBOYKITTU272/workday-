import { Text, View } from "react-native";

import { AppShell } from "./AppShell";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <AppShell title={title}>
      <View className="rounded-lg border border-border bg-card p-5">
        <Text className="text-lg font-semibold text-zinc-100">{title}</Text>
        <Text className="mt-2 text-sm leading-6 text-zinc-400">This section is reserved for a later approved phase.</Text>
      </View>
    </AppShell>
  );
}
