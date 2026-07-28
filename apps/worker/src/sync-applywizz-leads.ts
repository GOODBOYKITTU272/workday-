import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

import { ApplyWizzLeadsHttpError, fetchApplyWizzLeads } from "./applywizz-leads-client.js";
import type { ApplyWizzLeadsEnv } from "./applywizz-leads-env.js";
import { ApplyWizzSupabaseSyncError, createSupabaseApplyWizzCandidateStore, syncApplyWizzLeads } from "./applywizz-leads-sync.js";

type EnvLike = Record<string, string | undefined>;
type FetchLike = typeof fetch;

type SyncSupabaseEnv = {
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
};

type SyncCliEnv = ApplyWizzLeadsEnv & SyncSupabaseEnv;

type SyncCliOptions = {
  args?: string[];
  createClient?: (supabaseUrl: string, supabaseServiceRoleKey: string) => SupabaseClient;
  env?: EnvLike;
  fetchImpl?: FetchLike;
  stderr?: (line: string) => void;
  stdout?: (line: string) => void;
};

class MissingSyncEnvError extends Error {
  readonly missingEnv: string[];

  constructor(missingEnv: string[]) {
    super("MISSING_ENV");
    this.missingEnv = missingEnv;
  }
}

class SupabaseKeyError extends Error {
  constructor() {
    super("SUPABASE_SERVICE_ROLE_KEY_INVALID");
  }
}

export async function runApplyWizzLeadsSyncCli({
  args = process.argv.slice(2),
  createClient: createSupabaseClient = createSyncSupabaseClient,
  env = process.env,
  fetchImpl = fetch,
  stderr = console.error,
  stdout = console.log
}: SyncCliOptions = {}) {
  try {
    const syncEnv = getSyncCliEnv(env);

    if (args.includes("--check")) {
      const httpStatus = await checkApplyWizzApi(syncEnv, fetchImpl);
      const key = decodeSupabaseServiceRoleKey(syncEnv.supabaseServiceRoleKey);

      stdout(
        JSON.stringify({
          applywizz_api_http_status: httpStatus,
          ok: true,
          supabase_key_ref: key.ref,
          supabase_key_role: key.role
        })
      );

      return 0;
    }

    const client = createSupabaseClient(syncEnv.supabaseUrl, syncEnv.supabaseServiceRoleKey);
    const summary = await syncApplyWizzLeads({
      fetchLeads: () => fetchApplyWizzLeads(syncEnv, fetchImpl),
      store: createSupabaseApplyWizzCandidateStore(client)
    });

    stdout(JSON.stringify(summary));

    return 0;
  } catch (error) {
    stderr(JSON.stringify(formatSafeDiagnostic(error)));

    return 1;
  }
}

function getSyncCliEnv(env: EnvLike): SyncCliEnv {
  const missingEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APPLYWIZZ_LEADS_API_URL", "APPLYWIZZ_LEADS_BASIC_AUTH"].filter((key) => !env[key]?.trim());

  if (missingEnv.length > 0) {
    throw new MissingSyncEnvError(missingEnv);
  }

  return {
    apiUrl: env.APPLYWIZZ_LEADS_API_URL!.trim(),
    basicAuth: env.APPLYWIZZ_LEADS_BASIC_AUTH!.trim(),
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    supabaseUrl: env.SUPABASE_URL!.trim()
  };
}

async function checkApplyWizzApi(env: ApplyWizzLeadsEnv, fetchImpl: FetchLike) {
  const response = await fetchImpl(env.apiUrl, {
    headers: {
      Authorization: `Basic ${env.basicAuth}`
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new ApplyWizzLeadsHttpError(response.status);
  }

  return response.status;
}

function createSyncSupabaseClient(supabaseUrl: string, supabaseServiceRoleKey: string) {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function decodeSupabaseServiceRoleKey(jwt: string) {
  const parts = jwt.split(".");

  if (parts.length !== 3) {
    throw new SupabaseKeyError();
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as { ref?: unknown; role?: unknown };
    const ref = safeString(payload.ref);
    const role = safeString(payload.role);

    if (!ref || role !== "service_role") {
      throw new SupabaseKeyError();
    }

    return { ref, role };
  } catch {
    throw new SupabaseKeyError();
  }
}

function formatSafeDiagnostic(error: unknown) {
  if (error instanceof MissingSyncEnvError) {
    return {
      error_code: "MISSING_ENV",
      missing_env: error.missingEnv
    };
  }

  if (error instanceof ApplyWizzLeadsHttpError) {
    return {
      error_code: error.code,
      http_status: error.httpStatus
    };
  }

  if (error instanceof ApplyWizzSupabaseSyncError) {
    return {
      error_code: error.code,
      ...(error.supabaseCode ? { supabase_code: error.supabaseCode } : {})
    };
  }

  if (error instanceof SupabaseKeyError) {
    return {
      error_code: "SUPABASE_SERVICE_ROLE_KEY_INVALID"
    };
  }

  return {
    error_code: "APPLYWIZZ_LEADS_SYNC_FAILED"
  };
}

function safeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runApplyWizzLeadsSyncCli().then((code) => {
    process.exitCode = code;
  });
}
