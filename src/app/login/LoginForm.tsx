"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { LanguageMenu } from "@/components/LanguageMenu";
import { Button, Icon, IconButton, TextField } from "@/components/ui";
import { useBrand, useT } from "@/i18n/client";
import { api, errorText } from "@/lib/client";

/** Only same-origin paths; "/\t/evil.com" and friends resolve to another host. */
function safeNext(next: string | null): string {
  if (!next) return "/";
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

export function LoginForm() {
  const t = useT();
  const brand = useBrand();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { body: { password } });
      window.location.href = safeNext(params.get("next"));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-auto bg-bg px-4 py-10">
      <div className="absolute end-3 top-3">
        <LanguageMenu />
      </div>
      <div className="m3-dialog-in relative w-full max-w-[448px]">
        <form onSubmit={submit} className="rounded-[28px] bg-panel p-6 sm:p-10" noValidate>
          <div className="mb-8 flex flex-col items-start">
            <Logo size={48} />
            <h1 className="mt-6 type-headline-large">{t("login.title")}</h1>
            <p className="mt-2 type-body-large text-muted">{t("login.subtitle", { app: brand.name })}</p>
          </div>

          {error && (
            <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl bg-danger-soft px-4 py-3 type-body-medium text-on-danger-soft animate-fade">
              <Icon name="error" size={20} />
              <span>{error}</span>
            </div>
          )}

          <TextField
            label={t("login.password")}
            value={password}
            onChange={setPassword}
            type={show ? "text" : "password"}
            leading="lock"
            autoFocus
            autoComplete="current-password"
            required
            trailing={
              <IconButton label={show ? t("login.hidePassword") : t("login.showPassword")} selected={show} onClick={() => setShow((v) => !v)}>
                <Icon name={show ? "visibility_off" : "visibility"} />
              </IconButton>
            }
          />

          <Button type="submit" variant="filled" loading={busy} disabled={!password} className="mt-8 h-12 w-full">
            {t("login.submit")}
            <Icon name="arrow_forward" size={20} />
          </Button>
        </form>

        <p className="mt-6 flex items-start justify-center gap-2 px-4 text-center type-body-small text-muted">
          <Icon name="shield_lock" size={16} className="mt-px" />
          <span>{t("login.note")}</span>
        </p>
      </div>
    </main>
  );
}
