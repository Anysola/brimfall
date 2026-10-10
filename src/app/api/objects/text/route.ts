import { NextRequest } from "next/server";
import { handle, json, requireBucket, requireString } from "@/lib/api";
import { publicUrlResolver } from "@/lib/buckets";
import { readText } from "@/lib/s3";

export const dynamic = "force-dynamic";

const MAX = 256 * 1024;

export const GET = handle(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const bucket = requireBucket(q.get("bucket"));
  const key = requireString(q.get("key"), "key");

  // Read through the CDN when the file is public, so B2 egress is not used.
  const url = (await publicUrlResolver(bucket))(key);
  if (url) {
    try {
      const res = await fetch(url, {
        headers: { Range: `bytes=0-${MAX - 1}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 416) return json({ text: "", truncated: false });
      if (res.ok && res.body) {
        // Never buffer more than MAX, even if the CDN ignores the Range header.
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (size < MAX) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.length;
        }
        reader.cancel().catch(() => {});
        const bytes = new Uint8Array(size);
        let off = 0;
        for (const c of chunks) {
          bytes.set(c, off);
          off += c.length;
        }
        const total = Number(res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length") ?? size);
        const text = new TextDecoder().decode(bytes.subarray(0, MAX));
        return json({ text, truncated: total > MAX || size > MAX });
      }
    } catch {
      // CDN unreachable from the server: fall back to S3.
    }
  }
  return json(await readText(bucket, key, MAX));
});
