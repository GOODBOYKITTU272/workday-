import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSupabaseApplyWizzClientDetailsCandidateStore,
  mapApplyWizzClientDetailsToCandidate,
  syncApplyWizzClientDetails,
  type ApplyWizzClientDetails,
  type ApplyWizzClientDetailsCandidateStore
} from "../src/applywizz-client-details-sync";

const clientDetails: ApplyWizzClientDetails = {
  account_manager_id: 12,
  applywizz_id: "AWL-30453",
  badge_value: "gold",
  callable_phone: "555-0000",
  careerassociateid: 1,
  careerassociatemanagerid: 2,
  clientofficeid: 3,
  coding_lab_url: "https://example.test/lab",
  coding_labs: "private",
  company_email: "work@example.com",
  convicted_of_felony: "no",
  date_of_birth: "1990-01-01",
  disability_status: "private",
  experience: 5,
  failed_or_refused_drug_test: "no",
  felony_explanation: "private",
  full_address: "123 Private St",
  gender: "private",
  is_hispanic_latino: "private",
  linked_in_url: "https://linkedin.example.test/in/candidate",
  mcq_results: "private",
  no_of_applications: 10,
  onboarded_by: 4,
  pending_investigation: "no",
  personal_email: "Candidate@Example.com",
  primary_phone: "555-1111",
  race_ethnicity: "private",
  resume_url: "https://files.example.test/resume.pdf",
  role: "Data Analyst",
  salary_range: "120k-140k",
  scraperid: 5,
  sponsorship: "No sponsorship required",
  state_of_residence: "Texas",
  test_results: "private",
  uses_substances_affecting_duties: "no",
  veteran_status: "private",
  whatsapp_number: "555-2222",
  willing_background_check: "yes",
  willing_drug_screen: "yes",
  willing_to_relocate: "yes",
  work_auth_details: "US citizen"
};

