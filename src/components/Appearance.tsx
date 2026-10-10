"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { applyAppearance, readAppearance, SEEDS, swatch, DEFAULT_APPEARANCE, type Appearance, type Contrast, type Density, type Variant } from "@/lib/theme";
import { Button, cx, Icon, Modal, Segmented } from "./ui";

export type Theme = "light" | "dark" | "system";

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Light/dark/system choice stored per device; applies data-theme on <html>. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [dark, setDark] = useState(false);

  const reload = useCallback(() => {
    let saved: Theme = "system";
    try {
      saved = (localStorage.getItem("bf-theme") as Theme) || "system";
    } catch {}
    setThemeState(saved);
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  useEffect(reload, [reload]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => apply("system");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  });

  const apply = useCallback((next: Theme) => {
    const d = next === "dark" || (next === "system" && systemDark());
    document.documentElement.dataset.theme = d ? "dark" : "light";
    setDark(d);
    // re-apply so the browser toolbar color follows
    applyAppearance(readAppearance());
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem("bf-theme", next);
    } catch {}
    apply(next);
  };

  return { theme, setTheme, dark, reload };
}

export function AppearanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { theme, setTheme, dark, reload } = useTheme();
  const [a, setA] = useState<Appearance>(DEFAULT_APPEARANCE);
  useEffect(() => {
    if (!open) return;
    setA(readAppearance());
    reload();
  }, [open, reload]);
  const set = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch };
    setA(next);
    applyAppearance(next);
  };
  const custom = !SEEDS.some((s) => s.hex.toLowerCase() === a.seed.toLowerCase());

  return (
    <Modal open={open} onClose={onClose} title={t("appearance.title")} width={520} fullScreenOnMobile footer={<Button variant="text" onClick={onClose}>{t("common.done")}</Button>}>
      <div className="space-y-6 pt-1">
        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("appearance.theme")}</h3>
          <Segmented<Theme>
            label={t("appearance.theme")}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: t("appearance.light"), icon: "light_mode" },
              { value: "dark", label: t("appearance.dark"), icon: "dark_mode" },
              { value: "system", label: t("appearance.system"), icon: "brightness_auto" },
            ]}
          />
        </section>

        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("appearance.color")}</h3>
          <div className="grid grid-cols-5 gap-3 sm:grid-cols-9">
            {SEEDS.map((s) => {
              const sw = swatch(s.hex, a.variant, dark);
              const on = s.hex.toLowerCase() === a.seed.toLowerCase();
              return (
                <button
                  key={s.hex}
                  type="button"
                  onClick={() => set({ seed: s.hex })}
                  aria-label={t(`appearance.seeds.${s.name}`)}
                  aria-pressed={on}
                  data-tip={t(`appearance.seeds.${s.name}`)}
                  className="sl relative grid aspect-square w-full max-w-14 place-items-center rounded-2xl bg-panel-2 dark:bg-surface-highest"
                >
                  <span className="relative h-[70%] w-[70%] overflow-hidden rounded-full">
                    <span className="absolute inset-x-0 top-0 h-1/2" style={{ background: sw.a }} />
                    <span className="absolute bottom-0 start-0 h-1/2 w-1/2" style={{ background: sw.b }} />
                    <span className="absolute bottom-0 end-0 h-1/2 w-1/2" style={{ background: sw.c }} />
                  </span>
                  {on && (
                    <span className="absolute grid h-6 w-6 place-items-center rounded-full bg-accent text-accent-fg shadow-e1">
                      <Icon name="check" size={16} weight={700} />
                    </span>
                  )}
                </button>
              );
            })}
            <label
              data-tip={t("appearance.customColor")}
              className={cx(
                "sl relative grid aspect-square w-full max-w-14 cursor-pointer place-items-center rounded-2xl bg-panel-2 text-muted dark:bg-surface-highest",
                custom && "ring-2 ring-accent",
              )}
            >
              <Icon name="colorize" />
              <input
                type="color"
                value={a.seed}
                onChange={(e) => set({ seed: e.target.value })}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={t("appearance.pickColor")}
              />
            </label>
          </div>
        </section>

        <section>
          <h3 className="mb-1 type-title-small text-muted">{t("appearance.style")}</h3>
          <p className="mb-3 type-body-small text-muted">{t("appearance.styleHint")}</p>
          <Segmented<Variant>
            label={t("appearance.style")}
            value={a.variant}
            onChange={(v) => set({ variant: v })}
            options={[
              { value: "tonal", label: t("appearance.tonal") },
              { value: "vibrant", label: t("appearance.vibrant") },
              { value: "fidelity", label: t("appearance.fidelity") },
            ]}
          />
        </section>

        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("appearance.contrast")}</h3>
          <Segmented<Contrast>
            label={t("appearance.contrast")}
            value={a.contrast}
            onChange={(v) => set({ contrast: v })}
            options={[
              { value: 0, label: t("appearance.standard"), icon: "contrast" },
              { value: 0.5, label: t("appearance.medium") },
              { value: 1, label: t("appearance.high") },
            ]}
          />
        </section>

        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("appearance.density")}</h3>
          <Segmented<Density>
            label={t("appearance.density")}
            value={a.density}
            onChange={(v) => set({ density: v })}
            options={[
              { value: "default", label: t("appearance.default"), icon: "density_medium" },
              { value: "compact", label: t("appearance.compact"), icon: "density_small" },
            ]}
          />
        </section>
        <p className="pb-2 type-body-small text-muted">{t("appearance.deviceNote")}</p>
      </div>
    </Modal>
  );
}
