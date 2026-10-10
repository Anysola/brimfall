import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "bf_session";

function secret(): string {
  return process.env.SESSION_SECRET ?? "";
}

// Tokens are signed with the password mixed in, so changing DASHBOARD_PASSWORD logs every session out.
function signingKey(): string {
  const pw = createHash("sha256").update(process.env.DASHBOARD_PASSWORD ?? "").digest("hex");
  return `${secret()}:${pw}`;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", signingKey()).update(data).digest("base64url");
}

// Sessions ended by logout. In memory, so a restart forgets them; rotate SESSION_SECRET to end every session.
const g = globalThis as unknown as { __bfRevoked?: Map<string, number> };
const revoked: Map<string, number> = (g.__bfRevoked ??= new Map());

export function createSession(ttlHours: number): { token: string; maxAge: number } {
  const maxAge = Math.round(ttlHours * 3600);
  const payload = b64url(
    JSON.stringify({ exp: Date.now() + maxAge * 1000, sid: randomBytes(12).toString("base64url"), v: 2 }),
  );
  return { token: `${payload}.${sign(payload)}`, maxAge };
}

function readSession(token: string | undefined | null): { exp: number; sid?: string } | null {
  if (!token || secret().length < 32) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof s.exp !== "number" || s.exp <= Date.now()) return null;
    if (typeof s.sid === "string" && revoked.has(s.sid)) return null;
    return s;
  } catch {
    return null;
  }
}

export function verifySession(token: string | undefined | null): boolean {
  return readSession(token) !== null;
}

export function revokeSession(token: string | undefined | null) {
  const s = readSession(token);
  if (!s?.sid) return;
  const now = Date.now();
  for (const [k, exp] of revoked) if (exp <= now) revoked.delete(k);
  revoked.set(s.sid, s.exp);
}

export function passwordMatches(input: string): boolean {
  const pw = process.env.DASHBOARD_PASSWORD ?? "";
  if (!pw) return false;
  // Compare HMACs so lengths always match and timing does not leak length.
  const a = createHmac("sha256", "pw").update(input).digest();
  const b = createHmac("sha256", "pw").update(pw).digest();
  return timingSafeEqual(a, b);
}

/**
 * Client IP for rate limiting. CLIENT_IP_HEADER names the header your reverse proxy sets
 * (cf-connecting-ip for Cloudflare, x-real-ip for nginx). Otherwise the last X-Forwarded-For
 * hop is used: that is the one the nearest proxy appended, the earlier ones are client supplied.
 */
export function clientIp(headers: Headers): string {
  const name = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (name) return headers.get(name)?.split(",").pop()?.trim() || "unknown";
  return headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "local";
}

// In-memory brute-force guard: 10 failed attempts per IP, and 50 in total
// (so rotating IPs or spoofed headers do not help), per 15 minutes.
const attempts = new Map<string, { count: number; reset: number }>();
const WINDOW = 15 * 60 * 1000;
const PER_IP = 10;
const GLOBAL = 50;
const MAX_TRACKED = 10_000;
let global = { count: 0, reset: 0 };

export function loginBlocked(ip: string): number {
  const now = Date.now();
  if (global.reset > now && global.count >= GLOBAL) return Math.ceil((global.reset - now) / 1000);
  const a = attempts.get(ip);
  if (!a || a.reset < now) return 0;
  return a.count >= PER_IP ? Math.ceil((a.reset - now) / 1000) : 0;
}

export function recordFailure(ip: string) {
  const now = Date.now();
  if (global.reset < now) global = { count: 0, reset: now + WINDOW };
  global.count++;
  if (attempts.size >= MAX_TRACKED) {
    for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
    // Still full: drop the oldest entries (Map keeps insertion order).
    for (const k of attempts.keys()) {
      if (attempts.size < MAX_TRACKED) break;
      attempts.delete(k);
    }
  }
  const a = attempts.get(ip);
  if (!a || a.reset < now) attempts.set(ip, { count: 1, reset: now + WINDOW });
  else a.count++;
}

export function clearFailures(ip: string) {
  attempts.delete(ip);
}
