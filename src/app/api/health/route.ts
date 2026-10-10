export const dynamic = "force-dynamic";

/** Liveness probe for Docker / uptime monitors. Doesn't touch B2. */
export function GET() {
  return Response.json({ ok: true });
}
