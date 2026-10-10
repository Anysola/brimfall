import "server-only";
import { NextResponse } from "next/server";
import { B2Error } from "./b2";
import { runOrDefer } from "./jobs";

/** An error for the client. Messages starting with "errors." are translation keys (see src/i18n/messages/en.json). */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public vars?: Record<string, string | number>,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorStatus(e: unknown): number {
  if (e instanceof HttpError) return e.status;
  let status = 500;
  if (e instanceof B2Error) status = e.status;
  else {
    const meta = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata;
    if (meta?.httpStatusCode) status = meta.httpStatusCode;
  }
  // A 401 from B2 means the key lacks a capability or is invalid, not that the
  // dashboard session expired; passing it through would bounce the browser to /login.
  return status === 401 ? 403 : status;
}

export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      const status = errorStatus(e);
      const err = e as { name?: string; message?: string; code?: string; Code?: string };
      const code = (e instanceof B2Error ? e.code : undefined) ?? err.Code ?? err.name ?? "error";
      if (status >= 500) console.error("[api]", e);
      const vars = e instanceof HttpError ? e.vars : undefined;
      return json({ error: err.message || String(e), code, vars }, status >= 400 ? status : 500);
    }
  };
}

export function requireString(v: unknown, name: string): string {
  if (typeof v !== "string" || v === "") throw new HttpError(400, `${name} is required`);
  return v;
}

export function requireBucket(v: unknown): string {
  const b = requireString(v, "bucket");
  if (!/^[A-Za-z0-9.-]{3,63}$/.test(b)) throw new HttpError(400, "errors.invalidBucketName");
  return b;
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "Content-Type must be application/json");
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

/** Run a possibly long operation; respond 202 + jobId if it outlasts the proxy-safe window. */
export async function deferred<T>(fn: (progress: (n: number) => void) => Promise<T>) {
  const r = await runOrDefer(fn, errorStatus);
  return r.done ? json(r.result) : json({ jobId: r.jobId }, 202);
}
