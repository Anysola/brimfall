import { NextRequest } from "next/server";
import { invalidateStats } from "@/lib/statsCache";
import { body, deferred, handle, json, requireBucket, HttpError } from "@/lib/api";
import { publicUrlResolver } from "@/lib/buckets";
import { deleteKeys, iterateObjects, listFolder, presignGet, type FileEntry } from "@/lib/s3";

export const dynamic = "force-dynamic";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const SEARCH_SCAN_LIMIT = 50_000;
const SEARCH_RESULT_LIMIT = 500;

export const GET = handle(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const bucket = requireBucket(q.get("bucket"));
  const prefix = q.get("prefix") ?? "";
  const search = q.get("search")?.trim().toLowerCase();
  const thumbs = q.get("thumbs") === "1";
  const resolve = await publicUrlResolver(bucket);

  let folders: { key: string; name: string }[] = [];
  let files: FileEntry[] = [];
  let nextToken: string | null = null;
  let truncated = false;

  if (search) {
    let scanned = 0;
    const folderSet = new Set<string>();
    for await (const o of iterateObjects(bucket, prefix)) {
      if (++scanned > SEARCH_SCAN_LIMIT) {
        truncated = true;
        break;
      }
      const rel = o.Key!.slice(prefix.length);
      if (!rel.toLowerCase().includes(search)) continue;
      if (rel.endsWith("/")) {
        if (!folderSet.has(o.Key!)) folderSet.add(o.Key!);
        continue;
      }
      files.push({
        key: o.Key!,
        name: rel,
        size: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString() ?? null,
        etag: o.ETag?.replace(/"/g, "") ?? null,
      });
      if (files.length >= SEARCH_RESULT_LIMIT) {
        truncated = true;
        break;
      }
    }
    folders = [...folderSet].map((k) => ({ key: k, name: k.slice(prefix.length).replace(/\/$/, "") }));
  } else {
    const res = await listFolder(bucket, prefix, q.get("token") ?? undefined);
    folders = res.folders;
    files = res.files;
    nextToken = res.nextToken;
  }

  const withUrls = await Promise.all(
    files.map(async (f) => {
      const url = resolve(f.key);
      let thumb: string | null = null;
      if (thumbs && IMAGE.test(f.key) && f.size <= 25 * 1024 * 1024)
        thumb = url ?? (await presignGet(bucket, f.key, 3600));
      return { ...f, url, thumb };
    }),
  );

  return json({ folders, files: withUrls, nextToken, truncated });
});

export const DELETE = handle(async (req: NextRequest) => {
  const b = await body<{ bucket?: string; keys?: string[]; permanent?: boolean }>(req);
  const bucket = requireBucket(b.bucket);
  if (!Array.isArray(b.keys) || b.keys.length === 0) throw new HttpError(400, "keys is required");
  if (b.keys.some((k) => typeof k !== "string" || k === "" || k === "/"))
    throw new HttpError(400, "errors.deleteRoot");
  invalidateStats(bucket);
  const keys = b.keys;
  return deferred(async () => {
    const res = await deleteKeys(bucket, keys, b.permanent === true);
    invalidateStats(bucket);
    return res;
  });
});
