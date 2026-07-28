import type { ReactNode } from "react";
import { Link } from "expo-router";
import type { Href } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useAuth } from "../src/auth/AuthProvider";
import type { CandidateInput, CandidateRecord, CandidateStatus, CandidateValidationErrors } from "../src/candidates/model";
import { canManageCandidates, toCandidatePayload, validateCandidateInput } from "../src/candidates/model";
import { AppShell } from "../src/layout/AppShell";
import { supabase } from "../src/auth/supabase";

const candidateColumns =
  "id,created_by,full_name,email,phone,location,target_role,years_experience,status,created_at,updated_at";

const emptyForm: CandidateInput = {
  email: "",
  full_name: "",
  location: "",
  phone: "",
  status: "active",
  target_role: "",
  years_experience: ""
};

const statuses: CandidateStatus[] = ["active", "inactive", "archived"];

export default function CandidatesScreen() {
  const { profile, role } = useAuth();
  const canEdit = canManageCandidates(role);
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CandidateInput>(emptyForm);
  const [formErrors, setFormErrors] = useState<CandidateValidationErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadCandidates = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("candidates")
      .select(candidateColumns)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setCandidates([]);
    } else {
      setCandidates((data ?? []) as CandidateRecord[]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  function updateField<K extends keyof CandidateInput>(field: K, value: CandidateInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
  }

  function startEdit(candidate: CandidateRecord) {
    setEditingId(candidate.id);
    setForm({
      email: candidate.email,
      full_name: candidate.full_name,
      location: candidate.location ?? "",
      phone: candidate.phone ?? "",
      status: candidate.status,
      target_role: candidate.target_role ?? "",
      years_experience: candidate.years_experience == null ? "" : String(candidate.years_experience)
    });
    setFormErrors({});
  }

  async function handleSubmit() {
    if (!canEdit) {
      return;
    }

    const nextErrors = validateCandidateInput(form);
    setFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const payload = toCandidatePayload(form, editingId ? undefined : (profile?.id ?? null));
    const request = editingId
      ? supabase.from("candidates").update(payload).eq("id", editingId)
      : supabase.from("candidates").insert(payload);
    const { error: saveError } = await request;

    if (saveError) {
      setError(saveError.message);
    } else {
      resetForm();
      await loadCandidates();
    }

    setIsSaving(false);
  }

  return (
    <AppShell title="Candidates">
      <View className="gap-5">
        {canEdit ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <Text className="text-lg font-semibold text-zinc-100">{editingId ? "Edit Candidate" : "Add Candidate"}</Text>
            <View className="mt-4 gap-4">
              <Field label="Name" error={formErrors.full_name}>
                <TextInput
                  className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                  onChangeText={(value) => updateField("full_name", value)}
                  placeholder="Candidate name"
                  placeholderTextColor="#71717a"
                  value={form.full_name}
                />
              </Field>
              <Field label="Email" error={formErrors.email}>
                <TextInput
                  autoCapitalize="none"
                  className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                  inputMode="email"
                  onChangeText={(value) => updateField("email", value)}
                  placeholder="candidate@example.com"
                  placeholderTextColor="#71717a"
                  value={form.email}
                />
              </Field>
              <View className="gap-4 md:flex-row">
                <View className="flex-1">
                  <Field label="Phone">
                    <TextInput
                      className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                      onChangeText={(value) => updateField("phone", value)}
                      placeholder="Optional"
                      placeholderTextColor="#71717a"
                      value={form.phone}
                    />
                  </Field>
                </View>
                <View className="flex-1">
                  <Field label="Location">
                    <TextInput
                      className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                      onChangeText={(value) => updateField("location", value)}
                      placeholder="Optional"
                      placeholderTextColor="#71717a"
                      value={form.location}
                    />
                  </Field>
                </View>
              </View>
              <View className="gap-4 md:flex-row">
                <View className="flex-1">
                  <Field label="Target Role">
                    <TextInput
                      className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                      onChangeText={(value) => updateField("target_role", value)}
                      placeholder="Optional"
                      placeholderTextColor="#71717a"
                      value={form.target_role}
                    />
                  </Field>
                </View>
                <View className="flex-1">
                  <Field label="Years Experience" error={formErrors.years_experience}>
                    <TextInput
                      className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                      inputMode="decimal"
                      onChangeText={(value) => updateField("years_experience", value)}
                      placeholder="Optional"
                      placeholderTextColor="#71717a"
                      value={form.years_experience}
                    />
                  </Field>
                </View>
              </View>
              <View className="gap-2">
                <Text className="text-sm font-medium text-zinc-300">Status</Text>
                <View className="flex-row flex-wrap gap-2">
                  {statuses.map((status) => {
                    const isActive = form.status === status;

                    return (
                      <Pressable
                        className={`rounded-md border px-3 py-2 ${isActive ? "border-zinc-100 bg-zinc-100" : "border-border bg-transparent"}`}
                        key={status}
                        onPress={() => updateField("status", status)}
                      >
                        <Text className={`text-sm font-medium ${isActive ? "text-zinc-950" : "text-zinc-300"}`}>{status}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  className="min-h-11 items-center justify-center rounded-md bg-zinc-100 px-4 disabled:opacity-50"
                  disabled={isSaving}
                  onPress={handleSubmit}
                >
                  <Text className="text-sm font-semibold text-zinc-950">{isSaving ? "Saving..." : editingId ? "Save Changes" : "Add Candidate"}</Text>
                </Pressable>
                {editingId ? (
                  <Pressable className="min-h-11 items-center justify-center rounded-md border border-border px-4" onPress={resetForm}>
                    <Text className="text-sm font-semibold text-zinc-100">Cancel</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        ) : (
          <View className="rounded-lg border border-border bg-card p-5">
            <Text className="text-lg font-semibold text-zinc-100">Candidates</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">Viewer role can inspect candidates but cannot add or edit them.</Text>
          </View>
        )}

        {error ? (
          <View className="rounded-lg border border-red-300 bg-card p-5">
            <Text className="text-sm font-semibold text-red-300">Candidate data error</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">{error}</Text>
            <Pressable className="mt-4 min-h-11 items-center justify-center rounded-md border border-border px-4" onPress={() => void loadCandidates()}>
              <Text className="text-sm font-semibold text-zinc-100">Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <ActivityIndicator color="#f4f4f5" />
          </View>
        ) : candidates.length === 0 ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <Text className="text-lg font-semibold text-zinc-100">No candidates yet</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">
              {canEdit ? "Add the first candidate to start preparing dry-run applications." : "No candidate records are available."}
            </Text>
          </View>
        ) : (
          <View className="gap-3">
            {candidates.map((candidate) => (
              <View className="rounded-lg border border-border bg-card p-5" key={candidate.id}>
                <View className="gap-3 md:flex-row md:items-center md:justify-between">
                  <View className="min-w-0 flex-1">
                    <Link href={`/candidates/${candidate.id}` as Href} asChild>
                      <Pressable>
                        <Text className="text-lg font-semibold text-zinc-100">{candidate.full_name}</Text>
                        <Text className="mt-1 text-sm text-zinc-400">{candidate.email}</Text>
                      </Pressable>
                    </Link>
                    <Text className="mt-2 text-sm text-zinc-300">
                      {[candidate.target_role, candidate.location, candidate.phone].filter(Boolean).join(" · ") || "No profile details yet"}
                    </Text>
                    {candidate.years_experience == null ? null : (
                      <Text className="mt-1 text-sm text-zinc-500">{candidate.years_experience} years experience</Text>
                    )}
                  </View>
                  <View className="items-start gap-2 md:items-end">
                    <Text className="rounded-md border border-border px-3 py-2 text-sm font-medium text-zinc-300">{candidate.status}</Text>
                    {canEdit ? (
                      <Pressable className="min-h-10 items-center justify-center rounded-md border border-border px-4" onPress={() => startEdit(candidate)}>
                        <Text className="text-sm font-semibold text-zinc-100">Edit</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </AppShell>
  );
}

function Field({ children, error, label }: { children: ReactNode; error?: string; label: string }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-zinc-300">{label}</Text>
      {children}
      {error ? <Text className="text-sm text-red-300">{error}</Text> : null}
    </View>
  );
}
