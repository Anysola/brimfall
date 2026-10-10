import "server-only";
import { cachedBuckets, getAuth, listBuckets } from "./b2";
import { config } from "./config";
import { listS3Buckets, nativeApiAvailable } from "./s3";
import { publicUrl } from "./urls";

export interface BucketSummary {
  name: string;
  id: string | null;
  type: string | null;
  cdnUrl: string | null;
}

export async function bucketSummaries(fresh = false): Promise<BucketSummary[]> {
  if (nativeApiAvailable()) {
    const buckets = fresh ? await listBuckets() : await cachedBuckets();
    return buckets.map((b) => ({
      name: b.bucketName,
      id: b.bucketId,
      type: b.bucketType,
      cdnUrl: config.cdnUrls[b.bucketName] ?? null,
    }));
  }
  const names = await listS3Buckets();
  return names.map((name) => ({ name, id: null, type: null, cdnUrl: config.cdnUrls[name] ?? null }));
}

/** Returns a function that maps a key to its public URL, or null when the bucket is not public. */
export async function publicUrlResolver(bucket: string): Promise<(key: string) => string | null> {
  if (config.cdnUrls[bucket]) return (key) => publicUrl(bucket, key);
  if (!nativeApiAvailable()) return () => null;
  try {
    const [buckets, auth] = await Promise.all([cachedBuckets(), getAuth()]);
    const b = buckets.find((x) => x.bucketName === bucket);
    if (b?.bucketType === "allPublic") return (key) => publicUrl(bucket, key, auth.downloadUrl);
  } catch {
    // Missing listBuckets capability: fall back to presigned URLs only.
  }
  return () => null;
}
