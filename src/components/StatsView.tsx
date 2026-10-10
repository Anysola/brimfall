"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/format";
import { api, errorText, formatBytes, formatDate, timeAgo } from "@/lib/client";
import { PageHeader } from "./AppShell";
import { FileIcon } from "./FileIcon";
import { Banner, Button, Card, cx, Icon, LinearProgress } from "./ui";

interface Mini {
  key: string;
  size: number;
  lastModified: string | null;
}

interface Stats {
  bucket: string;
  prefix: string;
  scannedAt: string;
  truncated: boolean;
  versionsScanned: boolean;
  cached: boolean;
  current: { count: number; bytes: number };
  oldVersions: { count: number; bytes: number };
  hiddenFiles: number;
  byFolder: { name: string; count: number; bytes: number }[];
  byType: { type: string; count: number; bytes: number }[];
  largest: Mini[];
  recent: Mini[];
}

const TYPE_ICON: Record<string, string> = {
  image: "image",
  video: "movie",
  audio: "audio_file",
  document: "description",
  archive: "folder_zip",
  code: "code_blocks",
  font: "font_download",
  other: "draft",
};

/** Single-hue horizontal bars: one magnitude per row, value labelled at the end. */
function Bars({ rows, total }: { rows: { name: string; bytes: number; count: number; href?: string; icon?: string; color?: string }[]; total: number }) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => r.bytes));
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const share = total ? (r.bytes / total) * 100 : 0;
        const tip = `${r.name} · ${formatBytes(r.bytes)} · ${t("files.fileCount", { count: r.count })} · ${share.toFixed(1)}%`;
        const label = (
          <span className="flex min-w-0 items-center gap-2">
            {r.icon && (
              <span style={{ color: r.color, lineHeight: 0 }}>
                <Icon name={r.icon} size={18} fill />
              </span>
            )}
            <span className="truncate">{r.name}</span>
          </span>
        );
        return (
          <li key={r.name} data-tip={tip} className="group grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
            <span className="min-w-0 type-body-medium text-fg">
              {r.href ? (
                <Link href={r.href} className="block min-w-0 hover:underline">
                  {label}
                </Link>
              ) : (
                label
              )}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-panel-2 dark:bg-surface-highest">
              <span className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-emph" style={{ width: `${Math.max(1, (r.bytes / max) * 100)}%` }} />
            </span>
            <span className="w-[4.5rem] text-end type-body-small tabular-nums text-muted">{formatBytes(r.bytes)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function FileList({ rows, bucket, mode }: { rows: Mini[]; bucket: string; mode: "size" | "date" }) {
  const t = useT();
  if (!rows.length) return <p className="px-6 pb-4 type-body-medium text-muted">{t("stats.noFiles")}</p>;
  return (
    <ul>
      {rows.map((f) => {
        const dir = f.key.includes("/") ? f.key.slice(0, f.key.lastIndexOf("/") + 1) : "";
        const name = f.key.slice(dir.length);
        return (
          <li key={f.key}>
            <Link
              href={`/b/${encodeURIComponent(bucket)}${dir ? `?p=${encodeURIComponent(dir)}` : ""}`}
              title={f.key}
              className="sl flex h-14 items-center gap-3 px-5 sm:px-6"
            >
              <FileIcon name={name} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate type-body-medium text-fg">{name}</span>
                {dir && (
                  <span className="block truncate font-mono text-[11.5px] text-muted" dir="ltr">
                    {dir}
                  </span>
                )}
              </span>
              <span className="shrink-0 type-body-small tabular-nums text-muted" title={formatDate(f.lastModified)}>
                {mode === "size" ? formatBytes(f.size) : timeAgo(f.lastModified)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Tile({ label, value, sub, icon, accent }: { label: string; value: string; sub: string; icon: string; accent?: boolean }) {
  return (
    <div className={cx("min-w-0 rounded-xl p-4 sm:p-5", accent ? "col-span-2 bg-accent-soft text-on-accent-soft lg:col-span-1" : "border border-line bg-panel")}>
      <div className={cx("flex items-center gap-2 type-label-large", accent ? "" : "text-muted")}>
        <Icon name={icon} size={20} />
        {label}
      </div>
      <div className={cx("mt-3 truncate type-headline-small tabular-nums sm:type-headline-medium", accent ? "" : "text-fg")}>{value}</div>
      <div className={cx("mt-1 type-body-small", accent ? "opacity-80" : "text-muted")}>{sub}</div>
    </div>
  );
}

export function StatsView({ bucket }: { bucket: string }) {
  const t = useT();
  const params = useSearchParams();
  const prefix = params.get("p") ?? "";
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(0);

  const load = useCallback(
    async (refresh = false) => {
      setBusy(true);
      setError(null);
      try {
        setScanned(0);
        setStats(await api<Stats>("/api/stats", { query: { bucket, prefix, refresh: refresh ? 1 : undefined }, onProgress: setScanned }));
      } catch (e) {
        setError(errorText(e));
      }
      setBusy(false);
    },
    [bucket, prefix],
  );

  useEffect(() => {
    setStats(null);
    load();
  }, [load]);

  const base = `/b/${encodeURIComponent(bucket)}`;
  const total = stats ? stats.current.bytes + stats.oldVersions.bytes : 0;
  const curPct = total ? (stats!.current.bytes / total) * 100 : 100;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("stats.title")}
        subtitle={
          <span className="font-mono text-[13px]" dir="ltr">
            {bucket}
            {prefix && `/${prefix}`}
          </span>
        }
        actions={
          <>
            {prefix && (
              <Link href={`${base}/stats`} className="sl hidden h-10 items-center rounded-full px-3 type-label-large text-accent sm:inline-flex">
                {t("stats.wholeBucket")}
              </Link>
            )}
            <Button variant="tonal" icon="refresh" loading={busy} onClick={() => load(true)}>
              {t("stats.rescan")}
            </Button>
          </>
        }
      />
      {busy && stats && <LinearProgress className="mx-4 md:mx-6" />}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-2 md:px-6">
        {error && <Banner tone="error">{error}</Banner>}
        {!stats && !error && (
          <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
            <LinearProgress className="w-full" />
            <p className="mt-6 type-title-medium text-fg">{t("stats.scanning")}</p>
            <p className="mt-1 type-body-medium text-muted">{scanned ? t("stats.scanned", { count: scanned }) : t("stats.scanSlow")}</p>
          </div>
        )}

        {stats && (
          <div className="space-y-4 animate-fade">
            <p className="type-body-small text-muted">
              {t("stats.scannedAt", { when: timeAgo(stats.scannedAt) })}
              {stats.cached && ` · ${t("stats.cached")}`} · {t("stats.costNote")}
            </p>
            {stats.truncated && <Banner tone="warn">{t("stats.truncated")}</Banner>}

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <Tile accent icon="payments" label={t("stats.totalBilled")} value={formatBytes(total, 2)} sub={stats.hiddenFiles ? t("stats.hiddenFiles", { count: stats.hiddenFiles }) : t("stats.currentPlusOld")} />
              <Tile icon="cloud" label={t("stats.stored")} value={formatBytes(stats.current.bytes, 2)} sub={t("files.fileCount", { count: stats.current.count })} />
              <Tile
                icon="history"
                label={t("stats.oldVersions")}
                value={stats.versionsScanned ? formatBytes(stats.oldVersions.bytes, 2) : "—"}
                sub={stats.versionsScanned ? t("stats.versionsBilled", { count: stats.oldVersions.count }) : t("stats.notAvailable")}
              />
              <Tile icon="straighten" label={t("stats.averageFile")} value={formatBytes(stats.current.count ? stats.current.bytes / stats.current.count : 0)} sub={t("stats.topLevel", { count: stats.byFolder.length })} />
            </div>

            {stats.versionsScanned && total > 0 && (
              <Card>
                <div className="pt-5">
                  <div className="mb-3 type-title-medium text-fg">{t("stats.breakdown")}</div>
                  <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${t("stats.stored")} ${formatBytes(stats.current.bytes)}, ${t("stats.oldVersions")} ${formatBytes(stats.oldVersions.bytes)}`}>
                    <span className="h-full rounded-s-full bg-accent" style={{ width: `${curPct}%` }} data-tip={`${t("stats.stored")} · ${formatBytes(stats.current.bytes)}`} />
                    {stats.oldVersions.bytes > 0 && (
                      <span className="h-full flex-1 rounded-e-full bg-tertiary" data-tip={`${t("stats.oldVersions")} · ${formatBytes(stats.oldVersions.bytes)}`} />
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 type-body-small text-muted">
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-accent" />
                      {t("stats.stored")} · <span className="tabular-nums text-fg">{formatBytes(stats.current.bytes)}</span> ({curPct.toFixed(1)}%)
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-tertiary" />
                      {t("stats.oldVersions")} · <span className="tabular-nums text-fg">{formatBytes(stats.oldVersions.bytes)}</span> ({(100 - curPct).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </Card>
            )}

            {stats.oldVersions.bytes > stats.current.bytes * 0.1 && stats.oldVersions.bytes > 50 * 1024 ** 2 && (
              <Banner
                tone="warn"
                action={
                  <Link href={`${base}/settings`} className="sl inline-flex h-9 items-center rounded-full px-3 type-label-large">
                    {t("stats.addRule")}
                  </Link>
                }
              >
                {t("stats.oldWarning", { size: formatBytes(stats.oldVersions.bytes) })}
              </Banner>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t("stats.byFolder")} subtitle={prefix ? t("stats.byFolderSubPrefix") : t("stats.byFolderSub")}>
                <Bars
                  total={stats.current.bytes}
                  rows={stats.byFolder.slice(0, 14).map((f) => ({
                    ...f,
                    name: f.name || t("stats.rootFiles"),
                    icon: f.name.endsWith("/") ? "folder" : undefined,
                    color: "var(--ft-folder)",
                    href: f.name.endsWith("/") ? `${base}?p=${encodeURIComponent(prefix + f.name)}` : undefined,
                  }))}
                />
                {stats.byFolder.length > 14 && <p className="mt-2 px-2 type-body-small text-muted">{t("stats.more", { count: stats.byFolder.length - 14 })}</p>}
              </Card>
              <Card title={t("stats.byType")} subtitle={t("stats.byTypeSub")}>
                <Bars
                  total={stats.current.bytes}
                  rows={stats.byType.map((x) => ({
                    name: t(`types.${x.type}` as MessageKey),
                    bytes: x.bytes,
                    count: x.count,
                    icon: TYPE_ICON[x.type] ?? "draft",
                    color: `var(--ft-${TYPE_ICON[x.type] ? x.type : "other"})`,
                  }))}
                />
              </Card>
              <Card title={t("stats.largest")} flush>
                <FileList rows={stats.largest} bucket={bucket} mode="size" />
              </Card>
              <Card title={t("stats.recent")} flush>
                <FileList rows={stats.recent} bucket={bucket} mode="date" />
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
