import { APP_NAME } from "@applywizz/shared";
import { Redirect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useAuth } from "../src/auth/AuthProvider";

export default function LoginScreen() {
  const { error, isConfigured, isLoading, session, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!isLoading && session) {
    return <Redirect href="/dashboard" />;
  }

  async function handleSubmit() {
    setFormError(null);

    if (!email.trim() || !password) {
      setFormError("Email and password are required.");
      return;
    }

    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (signInError) {
      setFormError(signInError instanceof Error ? signInError.message : "Login failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const message = formError ?? error;

  return (
    <View className="flex-1 justify-center bg-background px-5">
      <StatusBar style="light" />
      <View className="w-full max-w-md self-center rounded-lg border border-border bg-card p-5">
        <Text className="text-xl font-bold text-zinc-100">{APP_NAME}</Text>
        <View className="mt-6 gap-4">
          <View className="gap-2">
            <Text className="text-sm font-medium text-zinc-300">Email</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
              editable={!isSubmitting && isConfigured}
              inputMode="email"
              onChangeText={setEmail}
              placeholder="operator@example.com"
              placeholderTextColor="#71717a"
              value={email}
            />
          </View>
          <View className="gap-2">
            <Text className="text-sm font-medium text-zinc-300">Password</Text>
            <TextInput
              autoComplete="password"
              className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
              editable={!isSubmitting && isConfigured}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor="#71717a"
              secureTextEntry
              value={password}
            />
          </View>
          {message ? <Text className="text-sm text-red-300">{message}</Text> : null}
          <Pressable
            className="min-h-12 items-center justify-center rounded-md bg-zinc-100 px-4 disabled:opacity-50"
            disabled={isSubmitting || isLoading || !isConfigured}
            onPress={handleSubmit}
          >
            {isSubmitting || isLoading ? (
              <ActivityIndicator color="#18181b" />
            ) : (
              <Text className="text-sm font-semibold text-zinc-950">Log In</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
