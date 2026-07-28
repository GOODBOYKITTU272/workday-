import type { ApplyWizzLeadsEnv } from "./applywizz-leads-env.js";
import type { ApplyWizzLead } from "./applywizz-leads-sync.js";

type FetchLike = typeof fetch;

type ApplyWizzLeadsResponse = {
  results?: unknown;
};

export class ApplyWizzLeadsHttpError extends Error {
  readonly code = "APPLYWIZZ_LEADS_FETCH_FAILED";
  readonly httpStatus: number;

  constructor(httpStatus: number) {
    super("APPLYWIZZ_LEADS_FETCH_FAILED");
    this.httpStatus = httpStatus;
  }
}

export async function fetchApplyWizzLeads(env: ApplyWizzLeadsEnv, fetchImpl: FetchLike = fetch): Promise<ApplyWizzLead[]> {
  const response = await fetchImpl(env.apiUrl, {
    headers: {
      Authorization: `Basic ${env.basicAuth}`
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new ApplyWizzLeadsHttpError(response.status);
  }

  const body = (await response.json()) as ApplyWizzLeadsResponse;

  if (!Array.isArray(body.results)) {
    throw new Error("APPLYWIZZ_LEADS_INVALID_RESPONSE");
  }

  return body.results as ApplyWizzLead[];
}
