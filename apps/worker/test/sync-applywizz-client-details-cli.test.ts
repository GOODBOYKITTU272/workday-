import { describe, expect, it } from "vitest";

import { runApplyWizzClientDetailsSyncCli } from "../src/sync-applywizz-client-details";

const safeEnv = {
  APPLYWIZZ_CLIENT_DETAILS_API_URL: "https://www.apply-wizz.me/api/get-client-details/",
  APPLYWIZZ_LEADS_BASIC_AUTH: "base64-secret-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_URL: "https://test-ref.supabase.co"
};

describe("ApplyWizz client details CLI", () => {
  it("requires --applywizz-id", async () => {
    const output = createOutput();
    const code = await runApplyWizzClientDetailsSyncCli({
      args: [],
      createClient: createSupabaseClient(),
      env: safeEnv,
      fetchImpl: createFetch(200, {}),
      stderr: output.stderr,
      stdout: output.stdout
    });

    expect(code).toBe(1);
    expect(output.err()).toContain("APPLYWIZZ_CLIENT_DETAILS_ID_REQUIRED");
    expect(output.err()).not.toContain("base64-secret-value");
  });

  it("prints API HTTP status without upstream payload", async () => {
    const output = createOutput();
    const code = await runApplyWizzClientDetailsSyncCli({
      args: ["--applywizz-id", "AWL-30453"],
      createClient: createSupabaseClient(),
      env: safeEnv,
      fetchImpl: createFetch(401, { detail: "upstream-payload-sentinel" }),
      stderr: output.stderr,
      stdout: output.stdout
    });

    expect(code).toBe(1);
    expect(output.err()).toContain("APPLYWIZZ_CLIENT_DETAILS_FETCH_FAILED");
    expect(output.err()).toContain("\"http_status\":401");
    expect(output.err()).not.toContain("upstream-payload-sentinel");
    expect(output.err()).not.toContain("base64-secret-value");
  });

  it("prints Supabase failure with safe code only", async () => {
    const output = createOutput();
    const code = await runApplyWizzClientDetailsSyncCli({
      args: ["--applywizz-id", "AWL-30453"],
      createClient: createSupabaseClient({ code: "23505", message: "candidate@example.com duplicate" }),
      env: safeEnv,
      fetchImpl: createFetch(200, { applywizz_id: "AWL-30453", personal_email: "candidate@example.com" }),
      stderr: output.stderr,
      stdout: output.stdout
    });

    expect(code).toBe(1);
    expect(output.err()).toContain("APPLYWIZZ_CLIENT_DETAILS_SYNC_FAILED");
    expect(output.err()).toContain("\"supabase_code\":\"23505\"");
    expect(output.err()).not.toContain("candidate@example.com");
    expect(output.err()).not.toContain("base64-secret-value");
  });
});

function createOutput() {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  return {
    err: () => stderrLines.join("\n"),
    out: () => stdoutLines.join("\n"),
    stderr: (line: string) => {
      stderrLines.push(line);
    },
    stdout: (line: string) => {
      stdoutLines.push(line);
    }
  };
}

function createFetch(status: number, body: unknown) {
  return async () =>
    ({
      json: async () => body,
      ok: status >= 200 && status < 300,
      status
    }) as Response;
}

function createSupabaseClient(error?: { code?: string; message?: string }) {
  const createClient = () =>
    ({
      from: () => ({
        select: () => {
          const builder = {
            eq: () => builder,
            is: () => builder,
            then: <TResult1 = { data: Array<{ id: string }>; error: null }, TResult2 = never>(
              resolve?: (value: { data: Array<{ id: string }>; error: null }) => TResult1 | PromiseLike<TResult1>,
              reject?: (reason: unknown) => TResult2 | PromiseLike<TResult2>
            ) => Promise.resolve({ data: [{ id: "existing-id" }], error: null }).then(resolve, reject)
          };

          return builder;
        },
        update: () => ({
          eq: () => Promise.resolve({ error })
        })
      })
    }) as never;

  return createClient;
}
