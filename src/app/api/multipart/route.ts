import { NextRequest } from "next/server";
import { body, handle, json, requireBucket, requireString } from "@/lib/api";
import { abortMultipart, listMultipartUploads } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const bucket = requireBucket(req.nextUrl.searchParams.get("bucket"));
  return json({ uploads: await listMultipartUploads(bucket) });
});

export const DELETE = handle(async (req: NextRequest) => {
  const b = await body<{ bucket?: string; key?: string; uploadId?: string }>(req);
  await abortMultipart(requireBucket(b.bucket), requireString(b.key, "key"), requireString(b.uploadId, "uploadId"));
  return json({ ok: true });
});
