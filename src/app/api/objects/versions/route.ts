import { NextRequest } from "next/server";
import { body, handle, json, requireBucket, requireString } from "@/lib/api";
import { copyObject, deleteVersion } from "@/lib/s3";
import { invalidateStats } from "@/lib/statsCache";

export const dynamic = "force-dynamic";

/** Restore an older version by copying it over the current key. */
export const POST = handle(async (req: NextRequest) => {
  const b = await body<{ bucket?: string; key?: string; versionId?: string }>(req);
  const bucket = requireBucket(b.bucket);
  const key = requireString(b.key, "key");
  await copyObject(bucket, key, key, undefined, requireString(b.versionId, "versionId"));
  invalidateStats(bucket);
  return json({ ok: true });
});

export const DELETE = handle(async (req: NextRequest) => {
  const b = await body<{ bucket?: string; key?: string; versionId?: string }>(req);
  const bucket = requireBucket(b.bucket);
  await deleteVersion(bucket, requireString(b.key, "key"), requireString(b.versionId, "versionId"));
  invalidateStats(bucket);
  return json({ ok: true });
});
