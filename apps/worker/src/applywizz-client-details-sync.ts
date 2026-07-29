import type { SupabaseClient } from "@supabase/supabase-js";

export type ApplyWizzClientDetails = {
  additional_information?: unknown;
  applywizz_id?: unknown;
  client?: unknown;
  experience?: unknown;
  linked_in_url?: unknown;
  personal_email?: unknown;
  resume_url?: unknown;
  role?: unknown;
  salary_range?: unknown;
  sponsorship?: unknown;
  state_of_residence?: unknown;
  willing_to_relocate?: unknown;
  work_auth_details?: unknown;
  [key: string]: unknown;
};

export type ApplyWizzClientDetailsCandidatePayload = {
  applywizz_client_id: string;
  expected_salary: string | null;
  external_resume_source: "applywizz_client_details" | null;
  external_resume_url: string | null;
  linkedin_url: string | null;
  location: string | null;
  relocation_preference: string | null;
  sponsorship_requirement: string | null;
  target_role: string | null;
  work_authorization: string | null;
  years_experience: number | null;
};

export type ApplyWizzClientDetailsInvalidReason = "missing_client" | "missing_applywizz_id" | "invalid_applywizz_id" | "missing_personal_email" | "invalid_personal_email";

export type ApplyWizzClientDetailsMappingResult = { ok: true; payload: ApplyWizzClientDetailsCandidatePayload } | { ok: false; reason: ApplyWizzClientDetailsInvalidReason };

export type ApplyWizzClientDetailsSyncSummary = {
  applywizz_id: string;
  attached_by_email: number;
  matched_by_id: number;
  skipped_ambiguous: number;
  skipped_invalid: number;
  skipped_invalid_reason?: ApplyWizzClientDetailsInvalidReason;
  skipped_no_match: number;
  updated: number;
};

export type ApplyWizzClientDetailsCandidateStore = {
  findByApplyWizzClientId: (applywizzClientId: string) => Promise<Array<{ id: string }>>;
  findUnlinkedByEmail: (email: string) => Promise<Array<{ id: string }>>;
  updateById: (id: string, payload: ApplyWizzClientDetailsCandidatePayload) => Promise<void>;
};

