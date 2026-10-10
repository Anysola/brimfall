import { NextRequest } from "next/server";
import { body, handle, HttpError, json, requireBucket } from "@/lib/api";
import { getBucket, updateBucket, type B2CorsRule, type B2LifecycleRule } from "@/lib/b2";
import { nativeApiAvailable } from "@/lib/s3";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bucket: string }> };

export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  if (!nativeApiAvailable()) throw new HttpError(400, "errors.nativeApiRequired");
  const bucket = requireBucket((await ctx.params).bucket);
  return json({ bucket: await getBucket(bucket) });
});

export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  if (!nativeApiAvailable()) throw new HttpError(400, "errors.nativeApiRequired");
  const bucket = requireBucket((await ctx.params).bucket);
  const b = await body<{ bucketType?: string; corsRules?: B2CorsRule[]; lifecycleRules?: B2LifecycleRule[] }>(req);
  const patch: Parameters<typeof updateBucket>[1] = {};
  if (b.bucketType) {
    if (b.bucketType !== "allPublic" && b.bucketType !== "allPrivate") throw new HttpError(400, "Invalid bucketType");
    patch.bucketType = b.bucketType;
  }
  if (b.corsRules) {
    if (!Array.isArray(b.corsRules)) throw new HttpError(400, "corsRules must be an array");
    patch.corsRules = b.corsRules;
  }
  if (b.lifecycleRules) {
    if (!Array.isArray(b.lifecycleRules)) throw new HttpError(400, "lifecycleRules must be an array");
    patch.lifecycleRules = b.lifecycleRules;
  }
  return json({ bucket: await updateBucket(bucket, patch) });
});
