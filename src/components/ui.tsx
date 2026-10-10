"use client";

import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ICON_NAMES from "@/lib/icon-names.json";
import { useT } from "@/i18n/client";

const KNOWN_ICONS = new Set<string>(ICON_NAMES);
// Directional icons that mirror in right-to-left languages
const MIRRORED = new Set(["arrow_back", "arrow_forward", "chevron_left", "chevron_right", "logout", "drive_file_move", "redo", "undo", "open_in_new", "keyboard_backspace"]);

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------- icon (Material Symbols Rounded) ----------

/** Only names in the public/fonts subset render (see src/lib/icon-names.json, npm run icons). */
export function Icon({
  name,
  size = 24,
  fill = false,
  weight = 400,
  className,
}: {
  name: string;
  size?: number;
  fill?: boolean;
  weight?: number;
  className?: string;
}) {
  if (process.env.NODE_ENV !== "production" && !KNOWN_ICONS.has(name)) {
    console.warn(`[Icon] "${name}" is not in the font subset: add it to src/lib/icon-names.json and run npm run icons`);
  }
  return (
    <span
      aria-hidden="true"
      className={cx("msr", MIRRORED.has(name) && "rtl:-scale-x-100", className)}
      style={
        {
          fontSize: size,
          "--fill": fill ? 1 : 0,
          "--wght": weight,
          "--opsz": Math.min(48, Math.max(20, size)),
        } as React.CSSProperties
      }
    >
      {name}
    </span>
  );
}

// ---------- icon button ----------

type IconBtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  /** standard (no container) · filled · tonal · outlined (M3) */
  variant?: "standard" | "filled" | "tonal" | "outlined";
  /** toggle icon button: filled when selected */
  selected?: boolean;
  size?: "sm" | "md";
  tip?: boolean;
};

