import "server-only";
import {
  S3Client,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  UploadPartCopyCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListBucketsCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config";
import { B2Error, b2Configured, getAuth } from "./b2";

let client: { s3: S3Client; endpoint: string } | null = null;

function regionFromEndpoint(endpoint: string): string {
  const m = endpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
  return m ? m[1] : "us-east-1";
}

export async function getS3(): Promise<S3Client> {
  if (client) return client.s3;
  let endpoint: string;
  let accessKeyId: string;
  let secretAccessKey: string;
  if (config.s3Endpoint) {
    endpoint = config.s3Endpoint;
    accessKeyId = config.s3AccessKeyId ?? config.b2KeyId ?? "";
    secretAccessKey = config.s3SecretAccessKey ?? config.b2AppKey ?? "";
  } else {
    const auth = await getAuth();
    // The master key's ID is the account ID, and B2's S3 API rejects it ("Malformed Access Key Id").
    if (config.b2KeyId === auth.accountId)
      throw new B2Error(
        400,
        "master_key_not_supported",
        "The B2 master key does not work with the S3 API. Create an application key (Application keys page, 'Everything') and put it in B2_KEY_ID / B2_APP_KEY.",
      );
    endpoint = auth.s3ApiUrl;
    accessKeyId = config.b2KeyId!;
    secretAccessKey = config.b2AppKey!;
  }
  const s3 = new S3Client({
    endpoint,
    region: config.s3Region ?? regionFromEndpoint(endpoint),
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: config.s3ForcePathStyle,
    // B2 does not need (and older B2 endpoints reject) the SDK's default CRC32 headers.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  client = { s3, endpoint };
  return s3;
}

export function nativeApiAvailable(): boolean {
  return b2Configured() && !config.s3Endpoint;
}

// ── Types ───────────────────────────────────────────────────────

export interface FileEntry {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
}

export interface FolderEntry {
  key: string;
  name: string;
}

function baseName(key: string, prefix: string): string {
  return key.slice(prefix.length).replace(/\/$/, "");
}

function toFile(o: _Object, prefix: string): FileEntry {
  return {
    key: o.Key!,
    name: baseName(o.Key!, prefix),
    size: o.Size ?? 0,
    lastModified: o.LastModified ? o.LastModified.toISOString() : null,
    etag: o.ETag ? o.ETag.replace(/"/g, "") : null,
  };
}

// ── Listing ─────────────────────────────────────────────────────

export async function listS3Buckets(): Promise<string[]> {
  const s3 = await getS3();
  const res = await s3.send(new ListBucketsCommand({}));
  return (res.Buckets ?? []).map((b) => b.Name!).sort();
}

export async function listFolder(bucket: string, prefix: string, token?: string, pageSize = 1000) {
  const s3 = await getS3();
  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
      MaxKeys: pageSize,
      ContinuationToken: token || undefined,
    }),
  );
  const folders: FolderEntry[] = (res.CommonPrefixes ?? []).map((p) => ({
    key: p.Prefix!,
    name: baseName(p.Prefix!, prefix),
  }));
  const files = (res.Contents ?? [])
    // Hide the zero-byte "folder marker" for the folder being viewed.
    .filter((o) => o.Key !== prefix)
    .map((o) => toFile(o, prefix));
  return { folders, files, nextToken: res.NextContinuationToken ?? null };
}

export async function* iterateObjects(bucket: string, prefix: string) {
  const s3 = await getS3();
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of res.Contents ?? []) yield o;
    token = res.NextContinuationToken;
  } while (token);
}

export interface VersionEntry {
  key: string;
  versionId: string;
  size: number;
  lastModified: string | null;
  isLatest: boolean;
  deleteMarker: boolean;
}

export async function* iterateVersions(bucket: string, prefix: string): AsyncGenerator<VersionEntry> {
  const s3 = await getS3();
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  for (;;) {
    const res = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
        MaxKeys: 1000,
      }),
    );
    for (const v of res.Versions ?? [])
      yield {
        key: v.Key!,
        versionId: v.VersionId!,
        size: v.Size ?? 0,
        lastModified: v.LastModified?.toISOString() ?? null,
        isLatest: Boolean(v.IsLatest),
        deleteMarker: false,
      };
    for (const d of res.DeleteMarkers ?? [])
      yield {
        key: d.Key!,
        versionId: d.VersionId!,
        size: 0,
        lastModified: d.LastModified?.toISOString() ?? null,
        isLatest: Boolean(d.IsLatest),
        deleteMarker: true,
      };
    if (!res.IsTruncated) break;
    keyMarker = res.NextKeyMarker;
    versionMarker = res.NextVersionIdMarker;
  }
}

export async function listKeyVersions(bucket: string, key: string): Promise<VersionEntry[]> {
  const out: VersionEntry[] = [];
  for await (const v of iterateVersions(bucket, key)) if (v.key === key) out.push(v);
  return out.sort((a, b) => (b.lastModified ?? "").localeCompare(a.lastModified ?? ""));
}

// ── Delete ──────────────────────────────────────────────────────

type DelTarget = { Key: string; VersionId?: string };

