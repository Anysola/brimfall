"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { setLocale, useBrand, useLocale, useT } from "@/i18n/client";
import { LOCALES } from "@/i18n/locales";
import { requestAction } from "@/lib/actions";
import { api, errorText } from "@/lib/client";
import { AppearanceDialog } from "./Appearance";
import { Logo } from "./Logo";
import { useUploads } from "./uploads";
import { cx, Icon, IconButton, MenuDivider, MenuItem, Popover, Spinner, usePresence } from "./ui";

export interface BucketSummary {
  name: string;
  id: string | null;
  type: string | null;
  cdnUrl: string | null;
}

type ShellCtx = {
  openNav: () => void;
  buckets: BucketSummary[] | null;
  reloadBuckets: () => void;
  /** B2 native API available (bucket settings, keys) */
  native: boolean;
  /** opens the file picker and uploads into the current bucket/folder */
  pickFiles: (folder: boolean) => void;
};

const Ctx = createContext<ShellCtx | null>(null);

export function useShell() {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppShell missing");
  return c;
}

/** Current bucket, tab and folder from the URL. */
export function useLocation() {
  const pathname = usePathname();
  const params = useSearchParams();
  const m = pathname.match(/^\/b\/([^/]+)(?:\/([^/]+))?/);
  return {
    pathname,
    bucket: m ? decodeURIComponent(m[1]) : null,
    tab: (m?.[2] ?? "files") as "files" | "stats" | "settings",
    prefix: m && !m[2] ? (params.get("p") ?? "") : "",
  };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const { enqueue } = useUploads();
  const [navOpen, setNavOpen] = useState(false);
  const [buckets, setBuckets] = useState<BucketSummary[] | null>(null);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const reloadBuckets = useCallback(async (fresh = true) => {
    setBucketError(null);
    try {
      const [b, acc] = await Promise.all([
        api<{ buckets: BucketSummary[] }>("/api/buckets", { query: { fresh: fresh ? 1 : undefined } }),
        api<{ native: boolean }>("/api/account").catch(() => ({ native: false })),
      ]);
      setBuckets(b.buckets);
      setNative(acc.native);
    } catch (e) {
      setBucketError(errorText(e));
      setBuckets([]);
    }
  }, []);

  useEffect(() => {
    reloadBuckets(false);
    const h = () => reloadBuckets(true);
    window.addEventListener("buckets-changed", h);
    return () => window.removeEventListener("buckets-changed", h);
  }, [reloadBuckets]);

  useEffect(() => setNavOpen(false), [loc.pathname]);

  const target = useRef({ bucket: loc.bucket, prefix: loc.prefix });
  target.current = { bucket: loc.bucket, prefix: loc.prefix };

  const pickFiles = useCallback((folder: boolean) => {
    if (!target.current.bucket) return;
    (folder ? folderInput : fileInput).current?.click();
  }, []);

  const onPick = (list: FileList | null, relative: boolean) => {
    const { bucket, prefix } = target.current;
    if (!list?.length || !bucket) return;
    enqueue(
      bucket,
      prefix,
      [...list].map((f) => ({ file: f, path: relative && f.webkitRelativePath ? f.webkitRelativePath : f.name })),
    );
  };

  const ctx: ShellCtx = { openNav: () => setNavOpen(true), buckets, reloadBuckets: () => reloadBuckets(true), native, pickFiles };

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-dvh overflow-hidden bg-bg">
        {/* xl+: standard drawer */}
        <aside className="hidden w-[288px] shrink-0 xl:block">
          <NavContent error={bucketError} />
        </aside>
        {/* md–xl: navigation rail */}
        <NavRail onMenu={() => setNavOpen(true)} />
        <ModalDrawer open={navOpen} onClose={() => setNavOpen(false)}>
          <NavContent error={bucketError} onClose={() => setNavOpen(false)} />
        </ModalDrawer>
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-panel md:my-2 md:me-2 md:rounded-[24px] xl:ms-0">{children}</main>
      </div>
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => (onPick(e.target.files, false), (e.target.value = ""))} />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        // @ts-expect-error non-standard but widely supported
        webkitdirectory=""
        onChange={(e) => (onPick(e.target.files, true), (e.target.value = ""))}
      />
    </Ctx.Provider>
  );
}

// ---------- "New" menu ----------

/** Upload files / upload folder / new folder. The trigger is rendered by the caller. */
export function NewMenu({ anchor, open, onClose, align }: { anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; align?: "start" | "end" }) {
  const t = useT();
  const router = useRouter();
  const { pickFiles } = useShell();
  const loc = useLocation();
  const run = (fn: () => void) => {
    onClose();
    fn();
  };
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} align={align} className="w-[240px]">
      <MenuItem icon={<Icon name="upload_file" />} onClick={() => run(() => pickFiles(false))}>
        {t("files.uploadFiles")}
      </MenuItem>
      <MenuItem icon={<Icon name="drive_folder_upload" />} onClick={() => run(() => pickFiles(true))}>
        {t("files.uploadFolder")}
      </MenuItem>
      <MenuDivider />
      <MenuItem
        icon={<Icon name="create_new_folder" />}
        onClick={() =>
          run(() => {
            if (loc.bucket && loc.tab !== "files") router.push(`/b/${encodeURIComponent(loc.bucket)}`);
            requestAction("newFolder");
          })
        }
      >
        {t("files.newFolder")}
      </MenuItem>
    </Popover>
  );
}