export const IconButton = forwardRef<HTMLButtonElement, IconBtnProps>(function IconButton(
  { label, variant = "standard", selected, size = "md", tip = true, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={selected === undefined ? undefined : selected}
      data-tip={tip ? label : undefined}
      className={cx(
        "sl inline-grid shrink-0 place-items-center rounded-full transition-[background-color,color,transform] duration-200 ease-std active:scale-[0.94] disabled:pointer-events-none disabled:opacity-[0.38]",
        size === "sm" ? "h-8 w-8" : "h-10 w-10",
        variant === "standard" && (selected ? "text-accent" : "text-muted"),
        variant === "filled" && (selected === false ? "bg-surface-highest text-accent" : "bg-accent text-accent-fg"),
        variant === "tonal" && (selected === false ? "bg-surface-highest text-muted" : "bg-select text-on-select"),
        variant === "outlined" && (selected ? "bg-inverse text-inverse-fg" : "border border-faint text-muted"),
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

// ---------- button ----------

export type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "elevated" | "danger";

export function Button({
  variant = "outlined",
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: React.ComponentProps<"button"> & { variant?: ButtonVariant; loading?: boolean; icon?: string }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "sl inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full type-label-large transition-[box-shadow,transform] duration-200 ease-std active:scale-[0.98] disabled:pointer-events-none",
        icon ? "ps-4 pe-6" : "px-6",
        variant === "filled" && "bg-accent text-accent-fg hover:shadow-e1 disabled:bg-fg/12 disabled:text-fg/38",
        variant === "tonal" && "bg-select text-on-select hover:shadow-e1 disabled:bg-fg/12 disabled:text-fg/38",
        variant === "outlined" && "border border-faint text-accent disabled:border-fg/12 disabled:text-fg/38",
        variant === "text" && cx("text-accent disabled:text-fg/38", icon ? "ps-3 pe-4" : "px-3"),
        variant === "elevated" && "bg-panel-2 text-accent shadow-e1 hover:shadow-e2 dark:bg-surface-high",
        variant === "danger" && "bg-danger text-on-danger hover:shadow-e1",
        // while loading, keeps its own color instead of the disabled look
        loading && variant === "filled" && "disabled:!bg-accent disabled:!text-accent-fg",
        loading && variant === "tonal" && "disabled:!bg-select disabled:!text-on-select",
        loading && variant === "outlined" && "disabled:!border-faint disabled:!text-accent",
        loading && variant === "text" && "disabled:!text-accent",
        className,
      )}
      {...rest}
    >
      {/* while loading, content stays in place (no width shift) and the indicator spins over it */}
      <span className={cx("inline-flex items-center gap-2 transition-opacity duration-150", loading && "opacity-0")}>
        {icon && <Icon name={icon} size={18} />}
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center animate-fade">
          <Spinner className="h-5 w-5" />
        </span>
      )}
    </button>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

// ---------- indicators ----------

/** Material 3 indeterminate circular indicator: the arc spins while growing and shrinking. Inherits its color. */
export function Spinner({ className = "h-5 w-5", label }: { className?: string; label?: string }) {
  const t = useT();
  return (
    <svg className={cx("m3-spinner shrink-0", className)} viewBox="0 0 48 48" role="progressbar" aria-label={label || t("common.loading")}>
      <circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/** Material 3 indeterminate linear indicator. */
export function LinearProgress({ className }: { className?: string }) {
  const t = useT();
  return (
    <div className={cx("relative h-1 overflow-hidden rounded-full bg-accent-soft rtl:-scale-x-100", className)} role="progressbar" aria-label={t("common.loading")}>
      <span className="m3-linear-bar absolute inset-y-0 rounded-full bg-accent" />
    </div>
  );
}

/** Badge: a small dot without n, otherwise the count. */
export function Badge({ n, className }: { n?: number; className?: string }) {
  if (n === 0) return null;
  return (
    <span
      className={cx(
        "pointer-events-none grid place-items-center rounded-full bg-danger text-on-danger type-label-small tabular-nums",
        n === undefined ? "h-1.5 w-1.5" : "h-4 min-w-4 px-1",
        className,
      )}
    >
      {n !== undefined && (n > 999 ? "999+" : n)}
    </span>
  );
}

// ---------- show/hide (for exit animations) ----------

export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, exitMs);
    return () => clearTimeout(t);
  }, [open, exitMs, mounted]);
  return { mounted, closing };
}

// ---------- menu ----------

/** M3 menu anchored to the clicked element; closes on outside click / Esc, navigable with arrow keys. */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = "start",
  className,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; right: boolean; up: boolean } | null>(null);
  const { mounted, closing } = usePresence(open, 120);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const up = r.bottom + 340 > window.innerHeight && r.top > 340;
    // "start"/"end" follow the writing direction: in RTL, "end" is the anchor's left edge
    const rtl = document.documentElement.dir === "rtl";
    const toRight = (align === "end") !== rtl;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left: toRight ? r.right : r.left, right: toRight, up });
  }, [open, anchor, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
        return;
      }
      const box = ref.current;
      if (!box || !box.contains(document.activeElement) || (document.activeElement as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        const items = [...box.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
        if (!items.length) return;
        e.preventDefault();
        e.stopPropagation();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    // if opened via keyboard, focus the first item
    const kb = document.activeElement === anchor.current && anchor.current?.matches(":focus-visible");
    if (kb) requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, anchor, onClose]);

  if (!mounted || !pos) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={cx(
        "fixed z-[60] min-w-[200px] max-w-[calc(100vw-16px)] rounded-[4px] bg-panel-2 py-2 shadow-e2 dark:bg-surface-high",
        closing ? "m3-menu-out" : cx("m3-menu-in", pos.up && "up"),
        className,
      )}
      style={{
        top: pos.up ? undefined : pos.top,
        bottom: pos.up ? window.innerHeight - pos.top : undefined,
        left: pos.right ? undefined : Math.max(8, pos.left),
        right: pos.right ? Math.max(8, window.innerWidth - pos.left) : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  hint,
  active,
  disabled,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  hint?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "sl flex h-12 w-full items-center gap-3 px-3 text-left type-label-large outline-none focus-visible:before:opacity-10 disabled:opacity-40",
        danger ? "text-danger" : "text-fg",
        active && "bg-select text-on-select",
      )}
    >
      {icon && <span className={cx("grid h-6 w-6 place-items-center", !danger && !active && "text-muted")}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="type-label-medium text-muted">{hint}</span>}
    </button>
  );
}

export function MenuDivider() {
  return <div role="separator" className="my-2 h-px bg-line" />;
}

