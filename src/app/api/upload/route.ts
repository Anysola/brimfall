import { NextRequest } from "next/server";
import { body, handle, HttpError, json, requireBucket, requireString } from "@/lib/api";
import { invalidateStats } from "@/lib/statsCache";
import { abortMultipart, completeMultipart, createMultipart, presignParts, presignPut } from "@/lib/s3";

export const dynamic = "force-dynamic";

const SINGLE_LIMIT = 64 * 1024 * 1024;
const MIN_PART = 16 * 1024 * 1024;
const MAX_PARTS = 9_500;
const MAX_SIZE = 10 * 1000 ** 4; // B2 file size limit (10 TB)

type Body = {
  action?: "init" | "parts" | "complete" | "abort";
  bucket?: string;
  key?: string;
  size?: number;
  contentType?: string;
  uploadId?: string;
  partNumbers?: number[];
  parts?: { PartNumber: number; ETag: string }[];
};

export const POST = handle(async (req: NextRequest) => {
  const b = await body<Body>(req);
  const bucket = requireBucket(b.bucket);
  const key = requireString(b.key, "key");

  switch (b.action) {
    case "init": {
      invalidateStats(bucket);
      const size = Number(b.size ?? 0);
      if (!Number.isFinite(size) || size < 0 || size > MAX_SIZE) throw new HttpError(400, "errors.invalidSize");
      const contentType = b.contentType || "application/octet-stream";
      if (size <= SINGLE_LIMIT) {
        return json({ mode: "single", url: await presignPut(bucket, key, contentType), contentType });
      }
      const partSize = Math.max(MIN_PART, Math.ceil(size / MAX_PARTS / (1024 * 1024)) * 1024 * 1024);
      const uploadId = await createMultipart(bucket, key, contentType);
      return json({ mode: "multipart", uploadId, partSize, partCount: Math.ceil(size / partSize) });
    }
    case "parts": {
      const uploadId = requireString(b.uploadId, "uploadId");
      const nums = (b.partNumbers ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10_000).slice(0, 100);
      return json({ urls: await presignParts(bucket, key, uploadId, nums) });
    }
    case "complete": {
      const uploadId = requireString(b.uploadId, "uploadId");
      if (!Array.isArray(b.parts) || !b.parts.length) throw new HttpError(400, "parts is required");
      await completeMultipart(bucket, key, uploadId, b.parts);
      invalidateStats(bucket);
      return json({ ok: true });
    }
    case "abort": {
      await abortMultipart(bucket, key, requireString(b.uploadId, "uploadId"));
      return json({ ok: true });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
});
