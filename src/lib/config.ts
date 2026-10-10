import "server-only";

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function parseCdnUrls(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const bucket = part.slice(0, idx).trim();
    const base = part.slice(idx + 1).trim().replace(/\/+$/, "");
    if (bucket && base) out[bucket] = base;
  }
  return out;
}

export const config = {
  password: env("DASHBOARD_PASSWORD"),
  sessionSecret: env("SESSION_SECRET"),
  sessionTtlHours: Number(env("SESSION_TTL_HOURS") ?? 168) || 168,

  b2KeyId: env("B2_KEY_ID"),
  b2AppKey: env("B2_APP_KEY"),
  defaultBucket: env("DEFAULT_BUCKET"),
  cdnUrls: parseCdnUrls(env("CDN_URLS")),

  s3Endpoint: env("S3_ENDPOINT"),
  s3Region: env("S3_REGION"),
  s3AccessKeyId: env("S3_ACCESS_KEY_ID"),
  s3SecretAccessKey: env("S3_SECRET_ACCESS_KEY"),
  s3ForcePathStyle: env("S3_FORCE_PATH_STYLE") !== "false",
};

export function configProblems(): string[] {
  const p: string[] = [];
  if (!config.password) p.push("errors.config.password");
  if (!config.sessionSecret || config.sessionSecret.length < 32) p.push("errors.config.secret");
  const hasB2 = config.b2KeyId && config.b2AppKey;
  const hasS3 = config.s3Endpoint && config.s3AccessKeyId && config.s3SecretAccessKey;
  if (!hasB2 && !hasS3) p.push("errors.config.b2");
  return p;
}
