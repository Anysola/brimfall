import { NextRequest } from "next/server";
import { body, handle, HttpError, json, requireBucket } from "@/lib/api";
import { createBucket, deleteBucket } from "@/lib/b2";
import { bucketSummaries } from "@/lib/buckets";
import { nativeApiAvailable } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: NextRequest) => {
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  return json({ buckets: await bucketSummaries(fresh) });
});

export const POST = handle(async (req: NextRequest) => {
  if (!nativeApiAvailable()) throw new HttpError(400, "errors.nativeApiRequired");
  const b = await body<{ name?: string; type?: string }>(req);
  const name = requireBucket(b.name);
  if (!/^[a-zA-Z0-9-]{6,50}$/.test(name))
    throw new HttpError(400, "errors.bucketNameRules");
  const bucket = await createBucket(name, b.type === "allPublic" ? "allPublic" : "allPrivate");
  return json({ bucket });
});

export const DELETE = handle(async (req: NextRequest) => {
  if (!nativeApiAvailable()) throw new HttpError(400, "errors.nativeApiRequired");
  const name = requireBucket(req.nextUrl.searchParams.get("name"));
  await deleteBucket(name);
  return json({ ok: true });
});
