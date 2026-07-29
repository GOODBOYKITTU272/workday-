import { describe, expect, it } from "vitest";

import { fetchApplyWizzClientDetails } from "../src/applywizz-client-details-client";
import { getApplyWizzClientDetailsEnv } from "../src/applywizz-client-details-env";
import { getWorkerEnv } from "../src/worker-env";

describe("ApplyWizz client details client", () => {
  it("uses worker-only env separate from main worker env", () => {
    expect(
      getApplyWizzClientDetailsEnv({
        APPLYWIZZ_CLIENT_DETAILS_API_URL: "https://www.apply-wizz.me/api/get-client-details/",
        APPLYWIZZ_LEADS_BASIC_AUTH: "base64-test"
      })
    ).toEqual({
      apiUrl: "https://www.apply-wizz.me/api/get-client-details/",
      basicAuth: "base64-test"
    });

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
  });

  it("fetches one client details record with Basic Auth and applywizz id query", async () => {
    const requests: Array<{ headers: HeadersInit | undefined; url: string }> = [];
    const details = await fetchApplyWizzClientDetails(
      {
        apiUrl: "https://www.apply-wizz.me/api/get-client-details/",
        basicAuth: "base64-test"
      },
      "AWL-30453",
      (async (url, init) => {
        requests.push({ headers: init?.headers, url: String(url) });

        return {
          json: async () => ({ applywizz_id: "AWL-30453", personal_email: "candidate@example.com" }),
          ok: true,
          status: 200
        } as Response;
      }) as typeof fetch
    );

    expect(details).toEqual({ applywizz_id: "AWL-30453", personal_email: "candidate@example.com" });
    expect(requests).toEqual([
      {
        headers: { Authorization: "Basic base64-test" },
        url: "https://www.apply-wizz.me/api/get-client-details/?applywizz_id=AWL-30453"
      }
    ]);
  });

  it("fails with HTTP status only", async () => {
    await expect(
      fetchApplyWizzClientDetails(
        {
          apiUrl: "https://www.apply-wizz.me/api/get-client-details/",
          basicAuth: "base64-test"
        },
        "AWL-30453",
        (async () =>
          ({
            json: async () => ({ detail: "upstream-payload-sentinel" }),
            ok: false,
            status: 401
          }) as Response) as typeof fetch
      )
    ).rejects.toMatchObject({
      code: "APPLYWIZZ_CLIENT_DETAILS_FETCH_FAILED",
      httpStatus: 401
    });
  });
});
