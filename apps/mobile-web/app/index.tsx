import { APP_NAME } from "@applywizz/shared";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View className="flex-1 justify-center bg-background px-6">
      <StatusBar style="light" />
      <View className="gap-3 rounded-xl border border-border bg-card p-5">
        <Text className="text-2xl font-bold text-zinc-100">{APP_NAME}</Text>
        <Text className="text-sm leading-6 text-zinc-400">
          Phase 1 foundation is ready for the operator dashboard.
        </Text>
      </View>
    </View>
  );
}