async function deleteBatch(bucket: string, targets: DelTarget[]): Promise<string[]> {
  const s3 = await getS3();
  const errors: string[] = [];
  for (let i = 0; i < targets.length; i += 1000) {
    const chunk = targets.slice(i, i + 1000);
    try {
      const res = await s3.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk, Quiet: true } }),
      );
      for (const e of res.Errors ?? []) errors.push(`${e.Key}: ${e.Message}`);
    } catch {
      // Fallback for endpoints that reject batch deletes: delete one by one.
      await pool(chunk, 16, async (t) => {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: t.Key, VersionId: t.VersionId }));
        } catch (e) {
          errors.push(`${t.Key}: ${(e as Error).message}`);
        }
      });
    }
  }
  return errors;
}

/**
 * Delete files and folders (keys ending in "/").
 * permanent=true removes every version (frees storage on B2);
 * permanent=false only hides the latest version.
 */
export async function deleteKeys(bucket: string, keys: string[], permanent: boolean) {
  const targets: DelTarget[] = [];
  for (const key of keys) {
    const isFolder = key.endsWith("/");
    if (permanent) {
      for await (const v of iterateVersions(bucket, key)) {
        if (isFolder || v.key === key) targets.push({ Key: v.key, VersionId: v.versionId });
      }
    } else if (isFolder) {
      for await (const o of iterateObjects(bucket, key)) targets.push({ Key: o.Key! });
    } else {
      targets.push({ Key: key });
    }
  }
  const errors = await deleteBatch(bucket, targets);
  return { deleted: targets.length - errors.length, errors };
}

export async function deleteVersion(bucket: string, key: string, versionId: string) {
  const s3 = await getS3();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
}

// ── Copy / move ─────────────────────────────────────────────────

const COPY_LIMIT = 5 * 1024 ** 3;
const COPY_PART = 1024 ** 3;

function copySource(bucket: string, key: string, versionId?: string) {
  const enc = encodeURIComponent(key).replace(/%2F/g, "/");
  return `${bucket}/${enc}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`;
}

export async function copyObject(bucket: string, from: string, to: string, size?: number, versionId?: string) {
  const s3 = await getS3();
  if (size === undefined) {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: from, VersionId: versionId }));
    size = head.ContentLength ?? 0;
  }
  if (size <= COPY_LIMIT) {
    await s3.send(
      new CopyObjectCommand({ Bucket: bucket, Key: to, CopySource: copySource(bucket, from, versionId) }),
    );
    return;
  }
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: from, VersionId: versionId }));
  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: to,
      ContentType: head.ContentType,
      Metadata: head.Metadata,
    }),
  );
  try {
    const ranges: { n: number; start: number; end: number }[] = [];
    for (let start = 0, n = 1; start < size; start += COPY_PART, n++)
      ranges.push({ n, start, end: Math.min(start + COPY_PART, size) - 1 });
    const parts = await pool(ranges, 4, async (r) => {
      const res = await s3.send(
        new UploadPartCopyCommand({
          Bucket: bucket,
          Key: to,
          UploadId,
          PartNumber: r.n,
          CopySource: copySource(bucket, from, versionId),
          CopySourceRange: `bytes=${r.start}-${r.end}`,
        }),
      );
      return { PartNumber: r.n, ETag: res.CopyPartResult!.ETag! };
    });
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: to,
        UploadId,
        MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
      }),
    );
  } catch (e) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: to, UploadId })).catch(() => {});
    throw e;
  }
}

/** Destination keys (from `to`) that already hold a file. Folder markers do not count. */
async function existingKeys(bucket: string, items: { to: string }[], jobs: { to: string }[]) {
  const s3 = await getS3();
  const existing = new Set<string>();
  for (const { to } of items) {
    if (to.endsWith("/")) {
      for await (const o of iterateObjects(bucket, to)) existing.add(o.Key!);
      continue;
    }
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: to }));
      existing.add(to);
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw e;
    }
  }
  return jobs.map((j) => j.to).filter((k) => !k.endsWith("/") && existing.has(k));
}

/**
 * Copy or move a file or a whole folder (keys ending in "/").
 * Unless overwrite is set, nothing is copied when a destination file already
 * exists; the conflicting keys are returned instead.
 */