function NewButton() {
  const t = useT();
  const loc = useLocation();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        disabled={!loc.bucket}
        onClick={() => setOpen((v) => !v)}
        className="sl inline-flex h-14 items-center gap-3 rounded-2xl bg-panel ps-4 pe-5 type-label-large text-fg shadow-e1 transition-shadow duration-200 hover:shadow-e2 disabled:opacity-40 disabled:shadow-none dark:bg-surface-high"
      >
        <Icon name="add" size={24} />
        {t("nav.new")}
      </button>
      <NewMenu anchor={anchor} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ---------- navigation drawer ----------

function NavItem({
  href,
  icon,
  label,
  active,
  trailing,
  sub,
  onClick,
}: {
  href?: string;
  icon: string;
  label: string;
  active?: boolean;
  trailing?: React.ReactNode;
  sub?: boolean;
  onClick?: () => void;
}) {
  const cls = cx(
    "sl flex w-full items-center gap-3 rounded-full pe-4 text-start type-label-large transition-colors duration-200",
    sub ? "h-11 ps-11" : "h-14 ps-4",
    active ? "bg-select text-on-select" : "text-muted hover:text-fg",
  );
  const inner = (
    <>
      <Icon name={icon} size={sub ? 20 : 24} fill={active} />
      <span className={cx("min-w-0 flex-1 truncate", !active && "text-fg")}>{label}</span>
      {trailing}
    </>
  );
  return href ? (
    <Link href={href} className={cls} aria-current={active ? "page" : undefined} onClick={onClick}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

function NavContent({ error, onClose }: { error: string | null; onClose?: () => void }) {
  const t = useT();
  const brand = useBrand();
  const { buckets, reloadBuckets, native } = useShell();
  const loc = useLocation();
  const [appearance, setAppearance] = useState(false);
  const langAnchor = useRef<HTMLDivElement>(null);
  const [langOpen, setLangOpen] = useState(false);
  const locale = useLocale();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 ps-5 pe-3">
        <Logo size={32} />
        <span className="min-w-0 flex-1 truncate type-title-large text-fg">{brand.name}</span>
        {onClose && (
          <IconButton label={t("common.close")} onClick={onClose}>
            <Icon name="menu_open" className="rtl:-scale-x-100" />
          </IconButton>
        )}
      </div>
      <div className="px-3 pb-3 pt-1">
        <NewButton />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-2" aria-label={t("nav.label")}>
        <div className="flex h-12 items-center justify-between ps-4 pe-1">
          <span className="type-title-small text-muted">{t("nav.buckets")}</span>
          <IconButton label={t("nav.refreshBuckets")} size="sm" onClick={reloadBuckets}>
            <Icon name="refresh" size={18} />
          </IconButton>
        </div>
        {buckets === null && (
          <div className="flex h-14 items-center gap-3 ps-4 type-label-large text-muted">
            <Spinner className="h-5 w-5" /> {t("common.loading")}
          </div>
        )}
        {error && <div className="mx-4 mb-2 rounded-xl bg-danger-soft px-3 py-2 type-body-small text-on-danger-soft">{error}</div>}
        {buckets?.map((b) => {
          const active = b.name === loc.bucket;
          const base = `/b/${encodeURIComponent(b.name)}`;
          return (
            <div key={b.name}>
              <NavItem
                href={base}
                icon={active ? "folder_open" : "folder"}
                label={b.name}
                active={active && loc.tab === "files"}
                trailing={b.type === "allPublic" ? <Icon name="public" size={18} className="opacity-70" /> : undefined}
              />
              {active && (
                <div className="animate-fade pb-1">
                  <NavItem sub href={`${base}/stats`} icon="bar_chart" label={t("nav.usage")} active={loc.tab === "stats"} />
                  {native && <NavItem sub href={`${base}/settings`} icon="tune" label={t("nav.settings")} active={loc.tab === "settings"} />}
                </div>
              )}
            </div>
          );
        })}
        <div className="mx-4 my-2 h-px bg-line" />
        <NavItem href="/buckets" icon="database" label={t("nav.allBuckets")} active={loc.pathname === "/buckets"} />
        {native && <NavItem href="/keys" icon="key" label={t("nav.keys")} active={loc.pathname === "/keys"} />}
      </nav>

      <div className="shrink-0 border-t border-line px-3 py-2">
        <NavItem icon="palette" label={t("nav.appearance")} onClick={() => setAppearance(true)} />
        <div ref={langAnchor}>
          <NavItem
            icon="language"
            label={t("common.language")}
            trailing={<span className="type-label-medium text-muted">{LOCALES.find((l) => l.code === locale)?.name}</span>}
            onClick={() => setLangOpen((v) => !v)}
          />
        </div>
        <LanguagePopover anchor={langAnchor} open={langOpen} onClose={() => setLangOpen(false)} />
        <NavItem icon="logout" label={t("nav.signOut")} onClick={signOut} />
      </div>
      <AppearanceDialog open={appearance} onClose={() => setAppearance(false)} />
    </div>
  );
}

export async function signOut() {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login";
}

export function LanguagePopover({ anchor, open, onClose, align = "start" }: { anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; align?: "start" | "end" }) {
  const locale = useLocale();
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} align={align} className="max-h-[60vh] w-[240px] overflow-y-auto">
      {LOCALES.map((l) => (
        <MenuItem
          key={l.code}
          icon={l.code === locale ? <Icon name="check" /> : <span className="w-6" />}
          onClick={() => {
            onClose();
            if (l.code !== locale) setLocale(l.code);
          }}
        >
          <span lang={l.code} dir={l.dir || "ltr"}>
            {l.name}
          </span>
        </MenuItem>
      ))}
    </Popover>
  );
}

function ModalDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const { mounted, closing } = usePresence(open, 200);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-[55] xl:hidden">
      <div className={cx("absolute inset-0 bg-scrim", closing ? "m3-scrim-out" : "m3-scrim-in")} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "absolute inset-y-0 start-0 w-[300px] max-w-[85vw] rounded-e-[16px] bg-bg shadow-e1",
          closing ? "m3-drawer-out" : "m3-drawer-in",
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ---------- navigation rail (md–xl) ----------

function RailItem({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className="group flex w-full flex-col items-center gap-1 py-1">
      <span
        className={cx(
          "sl grid h-8 w-14 place-items-center rounded-full transition-colors duration-200",
          active ? "bg-select text-on-select" : "text-muted group-hover:text-fg",
        )}
      >
        <Icon name={icon} fill={active} />
      </span>
      <span className={cx("max-w-[76px] truncate type-label-medium", active ? "text-fg" : "text-muted")}>{label}</span>
    </Link>
  );
}

function NavRail({ onMenu }: { onMenu: () => void }) {
  const t = useT();
  const loc = useLocation();
  const { native } = useShell();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const base = loc.bucket ? `/b/${encodeURIComponent(loc.bucket)}` : null;
  return (
    <nav className="hidden w-20 shrink-0 flex-col items-center gap-1 py-3 md:flex xl:hidden" aria-label={t("nav.label")}>
      <IconButton label={t("nav.menu")} onClick={onMenu}>
        <Icon name="menu" />
      </IconButton>
      <button
        ref={anchor}
        type="button"
        aria-label={t("nav.new")}
        data-tip={t("nav.new")}
        disabled={!loc.bucket}
        onClick={() => setOpen((v) => !v)}
        className="sl mb-4 mt-2 grid h-14 w-14 place-items-center rounded-2xl bg-panel text-fg shadow-e1 transition-shadow hover:shadow-e2 disabled:opacity-40 dark:bg-surface-high"
      >
        <Icon name="add" />
      </button>
      <NewMenu anchor={anchor} open={open} onClose={() => setOpen(false)} />
      {base && (
        <>
          <RailItem href={base} icon="folder" label={t("nav.files")} active={loc.tab === "files"} />
          <RailItem href={`${base}/stats`} icon="bar_chart" label={t("nav.usage")} active={loc.tab === "stats"} />
          {native && <RailItem href={`${base}/settings`} icon="tune" label={t("nav.settings")} active={loc.tab === "settings"} />}
          <div className="my-2 h-px w-10 bg-line" />
        </>
      )}
      <RailItem href="/buckets" icon="database" label={t("nav.bucketsShort")} active={loc.pathname === "/buckets"} />
      {native && <RailItem href="/keys" icon="key" label={t("nav.keysShort")} active={loc.pathname === "/keys"} />}
      <div className="flex-1" />
      <IconButton label={t("nav.appearance")} onClick={() => setAppearance(true)}>
        <Icon name="palette" />
      </IconButton>
      <IconButton label={t("nav.signOut")} onClick={signOut}>
        <Icon name="logout" />
      </IconButton>
      <AppearanceDialog open={appearance} onClose={() => setAppearance(false)} />
    </nav>
  );
}

// ---------- page header ----------

/** Top app bar for a page: menu button on phones, title, actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = useT();
  const { openNav } = useShell();
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 px-2 pb-2 pt-2 sm:px-4 md:px-6 md:pt-5">
      <IconButton label={t("nav.menu")} onClick={openNav} className="md:hidden">
        <Icon name="menu" />
      </IconButton>
      {children ?? (
        <div className="min-w-0 flex-1 py-1">
          <h1 className="truncate type-headline-small text-fg md:type-headline-medium">{title}</h1>
          {subtitle && <div className="mt-1 type-body-medium text-muted">{subtitle}</div>}
        </div>
      )}
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Mobile-only menu button for headers that render their own content. */
export function MenuButton() {
  const t = useT();
  const { openNav } = useShell();
  return (
    <IconButton label={t("nav.menu")} onClick={openNav} className="md:hidden">
      <Icon name="menu" />
    </IconButton>
  );
}
