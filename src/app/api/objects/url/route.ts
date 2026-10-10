import { NextRequest } from "next/server";
import { handle, json, requireBucket, requireString } from "@/lib/api";
import { presignGet } from "@/lib/s3";

export const dynamic = "force-dynamic";

const MAX = 7 * 24 * 3600; // S3 SigV4 limit

export const GET = handle(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const bucket = requireBucket(q.get("bucket"));
  const key = requireString(q.get("key"), "key");
  const expires = Math.min(Math.max(Number(q.get("expires") ?? 3600) || 3600, 60), MAX);
  const url = await presignGet(bucket, key, expires, {
    download: q.get("download") === "1",
    versionId: q.get("versionId") ?? undefined,
  });
  return json({ url, expiresAt: new Date(Date.now() + expires * 1000).toISOString() });
});
