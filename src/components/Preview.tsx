"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import { api, errorText, formatBytes } from "@/lib/client";
import { previewKind } from "@/lib/filetypes";
import { toast } from "@/lib/toast";
import { FileIcon } from "./FileIcon";
import { Button, copyText, Icon, IconButton, Spinner } from "./ui";

export interface PreviewFile {
  key: string;
  name: string;
  size: number;
  url: string | null;
}

async function signedUrl(bucket: string, key: string, download = false, versionId?: string) {
  const r = await api<{ url: string }>("/api/objects/url", {
    query: { bucket, key, versionId, download: download ? 1 : undefined },
  });
  return r.url;
}

// A hidden iframe, not window.open: the URL arrives after an await, and popup blockers stop that.
export async function downloadFile(bucket: string, key: string, versionId?: string) {
  const url = await signedUrl(bucket, key, true, versionId);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 60_000);
}

/** Full-screen viewer with ← → between the files of the folder. */
export function PreviewOverlay({
  bucket,
  files,
  index,
  onIndex,
  onClose,
  onInfo,
  onShare,
}: {
  bucket: string;
  files: PreviewFile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onInfo: (f: PreviewFile) => void;
  onShare: (f: PreviewFile) => void;
}) {
  const t = useT();
  const file = files[index];
  const kind = previewKind(file.name);
  const [src, setSrc] = useState<string | null>(null);
  const [text, setText] = useState<{ text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setText(null);
    setError(null);
    (async () => {
      try {
        if (kind === "text") {
          const r = await api<{ text: string; truncated: boolean }>("/api/objects/text", { query: { bucket, key: file.key } });
          if (alive) setText(r);
        } else if (kind) {
          // Public/CDN URL first (CDN egress is usually free); signed URL only for private files.
          const u = file.url ?? (await signedUrl(bucket, file.key));
          if (alive) setSrc(u);
        }
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [bucket, file.key, file.url, kind]);

  const go = useCallback(
    (d: number) => {
      const n = index + d;
      if (n >= 0 && n < files.length) onIndex(n);
    },
    [index, files.length, onIndex],
  );

  useEffect(() => {
    const rtl = document.documentElement.dir === "rtl";
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("[role=dialog]:not([data-preview])")) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(rtl ? -1 : 1);
      if (e.key === "ArrowLeft") go(rtl ? 1 : -1);
    };
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  const action = "!text-white/90 hover:!text-white";

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={file.name} data-preview className="m3-scrim-in fixed inset-0 z-[60] flex flex-col bg-[#101214]/[0.97] text-white backdrop-blur-sm" data-theme="dark">
      <div className="flex h-16 shrink-0 items-center gap-1 px-2 sm:gap-2 sm:px-3">
        <IconButton label={t("common.close")} onClick={onClose} className={action}>
          <Icon name="arrow_back" />
        </IconButton>
        <FileIcon name={file.name} size={22} className="ms-1" />
        <div className="min-w-0 flex-1 px-2">
          <div className="truncate type-title-medium" title={file.key}>
            {file.name}
          </div>
          <div className="type-body-small text-white/60">
            {formatBytes(file.size)} · {t("preview.position", { n: index + 1, total: files.length })}
          </div>
        </div>
        {file.url && (
          <IconButton
            label={t("files.copyUrl")}
            className={action}
            onClick={async () => {
              await copyText(file.url!);
              toast.ok(t("files.urlCopied"));
            }}
          >
            <Icon name="link" />
          </IconButton>
        )}
        <IconButton label={t("files.shareLink")} className={action} onClick={() => onShare(file)}>
          <Icon name="share" />
        </IconButton>
        <IconButton label={t("files.download")} className={action} onClick={() => downloadFile(bucket, file.key).catch((e) => toast.error(e))}>
          <Icon name="download" />
        </IconButton>
        {src && (
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            aria-label={t("preview.openNewTab")}
            data-tip={t("preview.openNewTab")}
            className="sl hidden h-10 w-10 place-items-center rounded-full text-white/90 sm:inline-grid"
          >
            <Icon name="open_in_new" />
          </a>
        )}
        <IconButton label={t("files.details")} className={action} onClick={() => onInfo(file)}>
          <Icon name="info" />
        </IconButton>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-20" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {error ? (
          <div className="flex max-w-md items-start gap-3 rounded-xl bg-white/10 px-4 py-3 type-body-medium">
            <Icon name="error" size={20} />
            <span>{error}</span>
          </div>
        ) : !kind ? (
          <div className="flex flex-col items-center text-center">
            <span className="grid h-24 w-24 place-items-center rounded-3xl bg-white/10">
              <FileIcon name={file.name} size={48} />
            </span>
            <h3 className="mt-6 type-title-large">{t("preview.noPreview")}</h3>
            <p className="mt-2 type-body-medium text-white/70">{t("preview.noPreviewHint")}</p>
            <Button variant="filled" icon="download" className="mt-6" onClick={() => downloadFile(bucket, file.key).catch((e) => toast.error(e))}>
              {t("files.download")}
            </Button>
          </div>
        ) : kind === "text" ? (
          text ? (
            <pre className="m3-dialog-in h-full w-full max-w-5xl overflow-auto rounded-2xl bg-[#1e1f22] p-5 font-mono text-[13px] leading-relaxed text-white/90" dir="ltr">
              {text.text}
              {text.truncated && `\n\n… ${t("preview.truncated")}`}
            </pre>
          ) : (
            <Spinner className="h-10 w-10 text-white" />
          )
        ) : !src ? (
          <Spinner className="h-10 w-10 text-white" />
        ) : kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={file.name} className="m3-dialog-in max-h-full max-w-full rounded-sm object-contain shadow-e3" />
        ) : kind === "video" ? (
          <video key={src} src={src} controls autoPlay className="max-h-full max-w-full rounded-lg" />
        ) : kind === "audio" ? (
          <div className="flex w-full max-w-lg flex-col items-center gap-6 rounded-3xl bg-white/10 p-8">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-white/10">
              <Icon name="music_note" size={40} />
            </span>
            <audio key={src} src={src} controls autoPlay className="w-full" />
          </div>
        ) : (
          <iframe key={src} src={src} title={file.name} className="h-full w-full max-w-5xl rounded-lg bg-white" />
        )}

        {index > 0 && (
          <button
            type="button"
            aria-label={t("preview.previous")}
            onClick={() => go(-1)}
            className="sl absolute start-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white sm:start-4"
          >
            <Icon name="chevron_left" />
          </button>
        )}
        {index < files.length - 1 && (
          <button
            type="button"
            aria-label={t("preview.next")}
            onClick={() => go(1)}
            className="sl absolute end-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-black/40 text-white sm:end-4"
          >
            <Icon name="chevron_right" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
