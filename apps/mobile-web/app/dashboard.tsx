import { APP_NAME } from "@applywizz/shared";
import { Redirect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useAuth } from "../src/auth/AuthProvider";
import { getAuthRedirect, hasActiveProfile } from "../src/auth/model";

export default function DashboardScreen() {
  const { error, isAdmin, isLoading, isOperator, isViewer, profile, session, signOut } = useAuth();
  const redirect = getAuthRedirect({ hasSession: Boolean(session), isLoading, pathname: "/dashboard" });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#f4f4f5" />
      </View>
    );
  }

  if (redirect) {
    return <Redirect href={redirect} />;
  }

  if (!hasActiveProfile(profile)) {
    return (
      <View className="flex-1 justify-center bg-background px-5">
        <StatusBar style="light" />
        <View className="w-full max-w-md self-center rounded-lg border border-border bg-card p-5">
          <Text className="text-xl font-bold text-zinc-100">Profile Required</Text>
          <Text className="mt-3 text-sm leading-6 text-zinc-400">
            Your login is valid, but no active ApplyWizz user profile is available.
          </Text>
          {error ? <Text className="mt-3 text-sm text-red-300">{error}</Text> : null}
          <Pressable className="mt-6 min-h-12 items-center justify-center rounded-md bg-zinc-100 px-4" onPress={() => void signOut()}>
            <Text className="text-sm font-semibold text-zinc-950">Log Out</Text>
          </Pressable>
        </View>
      </View>
    );
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
