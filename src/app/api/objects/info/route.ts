import { NextRequest } from "next/server";
import { handle, json, requireBucket, requireString } from "@/lib/api";
import { publicUrlResolver } from "@/lib/buckets";
import { headObject, listKeyVersions } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const bucket = requireBucket(q.get("bucket"));
  const key = requireString(q.get("key"), "key");
  const [head, versions, resolve] = await Promise.all([
    headObject(bucket, key),
    listKeyVersions(bucket, key).catch(() => []),
    publicUrlResolver(bucket),
  ]);
  return json({ ...head, url: resolve(key), versions });
});
