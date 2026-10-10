import { NextRequest, NextResponse } from "next/server";
import {
  clearFailures,
  clientIp,
  createSession,
  loginBlocked,
  passwordMatches,
  recordFailure,
  SESSION_COOKIE,
} from "@/lib/auth";
import { config, configProblems } from "@/lib/config";

export async function POST(req: NextRequest) {
  const problems = configProblems().filter((p) => p !== "errors.config.b2");
  if (problems.length) return NextResponse.json({ error: problems[0] }, { status: 500 });

  const ip = clientIp(req.headers);
  const wait = loginBlocked(ip);
  if (wait) return NextResponse.json({ error: "errors.tooManyAttempts", vars: { seconds: wait } }, { status: 429 });

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof password !== "string" || !passwordMatches(password)) {
    recordFailure(ip);
    return NextResponse.json({ error: "errors.wrongPassword" }, { status: 401 });
  }
  clearFailures(ip);
  const { token, maxAge } = createSession(config.sessionTtlHours);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge,
  });
  return res;
}
