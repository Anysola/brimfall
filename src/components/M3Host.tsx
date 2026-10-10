"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onDialogRequest, type DialogRequest } from "@/lib/dialog-service";
import { dismiss, onSnacks, type Snack } from "@/lib/toast";
import { Button, Checkbox, cx, Icon, IconButton, Modal, TextField } from "./ui";
import { useT } from "@/i18n/client";

/**
 * Page-wide Material 3 behaviour:
 * - ripple on press for .sl elements
 * - plain tooltips for elements with data-tip
 * - confirmDialog / promptDialog windows
 * - snackbars (src/lib/toast.ts)
 */
export function M3Host() {
  useRipple();
  return (
    <>
      <Tooltip />
      <Dialogs />
      <Snackbars />
    </>
  );
}

function useRipple() {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const host = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".sl");
      if (!host || (host as HTMLButtonElement).disabled || host.getAttribute("aria-disabled") === "true") return;
      const r = host.getBoundingClientRect();
      const size = Math.hypot(r.width, r.height) * 2;
      const dot = document.createElement("span");
      dot.className = "sl-ripple";
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - r.left - size / 2}px`;
      dot.style.top = `${e.clientY - r.top - size / 2}px`;
      host.appendChild(dot);
      const start = performance.now();
      const release = () => {
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
        // let the ripple grow for a minimum time even on a very short press
        const wait = Math.max(0, 225 - (performance.now() - start));
        setTimeout(() => {
          dot.classList.add("out");
          setTimeout(() => dot.remove(), 320);
        }, wait);
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
}

type Tip = { text: string; x: number; y: number; below: boolean };

function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = (el: HTMLElement, delay: number) => {
      const text = el.dataset.tip;
      if (!text) return;
      current.current = el;
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.bottom + 40 < window.innerHeight;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 4 : r.top - 4, below });
      }, delay);
    };
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]");
      if (el && el !== current.current) show(el, 500);
      if (!el && current.current) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]");
      if (el && el.matches(":focus-visible")) show(el, 150);
      else hide();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      className="m3-tip-in pointer-events-none fixed z-[90] max-w-[260px] rounded-[4px] bg-inverse px-2 py-1 type-body-small text-inverse-fg"
      style={{
        left: Math.min(Math.max(8, tip.x), window.innerWidth - 8),
        top: tip.y,
        transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`,
        transformOrigin: tip.below ? "top" : "bottom",
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}

function Dialogs() {
  const t = useT();
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState("");
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState("");
  const last = useRef<DialogRequest | null>(null);
  if (req) last.current = req;

  useEffect(
    () =>
      onDialogRequest((r) => {
        setReq(r);
        setValue(r.kind === "prompt" ? r.initial || "" : "");
        setChecked(r.kind === "confirm" && !!r.checkbox?.defaultChecked);
        setErr("");
      }),
    [],
  );

  const r = req ?? last.current;
  const typedOk = !(r?.kind === "confirm" && r.typeToConfirm) || value === r.typeToConfirm;

  const close = (answer: boolean) => {
    if (!req) return;
    if (req.kind === "confirm") {
      if (answer && !typedOk) return;
      req.resolve(answer ? { checked } : null);
    } else {
      if (answer) {
        const problem = req.validate?.(value) ?? null;
        if (problem) {
          setErr(problem);
          return;
        }
      }
      req.resolve(answer ? value : null);
    }
    setReq(null);
  };

  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      title={r?.title || ""}
      width={r?.kind === "prompt" || (r?.kind === "confirm" && r.typeToConfirm) ? 460 : 420}
      icon={r?.kind === "confirm" && r.icon ? <Icon name={r.icon} size={24} className={r.danger ? "text-danger" : "text-secondary"} /> : undefined}
      footer={
        r && (
          <>
            <Button variant="text" onClick={() => close(false)}>{(r.kind === "confirm" && r.cancel) || t("common.cancel")}</Button>
            <Button variant={r.kind === "confirm" && r.danger ? "danger" : "filled"} disabled={!typedOk} onClick={() => close(true)} autoFocus={r.kind === "confirm" && !r.typeToConfirm}>
              {r.confirm || t("common.ok")}
            </Button>
          </>
        )
      }
    >
      {r?.kind === "confirm" && (r.text || r.checkbox || r.typeToConfirm) && (
        <div className="space-y-4 pb-1">
          {r.text && <div className="type-body-medium text-muted">{r.text}</div>}
          {r.checkbox && (
            <label className="-ms-2 flex cursor-pointer select-none items-center gap-1 type-body-medium text-fg">
              <Checkbox label={r.checkbox.label} checked={checked} onChange={setChecked} />
              {r.checkbox.label}
            </label>
          )}
          {r.typeToConfirm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                close(true);
              }}
              className="pt-2"
            >
              <TextField
                label={t("common.typeToConfirm", { text: r.typeToConfirm })}
                value={value}
                onChange={setValue}
                autoFocus
                surface="dialog"
                dir="ltr"
                className="[&_input]:font-mono"
              />
            </form>
          )}
        </div>
      )}
      {r?.kind === "prompt" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close(true);
          }}
          className="pt-2"
        >
          <TextField label={r.label} value={value} onChange={setValue} autoFocus error={err || undefined} surface="dialog" />
        </form>
      )}
    </Modal>
  );
}

function Snackbars() {
  const t = useT();
  const [items, setItems] = useState<Snack[]>([]);
  useEffect(() => onSnacks(setItems), []);
  if (typeof document === "undefined" || !items.length) return null;
  return createPortal(
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(88px+env(safe-area-inset-bottom))] z-[80] flex flex-col items-center gap-2 md:inset-x-auto md:bottom-6 md:start-1/2 md:-translate-x-1/2 rtl:md:translate-x-1/2"
    >
      {items.map((s) => (
        <div
          key={s.id}
          role={s.tone === "error" ? "alert" : "status"}
          className={cx(
            "pointer-events-auto flex min-h-12 w-full items-center gap-1 rounded-[4px] py-1 ps-4 pe-1 type-body-medium shadow-e3 md:w-auto md:min-w-[344px] md:max-w-[640px]",
            s.tone === "error" ? "bg-danger-soft text-on-danger-soft" : "bg-inverse text-inverse-fg",
            s.leaving ? "m3-snack-out" : "m3-snack-in",
          )}
        >
          {s.tone === "error" && <Icon name="error" size={20} className="-ms-1 me-1.5" />}
          {s.tone === "ok" && <Icon name="check_circle" size={20} className="-ms-1 me-1.5 text-inverse-accent" />}
          <span className="flex-1 break-words py-2.5 pe-2">{s.text}</span>
          <IconButton label={t("common.close")} tip={false} onClick={() => dismiss(s.id)} className="!text-current opacity-80">
            <Icon name="close" size={20} />
          </IconButton>
        </div>
      ))}
    </div>,
    document.body,
  );
}