// ---------- dialog ----------

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 480,
  footer,
  icon,
  fullScreenOnMobile,
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
  icon?: React.ReactNode;
  fullScreenOnMobile?: boolean;
}) {
  const { mounted, closing } = usePresence(open, 150);
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      // keep focus inside the dialog
      if (e.key === "Tab" && box.current) {
        const f = [...box.current.querySelectorAll<HTMLElement>("button,input,textarea,select,a[href],[contenteditable],[tabindex]:not([tabindex='-1'])")].filter(
          (x) => !x.hasAttribute("disabled"),
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => {
      if (box.current && !box.current.contains(document.activeElement)) {
        (box.current.querySelector<HTMLElement>("[autofocus],input,[contenteditable]") || box.current).focus();
      }
    });
    return () => {
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className={cx("fixed inset-0 z-[70] grid place-items-center", fullScreenOnMobile ? "sm:p-4" : "p-4")}>
      <div className={cx("absolute inset-0 bg-scrim", closing ? "m3-scrim-out" : "m3-scrim-in")} onClick={onClose} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          "relative flex w-full flex-col bg-panel-2 shadow-e3 outline-none dark:bg-surface-high",
          fullScreenOnMobile ? "h-full max-h-none rounded-none sm:h-auto sm:max-h-[85vh] sm:rounded-[28px]" : "max-h-[85vh] rounded-[28px]",
          closing ? "m3-dialog-out" : "m3-dialog-in",
        )}
        style={{ maxWidth: width, minWidth: Math.min(280, width) }}
      >
        <div className={cx("flex px-6 pb-4 pt-6", icon ? "flex-col items-center gap-4 text-center" : "items-center")}>
          {icon}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="type-headline-small text-fg">
              {title}
            </h2>
            {description && <div className="mt-2 break-words type-body-medium text-muted">{description}</div>}
          </div>
        </div>
        {children && <div className="overflow-auto px-6 pb-2">{children}</div>}
        {footer && <div className="flex justify-end gap-2 px-6 pb-6 pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- selection controls ----------

/** M3 switch: the handle grows when on and more when pressed; shows a check icon when on. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "group relative h-8 w-[52px] shrink-0 rounded-full border-2 transition-colors duration-200 ease-std disabled:opacity-40",
        checked ? "border-accent bg-accent" : "border-faint bg-surface-highest",
      )}
    >
      <span
        className={cx(
          "absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-full transition-all duration-300 ease-emph",
          "before:absolute before:-inset-2 before:rounded-full before:bg-current before:opacity-0 before:transition-opacity group-hover:before:opacity-[0.08] group-active:before:opacity-[0.1]",
          checked
            ? "start-[22px] h-6 w-6 bg-accent-fg text-accent group-active:start-[20px] group-active:h-7 group-active:w-7"
            : "start-[6px] h-4 w-4 bg-faint text-faint group-active:start-[2px] group-active:h-7 group-active:w-7",
        )}
      >
        {checked && <Icon name="check" size={16} weight={600} className="relative" />}
      </span>
    </button>
  );
}

/** M3 checkbox (40px touch target + state layer). */
export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean, e: React.MouseEvent) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked, e);
      }}
      className={cx("sl grid h-10 w-10 shrink-0 place-items-center rounded-full disabled:opacity-40", on ? "text-accent" : "text-muted", className)}
    >
      <span
        className={cx(
          "grid h-[18px] w-[18px] place-items-center rounded-[2px] border-2 transition-colors duration-150",
          on ? "border-accent bg-accent text-accent-fg" : "border-muted bg-transparent",
        )}
      >
        {checked ? <Icon name="check" size={16} weight={700} /> : indeterminate ? <span className="h-[2px] w-2.5 rounded bg-current" /> : null}
      </span>
    </button>
  );
}

/** M3 segmented button (single select): check mark on the selected one. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: string }[];
  className?: string;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("flex h-10 overflow-hidden rounded-full border border-faint", className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "sl flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 type-label-large transition-colors duration-200",
              i > 0 && "border-s border-faint",
              on ? "bg-select text-on-select" : "text-fg",
            )}
          >
            {on ? <Icon name="check" size={18} /> : o.icon && <Icon name={o.icon} size={18} />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** M3 filter chip. */
