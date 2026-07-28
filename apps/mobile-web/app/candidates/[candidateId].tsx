import { Link, Redirect, type Href, useLocalSearchParams } from "expo-router";
import type { ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { useAuth } from "../../src/auth/AuthProvider";
import type { CandidateRecord } from "../../src/candidates/model";
import type { JobLinkInput, JobLinkRecord, JobLinkStatus, JobLinkValidationErrors } from "../../src/job-links/model";
import { canManageJobLinks, normalizeJobUrl, toJobLinkPayload, validateJobLinkInput } from "../../src/job-links/model";
import { AppShell } from "../../src/layout/AppShell";
import type { CandidateResumeRecord } from "../../src/resumes/model";
import {
  buildResumeStoragePath,
  canManageResumes,
  formatFileSize,
  RESUME_BUCKET,
  validateResumeFile
} from "../../src/resumes/model";
import type { ApplicationRunRecord, RunCreationValidationErrors } from "../../src/runs/model";
import { buildRunReadiness, canCreateApplicationRuns, toApplicationRunPayload, validateRunCreation } from "../../src/runs/model";
import { supabase } from "../../src/auth/supabase";
import type { ZohoConnectionStatus, ZohoMailboxInput, ZohoMailboxRecord, ZohoMailboxValidationErrors } from "../../src/zoho/model";
import { canManageZohoMailbox, isMailboxEmailMismatch, toZohoMailboxPayload, validateZohoMailboxInput } from "../../src/zoho/model";

const candidateColumns =
  "id,created_by,full_name,email,phone,location,target_role,years_experience,status,created_at,updated_at";
const resumeColumns =
  "id,candidate_id,storage_bucket,storage_path,file_name,file_type,file_size_bytes,is_active,uploaded_by,notes,created_at,updated_at";
const zohoColumns =
  "id,candidate_id,email,zoho_account_id,token_expires_at,connection_status,last_otp_check_at,last_success_at,last_error,created_at,updated_at";
const jobLinkColumns =
  "id,candidate_id,created_by,url,normalized_url,company_name,job_title,workday_tenant_key,source,status,last_run_id,last_error,priority,notes,created_at,updated_at";
const applicationRunColumns =
  "id,job_link_id,candidate_id,started_by,status,mode,current_step,readiness_score,total_questions_found,total_answers_mapped,total_answers_filled,total_manual_review_items,total_high_risk_items,error_code,error_message,started_at,completed_at,approved_by,approved_at,submitted_at,created_at,updated_at";
const zohoStatuses: ZohoConnectionStatus[] = ["not_connected", "connected", "expired", "failed", "revoked"];
const jobLinkStatuses: JobLinkStatus[] = ["queued", "opened", "login_required", "manual_review_required", "dry_run_complete", "failed", "duplicate", "skipped"];

export default function CandidateDetailScreen() {
  const { candidateId } = useLocalSearchParams<{ candidateId: string }>();
  const { profile, role } = useAuth();
  const canCreateRuns = canCreateApplicationRuns(role);
  const canEdit = canManageResumes(role);
  const canEditJobLinks = canManageJobLinks(role);
  const canEditZoho = canManageZohoMailbox(role);
  const [candidate, setCandidate] = useState<CandidateRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingJobLinkId, setEditingJobLinkId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingJobLink, setIsSavingJobLink] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [jobLinkError, setJobLinkError] = useState<string | null>(null);
  const [jobLinkForm, setJobLinkForm] = useState<JobLinkInput>({ candidateId: candidateId ?? "", status: "queued", url: "" });
  const [jobLinkFormErrors, setJobLinkFormErrors] = useState<JobLinkValidationErrors>({});
  const [jobLinkSuccess, setJobLinkSuccess] = useState<string | null>(null);
  const [jobLinks, setJobLinks] = useState<JobLinkRecord[]>([]);
  const [applicationRuns, setApplicationRuns] = useState<ApplicationRunRecord[]>([]);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [resumes, setResumes] = useState<CandidateResumeRecord[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [runFormErrors, setRunFormErrors] = useState<RunCreationValidationErrors>({});
  const [runSuccess, setRunSuccess] = useState<string | null>(null);
  const [selectedRunJobLinkId, setSelectedRunJobLinkId] = useState("");
  const [zohoError, setZohoError] = useState<string | null>(null);
  const [zohoForm, setZohoForm] = useState<ZohoMailboxInput>({ candidateId: candidateId ?? "", connection_status: "not_connected", email: "" });
  const [zohoFormErrors, setZohoFormErrors] = useState<ZohoMailboxValidationErrors>({});
  const [zohoMailbox, setZohoMailbox] = useState<ZohoMailboxRecord | null>(null);
  const [isSavingZoho, setIsSavingZoho] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!candidateId) {
      setError("Candidate id is required.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const [
      { data: candidateData, error: candidateError },
      { data: resumeData, error: resumeError },
      { data: zohoData, error: zohoFetchError },
      { data: jobLinkData, error: jobLinkFetchError },
      { data: applicationRunData, error: applicationRunFetchError }
    ] = await Promise.all([
      supabase.from("candidates").select(candidateColumns).eq("id", candidateId).single(),
      supabase.from("candidate_resumes").select(resumeColumns).eq("candidate_id", candidateId).order("created_at", { ascending: false }),
      supabase.from("zoho_mailboxes").select(zohoColumns).eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("job_links").select(jobLinkColumns).eq("candidate_id", candidateId).order("priority", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("application_runs").select(applicationRunColumns).eq("candidate_id", candidateId).order("created_at", { ascending: false })
    ]);

    if (candidateError) {
      setError(candidateError.message);
      setCandidate(null);
    } else {
      const nextCandidate = candidateData as CandidateRecord;
      setCandidate(nextCandidate);

      if (!zohoData) {
        setZohoForm({
          candidateId,
          connection_status: "not_connected",
          email: nextCandidate.email,
          last_error: "",
          zoho_account_id: ""
        });
      }
    }

    if (resumeError) {
      setUploadError(resumeError.message);
      setResumes([]);
    } else {
      setResumes((resumeData ?? []) as CandidateResumeRecord[]);
    }

    if (zohoFetchError) {
      setZohoError(zohoFetchError.message);
      setZohoMailbox(null);
    } else {
      const nextMailbox = zohoData as ZohoMailboxRecord | null;
      setZohoError(null);
      setZohoMailbox(nextMailbox);

      if (nextMailbox) {
        setZohoForm({
          candidateId,
          connection_status: nextMailbox.connection_status,
          email: nextMailbox.email,
          last_error: nextMailbox.last_error ?? "",
          zoho_account_id: nextMailbox.zoho_account_id ?? ""
        });
      }
    }

    if (jobLinkFetchError) {
      setJobLinkError(jobLinkFetchError.message);
      setJobLinks([]);
    } else {
      const nextJobLinks = (jobLinkData ?? []) as JobLinkRecord[];
      setJobLinks(nextJobLinks);
      setSelectedRunJobLinkId((current) => current || nextJobLinks[0]?.id || "");
    }

    if (applicationRunFetchError) {
      setRunError(applicationRunFetchError.message);
      setApplicationRuns([]);
    } else {
      setApplicationRuns((applicationRunData ?? []) as ApplicationRunRecord[]);
    }

    setIsLoading(false);
  }, [candidateId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file || !candidateId || !canEdit) {
      return;
    }

    const validationErrors = validateResumeFile({
      candidateId,
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type
    });

    if (validationErrors.file || validationErrors.candidateId) {
      setUploadError(validationErrors.file ?? validationErrors.candidateId ?? null);
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    const fileId = `${Date.now()}`;
    const storagePath = buildResumeStoragePath(candidateId, fileId);
    const { error: uploadErrorResult } = await supabase.storage.from(RESUME_BUCKET).upload(storagePath, file, {
      contentType: "application/pdf",
      upsert: false
    });

    if (uploadErrorResult) {
      setUploadError(uploadErrorResult.message);
      setIsUploading(false);
      return;
    }

    const { data: insertedResume, error: insertError } = await supabase
      .from("candidate_resumes")
      .insert({
        candidate_id: candidateId,
        file_name: file.name,
        file_size_bytes: file.size,
        file_type: "pdf",
        is_active: false,
        storage_bucket: RESUME_BUCKET,
        storage_path: storagePath,
        uploaded_by: profile?.id ?? null
      })
      .select("id")
      .single();

    if (insertError) {
      setUploadError(insertError.message);
    } else {
      await setActiveResume(insertedResume.id);
    }

    setIsUploading(false);
  }

  async function createRun() {
    if (!candidateId || !canCreateRuns) {
      return;
    }

    const readiness = buildRunReadiness({
      activeResumeCount: resumes.filter((resume) => resume.is_active).length,
      candidateId,
      jobLinkId: selectedRunJobLinkId,
      zohoMailboxCount: zohoMailbox ? 1 : 0
    });
    const nextErrors = validateRunCreation(readiness);
    setRunFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsCreatingRun(true);
    setRunError(null);
    setRunSuccess(null);

    const { error: createError } = await supabase
      .from("application_runs")
      .insert(toApplicationRunPayload(readiness, profile?.id ?? null));

    if (createError) {
      setRunError(createError.message);
    } else {
      setRunSuccess("Dry-run queued.");
      await loadDetail();
    }

    setIsCreatingRun(false);
  }

  function resetJobLinkForm() {
    setEditingJobLinkId(null);
    setJobLinkForm({ candidateId: candidateId ?? "", status: "queued", url: "" });
    setJobLinkFormErrors({});
  }

  function startEditJobLink(jobLink: JobLinkRecord) {
    setEditingJobLinkId(jobLink.id);
    setJobLinkForm({
      candidateId: jobLink.candidate_id,
      company_name: jobLink.company_name ?? "",
      job_title: jobLink.job_title ?? "",
      notes: jobLink.notes ?? "",
      priority: String(jobLink.priority),
      source: jobLink.source ?? "",
      status: jobLink.status,
      url: jobLink.url,
      workday_tenant_key: jobLink.workday_tenant_key ?? ""
    });
    setJobLinkFormErrors({});
    setJobLinkSuccess(null);
  }

  function updateJobLinkField<K extends keyof JobLinkInput>(field: K, value: JobLinkInput[K]) {
    setJobLinkForm((current) => ({ ...current, [field]: value }));
    setJobLinkFormErrors((current) => ({ ...current, [field]: undefined }));
    setJobLinkSuccess(null);
  }

  async function saveJobLink() {
    if (!candidateId || !canEditJobLinks) {
      return;
    }

    const nextForm = { ...jobLinkForm, candidateId };
    const nextErrors = validateJobLinkInput(nextForm);
    setJobLinkFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSavingJobLink(true);
    setJobLinkError(null);
    setJobLinkSuccess(null);

    const payload = toJobLinkPayload(nextForm, editingJobLinkId ? undefined : (profile?.id ?? null));
    const request = editingJobLinkId
      ? supabase.from("job_links").update(payload).eq("id", editingJobLinkId)
      : supabase.from("job_links").insert(payload);
    const { error: saveError } = await request;

    if (saveError) {
      setJobLinkError(saveError.message);
    } else {
      setJobLinkSuccess(editingJobLinkId ? "Job link updated." : "Job link added.");
      resetJobLinkForm();
      await loadDetail();
    }

    setIsSavingJobLink(false);
  }

  function updateZohoField<K extends keyof ZohoMailboxInput>(field: K, value: ZohoMailboxInput[K]) {
    setZohoForm((current) => ({ ...current, [field]: value }));
    setZohoFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function saveZohoMailbox() {
    if (!candidateId || !canEditZoho) {
      return;
    }

    const nextForm = { ...zohoForm, candidateId };
    const nextErrors = validateZohoMailboxInput(nextForm);
    setZohoFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSavingZoho(true);
    setZohoError(null);

    const payload = toZohoMailboxPayload(nextForm);
    const request = zohoMailbox
      ? supabase.from("zoho_mailboxes").update(payload).eq("id", zohoMailbox.id)
      : supabase.from("zoho_mailboxes").insert(payload);
    const { error: saveError } = await request;

    if (saveError) {
      setZohoError(saveError.message);
    } else {
      await loadDetail();
    }

    setIsSavingZoho(false);
  }

  async function setActiveResume(resumeId: string) {
    if (!candidateId || !canEdit) {
      return;
    }

    setUploadError(null);
    const { error: deactivateError } = await supabase.from("candidate_resumes").update({ is_active: false }).eq("candidate_id", candidateId);

    if (deactivateError) {
      setUploadError(deactivateError.message);
      return;
    }

    const { error: activateError } = await supabase.from("candidate_resumes").update({ is_active: true }).eq("id", resumeId);

    if (activateError) {
      setUploadError(activateError.message);
    } else {
      await loadDetail();
    }
  }

  if (!candidateId) {
    return <Redirect href={"/candidates" as Href} />;
  }

  return (
    <AppShell title="Candidate Detail">
      <View className="gap-5">
        <Link href={"/candidates" as Href} asChild>
          <Pressable>
            <Text className="text-sm font-semibold text-zinc-300">Back to candidates</Text>
          </Pressable>
        </Link>

        {isLoading ? (
          <View className="rounded-lg border border-border bg-card p-5">
            <ActivityIndicator color="#f4f4f5" />
          </View>
        ) : error ? (
          <View className="rounded-lg border border-red-300 bg-card p-5">
            <Text className="text-sm font-semibold text-red-300">Candidate detail error</Text>
            <Text className="mt-2 text-sm leading-6 text-zinc-400">{error}</Text>
          </View>
        ) : candidate ? (
          <>
            <View className="rounded-lg border border-border bg-card p-5">
              <Text className="text-2xl font-bold text-zinc-100">{candidate.full_name}</Text>
              <Text className="mt-1 text-sm text-zinc-400">{candidate.email}</Text>
              <View className="mt-4 gap-2">
                <DetailRow label="Phone" value={candidate.phone} />
                <DetailRow label="Location" value={candidate.location} />
                <DetailRow label="Target Role" value={candidate.target_role} />
                <DetailRow label="Experience" value={candidate.years_experience == null ? null : `${candidate.years_experience} years`} />
                <DetailRow label="Status" value={candidate.status} />
              </View>
            </View>

            <View className="gap-3">
              {["Overview", "Resumes", "Zoho Email", "Job Links", "Runs", "Manual Review"].map((section) => (
                <View className="rounded-lg border border-border bg-card p-5" key={section}>
                  <Text className="text-lg font-semibold text-zinc-100">{section}</Text>
                  {section === "Overview" ? (
                    <OverviewSection candidate={candidate} />
                  ) : section === "Resumes" ? (
                    <ResumeSection
                      canEdit={canEdit}
                      isUploading={isUploading}
                      onFileChange={handleFileChange}
                      onSetActive={setActiveResume}
                      resumes={resumes}
                      uploadError={uploadError}
                    />
                  ) : section === "Zoho Email" ? (
                    <ZohoSection
                      canEdit={canEditZoho}
                      candidate={candidate}
                      form={zohoForm}
                      formErrors={zohoFormErrors}
                      isSaving={isSavingZoho}
                      mailbox={zohoMailbox}
                      onSave={saveZohoMailbox}
                      onUpdate={updateZohoField}
                      zohoError={zohoError}
                    />
                  ) : section === "Job Links" ? (
                    <JobLinksSection
                      canEdit={canEditJobLinks}
                      editingId={editingJobLinkId}
                      form={jobLinkForm}
                      formErrors={jobLinkFormErrors}
                      isSaving={isSavingJobLink}
                      jobLinks={jobLinks}
                      onCancel={resetJobLinkForm}
                      onEdit={startEditJobLink}
                      onSave={saveJobLink}
                      onUpdate={updateJobLinkField}
                      saveError={jobLinkError}
                      success={jobLinkSuccess}
                    />
                  ) : section === "Runs" ? (
                    <RunsSection
                      activeResumeCount={resumes.filter((resume) => resume.is_active).length}
                      canCreate={canCreateRuns}
                      candidateId={candidate.id}
                      isCreating={isCreatingRun}
                      jobLinks={jobLinks}
                      onCreate={createRun}
                      onSelectJobLink={(jobLinkId) => {
                        setSelectedRunJobLinkId(jobLinkId);
                        setRunFormErrors({});
                        setRunSuccess(null);
                      }}
                      runError={runError}
                      runFormErrors={runFormErrors}
                      runs={applicationRuns}
                      selectedJobLinkId={selectedRunJobLinkId}
                      success={runSuccess}
                      zohoMailboxCount={zohoMailbox ? 1 : 0}
                    />
                  ) : (
                    <Text className="mt-2 text-sm leading-6 text-zinc-400">Placeholder for a later approved phase.</Text>
                  )}
                </View>
              ))}
            </View>
          </>
        ) : null}
      </View>
    </AppShell>
  );
}

function OverviewSection({ candidate }: { candidate: CandidateRecord }) {
  return (
    <View className="mt-4 gap-2">
      <DetailRow label="Candidate Email" value={candidate.email} />
      <DetailRow label="Target Role" value={candidate.target_role} />
      <DetailRow label="Status" value={candidate.status} />
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

function Field({ children, error, label }: { children: ReactNode; error?: string; label: string }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-zinc-300">{label}</Text>
      {children}
      {error ? <Text className="text-sm text-red-300">{error}</Text> : null}
    </View>
  );
}

function ResumeSection({
  canEdit,
  isUploading,
  onFileChange,
  onSetActive,
  resumes,
  uploadError
}: {
  canEdit: boolean;
  isUploading: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSetActive: (resumeId: string) => Promise<void>;
  resumes: CandidateResumeRecord[];
  uploadError: string | null;
}) {
  return (
    <View className="mt-4 gap-4">
      {canEdit ? (
        <View className="gap-2">
          <Text className="text-sm text-zinc-400">Upload a PDF resume. New uploads become active.</Text>
          <input accept="application/pdf" aria-label="Upload PDF resume" disabled={isUploading} onChange={onFileChange} type="file" />
          {isUploading ? <Text className="text-sm text-zinc-400">Uploading...</Text> : null}
        </View>
      ) : (
        <Text className="text-sm text-zinc-400">Viewer role can inspect resume metadata but cannot upload or set active resumes.</Text>
      )}

      {uploadError ? <Text className="text-sm text-red-300">{uploadError}</Text> : null}

      {resumes.length === 0 ? (
        <Text className="text-sm text-zinc-400">No resumes uploaded for this candidate.</Text>
      ) : (
        <View className="gap-3">
          {resumes.map((resume) => (
            <View className="rounded-md border border-border p-4" key={resume.id}>
              <View className="gap-2 md:flex-row md:items-center md:justify-between">
                <View>
                  <Text className="text-base font-semibold text-zinc-100">{resume.file_name}</Text>
                  <Text className="mt-1 text-sm text-zinc-400">
                    {formatFileSize(resume.file_size_bytes)} · {resume.storage_path}
                  </Text>
                </View>
                <View className="items-start gap-2 md:items-end">
                  <Text className={`rounded-md border px-3 py-2 text-sm font-medium ${resume.is_active ? "border-zinc-100 text-zinc-100" : "border-border text-zinc-400"}`}>
                    {resume.is_active ? "Active" : "Inactive"}
                  </Text>
                  {canEdit && !resume.is_active ? (
                    <Pressable className="min-h-10 items-center justify-center rounded-md border border-border px-4" onPress={() => void onSetActive(resume.id)}>
                      <Text className="text-sm font-semibold text-zinc-100">Set Active</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function JobLinksSection({
  canEdit,
  editingId,
  form,
  formErrors,
  isSaving,
  jobLinks,
  onCancel,
  onEdit,
  onSave,
  onUpdate,
  saveError,
  success
}: {
  canEdit: boolean;
  editingId: string | null;
  form: JobLinkInput;
  formErrors: JobLinkValidationErrors;
  isSaving: boolean;
  jobLinks: JobLinkRecord[];
  onCancel: () => void;
  onEdit: (jobLink: JobLinkRecord) => void;
  onSave: () => Promise<void>;
  onUpdate: <K extends keyof JobLinkInput>(field: K, value: JobLinkInput[K]) => void;
  saveError: string | null;
  success: string | null;
}) {
  const normalizedUrl = form.url.trim() ? safeNormalizeUrl(form.url) : null;

  return (
    <View className="mt-4 gap-4">
      {canEdit ? (
        <View className="gap-4">
          <Text className="text-sm text-zinc-400">Paste Workday job links for this candidate. Automation runs are created in a later phase.</Text>
          <Field label="Workday Job URL" error={formErrors.url}>
            <TextInput
              autoCapitalize="none"
              className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
              inputMode="url"
              onChangeText={(value) => onUpdate("url", value)}
              placeholder="https://company.wd1.myworkdayjobs.com/..."
              placeholderTextColor="#71717a"
              value={form.url}
            />
          </Field>
          {normalizedUrl ? <Text className="text-sm text-zinc-500">Normalized: {normalizedUrl}</Text> : null}
          <View className="gap-4 md:flex-row">
            <View className="flex-1">
              <Field label="Company">
                <TextInput
                  className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                  onChangeText={(value) => onUpdate("company_name", value)}
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
                  onChangeText={(value) => onUpdate("job_title", value)}
                  placeholder="Optional"
                  placeholderTextColor="#71717a"
                  value={form.job_title}
                />
              </Field>
            </View>
          </View>
          <View className="gap-4 md:flex-row">
            <View className="flex-1">
              <Field label="Tenant Key">
                <TextInput
                  autoCapitalize="none"
                  className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                  onChangeText={(value) => onUpdate("workday_tenant_key", value)}
                  placeholder="Optional"
                  placeholderTextColor="#71717a"
                  value={form.workday_tenant_key}
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Priority" error={formErrors.priority}>
                <TextInput
                  className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
                  inputMode="numeric"
                  onChangeText={(value) => onUpdate("priority", value)}
                  placeholder="0"
                  placeholderTextColor="#71717a"
                  value={form.priority}
                />
              </Field>
            </View>
          </View>
          <Field label="Source">
            <TextInput
              className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
              onChangeText={(value) => onUpdate("source", value)}
              placeholder="Optional"
              placeholderTextColor="#71717a"
              value={form.source}
            />
          </Field>
          <View className="gap-2">
            <Text className="text-sm font-medium text-zinc-300">Status</Text>
            <View className="flex-row flex-wrap gap-2">
              {jobLinkStatuses.map((status) => {
                const isActive = form.status === status;

                return (
                  <Pressable
                    className={`rounded-md border px-3 py-2 ${isActive ? "border-zinc-100 bg-zinc-100" : "border-border bg-transparent"}`}
                    key={status}
                    onPress={() => onUpdate("status", status)}
                  >
                    <Text className={`text-sm font-medium ${isActive ? "text-zinc-950" : "text-zinc-300"}`}>{status}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Field label="Notes">
            <TextInput
              className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
              multiline
              onChangeText={(value) => onUpdate("notes", value)}
              placeholder="Optional"
              placeholderTextColor="#71717a"
              value={form.notes}
            />
          </Field>
          <View className="flex-row flex-wrap gap-2">
            <Pressable className="min-h-11 items-center justify-center rounded-md bg-zinc-100 px-4 disabled:opacity-50" disabled={isSaving} onPress={() => void onSave()}>
              <Text className="text-sm font-semibold text-zinc-950">{isSaving ? "Saving..." : editingId ? "Save Job Link" : "Add Job Link"}</Text>
            </Pressable>
            {editingId ? (
              <Pressable className="min-h-11 items-center justify-center rounded-md border border-border px-4" onPress={onCancel}>
                <Text className="text-sm font-semibold text-zinc-100">Cancel</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <Text className="text-sm text-zinc-400">Viewer role can inspect job links but cannot add or edit them.</Text>
      )}

      {success ? <Text className="text-sm text-emerald-300">{success}</Text> : null}
      {saveError ? <Text className="text-sm text-red-300">{saveError}</Text> : null}

      {jobLinks.length === 0 ? (
        <Text className="text-sm text-zinc-400">No job links added for this candidate.</Text>
      ) : (
        <View className="gap-3">
          {jobLinks.map((jobLink) => (
            <View className="rounded-md border border-border p-4" key={jobLink.id}>
              <View className="gap-3 md:flex-row md:items-start md:justify-between">
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-semibold text-zinc-100">{jobLink.job_title || "Untitled job"}</Text>
                  <Text className="mt-1 text-sm text-zinc-400">{jobLink.company_name || "Company not set"}</Text>
                  <Text className="mt-2 text-sm text-zinc-500">{jobLink.normalized_url}</Text>
                  <View className="mt-3 gap-2">
                    <DetailRow label="Tenant Key" value={jobLink.workday_tenant_key} />
                    <DetailRow label="Priority" value={String(jobLink.priority)} />
                    <DetailRow label="Source" value={jobLink.source} />
                    <DetailRow label="Last Error" value={jobLink.last_error} />
                  </View>
                </View>
                <View className="items-start gap-2 md:items-end">
                  <JobLinkStatusBadge status={jobLink.status} />
                  {canEdit ? (
                    <Pressable className="min-h-10 items-center justify-center rounded-md border border-border px-4" onPress={() => onEdit(jobLink)}>
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
  );
}

function safeNormalizeUrl(url: string) {
  try {
    return normalizeJobUrl(url);
  } catch {
    return null;
  }
}

function JobLinkStatusBadge({ status }: { status: JobLinkStatus }) {
  const isDone = status === "dry_run_complete";
  const isWarning = status === "failed" || status === "duplicate" || status === "skipped";

  return (
    <Text
      className={`rounded-md border px-3 py-2 text-sm font-medium ${
        isDone ? "border-emerald-300 text-emerald-200" : isWarning ? "border-yellow-300 text-yellow-200" : "border-border text-zinc-300"
      }`}
    >
      {status}
    </Text>
  );
}

function RunsSection({
  activeResumeCount,
  canCreate,
  candidateId,
  isCreating,
  jobLinks,
  onCreate,
  onSelectJobLink,
  runError,
  runFormErrors,
  runs,
  selectedJobLinkId,
  success,
  zohoMailboxCount
}: {
  activeResumeCount: number;
  canCreate: boolean;
  candidateId: string;
  isCreating: boolean;
  jobLinks: JobLinkRecord[];
  onCreate: () => Promise<void>;
  onSelectJobLink: (jobLinkId: string) => void;
  runError: string | null;
  runFormErrors: RunCreationValidationErrors;
  runs: ApplicationRunRecord[];
  selectedJobLinkId: string;
  success: string | null;
  zohoMailboxCount: number;
}) {
  const readiness = buildRunReadiness({
    activeResumeCount,
    candidateId,
    jobLinkId: selectedJobLinkId,
    zohoMailboxCount
  });

  return (
    <View className="mt-4 gap-4">
      {canCreate ? (
        <View className="gap-4">
          <Text className="text-sm text-zinc-400">Create queued dry-run records for the future worker. This does not open the job link.</Text>
          <View className="gap-2">
            <Text className="text-sm font-medium text-zinc-300">Job Link</Text>
            <View className="gap-2">
              {jobLinks.length === 0 ? (
                <Text className="text-sm text-zinc-400">Add a job link before creating a run.</Text>
              ) : (
                jobLinks.map((jobLink) => {
                  const isActive = selectedJobLinkId === jobLink.id;

                  return (
                    <Pressable
                      className={`rounded-md border p-3 ${isActive ? "border-zinc-100 bg-zinc-900" : "border-border bg-transparent"}`}
                      key={jobLink.id}
                      onPress={() => onSelectJobLink(jobLink.id)}
                    >
                      <Text className="text-sm font-semibold text-zinc-100">{jobLink.job_title || "Untitled job"}</Text>
                      <Text className="mt-1 text-sm text-zinc-400">{jobLink.company_name || jobLink.normalized_url}</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
            {runFormErrors.jobLinkId ? <Text className="text-sm text-red-300">{runFormErrors.jobLinkId}</Text> : null}
          </View>
          <ReadinessList readiness={readiness} />
          {runFormErrors.readiness ? <Text className="text-sm text-red-300">{runFormErrors.readiness}</Text> : null}
          <Pressable
            className="min-h-11 items-center justify-center rounded-md bg-zinc-100 px-4 disabled:opacity-50"
            disabled={isCreating || !readiness.canCreate}
            onPress={() => void onCreate()}
          >
            <Text className="text-sm font-semibold text-zinc-950">{isCreating ? "Queueing..." : "Create Dry Run"}</Text>
          </Pressable>
        </View>
      ) : (
        <Text className="text-sm text-zinc-400">Viewer role can inspect application runs but cannot create them.</Text>
      )}

      {success ? <Text className="text-sm text-emerald-300">{success}</Text> : null}
      {runError ? <Text className="text-sm text-red-300">{runError}</Text> : null}

      {runs.length === 0 ? (
        <Text className="text-sm text-zinc-400">No application runs queued for this candidate.</Text>
      ) : (
        <View className="gap-3">
          {runs.map((run) => {
            const jobLink = jobLinks.find((item) => item.id === run.job_link_id);

            return (
              <View className="rounded-md border border-border p-4" key={run.id}>
                <View className="gap-3 md:flex-row md:items-start md:justify-between">
                  <View className="min-w-0 flex-1">
                    <Text className="text-base font-semibold text-zinc-100">{jobLink?.job_title || "Untitled job"}</Text>
                    <Text className="mt-1 text-sm text-zinc-400">{jobLink?.company_name || "Company not set"}</Text>
                    <Text className="mt-2 text-sm text-zinc-500">{jobLink?.normalized_url || run.job_link_id}</Text>
                    <View className="mt-3 gap-2">
                      <DetailRow label="Mode" value={run.mode} />
                      <DetailRow label="Current Step" value={run.current_step} />
                      <DetailRow label="Readiness" value={run.readiness_score} />
                      <DetailRow label="Error" value={run.error_message} />
                    </View>
                  </View>
                  <View className="items-start gap-2 md:items-end">
                    <RunStatusBadge status={run.status} />
                    <Text className="text-sm text-zinc-500">{new Date(run.created_at).toLocaleString()}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function ReadinessList({ readiness }: { readiness: ReturnType<typeof buildRunReadiness> }) {
  const items = [
    { label: "Candidate", ready: Boolean(readiness.candidateId) },
    { label: "Active resume", ready: readiness.activeResumeCount > 0 },
    { label: "Zoho mailbox", ready: readiness.zohoMailboxCount > 0 },
    { label: "Job link", ready: Boolean(readiness.jobLinkId) }
  ];

  return (
    <View className="gap-2 rounded-md border border-border p-4">
      {items.map((item) => (
        <View className="flex-row items-center justify-between gap-3" key={item.label}>
          <Text className="text-sm text-zinc-400">{item.label}</Text>
          <Text className={`text-sm font-semibold ${item.ready ? "text-emerald-300" : "text-yellow-200"}`}>
            {item.ready ? "Ready" : "Missing"}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RunStatusBadge({ status }: { status: ApplicationRunRecord["status"] }) {
  const isDone = status === "dry_run_complete";
  const isBlocked = status === "failed" || status === "stopped" || status === "manual_review_required";

  return (
    <Text
      className={`rounded-md border px-3 py-2 text-sm font-medium ${
        isDone ? "border-emerald-300 text-emerald-200" : isBlocked ? "border-yellow-300 text-yellow-200" : "border-border text-zinc-300"
      }`}
    >
      {status}
    </Text>
  );
}

function ZohoSection({
  canEdit,
  candidate,
  form,
  formErrors,
  isSaving,
  mailbox,
  onSave,
  onUpdate,
  zohoError
}: {
  canEdit: boolean;
  candidate: CandidateRecord;
  form: ZohoMailboxInput;
  formErrors: ZohoMailboxValidationErrors;
  isSaving: boolean;
  mailbox: ZohoMailboxRecord | null;
  onSave: () => Promise<void>;
  onUpdate: <K extends keyof ZohoMailboxInput>(field: K, value: ZohoMailboxInput[K]) => void;
  zohoError: string | null;
}) {
  const mailboxEmail = mailbox?.email ?? form.email;
  const hasMismatch = isMailboxEmailMismatch(candidate.email, mailboxEmail);

  return (
    <View className="mt-4 gap-4">
      <View className="gap-3 md:flex-row md:items-center md:justify-between">
        <View>
          <Text className="text-sm text-zinc-400">Candidate email</Text>
          <Text className="mt-1 text-base font-semibold text-zinc-100">{candidate.email}</Text>
        </View>
        <StatusBadge status={mailbox?.connection_status ?? "not_connected"} />
      </View>

      {hasMismatch ? (
        <View className="rounded-md border border-yellow-300 p-4">
          <Text className="text-sm font-semibold text-yellow-200">Mailbox email does not match candidate email.</Text>
          <Text className="mt-1 text-sm text-zinc-400">Workday accounts should use the candidate email.</Text>
        </View>
      ) : null}

      {zohoError ? <Text className="text-sm text-red-300">{zohoError}</Text> : null}

      {canEdit ? (
        <View className="gap-4">
          <Field label="Zoho Mailbox Email" error={formErrors.email}>
            <TextInput
              autoCapitalize="none"
              className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
              inputMode="email"
              onChangeText={(value) => onUpdate("email", value)}
              placeholder="candidate@example.com"
              placeholderTextColor="#71717a"
              value={form.email}
            />
          </Field>
          <Field label="Zoho Account ID">
            <TextInput
              className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
              onChangeText={(value) => onUpdate("zoho_account_id", value)}
              placeholder="Optional"
              placeholderTextColor="#71717a"
              value={form.zoho_account_id}
            />
          </Field>
          <View className="gap-2">
            <Text className="text-sm font-medium text-zinc-300">Connection Status</Text>
            <View className="flex-row flex-wrap gap-2">
              {zohoStatuses.map((status) => {
                const isActive = form.connection_status === status;

                return (
                  <Pressable
                    className={`rounded-md border px-3 py-2 ${isActive ? "border-zinc-100 bg-zinc-100" : "border-border bg-transparent"}`}
                    key={status}
                    onPress={() => onUpdate("connection_status", status)}
                  >
                    <Text className={`text-sm font-medium ${isActive ? "text-zinc-950" : "text-zinc-300"}`}>{status}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Field label="Last Error">
            <TextInput
              className="rounded-md border border-border bg-zinc-950 px-3 py-3 text-base text-zinc-100"
              multiline
              onChangeText={(value) => onUpdate("last_error", value)}
              placeholder="Optional status note"
              placeholderTextColor="#71717a"
              value={form.last_error}
            />
          </Field>
          <Pressable className="min-h-11 items-center justify-center rounded-md bg-zinc-100 px-4 disabled:opacity-50" disabled={isSaving} onPress={() => void onSave()}>
            <Text className="text-sm font-semibold text-zinc-950">{isSaving ? "Saving..." : mailbox ? "Save Zoho Metadata" : "Add Zoho Mailbox"}</Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-2">
          <Text className="text-sm text-zinc-400">Viewer role can inspect mailbox metadata but cannot edit it.</Text>
          <DetailRow label="Mailbox Email" value={mailbox?.email ?? null} />
          <DetailRow label="Zoho Account ID" value={mailbox?.zoho_account_id ?? null} />
          <DetailRow label="Last Success" value={mailbox?.last_success_at ?? null} />
          <DetailRow label="Last Error" value={mailbox?.last_error ?? null} />
        </View>
      )}
    </View>
  );
}

function StatusBadge({ status }: { status: ZohoConnectionStatus }) {
  const isConnected = status === "connected";
  const isWarning = status === "expired" || status === "failed" || status === "revoked";

  return (
    <Text
      className={`rounded-md border px-3 py-2 text-sm font-medium ${
        isConnected ? "border-emerald-300 text-emerald-200" : isWarning ? "border-yellow-300 text-yellow-200" : "border-border text-zinc-300"
      }`}
    >
      {status}
    </Text>
  );
}
