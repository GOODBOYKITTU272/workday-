import { APP_NAME } from "@applywizz/shared";
import { Link, Redirect, type Href, usePathname } from "expo-router";
import {
  Banknote,
  BriefcaseBusiness,
  ClipboardCheck,
  Gauge,
  ListChecks,
  LogOut,
  Settings,
  Users
} from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { getAuthRedirect, hasActiveProfile } from "../auth/model";
import type { NavigationItemId } from "../navigation/model";
import { getActiveNavItem, navigationItems } from "../navigation/model";

const icons: Record<NavigationItemId, ComponentType<{ color?: string; size?: number }>> = {
  "answer-bank": Banknote,
  candidates: Users,
  dashboard: Gauge,
  "job-links": BriefcaseBusiness,
  "manual-review": ClipboardCheck,
  runs: ListChecks,
  settings: Settings
};

export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const pathname = usePathname();
  const { error, profile, role, session, signOut, isLoading } = useAuth();
  const redirect = getAuthRedirect({ hasSession: Boolean(session), isLoading, pathname });
  const activeItem = getActiveNavItem(pathname);
  const appEnv = process.env.EXPO_PUBLIC_APP_ENV ?? "local";

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
    <View className="flex-1 bg-background md:flex-row">
      <View className="border-b border-border bg-card px-3 py-3 md:w-64 md:border-b-0 md:border-r md:px-4 md:py-5">
        <View className="mb-4 gap-1 px-2">
          <Text className="text-base font-bold text-zinc-100">{APP_NAME}</Text>
          <Text className="text-xs text-zinc-500">Workday dry-run engine</Text>
        </View>
        <ScrollView horizontal className="md:flex-1" contentContainerClassName="gap-2 md:flex-col md:gap-1">
          {navigationItems.map((item) => {
            const Icon = icons[item.id];
            const isActive = item.id === activeItem;

            return (
              <Link href={item.href as Href} key={item.id} asChild>
                <Pressable
                  className={`min-h-11 flex-row items-center gap-3 rounded-md px-3 py-2 ${
                    isActive ? "bg-zinc-100" : "bg-transparent"
                  }`}
                >
                  <Icon color={isActive ? "#18181b" : "#a1a1aa"} size={18} />
                  <Text className={`text-sm font-medium ${isActive ? "text-zinc-950" : "text-zinc-300"}`}>{item.label}</Text>
                </Pressable>
              </Link>
            );
          })}
        </ScrollView>
      </View>

      <View className="min-w-0 flex-1">
        <View className="border-b border-border bg-background px-5 py-4">
          <View className="flex-row flex-wrap items-center justify-between gap-3">
            <View>
              <Text className="text-xs font-medium uppercase text-zinc-500">{appEnv}</Text>
              <Text className="text-xl font-bold text-zinc-100">{title}</Text>
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              <View className="rounded-md border border-border px-3 py-2">
                <Text className="text-xs font-medium text-zinc-300">Worker: standby</Text>
              </View>
              <View className="rounded-md border border-border px-3 py-2">
                <Text className="text-xs font-medium text-zinc-300">{role ?? "unknown"}</Text>
              </View>
              <Pressable className="min-h-10 flex-row items-center gap-2 rounded-md border border-border px-3" onPress={() => void signOut()}>
                <LogOut color="#e4e4e7" size={16} />
                <Text className="text-xs font-semibold text-zinc-100">Log Out</Text>
              </Pressable>
            </View>
          </View>
          <Text className="mt-2 text-sm text-zinc-500">{profile.full_name || profile.email}</Text>
        </View>
        <ScrollView className="flex-1" contentContainerClassName="p-5">
          {children}
        </ScrollView>
      </View>
    </View>
  );
}
