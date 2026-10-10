import { NextRequest } from "next/server";
import { body, handle, HttpError, json, requireString } from "@/lib/api";
import { ALL_CAPABILITIES, createKey, deleteKey, listKeys } from "@/lib/b2";
import { config } from "@/lib/config";
import { nativeApiAvailable } from "@/lib/s3";

export const dynamic = "force-dynamic";

function ensureNative() {
  if (!nativeApiAvailable()) throw new HttpError(400, "errors.nativeApiRequired");
}

export const GET = handle(async () => {
  ensureNative();
  const keys = await listKeys();
  return json({ keys, currentKeyId: config.b2KeyId, allCapabilities: ALL_CAPABILITIES });
});

export const POST = handle(async (req: NextRequest) => {
  ensureNative();
  const b = await body<{
    keyName?: string;
    capabilities?: string[];
    bucketId?: string;
    namePrefix?: string;
    validDays?: number;
  }>(req);
  const keyName = requireString(b.keyName, "keyName");
  if (!/^[A-Za-z0-9-]{1,100}$/.test(keyName)) throw new HttpError(400, "errors.keyNameRules");
  const capabilities = (b.capabilities ?? []).filter((c) => ALL_CAPABILITIES.includes(c));
  if (!capabilities.length) throw new HttpError(400, "errors.pickCapability");
  const days = Number(b.validDays ?? 0);
  const key = await createKey({
    keyName,
    capabilities,
    bucketId: b.bucketId || undefined,
    namePrefix: b.namePrefix || undefined,
    validDurationInSeconds: days > 0 ? Math.min(Math.round(days * 86400), 1000 * 86400) : undefined,
  });
  return json({ key });
});

export const DELETE = handle(async (req: NextRequest) => {
  ensureNative();
  const id = requireString(req.nextUrl.searchParams.get("id"), "id");
  if (id === config.b2KeyId) throw new HttpError(400, "errors.ownKey");
  await deleteKey(id);
  return json({ ok: true });
});