export async function moveKeys(
  bucket: string,
  items: { from: string; to: string }[],
  keepSource: boolean,
  overwrite = false,
) {
  type Job = { item: string; from: string; to: string; size: number; versionId?: string };
  const jobs = new Map<string, Job>();
  const errors: string[] = [];
  // A move only deletes the source versions listed here, before anything was
  // copied, so files uploaded into the source while it runs are never lost.
  const snapshot: { item: string; v: VersionEntry }[] = [];
  const moving = items.filter((i) => i.from !== i.to);

  for (const { from, to } of moving) {
    const isFolder = from.endsWith("/");
    if (isFolder && to.startsWith(from)) throw new Error("errors.folderIntoItself");
    const before = jobs.size;
    if (keepSource) {
      if (isFolder) {
        for await (const o of iterateObjects(bucket, from))
          jobs.set(o.Key!, { item: from, from: o.Key!, to: to + o.Key!.slice(from.length), size: o.Size ?? 0 });
      } else jobs.set(from, { item: from, from, to, size: -1 });
      continue;
    }
    for await (const v of iterateVersions(bucket, from)) {
      if (!isFolder && v.key !== from) continue;
      snapshot.push({ item: from, v });
      if (v.isLatest && !v.deleteMarker)
        jobs.set(v.key, { item: from, from: v.key, to: to + v.key.slice(from.length), size: v.size, versionId: v.versionId });
    }
    if (!isFolder && jobs.size === before) errors.push(`${from}: not found`);
  }

  if (!overwrite) {
    const conflicts = await existingKeys(bucket, moving, [...jobs.values()]);
    if (conflicts.length) return { copied: 0, errors, conflicts: conflicts.slice(0, 100), conflictCount: conflicts.length };
  }

  const done = new Set<string>();
  const failedItems = new Set<string>();
  await pool([...jobs.values()], 8, async (j) => {
    try {
      await copyObject(bucket, j.from, j.to, j.size >= 0 ? j.size : undefined, j.versionId);
      done.add(j.from);
    } catch (e) {
      failedItems.add(j.item);
      errors.push(`${j.from}: ${(e as Error).message}`);
    }
  });

  if (!keepSource && done.size) {
    // A move leaves nothing behind: remove all versions of what was copied. In a
    // folder that moved without errors, also remove files that were already
    // hidden (their old versions would stay billed).
    const seen = new Set<string>();
    const targets: DelTarget[] = [];
    for (const { item, v } of snapshot) {
      const hiddenOnly = !jobs.has(v.key);
      if (!done.has(v.key) && !(hiddenOnly && item.endsWith("/") && !failedItems.has(item))) continue;
      const id = `${v.key}\n${v.versionId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      targets.push({ Key: v.key, VersionId: v.versionId });
    }
    errors.push(...(await deleteBatch(bucket, targets)));
  }
  return { copied: done.size, errors, conflicts: [] as string[], conflictCount: 0 };
}

// ── Misc object ops ─────────────────────────────────────────────

export async function createFolder(bucket: string, key: string) {
  const s3 = await getS3();
  const k = key.endsWith("/") ? key : `${key}/`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: k, Body: "" }));
}

export async function headObject(bucket: string, key: string) {
  const s3 = await getS3();
  const h = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return {
    key,
    size: h.ContentLength ?? 0,
    contentType: h.ContentType ?? null,
    lastModified: h.LastModified?.toISOString() ?? null,
    etag: h.ETag?.replace(/"/g, "") ?? null,
    versionId: h.VersionId ?? null,
    cacheControl: h.CacheControl ?? null,
    metadata: h.Metadata ?? {},
  };
}

export async function readText(bucket: string, key: string, maxBytes: number) {
  const s3 = await getS3();
  let res;
  try {
    res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${maxBytes - 1}` }));
  } catch (e) {
    // Empty objects answer a byte range with 416.
    if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 416)
      return { text: "", truncated: false };
    throw e;
  }
  const bytes = await res.Body!.transformToByteArray();
  const total = Number(res.ContentRange?.split("/")[1] ?? bytes.length);
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), truncated: total > bytes.length };
}

export async function presignGet(
  bucket: string,
  key: string,
  expiresIn: number,
  opts: { download?: boolean; versionId?: string } = {},
) {
  const s3 = await getS3();
  const name = key.split("/").pop() || "file";
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: opts.versionId,
      ResponseContentDisposition: opts.download
        ? `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
        : undefined,
    }),
    { expiresIn },
  );
}

// ── Uploads (browser → B2 directly via presigned URLs) ──────────

export async function presignPut(bucket: string, key: string, contentType: string) {
  const s3 = await getS3();
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
    expiresIn: 3600,
  });
}

export async function createMultipart(bucket: string, key: string, contentType: string) {
  const s3 = await getS3();
  const res = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
  return res.UploadId!;
}

export async function presignParts(bucket: string, key: string, uploadId: string, partNumbers: number[]) {
  const s3 = await getS3();
  const urls: Record<number, string> = {};
  for (const n of partNumbers)
    urls[n] = await getSignedUrl(
      s3,
      new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: n }),
      { expiresIn: 3600 },
    );
  return urls;
}

export async function completeMultipart(
  bucket: string,
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
) {
  const s3 = await getS3();
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber) },
    }),
  );
}

export async function abortMultipart(bucket: string, key: string, uploadId: string) {
  const s3 = await getS3();
  await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
}

export async function listMultipartUploads(bucket: string) {
  const s3 = await getS3();
  const out: { key: string; uploadId: string; initiated: string | null }[] = [];
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  for (;;) {
    const res = await s3.send(
      new ListMultipartUploadsCommand({ Bucket: bucket, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker }),
    );
    for (const u of res.Uploads ?? [])
      out.push({ key: u.Key!, uploadId: u.UploadId!, initiated: u.Initiated?.toISOString() ?? null });
    if (!res.IsTruncated) break;
    keyMarker = res.NextKeyMarker;
    uploadIdMarker = res.NextUploadIdMarker;
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────

export async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}
