import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

const PUBLIC = ["/login", "/api/auth/login", "/api/health", "/icon.svg", "/logo.svg"];
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

/**
 * CSRF guard for state-changing requests. SameSite=Lax does not stop same-site
 * origins (e.g. HTML served from cdn.<your-domain>), so only same-origin requests pass.
 */
function crossSite(req: NextRequest): boolean {
  if (SAFE_METHODS.includes(req.method)) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin";
  // Older browsers: compare Origin with the host the browser used.
  const origin = req.headers.get("origin");
  if (!origin) return false; // not a browser request
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (crossSite(req)) return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  if (PUBLIC.includes(pathname) || pathname.startsWith("/fonts/")) return NextResponse.next();

  if (verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
