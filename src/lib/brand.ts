import "server-only";
import type { Brand } from "@/i18n/client";

/** Instance branding from the environment (APP_NAME, LOGO_URL). */
export function getBrand(): Brand {
  const name = (process.env.APP_NAME || "Brimfall").trim().slice(0, 60) || "Brimfall";
  const logoUrl = process.env.LOGO_URL?.trim() || undefined;
  return { name, logoUrl };
}
