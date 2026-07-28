import { createClient } from "@supabase/supabase-js";

export type WorkerEnv = {
  encryptionKey: string;
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
  zohoClientId: string;
  zohoClientSecret: string;
  zohoRedirectUri: string;
};

type EnvLike = Record<string, string | undefined>;

function required(env: EnvLike, key: string) {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

export function getWorkerEnv(env: EnvLike = process.env): WorkerEnv {
  return {
    supabaseUrl: required(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: required(env, "SUPABASE_SERVICE_ROLE_KEY"),
    encryptionKey: required(env, "ENCRYPTION_KEY"),
    zohoClientId: required(env, "ZOHO_CLIENT_ID"),
    zohoClientSecret: required(env, "ZOHO_CLIENT_SECRET"),
    zohoRedirectUri: required(env, "ZOHO_REDIRECT_URI")
  };
}

export function createWorkerSupabaseClient(env: WorkerEnv = getWorkerEnv()) {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