export function FilterChip({ selected, onClick, children, icon }: { selected: boolean; onClick: () => void; children: React.ReactNode; icon?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "sl flex h-8 shrink-0 items-center gap-2 rounded-lg type-label-large transition-colors duration-200",
        selected ? "bg-select ps-2 pe-4 text-on-select" : cx("border border-faint pe-4 text-muted", icon ? "ps-2" : "ps-4"),
      )}
    >
      {selected ? <Icon name="check" size={18} /> : icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

// ---------- text field ----------

const FIELD_BG = { panel: "bg-panel", dialog: "bg-panel-2 dark:bg-surface-high", bg: "bg-bg" } as const;

/** M3 outlined text field: the label floats above the outline. */
export function TextField({
  label,
  value,
  onChange,
  type = "text",
  leading,
  trailing,
  suffix,
  supporting,
  error,
  surface = "panel",
  className,
  inputRef,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  label: string;
  value: string;
  onChange: (v: string) => void;
  leading?: string;
  trailing?: React.ReactNode;
  suffix?: string;
  supporting?: React.ReactNode;
  error?: string;
  surface?: keyof typeof FIELD_BG;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [focus, setFocus] = useState(false);
  const floated = focus || value.length > 0;
  // if autoFocus fires before hydration, onFocus is missed; catch it on first paint
  useEffect(() => {
    const el = document.getElementById(id);
    if (el && document.activeElement === el) setFocus(true);
  }, [id]);
  return (
    <div className={className}>
      <div
        className={cx(
          "group relative flex h-14 items-center rounded-[4px] border transition-colors duration-150",
          error ? "border-danger" : focus ? "border-accent" : "border-faint hover:border-fg",
          focus && "ring-1 ring-inset",
          focus && (error ? "ring-danger" : "ring-accent"),
        )}
      >
        {leading && <Icon name={leading} size={24} className={cx("ms-3", error ? "text-danger" : "text-muted")} />}
        <input
          id={id}
          ref={inputRef}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            setFocus(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          aria-invalid={!!error || undefined}
          aria-describedby={error || supporting ? `${id}-s` : undefined}
          className={cx("h-full min-w-0 flex-1 bg-transparent type-body-large text-fg outline-none", leading ? "ps-3" : "ps-4", trailing || suffix ? "pe-1" : "pe-4")}
          {...rest}
        />
        {suffix && (floated || !label) && <span className="select-none pe-4 type-body-large text-muted">{suffix}</span>}
        {trailing && <span className="me-1 flex items-center">{trailing}</span>}
        <label
          htmlFor={id}
          className={cx(
            "pointer-events-none absolute origin-left rtl:origin-right truncate px-1 transition-all duration-150 ease-std",
            FIELD_BG[surface],
            floated ? "-top-2 type-body-small" : "top-1/2 -translate-y-1/2 type-body-large",
            floated ? (leading ? "start-3" : "start-3") : leading ? "start-12" : "start-3",
            error ? "text-danger" : focus ? "text-accent" : "text-muted",
          )}
        >
          {label}
        </label>
      </div>
      {(error || supporting) && (
        <div id={`${id}-s`} className={cx("px-4 pt-1 type-body-small", error ? "text-danger" : "text-muted")}>
          {error || supporting}
        </div>
      )}
    </div>
  );
}

// ---------- select (native, styled as an outlined field) ----------

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  surface = "panel",
  className,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  surface?: keyof typeof FIELD_BG;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx("relative", className)}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="peer h-14 w-full cursor-pointer appearance-none rounded-[4px] border border-faint bg-transparent ps-4 pe-10 type-body-large text-fg outline-none transition-colors hover:border-fg focus:border-accent focus:ring-1 focus:ring-inset focus:ring-accent disabled:opacity-40"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-panel text-fg">
            {o.label}
          </option>
        ))}
      </select>
      <label htmlFor={id} className={cx("pointer-events-none absolute -top-2 start-3 px-1 type-body-small text-muted peer-focus:text-accent", FIELD_BG[surface])}>
        {label}
      </label>
      <Icon name="arrow_drop_down" className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

// ---------- copy ----------

export function CopyButton({ text, label, variant = "outlined" }: { text: string; label?: string; variant?: ButtonVariant }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    await copyText(text);
    setDone(true);
    setTimeout(() => setDone(false), 1400);
  };
  if (!label)
    return (
      <IconButton label={done ? t("common.copied") : t("common.copy")} onClick={copy}>
        <Icon name={done ? "check" : "content_copy"} size={20} />
      </IconButton>
    );
  return (
    <Button variant={variant} icon={done ? "check" : "content_copy"} onClick={copy}>
      {done ? t("common.copied") : label}
    </Button>
  );
}

/** Read-only field with a copy button (URLs, key IDs, secrets). */
export function CopyField({ label, value, surface = "panel" }: { label: string; value: string; surface?: keyof typeof FIELD_BG }) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={() => {}}
      readOnly
      dir="ltr"
      surface={surface}
      className="[&_input]:font-mono [&_input]:!text-[13px]"
      onFocus={(e) => e.currentTarget.select()}
      trailing={<CopyButton text={value} />}
    />
  );
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

// ---------- banners, cards, empty states ----------

