"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n/client";
import { api, errorText, formatBytes, formatDate, formatNumber, lastSegment, parentPrefix } from "@/lib/client";
import { confirmDialog } from "@/lib/dialog-service";
import { toast } from "@/lib/toast";
import { FileIcon } from "./FileIcon";
import { downloadFile } from "./Preview";
import { Banner, Button, Chip, CopyButton, CopyField, cx, Icon, IconButton, Modal, Segmented, Spinner, TextField, usePresence, useSticky } from "./ui";

type MoveResult = { copied: number; errors: string[]; conflicts: string[]; conflictCount: number };

/** Run a move/copy; if destination files exist, ask before overwriting them. Null when the user backs out. */
async function runMove(bucket: string, items: { from: string; to: string }[], copy: boolean, t: ReturnType<typeof useT>): Promise<MoveResult | null> {
  const r = await api<MoveResult>("/api/objects/move", { body: { bucket, items, copy } });
  if (!r.conflictCount) return r;
  const n = r.conflictCount;
  const ok = await confirmDialog({
    title: t("move.overwriteTitle", { count: n }),
    icon: "file_copy",
    text: (
      <>
        <p className="mb-2">{t("move.overwriteText")}</p>
        <ul className="max-h-40 list-disc overflow-y-auto ps-5 font-mono text-[12.5px]" dir="ltr">
          {r.conflicts.slice(0, 20).map((k) => (
            <li key={k} className="break-all">
              {k}
            </li>
          ))}
          {n > 20 && <li>{t("move.andMore", { count: n - 20 })}</li>}
        </ul>
      </>
    ),
    confirm: t("move.overwrite"),
    danger: true,
  });
  if (!ok) return null;
  return api<MoveResult>("/api/objects/move", { body: { bucket, items, copy, overwrite: true } });
}

// ---------- new folder ----------

export function NewFolderDialog({
  open,
  bucket,
  prefix,
  onClose,
  onDone,
}: {
  open: boolean;
  bucket: string;
  prefix: string;
  onClose: () => void;
  onDone: (key: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setBusy(false);
    }
  }, [open]);
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  const submit = async () => {
    if (!clean || busy) return;
    setBusy(true);
    try {
      const key = `${prefix}${clean}/`;
      await api("/api/objects/folder", { body: { bucket, key } });
      onDone(key);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={t("files.newFolder")}
      description={<span className="break-all font-mono text-[13px]" dir="ltr">{`${bucket}/${prefix}`}</span>}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="filled" disabled={!clean} loading={busy} onClick={submit}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <form
        className="pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t("newFolder.name")}
          value={name}
          onChange={setName}
          autoFocus
          surface="dialog"
          placeholder={t("newFolder.placeholder")}
          supporting={t("newFolder.hint", { name: clean || t("newFolder.name").toLowerCase() })}
        />
      </form>
    </Modal>
  );
}

// ---------- rename ----------

export function RenameDialog({ bucket, itemKey, onClose, onDone }: { bucket: string; itemKey: string | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const key = useSticky(itemKey) ?? "";
  const isFolder = key.endsWith("/");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (itemKey) {
      setName(lastSegment(itemKey));
      setBusy(false);
    }
  }, [itemKey]);
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  const submit = async () => {
    if (busy) return;
    if (!clean || clean === lastSegment(key)) return onClose();
    setBusy(true);
    const to = parentPrefix(key) + clean + (isFolder ? "/" : "");
    try {
      const r = await runMove(bucket, [{ from: key, to }], false, t);
      if (!r) return setBusy(false);
      if (r.errors.length) toast.error(t("files.errorsOccurred", { count: r.errors.length, first: r.errors[0] }));
      else toast.ok(t("rename.done", { name: clean }));
      onDone();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!itemKey}
      title={isFolder ? t("rename.folderTitle") : t("rename.fileTitle")}
      description={isFolder ? t("rename.folderNote") : t("rename.fileNote")}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="filled" disabled={!clean} loading={busy} onClick={submit}>
            {t("files.rename")}
          </Button>
        </>
      }
    >
      <form
        className="pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t("rename.newName")}
          value={name}
          onChange={setName}
          autoFocus
          surface="dialog"
          onFocus={(e) => {
            const v = e.currentTarget.value;
            const dot = v.lastIndexOf(".");
            e.currentTarget.setSelectionRange(0, !isFolder && dot > 0 ? dot : v.length);
          }}
        />
      </form>
    </Modal>
  );
}

// ---------- move / copy ----------

