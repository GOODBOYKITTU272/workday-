import { Link, Redirect, type Href, useLocalSearchParams } from "expo-router";
import type { ChangeEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useAuth } from "../../src/auth/AuthProvider";
import type { CandidateRecord } from "../../src/candidates/model";
import { AppShell } from "../../src/layout/AppShell";
import type { CandidateResumeRecord } from "../../src/resumes/model";
import {
  buildResumeStoragePath,
  canManageResumes,
  formatFileSize,
  RESUME_BUCKET,
  validateResumeFile
} from "../../src/resumes/model";
import { supabase } from "../../src/auth/supabase";

const candidateColumns =
  "id,created_by,full_name,email,phone,location,target_role,years_experience,status,created_at,updated_at";
const resumeColumns =
  "id,candidate_id,storage_bucket,storage_path,file_name,file_type,file_size_bytes,is_active,uploaded_by,notes,created_at,updated_at";

export default function CandidateDetailScreen() {
  const { candidateId } = useLocalSearchParams<{ candidateId: string }>();
  const { profile, role } = useAuth();
  const canEdit = canManageResumes(role);
  const [candidate, setCandidate] = useState<CandidateRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [resumes, setResumes] = useState<CandidateResumeRecord[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!candidateId) {
      setError("Candidate id is required.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const [{ data: candidateData, error: candidateError }, { data: resumeData, error: resumeError }] = await Promise.all([
      supabase.from("candidates").select(candidateColumns).eq("id", candidateId).single(),
      supabase.from("candidate_resumes").select(resumeColumns).eq("candidate_id", candidateId).order("created_at", { ascending: false })
    ]);

    if (candidateError) {
      setError(candidateError.message);
      setCandidate(null);
    } else {
      setCandidate(candidateData as CandidateRecord);
    }

    if (resumeError) {
      setUploadError(resumeError.message);
      setResumes([]);
    } else {
      setResumes((resumeData ?? []) as CandidateResumeRecord[]);
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
              {["Overview", "Resumes", "Job Links", "Runs", "Manual Review"].map((section) => (
                <View className="rounded-lg border border-border bg-card p-5" key={section}>
                  <Text className="text-lg font-semibold text-zinc-100">{section}</Text>
                  {section === "Resumes" ? (
                    <ResumeSection
                      canEdit={canEdit}
                      isUploading={isUploading}
                      onFileChange={handleFileChange}
                      onSetActive={setActiveResume}
                      resumes={resumes}
                      uploadError={uploadError}
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

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-sm text-zinc-500">{label}</Text>
      <Text className="text-sm font-medium text-zinc-100">{value || "Not set"}</Text>
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
