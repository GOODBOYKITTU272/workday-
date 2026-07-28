export type ApplyWizzLeadsEnv = {
  apiUrl: string;
  basicAuth: string;
};

type EnvLike = Record<string, string | undefined>;

function required(env: EnvLike, key: string) {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

export function getApplyWizzLeadsEnv(env: EnvLike = process.env): ApplyWizzLeadsEnv {
  return {
    apiUrl: required(env, "APPLYWIZZ_LEADS_API_URL"),
    basicAuth: required(env, "APPLYWIZZ_LEADS_BASIC_AUTH")
  };
}
