import { NextRequest } from "next/server";
import { invalidateStats } from "@/lib/statsCache";
import { body, deferred, handle, HttpError, requireBucket } from "@/lib/api";
import { moveKeys } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const b = await body<{ bucket?: string; items?: { from: string; to: string }[]; copy?: boolean; overwrite?: boolean }>(req);
  const bucket = requireBucket(b.bucket);
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, "items is required");
  for (const it of b.items) {
    if (typeof it.from !== "string" || typeof it.to !== "string" || !it.from || !it.to)
      throw new HttpError(400, "Each item needs from and to");
    if (it.from.endsWith("/") !== it.to.endsWith("/"))
      throw new HttpError(400, "Folders must map to folders (keys ending in /)");
    if (it.from.endsWith("/") && it.to.startsWith(it.from)) throw new HttpError(400, "errors.folderIntoItself");
  }
  invalidateStats(bucket);
  const items = b.items;
  return deferred(async () => {
    const res = await moveKeys(bucket, items, Boolean(b.copy), b.overwrite === true);
    invalidateStats(bucket);
    return res;
  });
});