export function MoveDialog({
  bucket,
  keys: keysIn,
  startPrefix,
  onClose,
  onDone,
}: {
  bucket: string;
  keys: string[] | null;
  startPrefix: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const keys = useSticky(keysIn) ?? [];
  const open = !!keysIn;
  const [dest, setDest] = useState(startPrefix);
  const [folders, setFolders] = useState<{ key: string; name: string }[] | null>(null);
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setDest(startPrefix);
      setCopy(false);
      setBusy(false);
    }
  }, [open, startPrefix]);

  const norm = (p: string) => {
    const v = p.trim().replace(/^\/+/, "");
    return v && !v.endsWith("/") ? `${v}/` : v;
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setFolders(null);
    const tm = setTimeout(async () => {
      try {
        const r = await api<{ folders: { key: string; name: string }[] }>("/api/objects", { query: { bucket, prefix: norm(dest) } });
        if (alive) setFolders(r.folders);
      } catch {
        if (alive) setFolders([]);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
  }, [bucket, dest, open]);

  const target = norm(dest);
  const invalid = keys.some((k) => k.endsWith("/") && target.startsWith(k));
  const noop = keys.every((k) => parentPrefix(k) === target);

  const submit = async () => {
    setBusy(true);
    try {
      const items = keys.map((k) => ({ from: k, to: target + lastSegment(k) + (k.endsWith("/") ? "/" : "") }));
      const r = await runMove(bucket, items, copy, t);
      if (!r) return setBusy(false);
      if (r.errors.length) toast.error(t("files.errorsOccurred", { count: r.errors.length, first: r.errors[0] }));
      else toast.ok(copy ? t("move.copied", { count: r.copied }) : t("move.moved", { count: r.copied }));
      onDone();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const crumbs = target.split("/").filter(Boolean);

  return (
    <Modal
      open={open}
      title={copy ? t("move.copyTitle", { count: keys.length }) : t("move.moveTitle", { count: keys.length })}
      onClose={onClose}
      width={560}
      fullScreenOnMobile
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="filled" disabled={invalid || noop} loading={busy} onClick={submit}>
            {copy ? t("move.copyHere") : t("move.moveHere")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pt-2">
        <Segmented<"move" | "copy">
          label={t("move.mode")}
          value={copy ? "copy" : "move"}
          onChange={(v) => setCopy(v === "copy")}
          options={[
            { value: "move", label: t("move.move"), icon: "drive_file_move" },
            { value: "copy", label: t("move.copy"), icon: "file_copy" },
          ]}
        />
        <TextField
          label={t("move.destination")}
          value={dest}
          onChange={setDest}
          surface="dialog"
          leading="folder"
          placeholder={t("move.root")}
          dir="ltr"
          className="[&_input]:font-mono [&_input]:!text-[14px]"
        />
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="no-scrollbar flex items-center overflow-x-auto border-b border-line bg-panel-2 px-1 py-1 dark:bg-surface-highest">
            <button type="button" onClick={() => setDest("")} className="sl flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 type-label-large text-fg">
              <Icon name="home_storage" size={18} />
              {bucket}
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex shrink-0 items-center">
                <Icon name="chevron_right" size={18} className="text-muted" />
                <button type="button" onClick={() => setDest(crumbs.slice(0, i + 1).join("/") + "/")} className="sl h-8 rounded-full px-2.5 type-label-large text-fg">
                  {c}
                </button>
              </span>
            ))}
          </div>
          <div className="h-56 overflow-y-auto py-1">
            {folders === null ? (
              <div className="flex h-full items-center justify-center">
                <Spinner className="h-6 w-6 text-accent" />
              </div>
            ) : folders.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center type-body-medium text-muted">
                <Icon name="folder_off" size={32} />
                {t("move.noSubfolders")}
              </div>
            ) : (
              folders.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  disabled={keys.includes(f.key)}
                  onClick={() => setDest(f.key)}
                  className="sl flex h-12 w-full items-center gap-3 px-4 text-start type-body-large text-fg disabled:opacity-40"
                >
                  <FileIcon name={f.name} folder />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <Icon name="chevron_right" size={20} className="text-muted" />
                </button>
              ))
            )}
          </div>
        </div>
        {!copy && <p className="type-body-small text-muted">{t("move.moveNote")}</p>}
        {invalid && <Banner tone="error">{t("errors.folderIntoItself")}</Banner>}
      </div>
    </Modal>
  );
}

// ---------- share ----------

const EXPIRY = [3600, 86400, 7 * 86400] as const;

