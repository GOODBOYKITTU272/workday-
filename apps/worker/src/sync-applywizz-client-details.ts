import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

import { fetchApplyWizzClientDetails, ApplyWizzClientDetailsHttpError } from "./applywizz-client-details-client.js";
import type { ApplyWizzClientDetailsEnv } from "./applywizz-client-details-env.js";
import { ApplyWizzClientDetailsSyncError, createSupabaseApplyWizzClientDetailsCandidateStore, syncApplyWizzClientDetails } from "./applywizz-client-details-sync.js";

type EnvLike = Record<string, string | undefined>;
type FetchLike = typeof fetch;

type ClientDetailsCliEnv = ApplyWizzClientDetailsEnv & {
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
};

type ClientDetailsCliOptions = {
  args?: string[];
  createClient?: (supabaseUrl: string, supabaseServiceRoleKey: string) => SupabaseClient;
  env?: EnvLike;
  fetchImpl?: FetchLike;
  stderr?: (line: string) => void;
  stdout?: (line: string) => void;
};

class MissingClientDetailsEnvError extends Error {
  readonly missingEnv: string[];

  constructor(missingEnv: string[]) {
    super("MISSING_ENV");
    this.missingEnv = missingEnv;
  }
}

class MissingApplyWizzClientDetailsIdError extends Error {
  constructor() {
    super("APPLYWIZZ_CLIENT_DETAILS_ID_REQUIRED");
  }
}

export async function runApplyWizzClientDetailsSyncCli({
  args = process.argv.slice(2),
  createClient: createSupabaseClient = createSyncSupabaseClient,
  env = process.env,
  fetchImpl = fetch,
  stderr = console.error,
  stdout = console.log
}: ClientDetailsCliOptions = {}) {
  try {
    const applywizzId = getApplyWizzIdArg(args);
    const syncEnv = getClientDetailsCliEnv(env);
    const client = createSupabaseClient(syncEnv.supabaseUrl, syncEnv.supabaseServiceRoleKey);
    const summary = await syncApplyWizzClientDetails({
      applywizzId,
      fetchDetails: (id) => fetchApplyWizzClientDetails(syncEnv, id, fetchImpl),
      store: createSupabaseApplyWizzClientDetailsCandidateStore(client)
    });

    stdout(JSON.stringify(summary));

    return 0;
  } catch (error) {
    stderr(JSON.stringify(formatSafeDiagnostic(error)));

    return 1;
  }
}

function getClientDetailsCliEnv(env: EnvLike): ClientDetailsCliEnv {
  const missingEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "APPLYWIZZ_CLIENT_DETAILS_API_URL", "APPLYWIZZ_LEADS_BASIC_AUTH"].filter((key) => !env[key]?.trim());

  if (missingEnv.length > 0) {
    throw new MissingClientDetailsEnvError(missingEnv);
  }

  return {
    apiUrl: env.APPLYWIZZ_CLIENT_DETAILS_API_URL!.trim(),
    basicAuth: env.APPLYWIZZ_LEADS_BASIC_AUTH!.trim(),
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    supabaseUrl: env.SUPABASE_URL!.trim()
  };
}

function getApplyWizzIdArg(args: string[]) {
  const index = args.indexOf("--applywizz-id");
  const value = index >= 0 ? args[index + 1]?.trim() : "";

  if (!value) {
    throw new MissingApplyWizzClientDetailsIdError();
  }

  return value;
}

function createSyncSupabaseClient(supabaseUrl: string, supabaseServiceRoleKey: string) {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function formatSafeDiagnostic(error: unknown) {
  if (error instanceof MissingClientDetailsEnvError) {
    return {
      error_code: "MISSING_ENV",
      missing_env: error.missingEnv
    };
  }

  if (error instanceof MissingApplyWizzClientDetailsIdError) {
    return {
      error_code: "APPLYWIZZ_CLIENT_DETAILS_ID_REQUIRED"
    };
  }

  if (error instanceof ApplyWizzClientDetailsHttpError) {
    return {
      error_code: error.code,
      http_status: error.httpStatus
    };
  }

  if (error instanceof ApplyWizzClientDetailsSyncError) {
    return {
      error_code: error.code,
      ...(error.supabaseCode ? { supabase_code: error.supabaseCode } : {})
    };
  }

  return {
    error_code: "APPLYWIZZ_CLIENT_DETAILS_SYNC_FAILED"
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runApplyWizzClientDetailsSyncCli().then((code) => {
    process.exitCode = code;
  });
}
