import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getApplyWizzLeadsEnv } from "../src/applywizz-leads-env";
import {
  createSupabaseApplyWizzCandidateStore,
  mapApplyWizzLeadToCandidate,
  syncApplyWizzLeads,
  type ApplyWizzCandidateStore,
  type ApplyWizzLead
} from "../src/applywizz-leads-sync";
import { getWorkerEnv } from "../src/worker-env";

const syncedAt = "2026-07-28T00:00:00.000Z";

const lead: ApplyWizzLead = {
  assigned_associate: {
    email: "associate@example.com",
    id: 2026,
    name: "Associate"
  },
  clientPreferences: { raw: "must not store" },
  created_at: "2026-07-08T05:59:29.435251Z",
  email: "Candidate@Example.com",
  endDate: null,
  id: 1745,
  location: "Connecticut",
  name: "Candidate Name",
  number_of_applications: "20+",
  plan: "Standard",
  startDate: "2026-07-08",
  status: "In Progress",
  targetRoleName: "AI/ML Engineer",
  yearsExp: 3
};

describe("ApplyWizz leads sync", () => {
  it("maps only allow-listed candidate fields", () => {
    expect(mapApplyWizzLeadToCandidate(lead, syncedAt)).toEqual({
      ok: true,
      payload: {
        assigned_associate_email: "associate@example.com",
        assigned_associate_name: "Associate",
        email: "candidate@example.com",
        external_lead_id: "1745",
        external_source: "applywizz_leads_api",
        full_name: "Candidate Name",
        last_synced_at: syncedAt,
        location: "Connecticut",
        plan: "Standard",
        start_date: "2026-07-08",
        status: "active",
        target_role: "AI/ML Engineer",
        years_experience: 3
      }
    });

    const mapped = JSON.stringify(mapApplyWizzLeadToCandidate(lead, syncedAt));

    expect(mapped).not.toMatch(/number_of_applications|clientPreferences|endDate|raw JSON/);
    expect(mapped).not.toContain("\"id\":2026");
  });

  it("skips missing or invalid email", async () => {
    const store = createStore();
    const result = await syncApplyWizzLeads({
      fetchLeads: async () => [{ ...lead, email: "" }, { ...lead, email: "not-an-email", id: 1746 }],
      store,
      now: () => syncedAt
    });

    expect(result).toEqual({
      attached_existing: 0,
      created: 0,
      fetched: 2,
      skipped_ambiguous: 0,
      skipped_invalid: 2,
      updated: 0
    });
    expect(store.rows).toEqual([]);
  });

  it("upserts existing external lead matches", async () => {
    const store = createStore([
      {
        email: "candidate@example.com",
        external_lead_id: "1745",
        external_source: "applywizz_leads_api",
        id: "existing-id"
      }
    ]);
    const result = await syncApplyWizzLeads({ fetchLeads: async () => [lead], store, now: () => syncedAt });

    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(store.upserts).toEqual([
      expect.objectContaining({
        email: "candidate@example.com",
        external_lead_id: "1745",
        external_source: "applywizz_leads_api"
      })
    ]);
  });

  it("uses Supabase upsert for existing external lead matches", async () => {
    const supabase = createSupabaseMock();
    const result = await syncApplyWizzLeads({
      fetchLeads: async () => [lead],
      now: () => syncedAt,
      store: createSupabaseApplyWizzCandidateStore(supabase.client)
    });

    expect(result.updated).toBe(1);
    expect(supabase.calls).toContainEqual({
      onConflict: "external_source,external_lead_id",
      operation: "upsert",
      payload: expect.objectContaining({
        email: "candidate@example.com",
        external_lead_id: "1745",
        external_source: "applywizz_leads_api"
      })
    });
  });

  it("attaches a single legacy email match", async () => {
    const store = createStore([{ email: "candidate@example.com", external_lead_id: null, external_source: null, id: "legacy-id" }]);
    const result = await syncApplyWizzLeads({ fetchLeads: async () => [lead], store, now: () => syncedAt });

    expect(result.attached_existing).toBe(1);
    expect(store.updates).toEqual([
      {
        id: "legacy-id",
        payload: expect.objectContaining({
          email: "candidate@example.com",
          external_lead_id: "1745"
        })
      }
    ]);
  });

  it("skips multiple legacy email matches as ambiguous", async () => {
    const store = createStore([
      { email: "candidate@example.com", external_lead_id: null, external_source: null, id: "legacy-one" },
      { email: "candidate@example.com", external_lead_id: null, external_source: null, id: "legacy-two" }
    ]);
    const result = await syncApplyWizzLeads({ fetchLeads: async () => [lead], store, now: () => syncedAt });

    expect(result.skipped_ambiguous).toBe(1);
    expect(store.updates).toEqual([]);
    expect(store.upserts).toEqual([]);
  });

  it("does not include credentials in the sync summary", async () => {
    const result = await syncApplyWizzLeads({ fetchLeads: async () => [lead], store: createStore(), now: () => syncedAt });

    expect(JSON.stringify(result)).not.toMatch(/base64-test|admin|credential|authorization/i);
  });

  it("keeps ApplyWizz leads env separate from the main worker env", () => {
    expect(
      getWorkerEnv({
        ENCRYPTION_KEY: "encryption-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://example.supabase.co",
        ZOHO_CLIENT_ID: "zoho-client",
        ZOHO_CLIENT_SECRET: "zoho-secret",
        ZOHO_REDIRECT_URI: "https://example.com/callback"
      }).supabaseUrl
    ).toBe("https://example.supabase.co");

    expect(
      getApplyWizzLeadsEnv({
        APPLYWIZZ_LEADS_API_URL: "https://dashboard.example.test/api/v1/leads/",
        APPLYWIZZ_LEADS_BASIC_AUTH: "base64-test"
      })
    ).toEqual({
      apiUrl: "https://dashboard.example.test/api/v1/leads/",
      basicAuth: "base64-test"
    });
  });
});