describe("ApplyWizz client details sync", () => {
  it("maps only allow-listed enrichment fields", () => {
    expect(mapApplyWizzClientDetailsToCandidate(clientDetails, "AWL-30453")).toEqual({
      ok: true,
      payload: {
        applywizz_client_id: "AWL-30453",
        expected_salary: "120k-140k",
        external_resume_source: "applywizz_client_details",
        external_resume_url: "https://files.example.test/resume.pdf",
        linkedin_url: "https://linkedin.example.test/in/candidate",
        location: "Texas",
        relocation_preference: "yes",
        sponsorship_requirement: "No sponsorship required",
        target_role: "Data Analyst",
        work_authorization: "US citizen",
        years_experience: 5
      }
    });

    const mapped = JSON.stringify(mapApplyWizzClientDetailsToCandidate(clientDetails, "AWL-30453"));

    expect(mapped).not.toMatch(
      /company_email|date_of_birth|full_address|primary_phone|whatsapp_number|callable_phone|gender|is_hispanic_latino|race_ethnicity|veteran_status|disability_status|convicted_of_felony|felony_explanation|pending_investigation|willing_background_check|willing_drug_screen|failed_or_refused_drug_test|uses_substances_affecting_duties|no_of_applications|account_manager_id|onboarded_by|careerassociateid|scraperid|careerassociatemanagerid|clientofficeid|badge_value|coding_labs|coding_lab_url|mcq_results|test_results|raw JSON/i
    );
  });

  it("uses resume URL only as external candidate metadata", () => {
    const mapped = mapApplyWizzClientDetailsToCandidate(clientDetails, "AWL-30453");

    expect(mapped).toEqual(
      expect.objectContaining({
        ok: true
      })
    );
    expect(JSON.stringify(mapped)).toContain("external_resume_url");
    expect(JSON.stringify(mapped)).not.toContain("candidate_resumes");
  });

  it("updates an existing candidate matched by applywizz_client_id", async () => {
    const store = createStore([{ applywizz_client_id: "AWL-30453", email: "candidate@example.com", id: "existing-id" }]);
    const result = await syncApplyWizzClientDetails({ applywizzId: "AWL-30453", fetchDetails: async () => clientDetails, store });

    expect(result).toEqual({
      applywizz_id: "AWL-30453",
      attached_by_email: 0,
      matched_by_id: 1,
      skipped_ambiguous: 0,
      skipped_invalid: 0,
      skipped_no_match: 0,
      updated: 1
    });
    expect(store.updates).toEqual([
      {
        id: "existing-id",
        payload: expect.objectContaining({ applywizz_client_id: "AWL-30453", target_role: "Data Analyst" })
      }
    ]);
  });

  it("attaches applywizz id to a single personal email match", async () => {
    const store = createStore([{ applywizz_client_id: null, email: "candidate@example.com", id: "legacy-id" }]);
    const result = await syncApplyWizzClientDetails({ applywizzId: "AWL-30453", fetchDetails: async () => clientDetails, store });

    expect(result.attached_by_email).toBe(1);
    expect(result.updated).toBe(0);
    expect(store.updates).toEqual([
      {
        id: "legacy-id",
        payload: expect.objectContaining({ applywizz_client_id: "AWL-30453" })
      }
    ]);
  });

  it("skips multiple personal email matches as ambiguous", async () => {
    const store = createStore([
      { applywizz_client_id: null, email: "candidate@example.com", id: "one" },
      { applywizz_client_id: null, email: "candidate@example.com", id: "two" }
    ]);
    const result = await syncApplyWizzClientDetails({ applywizzId: "AWL-30453", fetchDetails: async () => clientDetails, store });

    expect(result.skipped_ambiguous).toBe(1);
    expect(store.updates).toEqual([]);
  });

  it("skips when there is no matching candidate", async () => {
    const store = createStore();
    const result = await syncApplyWizzClientDetails({ applywizzId: "AWL-30453", fetchDetails: async () => clientDetails, store });

    expect(result.skipped_no_match).toBe(1);
    expect(store.updates).toEqual([]);
  });

  it.each(["", "  ", "not-an-id"])("skips invalid applywizz id %s", async (applywizzId) => {
    const store = createStore([{ applywizz_client_id: null, email: "candidate@example.com", id: "legacy-id" }]);
    const result = await syncApplyWizzClientDetails({ applywizzId, fetchDetails: async () => clientDetails, store });

    expect(result.skipped_invalid).toBe(1);
    expect(store.updates).toEqual([]);
  });

  it("skips missing or invalid personal email when id does not match", async () => {
    const store = createStore();
    const result = await syncApplyWizzClientDetails({ applywizzId: "AWL-30453", fetchDetails: async () => ({ ...clientDetails, personal_email: "bad-email" }), store });

    expect(result.skipped_invalid).toBe(1);
    expect(store.updates).toEqual([]);
  });

  it("uses Supabase update for id matches", async () => {
    const supabase = createSupabaseMock();
    const result = await syncApplyWizzClientDetails({
      applywizzId: "AWL-30453",
      fetchDetails: async () => clientDetails,
      store: createSupabaseApplyWizzClientDetailsCandidateStore(supabase.client)
    });

    expect(result.updated).toBe(1);
    expect(supabase.calls).toContainEqual({
      filter: { id: "existing-id" },
      operation: "update",
      payload: expect.objectContaining({
        applywizz_client_id: "AWL-30453",
        external_resume_url: "https://files.example.test/resume.pdf"
      })
    });
    expect(JSON.stringify(supabase.calls)).not.toContain("candidate_resumes");
  });

  it("does not include credentials or upstream payload in summary", async () => {
    const result = await syncApplyWizzClientDetails({ applywizzId: "AWL-30453", fetchDetails: async () => clientDetails, store: createStore() });

    expect(JSON.stringify(result)).not.toMatch(/base64|credential|authorization|Private St|555-/i);
  });
});

type FakeCandidateRow = {
  applywizz_client_id: string | null;
  email: string;
  id: string;
};

function createStore(initialRows: FakeCandidateRow[] = []) {
  const updates: Array<{ id: string; payload: unknown }> = [];
  const store: ApplyWizzClientDetailsCandidateStore & { updates: Array<{ id: string; payload: unknown }> } = {
    findByApplyWizzClientId: async (applywizzClientId) => initialRows.filter((row) => row.applywizz_client_id === applywizzClientId).map(({ id }) => ({ id })),
    findUnlinkedByEmail: async (email) => initialRows.filter((row) => row.email === email && !row.applywizz_client_id).map(({ id }) => ({ id })),
    updateById: async (id, payload) => {
      updates.push({ id, payload });
    },
    updates
  };

  return store;
}

type SupabaseMockCall = { filters: Record<string, unknown>; operation: "select" } | { filter: Record<string, unknown>; operation: "update"; payload: unknown };

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
            const data = filters.applywizz_client_id === "AWL-30453" ? [{ id: "existing-id" }] : [];

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
      })
    })
  };

  return { calls, client: client as unknown as SupabaseClient };
}
