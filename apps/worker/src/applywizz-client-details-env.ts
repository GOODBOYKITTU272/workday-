export type ApplyWizzClientDetailsEnv = {
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

export function getApplyWizzClientDetailsEnv(env: EnvLike = process.env): ApplyWizzClientDetailsEnv {
  return {
    apiUrl: required(env, "APPLYWIZZ_CLIENT_DETAILS_API_URL"),
    basicAuth: required(env, "APPLYWIZZ_LEADS_BASIC_AUTH")
  };
}
