import type { ApplyWizzLeadsEnv } from "./applywizz-leads-env.js";
import type { ApplyWizzLead } from "./applywizz-leads-sync.js";

type FetchLike = typeof fetch;

type ApplyWizzLeadsResponse = {
  results?: unknown;
};

export async function fetchApplyWizzLeads(env: ApplyWizzLeadsEnv, fetchImpl: FetchLike = fetch): Promise<ApplyWizzLead[]> {
  const response = await fetchImpl(env.apiUrl, {
    headers: {
      Authorization: `Basic ${env.basicAuth}`
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new Error("APPLYWIZZ_LEADS_FETCH_FAILED");
  }

  const body = (await response.json()) as ApplyWizzLeadsResponse;

  if (!Array.isArray(body.results)) {
    throw new Error("APPLYWIZZ_LEADS_INVALID_RESPONSE");
  }

  return body.results as ApplyWizzLead[];
}
