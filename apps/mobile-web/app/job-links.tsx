import { detectWorkdayTenantFromUrl } from "@applywizz/shared";
import { Link, type Href } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useAuth } from "../src/auth/AuthProvider";
import { supabase } from "../src/auth/supabase";
import type { CandidateRecord } from "../src/candidates/model";
import type { JobLinkInput, JobLinkRecord, JobLinkValidationErrors } from "../src/job-links/model";
import { canManageJobLinks, toJobLinkPayload, validateJobLinkInput } from "../src/job-links/model";
import { AppShell } from "../src/layout/AppShell";

const candidateColumns = "id,full_name,email";
const jobLinkColumns =
  "id,candidate_id,created_by,url,normalized_url,company_name,job_title,workday_tenant_key,source,status,last_run_id,last_error,priority,notes,created_at,updated_at";

type JobLinkCandidate = Pick<CandidateRecord, "email" | "full_name" | "id">;

const emptyForm: JobLinkInput = {
  candidateId: "",
  company_name: "",
  job_title: "",
  priority: "0",
  source: "",
  status: "queued",
  url: ""
};

export default function JobLinksScreen() {
  const { profile, role } = useAuth();
  const canEdit = canManageJobLinks(role);
  const [candidates, setCandidates] = useState<JobLinkCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<JobLinkInput>(emptyForm);
  const [formErrors, setFormErrors] = useState<JobLinkValidationErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [jobLinks, setJobLinks] = useState<JobLinkRecord[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  const loadJobLinks = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [{ data: candidateData, error: candidateError }, { data: jobLinkData, error: jobLinkError }] = await Promise.all([
      supabase.from("candidates").select(candidateColumns).order("created_at", { ascending: false }),
      supabase.from("job_links").select(jobLinkColumns).order("created_at", { ascending: false })
    ]);

    if (candidateError || jobLinkError) {
      setError(candidateError?.message ?? jobLinkError?.message ?? "Job link data failed to load.");
      setCandidates([]);
      setJobLinks([]);
    } else {
      const nextCandidates = (candidateData ?? []) as JobLinkCandidate[];

      setCandidates(nextCandidates);
      setJobLinks((jobLinkData ?? []) as JobLinkRecord[]);
      setForm((current) => ({ ...current, candidateId: current.candidateId || nextCandidates[0]?.id || "" }));
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadJobLinks();
  }, [loadJobLinks]);

  function updateField<K extends keyof JobLinkInput>(field: K, value: JobLinkInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
    setSuccess(null);
  }

  async function saveJobLink() {
    if (!canEdit) {
      return;
    }

    const nextErrors = validateJobLinkInput(form);
    setFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    const { error: saveError } = await supabase.from("job_links").insert(toJobLinkPayload(form, profile?.id ?? null));

    if (saveError) {
      setError(saveError.message);
    } else {
      setSuccess("Job link added.");
      setForm({ ...emptyForm, candidateId: form.candidateId });
      await loadJobLinks();
    }

    setIsSaving(false);
  }

  const candidatesById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);

  return (
    <AppShell title="Job Links">
      <View className="gap-5">
        {canEdit ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <Text className="text-lg font-semibold text-zinc-100">Add Workday Job Link</Text>
            <View className="mt-4 gap-4">
              <Field label="Candidate" error={formErrors.candidateId}>
                <View className="gap-2">
                  {candidates.length === 0 ? (
                    <Text className="text-sm text-zinc-400">Add a candidate first.</Text>
                  ) : (
                    candidates.map((candidate) => {
                      const isActive = form.candidateId === candidate.id;

                      return (
                        <Pressable
                          className={`rounded-md border p-3 ${isActive ? "border-zinc-100 bg-zinc-900" : "border-border bg-transparent"}`}
                          key={candidate.id}
                          onPress={() => updateField("candidateId", candidate.id)}
                        >
                          <Text className="text-sm font-semibold text-zinc-100">{candidate.full_name}</Text>
                          <Text className="mt-1 text-sm text-zinc-400">{candidate.email}</Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>
              </Field>
              <Field label="Workday Job URL" error={formErrors.url}>
                <TextInput
                  autoCapitalize="none"
                  className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                  inputMode="url"
                  onChangeText={(value) => updateField("url", value)}
                  placeholder="https://company.wd1.myworkdayjobs.com/..."
                  placeholderTextColor="#71717a"
                  value={form.url}
                />
              </Field>
              <View className="gap-4 md:flex-row">
                <View className="flex-1">
                  <Field label="Company">
                    <TextInput
                      className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                      onChangeText={(value) => updateField("company_name", value)}
                      placeholder="Optional"
                      placeholderTextColor="#71717a"
                      value={form.company_name}
                    />
                  </Field>
                </View>
                <View className="flex-1">
                  <Field label="Job Title">
                    <TextInput
                      className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                      onChangeText={(value) => updateField("job_title", value)}
                      placeholder="Optional"
                      placeholderTextColor="#71717a"
                      value={form.job_title}
                    />
                  </Field>
                </View>
              </View>
              <Pressable
                className="min-h-11 items-center justify-center rounded-md bg-zinc-100 px-4 disabled:opacity-50"
                disabled={isSaving || candidates.length === 0}
                onPress={() => void saveJobLink()}
              >
                <Text className="text-sm font-semibold text-zinc-950">{isSaving ? "Saving..." : "Add Job Link"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {success ? <Text className="text-sm text-emerald-300">{success}</Text> : null}
        {error ? (
          <View className="rounded-lg border border-red-300 bg-card p-5">
            <Text className="text-sm font-semibold text-red-300">Job links data error</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">{error}</Text>
            <Pressable className="mt-4 min-h-11 items-center justify-center rounded-md border border-border px-4" onPress={() => void loadJobLinks()}>
              <Text className="text-sm font-semibold text-zinc-100">Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <ActivityIndicator color="#f4f4f5" />
          </View>
        ) : jobLinks.length === 0 ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <Text className="text-lg font-semibold text-zinc-100">No job links yet</Text>
            <Text className="mt-2 text-sm text-zinc-400">Saved Workday links appear here.</Text>
          </View>
        ) : (
          <View className="gap-3">
            {jobLinks.map((jobLink) => (
              <JobLinkCard candidate={candidatesById.get(jobLink.candidate_id)} jobLink={jobLink} key={jobLink.id} />
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

function JobLinkCard({ candidate, jobLink }: { candidate?: JobLinkCandidate; jobLink: JobLinkRecord }) {
  const detection = detectWorkdayTenantFromUrl(jobLink.url);

  return (
    <View className="rounded-lg border border-border bg-card p-5">
      <View className="gap-3 md:flex-row md:items-start md:justify-between">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-semibold text-zinc-100">{jobLink.job_title || "Untitled job"}</Text>
          <Text className="mt-1 text-sm text-zinc-400">{jobLink.company_name || "Company not set"}</Text>
          <Text className="mt-2 text-sm text-zinc-500">{jobLink.normalized_url}</Text>
          <View className="mt-3 gap-2">
            <DetailRow label="Candidate" value={candidate ? `${candidate.full_name} · ${candidate.email}` : jobLink.candidate_id} />
            <DetailRow label="Tenant" value={jobLink.workday_tenant_key || detection.tenant_key} />
            <DetailRow label="Workday Base URL" value={detection.workday_base_url} />
            <DetailRow label="Status" value={jobLink.status} />
          </View>
        </View>
        <Link href={`/candidates/${jobLink.candidate_id}` as Href} asChild>
          <Pressable className="min-h-10 items-center justify-center rounded-md border border-border px-4">
            <Text className="text-sm font-semibold text-zinc-100">Candidate Detail</Text>
          </Pressable>
        </Link>
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
