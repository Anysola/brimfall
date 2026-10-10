import "server-only";
import { config } from "./config";

export class B2Error extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface B2Auth {
  accountId: string;
  authorizationToken: string;
  apiUrl: string;
  downloadUrl: string;
  s3ApiUrl: string;
  recommendedPartSize: number;
  allowed: {
    capabilities: string[];
    bucketId: string | null;
    bucketName: string | null;
    namePrefix: string | null;
  };
}

export interface B2CorsRule {
  corsRuleName: string;
  allowedOrigins: string[];
  allowedOperations: string[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds: number;
}

export interface B2LifecycleRule {
  fileNamePrefix: string;
  daysFromUploadingToHiding: number | null;
  daysFromHidingToDeleting: number | null;
}

export interface B2Bucket {
  accountId: string;
  bucketId: string;
  bucketName: string;
  bucketType: "allPublic" | "allPrivate" | "snapshot" | "shared" | "restricted";
  bucketInfo: Record<string, string>;
  corsRules: B2CorsRule[];
  lifecycleRules: B2LifecycleRule[];
  revision: number;
  options?: string[];
}

export interface B2Key {
  keyName: string;
  applicationKeyId: string;
  capabilities: string[];
  accountId: string;
  expirationTimestamp: number | null;
  bucketId: string | null;
  namePrefix: string | null;
}

const AUTH_URL = `${process.env.B2_API_URL ?? "https://api.backblazeb2.com"}/b2api/v2/b2_authorize_account`;
const AUTH_TTL = 20 * 60 * 60 * 1000;

let cached: { auth: B2Auth; at: number } | null = null;
let inflight: Promise<B2Auth> | null = null;

export function b2Configured(): boolean {
  return Boolean(config.b2KeyId && config.b2AppKey);
}

async function authorize(): Promise<B2Auth> {
  if (!b2Configured()) throw new B2Error(500, "not_configured", "B2_KEY_ID / B2_APP_KEY are not set");
  const basic = Buffer.from(`${config.b2KeyId}:${config.b2AppKey}`).toString("base64");
  const res = await fetch(AUTH_URL, { headers: { Authorization: `Basic ${basic}` }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new B2Error(res.status, body.code ?? "auth_failed", body.message ?? "B2 authorization failed");
  return body as B2Auth;
}

export async function getAuth(force = false): Promise<B2Auth> {
  if (!force && cached && Date.now() - cached.at < AUTH_TTL) return cached.auth;
  if (!inflight) {
    inflight = authorize()
      .then((auth) => {
        cached = { auth, at: Date.now() };
        return auth;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function b2Call<T>(op: string, body: Record<string, unknown>, retried = false): Promise<T> {
  const auth = await getAuth();
  const res = await fetch(`${auth.apiUrl}/b2api/v2/${op}`, {
    method: "POST",
    headers: { Authorization: auth.authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried && (data.code === "expired_auth_token" || data.code === "bad_auth_token")) {
    await getAuth(true);
    return b2Call<T>(op, body, true);
  }
  if (!res.ok) throw new B2Error(res.status, data.code ?? "b2_error", data.message ?? `${op} failed`);
  return data as T;
}

// ── Buckets ─────────────────────────────────────────────────────

export async function listBuckets(): Promise<B2Bucket[]> {
  const auth = await getAuth();
  const body: Record<string, unknown> = { accountId: auth.accountId };
  if (auth.allowed.bucketId) body.bucketId = auth.allowed.bucketId;
  const { buckets } = await b2Call<{ buckets: B2Bucket[] }>("b2_list_buckets", body);
  return buckets.sort((a, b) => a.bucketName.localeCompare(b.bucketName));
}

let bucketCache: { at: number; buckets: B2Bucket[] } | null = null;

/** Bucket list cached for 60s (used for hot paths such as listing objects). */
export async function cachedBuckets(): Promise<B2Bucket[]> {
  if (bucketCache && Date.now() - bucketCache.at < 60_000) return bucketCache.buckets;
  const buckets = await listBuckets();
  bucketCache = { at: Date.now(), buckets };
  return buckets;
}

export function invalidateBucketCache() {
  bucketCache = null;
}

export async function getBucket(name: string): Promise<B2Bucket> {
  const auth = await getAuth();
  const { buckets } = await b2Call<{ buckets: B2Bucket[] }>("b2_list_buckets", {
    accountId: auth.accountId,
    bucketName: name,
  });
  if (!buckets[0]) throw new B2Error(404, "not_found", `Bucket ${name} not found`);
  return buckets[0];
}

export async function updateBucket(
  name: string,
  patch: Partial<Pick<B2Bucket, "bucketType" | "corsRules" | "lifecycleRules" | "bucketInfo">>,
): Promise<B2Bucket> {
  const bucket = await getBucket(name);
  invalidateBucketCache();
  return b2Call<B2Bucket>("b2_update_bucket", {
    accountId: bucket.accountId,
    bucketId: bucket.bucketId,
    ...patch,
  });
}

export async function createBucket(name: string, bucketType: "allPublic" | "allPrivate"): Promise<B2Bucket> {
  const auth = await getAuth();
  invalidateBucketCache();
  return b2Call<B2Bucket>("b2_create_bucket", { accountId: auth.accountId, bucketName: name, bucketType });
}

export async function deleteBucket(name: string): Promise<void> {
  const bucket = await getBucket(name);
  invalidateBucketCache();
  await b2Call("b2_delete_bucket", { accountId: bucket.accountId, bucketId: bucket.bucketId });
}

// ── Application keys ────────────────────────────────────────────

export async function listKeys(): Promise<B2Key[]> {
  const auth = await getAuth();
  const keys: B2Key[] = [];
  let startApplicationKeyId: string | undefined;
  do {
    const res = await b2Call<{ keys: B2Key[]; nextApplicationKeyId: string | null }>("b2_list_keys", {
      accountId: auth.accountId,
      maxKeyCount: 1000,
      ...(startApplicationKeyId ? { startApplicationKeyId } : {}),
    });
    keys.push(...res.keys);
    startApplicationKeyId = res.nextApplicationKeyId ?? undefined;
  } while (startApplicationKeyId);
  return keys;
}

export async function createKey(input: {
  keyName: string;
  capabilities: string[];
  bucketId?: string;
  namePrefix?: string;
  validDurationInSeconds?: number;
}): Promise<B2Key & { applicationKey: string }> {
  const auth = await getAuth();
  const body: Record<string, unknown> = {
    accountId: auth.accountId,
    keyName: input.keyName,
    capabilities: input.capabilities,
  };
  if (input.bucketId) body.bucketId = input.bucketId;
  if (input.bucketId && input.namePrefix) body.namePrefix = input.namePrefix;
  if (input.validDurationInSeconds) body.validDurationInSeconds = input.validDurationInSeconds;
  return b2Call("b2_create_key", body);
}

export async function deleteKey(applicationKeyId: string): Promise<void> {
  await b2Call("b2_delete_key", { applicationKeyId });
}

export const ALL_CAPABILITIES = [
  "listKeys",
  "writeKeys",
  "deleteKeys",
  "listAllBucketNames",
  "listBuckets",
  "readBuckets",
  "writeBuckets",
  "deleteBuckets",
  "readBucketRetentions",
  "writeBucketRetentions",
  "readBucketEncryption",
  "writeBucketEncryption",
  "listFiles",
  "readFiles",
  "shareFiles",
  "writeFiles",
  "deleteFiles",
  "readFileLegalHolds",
  "writeFileLegalHolds",
  "readFileRetentions",
  "writeFileRetentions",
  "bypassGovernance",
];
