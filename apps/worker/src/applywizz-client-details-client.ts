import type { ApplyWizzClientDetailsEnv } from "./applywizz-client-details-env.js";
import type { ApplyWizzClientDetails } from "./applywizz-client-details-sync.js";

type FetchLike = typeof fetch;

export class ApplyWizzClientDetailsHttpError extends Error {
  readonly code = "APPLYWIZZ_CLIENT_DETAILS_FETCH_FAILED";
  readonly httpStatus: number;

  constructor(httpStatus: number) {
    super("APPLYWIZZ_CLIENT_DETAILS_FETCH_FAILED");
    this.httpStatus = httpStatus;
  }
}

export async function fetchApplyWizzClientDetails(env: ApplyWizzClientDetailsEnv, applywizzId: string, fetchImpl: FetchLike = fetch): Promise<ApplyWizzClientDetails> {
  const url = new URL(env.apiUrl);

  url.searchParams.set("applywizz_id", applywizzId);

  const response = await fetchImpl(url.toString(), {
    headers: {
      Authorization: `Basic ${env.basicAuth}`
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new ApplyWizzClientDetailsHttpError(response.status);
  }

  return (await response.json()) as ApplyWizzClientDetails;
}
