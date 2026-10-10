import { NextRequest } from "next/server";
import { deferred, handle, json, requireBucket } from "@/lib/api";
import { categoryOf, type FileCategory } from "@/lib/filetypes";
import { iterateObjects, iterateVersions, type VersionEntry } from "@/lib/s3";
import { statsCache as cache } from "@/lib/statsCache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SCAN_LIMIT = 2_000_000;
const TTL = 5 * 60 * 1000;

interface Mini {
  key: string;
  size: number;
  lastModified: string | null;
}

interface Stats {
  bucket: string;
  prefix: string;
  scannedAt: string;
  truncated: boolean;
  versionsScanned: boolean;
  current: { count: number; bytes: number };
  oldVersions: { count: number; bytes: number };
  hiddenFiles: number;
  byFolder: { name: string; count: number; bytes: number }[];
  byType: { type: FileCategory; count: number; bytes: number }[];
  largest: Mini[];
  recent: Mini[];
}


function pushTop(list: Mini[], item: Mini, n: number, cmp: (a: Mini, b: Mini) => number) {
  if (list.length < n) {
    list.push(item);
    list.sort(cmp);
  } else if (cmp(item, list[n - 1]) < 0) {
    list[n - 1] = item;
    list.sort(cmp);
  }
}

async function compute(bucket: string, prefix: string, progress: (n: number) => void): Promise<Stats> {
  const s: Stats = {
    bucket,
    prefix,
    scannedAt: new Date().toISOString(),
    truncated: false,
    versionsScanned: true,
    current: { count: 0, bytes: 0 },
    oldVersions: { count: 0, bytes: 0 },
    hiddenFiles: 0,
    byFolder: [],
    byType: [],
    largest: [],
    recent: [],
  };
  const folders = new Map<string, { count: number; bytes: number }>();
  const types = new Map<FileCategory, { count: number; bytes: number }>();
  const bySize = (a: Mini, b: Mini) => b.size - a.size;
  const byDate = (a: Mini, b: Mini) => (b.lastModified ?? "").localeCompare(a.lastModified ?? "");

  const addCurrent = (key: string, size: number, lastModified: string | null) => {
    if (key.endsWith("/") && size === 0) return; // folder marker
    s.current.count++;
    s.current.bytes += size;
    const rel = key.slice(prefix.length);
    const slash = rel.indexOf("/");
    const folder = slash === -1 ? "" : rel.slice(0, slash + 1); // "" = files directly in this folder
    const f = folders.get(folder) ?? { count: 0, bytes: 0 };
    f.count++;
    f.bytes += size;
    folders.set(folder, f);
    const cat = categoryOf(key);
    const t = types.get(cat) ?? { count: 0, bytes: 0 };
    t.count++;
    t.bytes += size;
    types.set(cat, t);
    const m = { key, size, lastModified };
    pushTop(s.largest, m, 10, bySize);
    pushTop(s.recent, m, 10, byDate);
  };

  let n = 0;
  try {
    for await (const v of iterateVersions(bucket, prefix) as AsyncGenerator<VersionEntry>) {
      if (++n % 1000 === 0) progress(n);
      if (n > SCAN_LIMIT) {
        s.truncated = true;
        break;
      }
      if (v.deleteMarker) {
        if (v.isLatest) s.hiddenFiles++;
      } else if (v.isLatest) addCurrent(v.key, v.size, v.lastModified);
      else {
        s.oldVersions.count++;
        s.oldVersions.bytes += v.size;
      }
    }
  } catch (e) {
    // A failure mid-scan is a real error; falling back now would count objects twice.
    if (n > 0) throw e;
    // Endpoint without ListObjectVersions: current objects only.
    s.versionsScanned = false;
    for await (const o of iterateObjects(bucket, prefix)) {
      if (++n % 1000 === 0) progress(n);
      if (n > SCAN_LIMIT) {
        s.truncated = true;
        break;
      }
      addCurrent(o.Key!, o.Size ?? 0, o.LastModified?.toISOString() ?? null);
    }
  }
  s.byFolder = [...folders].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.bytes - a.bytes);
  s.byType = [...types].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.bytes - a.bytes);
  return s;
}

export const GET = handle(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const bucket = requireBucket(q.get("bucket"));
  const prefix = q.get("prefix") ?? "";
  const ck = `${bucket}\n${prefix}`;
  const hit = cache.get(ck);
  if (hit && q.get("refresh") !== "1" && Date.now() - hit.at < TTL) return json({ ...(hit.stats as Stats), cached: true });
  return deferred(async (progress) => {
    const stats = await compute(bucket, prefix, progress);
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at > TTL) cache.delete(k);
    cache.set(ck, { at: now, stats });
    return { ...stats, cached: false };
  });
});
