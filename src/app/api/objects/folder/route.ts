import { NextRequest } from "next/server";
import { body, handle, json, requireBucket, requireString } from "@/lib/api";
import { createFolder } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest) => {
  const b = await body<{ bucket?: string; key?: string }>(req);
  await createFolder(requireBucket(b.bucket), requireString(b.key, "key"));
  return json({ ok: true });
});