type FakeCandidateRow = {
  email: string;
  external_lead_id: string | null;
  external_source: string | null;
  id: string;
};

function createStore(initialRows: FakeCandidateRow[] = []) {
  const rows = [...initialRows];
  const upserts: unknown[] = [];
  const updates: Array<{ id: string; payload: unknown }> = [];
  const store: ApplyWizzCandidateStore & {
    rows: FakeCandidateRow[];
    updates: Array<{ id: string; payload: unknown }>;
    upserts: unknown[];
  } = {
    findByExternalLead: async (externalSource, externalLeadId) =>
      rows.filter((row) => row.external_source === externalSource && row.external_lead_id === externalLeadId).map(({ id }) => ({ id })),
    findLegacyByEmail: async (email) => rows.filter((row) => row.email === email && !row.external_lead_id).map(({ id }) => ({ id })),
    rows,
    updateById: async (id, payload) => {
      updates.push({ id, payload });
    },
    updates,
    upsertByExternalLead: async (payload) => {
      upserts.push(payload);
      rows.push({
        email: payload.email,
        external_lead_id: payload.external_lead_id,
        external_source: payload.external_source,
        id: `created-${rows.length + 1}`
      });
    },
    upserts
  };

  return store;
}

type SupabaseMockCall =
  | { filters: Record<string, unknown>; operation: "select" }
  | { filter: Record<string, unknown>; operation: "update"; payload: unknown }
  | { onConflict: string; operation: "upsert"; payload: unknown };

function createSupabaseMock() {
  const calls: SupabaseMockCall[] = [];
  const client = {
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq: (key: string, value: unknown) => {
            filters[key] = value;

            return builder;
          },
          is: (key: string, value: unknown) => {
            filters[key] = value;

            return builder;
          },
          then: <TResult1 = { data: Array<{ id: string }>; error: null }, TResult2 = never>(
            resolve?: (value: { data: Array<{ id: string }>; error: null }) => TResult1 | PromiseLike<TResult1>,
            reject?: (reason: unknown) => TResult2 | PromiseLike<TResult2>
          ) => {
            calls.push({ filters, operation: "select" });
            const data = filters.external_lead_id === "1745" ? [{ id: "existing-id" }] : [];

            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
        };

        return builder;
      },
      update: (payload: unknown) => ({
        eq: (key: string, value: unknown) => {
          calls.push({ filter: { [key]: value }, operation: "update", payload });

          return Promise.resolve({ error: null });
        }
      }),
      upsert: (payload: unknown, options: { onConflict: string }) => {
        calls.push({ onConflict: options.onConflict, operation: "upsert", payload });

        return Promise.resolve({ error: null });
      }
    })
  };

  return { calls, client: client as unknown as SupabaseClient };
}