export function ShareDialog({ bucket, file: fileIn, onClose }: { bucket: string; file: { key: string; url: string | null } | null; onClose: () => void }) {
  const t = useT();
  const file = useSticky(fileIn);
  const [expires, setExpires] = useState<number>(86400);
  const [signed, setSigned] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (fileIn) setSigned(null);
  }, [fileIn]);
  const gen = async () => {
    if (!file) return;
    setBusy(true);
    try {
      setSigned(await api("/api/objects/url", { query: { bucket, key: file.key, expires } }));
    } catch (e) {
      toast.error(e);
    }
    setBusy(false);
  };
  const label = (s: number) => (s === 3600 ? t("share.hour") : s === 86400 ? t("share.day") : t("share.week"));
  return (
    <Modal
      open={!!fileIn}
      title={t("share.title")}
      description={<span className="break-all font-mono text-[13px]" dir="ltr">{file?.key}</span>}
      onClose={onClose}
      width={600}
      footer={
        <Button variant="text" onClick={onClose}>
          {t("common.done")}
        </Button>
      }
    >
      <div className="space-y-6 pt-2">
        {file?.url ? (
          <section>
            <h3 className="mb-1 flex items-center gap-2 type-title-small text-fg">
              <Icon name="public" size={18} className="text-accent" /> {t("share.publicUrl")}
            </h3>
            <p className="mb-3 type-body-small text-muted">{t("share.publicNote")}</p>
            <CopyField label={t("share.publicUrl")} value={file.url} surface="dialog" />
          </section>
        ) : (
          <Banner tone="info" icon="lock">
            {t("share.privateNote")}
          </Banner>
        )}
        <section>
          <h3 className="mb-1 flex items-center gap-2 type-title-small text-fg">
            <Icon name="timer" size={18} className="text-accent" /> {t("share.signedLink")}
          </h3>
          <p className="mb-3 type-body-small text-muted">{t("share.signedNote")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<number>
              label={t("share.expiresIn")}
              value={expires}
              onChange={(v) => {
                setExpires(v);
                setSigned(null);
              }}
              options={EXPIRY.map((s) => ({ value: s, label: label(s) }))}
              className="min-w-0 flex-1"
            />
            <Button variant="tonal" icon="add_link" loading={busy} onClick={gen}>
              {t("share.generate")}
            </Button>
          </div>
          {signed && (
            <div className="mt-4 animate-fade">
              <CopyField label={t("share.signedLink")} value={signed.url} surface="dialog" />
              <p className="mt-2 px-4 type-body-small text-muted">{t("share.expires", { date: formatDate(signed.expiresAt) })}</p>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

// ---------- details side sheet ----------

interface Info {
  key: string;
  size: number;
  contentType: string | null;
  lastModified: string | null;
  etag: string | null;
  versionId: string | null;
  cacheControl: string | null;
  metadata: Record<string, string>;
  url: string | null;
  versions: { versionId: string; size: number; lastModified: string | null; isLatest: boolean; deleteMarker: boolean }[];
}

export function InfoSheet({ bucket, fileKey, onClose, onChanged }: { bucket: string; fileKey: string | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const key = useSticky(fileKey) ?? "";
  const { mounted, closing } = usePresence(!!fileKey, 200);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (k: string) => {
    setError(null);
    try {
      setInfo(await api<Info>("/api/objects/info", { query: { bucket, key: k } }));
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    if (!fileKey) return;
    setInfo(null);
    load(fileKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, fileKey]);

  const restore = async (versionId: string) => {
    if (!(await confirmDialog({ title: t("info.restoreTitle"), text: t("info.restoreText"), icon: "history", confirm: t("info.restore") }))) return;
    try {
      await api("/api/objects/versions", { body: { bucket, key, versionId } });
      toast.ok(t("info.restored"));
      load(key);
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };

  const removeVersion = async (versionId: string) => {
    if (!(await confirmDialog({ title: t("info.deleteVersionTitle"), icon: "delete_forever", danger: true, confirm: t("info.deleteVersion") }))) return;
    try {
      await api("/api/objects/versions", { method: "DELETE", body: { bucket, key, versionId } });
      toast.ok(t("info.versionDeleted"));
      load(key);
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };

  if (!mounted) return null;
  const oldBytes = info?.versions.filter((v) => !v.isLatest).reduce((a, v) => a + v.size, 0) ?? 0;

  return createPortal(
    <div className="fixed inset-0 z-[58] lg:pointer-events-none">
      <div className={cx("absolute inset-0 bg-scrim lg:hidden", closing ? "m3-scrim-out" : "m3-scrim-in")} onClick={onClose} />
      <aside
        aria-label={t("info.title")}
        className={cx(
          "pointer-events-auto absolute inset-y-0 end-0 flex w-full max-w-[400px] flex-col bg-panel shadow-e3 sm:inset-y-2 sm:end-2 sm:rounded-[24px] dark:bg-panel-2",
          closing ? "m3-scrim-out" : "m3-side-in",
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 ps-6 pe-2">
          <h2 className="min-w-0 flex-1 truncate type-title-large text-fg">{t("info.title")}</h2>
          <IconButton label={t("common.close")} onClick={onClose}>
            <Icon name="close" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="mb-5 flex items-center gap-3 rounded-2xl bg-panel-2 p-3 dark:bg-surface-high">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-panel dark:bg-surface-highest">
              <FileIcon name={key} size={28} />
            </span>
            <div className="min-w-0">
              <div className="break-words type-title-medium text-fg">{lastSegment(key)}</div>
              {info && <div className="type-body-small text-muted">{formatBytes(info.size)}</div>}
            </div>
          </div>
          {error ? (
            <Banner tone="error">{error}</Banner>
          ) : !info ? (
            <div className="grid place-items-center py-10">
              <Spinner className="h-8 w-8 text-accent" />
            </div>
          ) : (
            <div className="space-y-6 animate-fade">
              <dl className="space-y-3">
                <Row label={t("info.path")} mono>
                  {info.key}
                </Row>
                <Row label={t("files.size")}>
                  {formatBytes(info.size)} <span className="text-muted">({t("info.bytes", { count: info.size })})</span>
                </Row>
                <Row label={t("info.type")} mono>
                  {info.contentType ?? "—"}
                </Row>
                <Row label={t("files.modified")}>{formatDate(info.lastModified)}</Row>
                <Row label="ETag" mono>
                  {info.etag ?? "—"}
                </Row>
                {info.cacheControl && (
                  <Row label="Cache-Control" mono>
                    {info.cacheControl}
                  </Row>
                )}
                {Object.entries(info.metadata).map(([k, v]) => (
                  <Row key={k} label={k} mono>
                    {v}
                  </Row>
                ))}
              </dl>
              {info.url && <CopyField label={t("share.publicUrl")} value={info.url} />}
              <div className="flex flex-wrap gap-2">
                <Button variant="tonal" icon="download" onClick={() => downloadFile(bucket, key).catch((e) => toast.error(e))}>
                  {t("files.download")}
                </Button>
                <CopyButton text={info.key} label={t("info.copyKey")} />
              </div>

              <section>
                <div className="mb-2 flex items-baseline gap-2">
                  <h3 className="type-title-medium text-fg">{t("info.versions")}</h3>
                  <span className="type-body-small text-muted">
                    {formatNumber(info.versions.length)}
                    {oldBytes > 0 && ` · ${t("info.oldBytes", { size: formatBytes(oldBytes) })}`}
                  </span>
                </div>
                {info.versions.length === 0 ? (
                  <p className="type-body-medium text-muted">{t("info.noVersions")}</p>
                ) : (
                  <ul className="overflow-hidden rounded-xl border border-line">
                    {info.versions.map((v) => (
                      <li key={v.versionId} className="flex items-center gap-1 border-b border-line py-2 ps-4 pe-1 last:border-b-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 type-body-medium text-fg">
                            {formatDate(v.lastModified)}
                            {v.isLatest && <Chip tone="accent">{t("info.current")}</Chip>}
                            {v.deleteMarker && <Chip tone="danger">{t("info.hidden")}</Chip>}
                          </div>
                          <div className="truncate font-mono text-[11.5px] text-muted" dir="ltr">
                            {v.deleteMarker ? t("info.deleteMarker") : formatBytes(v.size)} · {v.versionId.slice(0, 16)}…
                          </div>
                        </div>
                        {!v.deleteMarker && (
                          <IconButton label={t("info.downloadVersion")} size="sm" onClick={() => downloadFile(bucket, key, v.versionId).catch((e) => toast.error(e))}>
                            <Icon name="download" size={18} />
                          </IconButton>
                        )}
                        {!v.isLatest && !v.deleteMarker && (
                          <IconButton label={t("info.restore")} size="sm" onClick={() => restore(v.versionId)}>
                            <Icon name="history" size={18} />
                          </IconButton>
                        )}
                        <IconButton label={t("info.deleteVersion")} size="sm" onClick={() => removeVersion(v.versionId)}>
                          <Icon name="delete" size={18} />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="type-label-medium text-muted">{label}</dt>
      <dd className={cx("mt-0.5 break-all type-body-medium text-fg", mono && "font-mono text-[13px]")} dir={mono ? "ltr" : undefined}>
        {children}
      </dd>
    </div>
  );
}

