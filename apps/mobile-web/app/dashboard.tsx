import { APP_NAME } from "@applywizz/shared";
import { Redirect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useAuth } from "../src/auth/AuthProvider";

export default function DashboardScreen() {
  const { isAdmin, isLoading, isOperator, isViewer, profile, session, signOut } = useAuth();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#f4f4f5" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/login" />;
  }

  return (
    <View className="flex-1 bg-background px-5 py-8">
      <StatusBar style="light" />
      <View className="mx-auto w-full max-w-4xl gap-6">
        <View className="flex-row items-center justify-between gap-4">
          <View>
            <Text className="text-sm font-medium text-zinc-400">{APP_NAME}</Text>
            <Text className="text-2xl font-bold text-zinc-100">Dashboard</Text>
          </View>
          <Pressable className="rounded-md border border-border px-3 py-2" onPress={() => void signOut()}>
            <Text className="text-sm font-semibold text-zinc-100">Log Out</Text>
          </Pressable>
        </View>

        <View className="rounded-lg border border-border bg-card p-5">
          <Text className="text-base font-semibold text-zinc-100">{profile?.full_name ?? profile?.email}</Text>
          <Text className="mt-1 text-sm text-zinc-400">{profile?.email}</Text>
          <Text className="mt-4 text-sm text-zinc-300">
            Role: {isAdmin ? "admin" : isOperator ? "operator" : isViewer ? "viewer" : "unknown"}
          </Text>
        </View>
      </View>
    </View>
  );
}
