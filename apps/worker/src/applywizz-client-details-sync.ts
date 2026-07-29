import type { SupabaseClient } from "@supabase/supabase-js";

export type ApplyWizzClientDetails = {
  applywizz_id?: unknown;
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

export type ApplyWizzClientDetailsMappingResult = { ok: true; payload: ApplyWizzClientDetailsCandidatePayload } | { ok: false; reason: "invalid_applywizz_id" };

export type ApplyWizzClientDetailsSyncSummary = {
  applywizz_id: string;
  attached_by_email: number;
  matched_by_id: number;
  skipped_ambiguous: number;
  skipped_invalid: number;
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

  const externalResumeUrl = safeUrl(details.resume_url);

  return {
    ok: true,
    payload: {
      applywizz_client_id: safeApplyWizzId,
      expected_salary: safeString(details.salary_range) || null,
      external_resume_source: externalResumeUrl ? "applywizz_client_details" : null,
      external_resume_url: externalResumeUrl,
      linkedin_url: safeUrl(details.linked_in_url),
      location: safeString(details.state_of_residence) || null,
      relocation_preference: safeString(details.willing_to_relocate) || null,
      sponsorship_requirement: safeString(details.sponsorship) || null,
      target_role: safeString(details.role) || null,
      work_authorization: safeString(details.work_auth_details) || null,
      years_experience: safeNumber(details.experience)
    }
  };
}

export async function syncApplyWizzClientDetails({ applywizzId, fetchDetails, store }: ApplyWizzClientDetailsSyncInput): Promise<ApplyWizzClientDetailsSyncSummary> {
  const safeApplyWizzId = safeApplyWizzClientId(applywizzId);
  const summary = createSummary(safeApplyWizzId || safeString(applywizzId));

  if (!safeApplyWizzId) {
    summary.skipped_invalid = 1;

    return summary;
  }

  const details = await fetchDetails(safeApplyWizzId);
  const mapped = mapApplyWizzClientDetailsToCandidate(details, safeApplyWizzId);

  if (!mapped.ok) {
    summary.skipped_invalid = 1;

    return summary;
  }

  const idMatches = await store.findByApplyWizzClientId(safeApplyWizzId);

  if (idMatches.length > 0) {
    await store.updateById(idMatches[0]!.id, mapped.payload);
    summary.matched_by_id = 1;
    summary.updated = 1;

    return summary;
  }

  const personalEmail = safeString(details.personal_email).toLowerCase();

  if (!personalEmail || !emailPattern.test(personalEmail)) {
    summary.skipped_invalid = 1;

    return summary;
  }

  const emailMatches = await store.findUnlinkedByEmail(personalEmail);

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
