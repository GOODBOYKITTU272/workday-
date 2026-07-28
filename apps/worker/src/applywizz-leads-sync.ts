import type { SupabaseClient } from "@supabase/supabase-js";

export const APPLYWIZZ_LEADS_EXTERNAL_SOURCE = "applywizz_leads_api";

export type ApplyWizzLead = {
  assigned_associate?: {
    email?: unknown;
    id?: unknown;
    name?: unknown;
  } | null;
  clientPreferences?: unknown;
  created_at?: unknown;
  email?: unknown;
  endDate?: unknown;
  id?: unknown;
  location?: unknown;
  name?: unknown;
  number_of_applications?: unknown;
  plan?: unknown;
  startDate?: unknown;
  status?: unknown;
  targetRoleName?: unknown;
  yearsExp?: unknown;
};

export type ApplyWizzCandidatePayload = {
  assigned_associate_email: string | null;
  assigned_associate_name: string | null;
  email: string;
  external_lead_id: string;
  external_source: typeof APPLYWIZZ_LEADS_EXTERNAL_SOURCE;
  full_name: string;
  last_synced_at: string;
  location: string | null;
  plan: string | null;
  start_date: string | null;
  status: "active";
  target_role: string | null;
  years_experience: number | null;
};

export type ApplyWizzLeadMappingResult =
  | { ok: true; payload: ApplyWizzCandidatePayload }
  | { ok: false; reason: "invalid_email" | "missing_external_lead_id" | "missing_name" | "not_in_progress" };

export type ApplyWizzLeadsSyncSummary = {
  attached_existing: number;
  created: number;
  fetched: number;
  skipped_ambiguous: number;
  skipped_invalid: number;
  updated: number;
};

export type ApplyWizzCandidateStore = {
  findByExternalLead: (externalSource: string, externalLeadId: string) => Promise<Array<{ id: string }>>;
  findLegacyByEmail: (email: string) => Promise<Array<{ id: string }>>;
  updateById: (id: string, payload: ApplyWizzCandidatePayload) => Promise<void>;
  upsertByExternalLead: (payload: ApplyWizzCandidatePayload) => Promise<void>;
};

export type ApplyWizzLeadsSyncInput = {
  fetchLeads: () => Promise<ApplyWizzLead[]>;
  now?: () => string;
  store: ApplyWizzCandidateStore;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ApplyWizzSupabaseSyncError extends Error {
  readonly code = "SUPABASE_CANDIDATE_SYNC_FAILED";
  readonly supabaseCode?: string;

  constructor(supabaseCode?: string) {
    super("SUPABASE_CANDIDATE_SYNC_FAILED");
    this.supabaseCode = supabaseCode;
  }
}

export function mapApplyWizzLeadToCandidate(lead: ApplyWizzLead, syncedAt: string): ApplyWizzLeadMappingResult {
  const externalLeadId = safeString(lead.id);
  const email = safeString(lead.email).toLowerCase();
  const fullName = safeString(lead.name);
  const upstreamStatus = safeString(lead.status).toLowerCase();

  if (!externalLeadId) {
    return { ok: false, reason: "missing_external_lead_id" };
  }

  if (!fullName) {
    return { ok: false, reason: "missing_name" };
  }

  if (!email || !emailPattern.test(email)) {
    return { ok: false, reason: "invalid_email" };
  }

  if (upstreamStatus !== "in progress") {
    return { ok: false, reason: "not_in_progress" };
  }

  return {
    ok: true,
    payload: {
      assigned_associate_email: safeString(lead.assigned_associate?.email).toLowerCase() || null,
      assigned_associate_name: safeString(lead.assigned_associate?.name) || null,
      email,
      external_lead_id: externalLeadId,
      external_source: APPLYWIZZ_LEADS_EXTERNAL_SOURCE,
      full_name: fullName,
      last_synced_at: syncedAt,
      location: safeString(lead.location) || null,
      plan: safeString(lead.plan) || null,
      start_date: safeDate(lead.startDate),
      status: "active",
      target_role: safeString(lead.targetRoleName) || null,
      years_experience: safeNumber(lead.yearsExp)
    }
  };
}

export async function syncApplyWizzLeads({ fetchLeads, now = () => new Date().toISOString(), store }: ApplyWizzLeadsSyncInput): Promise<ApplyWizzLeadsSyncSummary> {
  const leads = await fetchLeads();
  const summary: ApplyWizzLeadsSyncSummary = {
    attached_existing: 0,
    created: 0,
    fetched: leads.length,
    skipped_ambiguous: 0,
    skipped_invalid: 0,
    updated: 0
  };
  const syncedAt = now();

  for (const lead of leads) {
    const mapped = mapApplyWizzLeadToCandidate(lead, syncedAt);

    if (!mapped.ok) {
      summary.skipped_invalid += 1;
      continue;
    }

    const payload = mapped.payload;
    const externalMatches = await store.findByExternalLead(payload.external_source, payload.external_lead_id);

    if (externalMatches.length > 0) {
      await store.upsertByExternalLead(payload);
      summary.updated += 1;
      continue;
    }

    const legacyMatches = await store.findLegacyByEmail(payload.email);

    if (legacyMatches.length > 1) {
      summary.skipped_ambiguous += 1;
      continue;
    }

    if (legacyMatches.length === 1) {
      await store.updateById(legacyMatches[0]!.id, payload);
      summary.attached_existing += 1;
      continue;
    }

    await store.upsertByExternalLead(payload);
    summary.created += 1;
  }

  return summary;
}

export function createSupabaseApplyWizzCandidateStore(client: SupabaseClient): ApplyWizzCandidateStore {
  return {
    findByExternalLead: async (externalSource, externalLeadId) => {
      const { data, error } = await client
        .from("candidates")
        .select("id")
        .eq("external_source", externalSource)
        .eq("external_lead_id", externalLeadId);

      if (error) {
        throw new ApplyWizzSupabaseSyncError(safeSupabaseCode(error.code));
      }

      return ((data ?? []) as Array<{ id: string }>).map(({ id }) => ({ id }));
    },
    findLegacyByEmail: async (email) => {
      const { data, error } = await client.from("candidates").select("id").eq("email", email).is("external_lead_id", null);

      if (error) {
        throw new ApplyWizzSupabaseSyncError(safeSupabaseCode(error.code));
      }

      return ((data ?? []) as Array<{ id: string }>).map(({ id }) => ({ id }));
    },
    updateById: async (id, payload) => {
      const { error } = await client.from("candidates").update(payload).eq("id", id);

      if (error) {
        throw new ApplyWizzSupabaseSyncError(safeSupabaseCode(error.code));
      }
    },
    upsertByExternalLead: async (payload) => {
      const { error } = await client.from("candidates").upsert(payload, { onConflict: "external_source,external_lead_id" });

      if (error) {
        throw new ApplyWizzSupabaseSyncError(safeSupabaseCode(error.code));
      }
    }
  };
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

function safeDate(value: unknown) {
  const text = safeString(value);

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function safeSupabaseCode(value: unknown) {
  const code = safeString(value);

  return /^[A-Za-z0-9_]+$/.test(code) ? code : undefined;
}
