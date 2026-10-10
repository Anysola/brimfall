import "server-only";
import { config } from "./config";

export function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Public URL for an object: CDN base when configured, otherwise B2's friendly URL. */
export function publicUrl(bucket: string, key: string, downloadUrl?: string | null): string | null {
  // URLs resolve "." and ".." segments (even percent-encoded), so such keys have no working public URL.
  if (key.split("/").some((seg) => seg === "." || seg === "..")) return null;
  const cdn = config.cdnUrls[bucket];
  if (cdn) return `${cdn}/${encodeKey(key)}`;
  if (downloadUrl) return `${downloadUrl}/file/${bucket}/${encodeKey(key)}`;
  return null;
}
