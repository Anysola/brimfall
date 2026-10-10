"use client";

import { useBrand } from "@/i18n/client";

/** Brimfall mark: a drop falling into a brimming bucket. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <path d="M50 3 C44 12 38.5 18.5 38.5 26 A11.5 11.5 0 0 0 61.5 26 C61.5 18.5 56 12 50 3 Z" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 47 H84 L75.5 87 Q74.5 92 69.5 92 H30.5 Q25.5 92 24.5 87 Z" />
        <path d="M25 62 Q37.5 55 50 62 T75 62" />
      </g>
    </svg>
  );
}

/** App logo: the instance's LOGO_URL when set, otherwise the Brimfall mark. */
export function Logo({ size = 28 }: { size?: number }) {
  const brand = useBrand();
  if (brand.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brand.logoUrl} alt="" width={size} height={size} className="shrink-0 rounded-[30%] object-contain" />;
  }
  return (
    <div className="grid shrink-0 place-items-center rounded-[30%] bg-accent text-accent-fg" style={{ width: size, height: size }}>
      <LogoMark className="h-[64%] w-[64%]" />
    </div>
  );
}
