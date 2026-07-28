import type { AppRole } from "../auth/model";

export const RESUME_BUCKET = "candidate-resumes";
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;

export type CandidateResumeRecord = {
  id: string;
  candidate_id: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  file_type: "pdf" | "doc" | "docx";
  file_size_bytes: number | null;
  is_active: boolean;
  uploaded_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ResumeFileInput = {
  candidateId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
};

export type ResumeValidationErrors = {
  candidateId?: string;
  file?: string;
};

export function canManageResumes(role: AppRole | null | undefined) {
  return role === "admin" || role === "operator";
}

export function validateResumeFile(input: ResumeFileInput): ResumeValidationErrors {
  const errors: ResumeValidationErrors = {};

  if (!input.candidateId) {
    errors.candidateId = "Candidate is required.";
  }

  if (!input.fileName) {
    errors.file = "PDF resume is required.";
  } else if (input.mimeType !== "application/pdf" && !input.fileName.toLowerCase().endsWith(".pdf")) {
    errors.file = "Only PDF resumes are supported in Phase 6.";
  } else if (input.fileSizeBytes > MAX_RESUME_BYTES) {
    errors.file = "Resume PDF must be 10 MB or smaller.";
  }

  return errors;
}

export function buildResumeStoragePath(candidateId: string, fileId: string) {
  return `${candidateId}/${fileId}.pdf`;
}

export function formatFileSize(bytes: number | null) {
  if (bytes == null) {
    return "Unknown size";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
