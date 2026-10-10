"use client";

import { currentLocale, t } from "@/i18n/client";
import type { MessageKey, Vars } from "@/i18n/format";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public vars?: Vars,
  ) {
    super(message);
  }
}

/** Human text for an error. Server errors of our own arrive as "errors.*" message keys. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  const err = e as { message?: string; vars?: Vars } | null;
  const msg = err?.message || String(e);
  if (msg.startsWith("errors.")) return t(msg as MessageKey, err?.vars);
  return msg;
}

export async function api<T = unknown>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined | null>;
    onProgress?: (n: number) => void;
  } = {},
): Promise<T> {
  let url = path;
  if (init.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "errors.network");
  }
  if (res.status === 401 && !path.startsWith("/api/auth")) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new ApiError(401, "errors.sessionExpired");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? t("errors.requestFailed", { status: res.status }), data.code, data.vars);
  // Long operation continuing in the background: poll until it finishes.
  if (res.status === 202 && data.jobId) return pollJob<T>(data.jobId, init.onProgress);
  return data as T;
}

async function pollJob<T>(id: string, onProgress?: (n: number) => void): Promise<T> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const j = await api<{ status: string; progress: number; result: T }>("/api/jobs", { query: { id } });
    if (j.status === "done") return j.result;
    onProgress?.(j.progress);
  }
}

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte", "petabyte"] as const;

/** 1.5 MB, 1,5 MB, 1.5 МБ… following the UI language (binary multiples, as storage providers bill). */
export function formatBytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${formatNumber(n)} B`;
  const max = v >= 100 ? 0 : digits;
  return new Intl.NumberFormat(currentLocale(), { style: "unit", unit: UNITS[i], unitDisplay: "short", maximumFractionDigits: max }).format(v);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(currentLocale()).format(n);
}

export function formatDate(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  return new Date(iso).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
}

export function formatDay(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  return new Date(iso).toLocaleDateString(currentLocale(), { dateStyle: "medium" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto", style: "short" });
  if (s < 45) return rtf.format(0, "second");
  const m = Math.round(s / 60);
  if (m < 60) return rtf.format(-m, "minute");
  const h = Math.round(m / 60);
  if (h < 24) return rtf.format(-h, "hour");
  const d = Math.round(h / 24);
  if (d < 30) return rtf.format(-d, "day");
  return formatDay(iso);
}

export function parentPrefix(key: string): string {
  const k = key.endsWith("/") ? key.slice(0, -1) : key;
  const i = k.lastIndexOf("/");
  return i === -1 ? "" : k.slice(0, i + 1);
}

export function lastSegment(key: string): string {
  const k = key.endsWith("/") ? key.slice(0, -1) : key;
  return k.slice(k.lastIndexOf("/") + 1);
}

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