export function Banner({
  tone = "info",
  icon,
  children,
  action,
  className,
}: {
  tone?: "info" | "warn" | "error" | "ok";
  icon?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cx(
        "flex flex-wrap items-start gap-3 rounded-xl px-4 py-3 type-body-medium",
        tone === "info" && "bg-select text-on-select",
        tone === "warn" && "bg-warn-soft text-warn-fg",
        tone === "error" && "bg-danger-soft text-on-danger-soft",
        tone === "ok" && "bg-ok-soft text-on-ok-soft",
        className,
      )}
    >
      <Icon name={icon ?? (tone === "error" ? "error" : tone === "warn" ? "warning" : tone === "ok" ? "check_circle" : "info")} size={20} className="mt-px" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {action}
    </div>
  );
}

/** M3 outlined card with an optional header row. */
export function Card({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  danger,
  flush,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  danger?: boolean;
  /** no inner padding below the header (tables, lists) */
  flush?: boolean;
}) {
  return (
    <section className={cx("min-w-0 rounded-xl border bg-panel", danger ? "border-danger/40" : "border-line", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 pb-3 pt-5 sm:px-6">
          {icon && (
            <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full", danger ? "bg-danger-soft text-on-danger-soft" : "bg-accent-soft text-on-accent-soft")}>
              <Icon name={icon} size={22} />
            </span>
          )}
          <div className="min-w-[180px] flex-1">
            {title && <h2 className="type-title-large text-fg">{title}</h2>}
            {subtitle && <p className="mt-1 type-body-medium text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children && <div className={flush ? "pb-2" : "px-5 pb-5 sm:px-6 sm:pb-6"}>{children}</div>}
    </section>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center animate-fade">
      <span className="grid h-24 w-24 place-items-center rounded-full bg-accent-soft text-on-accent-soft">
        <Icon name={icon} size={44} />
      </span>
      <h3 className="mt-6 type-title-large text-fg">{title}</h3>
      {text && <p className="mt-2 max-w-[420px] type-body-medium text-muted">{text}</p>}
      {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function Chip({ children, icon, tone = "neutral", className }: { children: React.ReactNode; icon?: string; tone?: "neutral" | "accent" | "danger" | "ok"; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 type-label-medium",
        tone === "neutral" && "border border-line text-muted",
        tone === "accent" && "bg-accent-soft text-on-accent-soft",
        tone === "danger" && "bg-danger-soft text-on-danger-soft",
        tone === "ok" && "bg-ok-soft text-on-ok-soft",
        className,
      )}
    >
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** Keeps the last non-null value so a dialog can animate out after its state is cleared. */
export function useSticky<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(value ?? null);
  if (value !== null && value !== undefined) ref.current = value;
  return ref.current;
}

// ---------- menus from data ----------

export type MenuEntry = { label: string; icon: string; onClick: () => void; danger?: boolean; hidden?: boolean; divider?: boolean; hint?: string };

export function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  return (
    <>
      {items
        .filter((i) => !i.hidden)
        .map((i, n) => (
          <div key={i.label}>
            {i.divider && n > 0 && <MenuDivider />}
            <MenuItem
              icon={<Icon name={i.icon} />}
              danger={i.danger}
              hint={i.hint}
              onClick={() => {
                onClose();
                i.onClick();
              }}
            >
              {i.label}
            </MenuItem>
          </div>
        ))}
    </>
  );
}

/** Overflow (⋮) button with a menu. */
export function MoreMenu({ items, label, onOpenChange, className, size }: { items: MenuEntry[]; label: string; onOpenChange?: (o: boolean) => void; className?: string; size?: "sm" | "md" }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const set = (o: boolean) => {
    setOpen(o);
    onOpenChange?.(o);
  };
  return (
    <>
      <IconButton
        ref={anchor}
        label={label}
        size={size}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          set(!open);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Icon name="more_vert" size={size === "sm" ? 20 : 24} />
      </IconButton>
      <Popover anchor={anchor} open={open} onClose={() => set(false)} align="end">
        <MenuList items={items} onClose={() => set(false)} />
      </Popover>
    </>
  );
}

/** Menu at the pointer position (right click). */
export function ContextMenu({ at, onClose, items }: { at: { x: number; y: number } | null; onClose: () => void; items: MenuEntry[] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const last = useSticky(at);
  return (
    <>
      {last && <span ref={anchor} aria-hidden className="pointer-events-none fixed h-0 w-0" style={{ left: last.x, top: last.y }} />}
      <Popover anchor={anchor} open={!!at} onClose={onClose}>
        <MenuList items={items} onClose={onClose} />
      </Popover>
    </>
  );
}
