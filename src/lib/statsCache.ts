import "server-only";

export interface CachedStats {
  at: number;
  stats: unknown;
}

const g = globalThis as unknown as { __bfStats?: Map<string, CachedStats> };
export const statsCache: Map<string, CachedStats> = (g.__bfStats ??= new Map());

/** Drop cached usage numbers for a bucket after anything changes in it. */
export function invalidateStats(bucket: string) {
  for (const k of statsCache.keys()) if (k.startsWith(`${bucket}\n`)) statsCache.delete(k);
}