export type ApplyWizzClientDetailsSyncInput = {
  applywizzId: string;
  fetchDetails: (applywizzId: string) => Promise<ApplyWizzClientDetails>;
  store: ApplyWizzClientDetailsCandidateStore;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ApplyWizzClientDetailsSyncError extends Error {
  readonly code = "APPLYWIZZ_CLIENT_DETAILS_SYNC_FAILED";
  readonly supabaseCode?: string;

  constructor(supabaseCode?: string) {
    super("APPLYWIZZ_CLIENT_DETAILS_SYNC_FAILED");
    this.supabaseCode = supabaseCode;
  }
}

export function mapApplyWizzClientDetailsToCandidate(details: ApplyWizzClientDetails, applywizzId: string): ApplyWizzClientDetailsMappingResult {
  const safeApplyWizzId = safeApplyWizzClientId(applywizzId);

  if (!safeApplyWizzId) {
    return { ok: false, reason: "invalid_applywizz_id" };
  }

  const normalized = normalizeApplyWizzClientDetails(details);

  if (!normalized.ok) {
    return normalized;
  }

  const externalResumeUrl = safeUrl(normalized.resumeUrl);

  return {
    ok: true,
    payload: {
      applywizz_client_id: normalized.applywizzId,
      expected_salary: safeString(normalized.salaryRange) || null,
      external_resume_source: externalResumeUrl ? "applywizz_client_details" : null,
      external_resume_url: externalResumeUrl,
      linkedin_url: safeUrl(normalized.linkedInUrl),
      location: safeString(normalized.stateOfResidence) || null,
      relocation_preference: safeString(normalized.willingToRelocate) || null,
      sponsorship_requirement: safeString(normalized.sponsorship) || null,
      target_role: safeString(normalized.role) || null,
      work_authorization: safeString(normalized.workAuthDetails) || null,
      years_experience: safeNumber(normalized.experience)
    }
  };
}

export async function syncApplyWizzClientDetails({ applywizzId, fetchDetails, store }: ApplyWizzClientDetailsSyncInput): Promise<ApplyWizzClientDetailsSyncSummary> {
  const safeApplyWizzId = safeApplyWizzClientId(applywizzId);
  const summary = createSummary(safeApplyWizzId || safeString(applywizzId));

  if (!safeApplyWizzId) {
    summary.skipped_invalid = 1;
    summary.skipped_invalid_reason = "invalid_applywizz_id";

    return summary;
  }

  const details = await fetchDetails(safeApplyWizzId);
  const normalized = normalizeApplyWizzClientDetails(details);

  if (!normalized.ok) {
    summary.skipped_invalid = 1;
    summary.skipped_invalid_reason = normalized.reason;

    return summary;
  }

  const mapped = mapApplyWizzClientDetailsToCandidate(details, safeApplyWizzId);

  if (!mapped.ok) {
    summary.skipped_invalid = 1;
    summary.skipped_invalid_reason = mapped.reason;

    return summary;
  }

  const idMatches = await store.findByApplyWizzClientId(normalized.applywizzId);

  if (idMatches.length > 0) {
    await store.updateById(idMatches[0]!.id, mapped.payload);
    summary.matched_by_id = 1;
    summary.updated = 1;

    return summary;
  }

  const emailMatches = await store.findUnlinkedByEmail(normalized.personalEmail);

  if (emailMatches.length > 1) {
    summary.skipped_ambiguous = 1;

    return summary;
  }

  if (emailMatches.length === 1) {
    await store.updateById(emailMatches[0]!.id, mapped.payload);
    summary.attached_by_email = 1;

    return summary;
  }

  summary.skipped_no_match = 1;

  return summary;
}

export function createSupabaseApplyWizzClientDetailsCandidateStore(client: SupabaseClient): ApplyWizzClientDetailsCandidateStore {
  return {
    findByApplyWizzClientId: async (applywizzClientId) => {
      const { data, error } = await client.from("candidates").select("id").eq("applywizz_client_id", applywizzClientId);

      if (error) {
        throw new ApplyWizzClientDetailsSyncError(safeSupabaseCode(error.code));
      }

      return ((data ?? []) as Array<{ id: string }>).map(({ id }) => ({ id }));
    },
    findUnlinkedByEmail: async (email) => {
      const { data, error } = await client.from("candidates").select("id").eq("email", email).is("applywizz_client_id", null);

      if (error) {
        throw new ApplyWizzClientDetailsSyncError(safeSupabaseCode(error.code));
      }

      return ((data ?? []) as Array<{ id: string }>).map(({ id }) => ({ id }));
    },
    updateById: async (id, payload) => {
      const { error } = await client.from("candidates").update(payload).eq("id", id);

      if (error) {
        throw new ApplyWizzClientDetailsSyncError(safeSupabaseCode(error.code));
      }
    }
  };
}

function createSummary(applywizzId: string): ApplyWizzClientDetailsSyncSummary {
  return {
    applywizz_id: applywizzId,
    attached_by_email: 0,
    matched_by_id: 0,
    skipped_ambiguous: 0,
    skipped_invalid: 0,
    skipped_no_match: 0,
    updated: 0
  };
}

function normalizeApplyWizzClientDetails(details: ApplyWizzClientDetails):
  | {
      ok: true;
      applywizzId: string;
      experience: unknown;
      linkedInUrl: unknown;
      personalEmail: string;
      resumeUrl: unknown;
      role: unknown;
      salaryRange: unknown;
      sponsorship: unknown;
      stateOfResidence: unknown;
      willingToRelocate: unknown;
      workAuthDetails: unknown;
    }
  | { ok: false; reason: ApplyWizzClientDetailsInvalidReason } {
  const root = asRecord(details) ?? {};
  const nestedClient = asRecord(root.client);
  const client = nestedClient ?? (safeString(root.applywizz_id) || safeString(root.personal_email) ? root : null);

  if (!client) {
    return { ok: false, reason: "missing_client" };
  }

  const rawApplyWizzId = safeString(client.applywizz_id);

  if (!rawApplyWizzId) {
    return { ok: false, reason: "missing_applywizz_id" };
  }

  const applywizzId = safeApplyWizzClientId(rawApplyWizzId);

  if (!applywizzId) {
    return { ok: false, reason: "invalid_applywizz_id" };
  }

  const personalEmail = safeString(client.personal_email).toLowerCase();

  if (!personalEmail) {
    return { ok: false, reason: "missing_personal_email" };
  }

  if (!emailPattern.test(personalEmail)) {
    return { ok: false, reason: "invalid_personal_email" };
  }

  const additionalInformation = asRecord(root.additional_information) ?? root;

  return {
    applywizzId,
    experience: additionalInformation.experience,
    linkedInUrl: additionalInformation.linked_in_url,
    ok: true,
    personalEmail,
    resumeUrl: additionalInformation.resume_url,
    role: additionalInformation.role,
    salaryRange: client.salary_range,
    sponsorship: client.sponsorship,
    stateOfResidence: additionalInformation.state_of_residence,
    willingToRelocate: additionalInformation.willing_to_relocate,
    workAuthDetails: additionalInformation.work_auth_details ?? client.work_auth_details
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function safeApplyWizzClientId(value: unknown) {
  const text = safeString(value);

  return /^AWL-\d+$/.test(text) ? text : "";
}

function safeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function safeNumber(value: unknown) {
  if (value == null || value === "") {
    return null;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function safeUrl(value: unknown) {
  const text = safeString(value);

  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);

    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeSupabaseCode(value: unknown) {
  const code = safeString(value);

  return /^[A-Za-z0-9_]+$/.test(code) ? code : undefined;
}
