"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { t as tr, useT } from "@/i18n/client";
import { api, errorText, formatBytes } from "@/lib/client";
import { FileIcon } from "./FileIcon";
import { cx, Icon, IconButton } from "./ui";

type Status = "queued" | "uploading" | "done" | "error" | "canceled";

export interface UploadItem {
  id: number;
  bucket: string;
  key: string;
  file: File;
  status: Status;
  loaded: number;
  error?: string;
  startedAt?: number;
}

type Listener = (bucket: string, key: string) => void;

interface Ctx {
  enqueue: (bucket: string, prefix: string, files: { file: File; path: string }[]) => void;
  subscribe: (fn: Listener) => () => void;
}

const UploadCtx = createContext<Ctx>({ enqueue: () => {}, subscribe: () => () => {} });
export const useUploads = () => useContext(UploadCtx);

const FILE_CONCURRENCY = 3;
const PART_CONCURRENCY = 4;
const PART_RETRIES = 3;

class UploadCanceled extends Error {}

function putBlob(
  url: string,
  blob: Blob,
  contentType: string | null,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
  wantEtag = false,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(wantEtag ? xhr.getResponseHeader("ETag") : null);
      else {
        const msg = xhr.responseText.match(/<Message>([^<]+)<\/Message>/)?.[1];
        reject(new Error(msg ? `${xhr.status}: ${msg}` : tr("errors.uploadFailed", { status: xhr.status })));
      }
    };
    xhr.onerror = () => reject(new Error(tr("errors.uploadCors")));
    xhr.onabort = () => reject(new UploadCanceled("Canceled"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

async function uploadOne(item: UploadItem, onProgress: (loaded: number) => void, outer: AbortSignal) {
  const { bucket, key, file } = item;
  const contentType = file.type || "application/octet-stream";
  const init = await api<
    | { mode: "single"; url: string; contentType: string }
    | { mode: "multipart"; uploadId: string; partSize: number; partCount: number }
  >("/api/upload", { body: { action: "init", bucket, key, size: file.size, contentType } });

  if (init.mode === "single") {
    await putBlob(init.url, file, init.contentType, onProgress, outer);
    return;
  }

  const { uploadId, partSize, partCount } = init;
  // Aborted by the user, or when one part fails for good so the other workers stop too.
  const ctl = new AbortController();
  const signal = ctl.signal;
  if (outer.aborted) ctl.abort();
  else outer.addEventListener("abort", () => ctl.abort(), { once: true });
  const progress = new Array<number>(partCount).fill(0);
  const report = () => onProgress(progress.reduce((a, b) => a + b, 0));
  const parts: { PartNumber: number; ETag: string }[] = [];
  const urls = new Map<number, string>();
  let next = 1;

  const fetchUrls = async (from: number) => {
    const nums = [];
    for (let n = from; n < from + 20 && n <= partCount; n++) if (!urls.has(n)) nums.push(n);
    if (!nums.length) return;
    const res = await api<{ urls: Record<string, string> }>("/api/upload", {
      body: { action: "parts", bucket, key, uploadId, partNumbers: nums },
    });
    for (const [n, u] of Object.entries(res.urls)) urls.set(Number(n), u);
  };

  try {
    const worker = async () => {
      while (next <= partCount) {
        const n = next++;
        if (signal.aborted) throw new UploadCanceled("Canceled");
        if (!urls.has(n)) await fetchUrls(n);
        const blob = file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
        let attempt = 0;
        for (;;) {
          try {
            const etag = await putBlob(
              urls.get(n)!,
              blob,
              null,
              (l) => {
                progress[n - 1] = l;
                report();
              },
              signal,
              true,
            );
            if (!etag)
              throw new Error(tr("errors.etagMissing"));
            parts.push({ PartNumber: n, ETag: etag });
            break;
          } catch (e) {
            if (e instanceof UploadCanceled || ++attempt >= PART_RETRIES) throw e;
            progress[n - 1] = 0;
            urls.delete(n);
            await new Promise((r) => setTimeout(r, 800 * attempt));
            await fetchUrls(n);
          }
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, () =>
        worker().catch((e) => {
          ctl.abort();
          throw e;
        }),
      ),
    );
    await api("/api/upload", { body: { action: "complete", bucket, key, uploadId, parts } });
  } catch (e) {
    await api("/api/upload", { body: { action: "abort", bucket, key, uploadId } }).catch(() => {});
    throw e;
  }
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const seq = useRef(0);
  const listeners = useRef(new Set<Listener>());
  const controllers = useRef(new Map<number, AbortController>());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const running = useRef(new Set<number>());

  const patch = useCallback((id: number, p: Partial<UploadItem>) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }, []);

  // Scheduler: start queued items while below concurrency.
  useEffect(() => {
    const queued = items.filter((i) => i.status === "queued" && !running.current.has(i.id));
    const slots = FILE_CONCURRENCY - running.current.size;
    for (const item of queued.slice(0, Math.max(0, slots))) {
      running.current.add(item.id);
      const ctl = new AbortController();
      controllers.current.set(item.id, ctl);
      patch(item.id, { status: "uploading", startedAt: Date.now(), loaded: 0, error: undefined });
      let last = 0;
      uploadOne(
        item,
        (loaded) => {
          const now = Date.now();
          if (now - last > 150 || loaded === item.file.size) {
            last = now;
            patch(item.id, { loaded });
          }
        },
        ctl.signal,
      )
        .then(() => {
          patch(item.id, { status: "done", loaded: item.file.size });
          listeners.current.forEach((fn) => fn(item.bucket, item.key));
        })
        .catch((e) => {
          patch(item.id, e instanceof UploadCanceled ? { status: "canceled" } : { status: "error", error: errorText(e) });
        })
        .finally(() => {
          running.current.delete(item.id);
          controllers.current.delete(item.id);
          setItems((l) => [...l]); // re-run scheduler
        });
    }
  }, [items, patch]);

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    const busy = items.some((i) => i.status === "uploading" || i.status === "queued");
    if (!busy) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [items]);

  const enqueue = useCallback((bucket: string, prefix: string, files: { file: File; path: string }[]) => {
    if (!files.length) return;
    setCollapsed(false);
    setItems((list) => [
      ...list,
      ...files.map((f) => ({
        id: ++seq.current,
        bucket,
        key: prefix + f.path.replace(/^\/+/, ""),
        file: f.file,
        status: "queued" as Status,
        loaded: 0,
      })),
    ]);
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const cancel = (id: number) => {
    const ctl = controllers.current.get(id);
    if (ctl) ctl.abort();
    else patch(id, { status: "canceled" });
  };
  const retry = (id: number) => patch(id, { status: "queued", loaded: 0, error: undefined });
  const clearFinished = () =>
    setItems((l) => l.filter((i) => i.status === "uploading" || i.status === "queued"));
  const cancelAll = () => itemsRef.current.forEach((i) => (i.status === "uploading" || i.status === "queued") && cancel(i.id));

  const active = items.filter((i) => i.status === "uploading" || i.status === "queued");
  const failed = items.filter((i) => i.status === "error").length;
  const totalBytes = active.reduce((a, i) => a + i.file.size, 0);
  const loadedBytes = active.reduce((a, i) => a + i.loaded, 0);

  const done = items.filter((i) => i.status === "done").length;

  return (
    <UploadCtx.Provider value={{ enqueue, subscribe }}>
      {children}
      {items.length > 0 && (
        <UploadPanel
          items={items}
          active={active.length}
          failed={failed}
          done={done}
          loadedBytes={loadedBytes}
          totalBytes={totalBytes}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          onCancelAll={cancelAll}
          onClear={clearFinished}
          onCancel={cancel}
          onRetry={retry}
        />
      )}
    </UploadCtx.Provider>
  );
}

function UploadPanel(p: {
  items: UploadItem[];
  active: number;
  failed: number;
  done: number;
  loadedBytes: number;
  totalBytes: number;
  collapsed: boolean;
  onToggle: () => void;
  onCancelAll: () => void;
  onClear: () => void;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  const t = useT();
  const pct = p.totalBytes ? Math.min(100, (p.loadedBytes / p.totalBytes) * 100) : 0;
  return (
    <div
      role="region"
      aria-label={t("uploads.title")}
      className="m3-snack-in fixed inset-x-2 bottom-2 z-[65] overflow-hidden rounded-2xl bg-panel shadow-e3 sm:inset-x-auto sm:bottom-4 sm:end-4 sm:w-[400px] dark:bg-surface-high"
    >
      <div className="flex h-14 items-center gap-2 bg-panel-2 ps-5 pe-2 dark:bg-surface-highest">
        <span className="min-w-0 flex-1 truncate type-title-medium text-fg">
          {p.active
            ? t("uploads.uploading", { count: p.active })
            : p.failed
              ? t("uploads.failed", { count: p.failed })
              : t("uploads.complete", { count: p.done })}
        </span>
        <IconButton label={p.collapsed ? t("uploads.expand") : t("uploads.collapse")} onClick={p.onToggle}>
          <Icon name={p.collapsed ? "expand_less" : "expand_more"} />
        </IconButton>
        {!p.active && (
          <IconButton label={t("common.close")} onClick={p.onClear}>
            <Icon name="close" />
          </IconButton>
        )}
      </div>
      {p.active > 0 && (
        <div className="flex items-center gap-3 border-b border-line ps-5 pe-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="type-body-small text-muted">
              {t("uploads.progress", { loaded: formatBytes(p.loadedBytes), total: formatBytes(p.totalBytes) })}
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-accent-soft">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <button type="button" onClick={p.onCancelAll} className="sl h-9 rounded-full px-3 type-label-large text-accent">
            {t("uploads.cancelAll")}
          </button>
        </div>
      )}
      {!p.collapsed && (
        <ul className="max-h-[min(320px,45vh)] overflow-y-auto py-1">
          {[...p.items].reverse().map((i) => (
            <UploadRow key={i.id} item={i} onCancel={() => p.onCancel(i.id)} onRetry={() => p.onRetry(i.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Determinate circular progress (M3). */
function Ring({ pct }: { pct: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <circle cx="12" cy="12" r={r} fill="none" strokeWidth="3" className="stroke-accent-soft" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-accent transition-[stroke-dashoffset] duration-300"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
      />
    </svg>
  );
}

function UploadRow({ item, onCancel, onRetry }: { item: UploadItem; onCancel: () => void; onRetry: () => void }) {
  const t = useT();
  const pct = item.file.size ? Math.min(100, (item.loaded / item.file.size) * 100) : 100;
  const secs = item.startedAt ? (Date.now() - item.startedAt) / 1000 : 0;
  const speed = secs > 0.5 ? item.loaded / secs : 0;
  const name = item.key.slice(item.key.lastIndexOf("/") + 1);
  const busy = item.status === "uploading" || item.status === "queued";
  return (
    <li className="group flex min-h-14 items-center gap-3 ps-5 pe-2 py-1.5" title={item.key}>
      <FileIcon name={name} size={24} />
      <div className="min-w-0 flex-1">
        <div className="truncate type-body-medium text-fg">{name}</div>
        <div className={cx("truncate type-body-small", item.status === "error" ? "text-danger" : "text-muted")}>
          {item.status === "uploading"
            ? `${Math.floor(pct)}%${speed ? ` · ${t("uploads.speed", { speed: formatBytes(speed) })}` : ""}`
            : item.status === "queued"
              ? t("uploads.queued")
              : item.status === "canceled"
                ? t("uploads.canceled")
                : item.status === "error"
                  ? item.error
                  : formatBytes(item.file.size)}
        </div>
      </div>
      <div className="relative grid h-10 w-10 shrink-0 place-items-center">
        {item.status === "done" && <Icon name="check_circle" fill className="text-ok" />}
        {item.status === "uploading" && (
          <span className="group-hover:invisible">
            <Ring pct={pct} />
          </span>
        )}
        {item.status === "queued" && <Icon name="schedule" className="text-muted group-hover:invisible" />}
        {busy && (
          <IconButton label={t("common.cancel")} onClick={onCancel} className="!absolute inset-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100">
            <Icon name="close" />
          </IconButton>
        )}
        {(item.status === "error" || item.status === "canceled") && (
          <IconButton label={t("uploads.retry")} onClick={onRetry}>
            <Icon name="refresh" />
          </IconButton>
        )}
      </div>
    </li>
  );
}
