"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { api, errorText, formatDate, timeAgo } from "@/lib/client";
import { confirmDialog } from "@/lib/dialog-service";
import { toast } from "@/lib/toast";
import { PageHeader } from "./AppShell";
import { Banner, Button, Card, Chip, CopyField, Icon, IconButton, Spinner, TextField, Toggle } from "./ui";

interface CorsRule {
  corsRuleName: string;
  allowedOrigins: string[];
  allowedOperations: string[];
  allowedHeaders?: string[];
  exposeHeaders?: string[];
  maxAgeSeconds: number;
}

interface LifecycleRule {
  fileNamePrefix: string;
  daysFromUploadingToHiding: number | null;
  daysFromHidingToDeleting: number | null;
}

interface Bucket {
  bucketId: string;
  bucketName: string;
  bucketType: string;
  corsRules: CorsRule[];
  lifecycleRules: LifecycleRule[];
  revision: number;
}

interface Account {
  native: boolean;
  cdnUrls: Record<string, string>;
  downloadUrl?: string;
  s3Endpoint?: string | null;
}

/** Name of the CORS rule this app adds for browser uploads. */
const UPLOAD_RULE = "brimfall-uploads";

export function BucketSettings({ bucket }: { bucket: string }) {
  const t = useT();
  const router = useRouter();
  const [data, setData] = useState<Bucket | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const acc = await api<Account>("/api/account");
      setAccount(acc);
      if (!acc.native) return;
      const r = await api<{ bucket: Bucket }>(`/api/buckets/${encodeURIComponent(bucket)}`);
      setData(r.bucket);
    } catch (e) {
      setError(errorText(e));
    }
  }, [bucket]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const patch = async (what: string, body: Partial<Bucket>) => {
    setSaving(what);
    try {
      const r = await api<{ bucket: Bucket }>(`/api/buckets/${encodeURIComponent(bucket)}`, { method: "PATCH", body });
      setData(r.bucket);
      toast.ok(t("common.saved"));
      window.dispatchEvent(new Event("buckets-changed"));
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setSaving(null);
    }
  };

  const header = <PageHeader title={t("settings.title")} subtitle={<span className="font-mono text-[13px]" dir="ltr">{bucket}{data ? ` · ${data.bucketId}` : ""}</span>} />;

  let body: React.ReactNode;
  if (error) body = <Banner tone="error">{error}</Banner>;
  else if (account && !account.native) body = <Banner>{t("settings.needsNative")}</Banner>;
  else if (!data)
    body = (
      <div className="grid place-items-center py-20">
        <Spinner className="h-8 w-8 text-accent" />
      </div>
    );
  else {
    const isPublic = data.bucketType === "allPublic";
    const cdn = account?.cdnUrls[bucket];
    body = (
      <div className="max-w-[960px] space-y-4">
        <Card icon={isPublic ? "public" : "lock"} title={t("settings.visibility")} subtitle={t("settings.visibilityText")}>
          <label className="flex cursor-pointer items-center gap-4 rounded-xl bg-panel-2 px-4 py-3 dark:bg-surface-high">
            <div className="min-w-0 flex-1">
              <div className="type-title-medium text-fg">{t("settings.publicBucket")}</div>
              <div className="type-body-small text-muted">{isPublic ? t("settings.publicOn") : t("settings.publicOff")}</div>
            </div>
            {saving === "type" && <Spinner className="h-5 w-5 text-accent" />}
            <Toggle
              label={t("settings.publicBucket")}
              checked={isPublic}
              disabled={!!saving}
              onChange={async () => {
                const ok = await confirmDialog({
                  title: isPublic ? t("settings.makePrivateTitle") : t("settings.makePublicTitle"),
                  text: isPublic ? t("settings.makePrivateText") : t("settings.makePublicText"),
                  icon: isPublic ? "lock" : "public",
                  confirm: isPublic ? t("settings.makePrivate") : t("settings.makePublic"),
                  danger: !isPublic,
                });
                if (ok) patch("type", { bucketType: isPublic ? "allPrivate" : "allPublic" });
              }}
            />
          </label>
          {(cdn || account?.downloadUrl) && (
            <div className="mt-5 space-y-4">
              {cdn && <CopyField label={t("settings.cdnBase")} value={`${cdn}/`} />}
              {account?.downloadUrl && (
                <div>
                  <CopyField label={t("settings.friendlyUrl")} value={`${account.downloadUrl}/file/${bucket}/`} />
                  {!cdn && <p className="mt-1 px-4 type-body-small text-muted">{t("settings.cdnHint", { bucket })}</p>}
                </div>
              )}
            </div>
          )}
        </Card>

        <CorsCard rules={data.corsRules} saving={saving === "cors"} onSave={(r) => patch("cors", { corsRules: r })} />
        <LifecycleCard rules={data.lifecycleRules} saving={saving === "lifecycle"} onSave={(r) => patch("lifecycle", { lifecycleRules: r })} />
        <MultipartCard bucket={bucket} />

        <Card
          danger
          icon="delete_forever"
          title={t("settings.deleteTitle")}
          subtitle={t("settings.deleteText")}
          actions={
            <Button
              variant="danger"
              icon="delete"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: t("settings.deleteConfirm", { bucket }),
                  text: t("settings.cannotUndo"),
                  icon: "delete_forever",
                  typeToConfirm: bucket,
                  confirm: t("settings.deleteTitle"),
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api("/api/buckets", { method: "DELETE", query: { name: bucket } });
                  toast.ok(t("settings.deleted"));
                  window.dispatchEvent(new Event("buckets-changed"));
                  router.push("/buckets");
                } catch (e) {
                  toast.error(e);
                }
              }}
            >
              {t("common.delete")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-2 md:px-6">{body}</div>
    </div>
  );
}

// ---------- CORS ----------

function CorsCard({ rules, saving, onSave }: { rules: CorsRule[]; saving: boolean; onSave: (r: CorsRule[]) => Promise<boolean> }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // any rule that lets this origin PUT counts, whatever its name
  const allowed = rules.some((r) => (r.allowedOrigins.includes(origin) || r.allowedOrigins.includes("*")) && r.allowedOperations.includes("s3_put"));

  const enable = () => {
    const existing = rules.find((r) => r.corsRuleName === UPLOAD_RULE);
    const origins = new Set(existing?.allowedOrigins ?? []);
    origins.add(origin);
    const rule: CorsRule = {
      corsRuleName: UPLOAD_RULE,
      allowedOrigins: [...origins],
      allowedOperations: ["s3_put", "s3_get", "s3_head"],
      allowedHeaders: ["*"],
      exposeHeaders: ["ETag"],
      maxAgeSeconds: 3600,
    };
    onSave([...rules.filter((r) => r.corsRuleName !== UPLOAD_RULE), rule]);
  };

  return (
    <Card
      icon="swap_horiz"
      title={t("cors.title")}
      subtitle={t("cors.text")}
      actions={
        <Button
          variant="text"
          icon={editing ? "close" : "data_object"}
          onClick={() => {
            setText(JSON.stringify(rules, null, 2));
            setParseError(null);
            setEditing((e) => !e);
          }}
        >
          {editing ? t("cors.closeEditor") : t("cors.editJson")}
        </Button>
      }
    >
      <div className="space-y-4">
        {allowed ? (
          <Banner tone="ok">{t("cors.allowed", { origin })}</Banner>
        ) : (
          <Banner
            tone="warn"
            action={
              <Button variant="filled" icon="verified_user" loading={saving} onClick={enable} className="max-sm:w-full">
                {t("cors.allow")}
              </Button>
            }
          >
            {t("cors.notAllowed", { origin })}
          </Banner>
        )}

        {editing ? (
          <div>
            <textarea
              rows={14}
              value={text}
              spellCheck={false}
              dir="ltr"
              onChange={(e) => setText(e.target.value)}
              className="w-full resize-y rounded-[4px] border border-faint bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-fg outline-none focus:border-accent focus:ring-1 focus:ring-inset focus:ring-accent"
            />
            {parseError && <Banner tone="error" className="mt-2">{parseError}</Banner>}
            <div className="mt-3 flex justify-end">
              <Button
                variant="filled"
                loading={saving}
                onClick={async () => {
                  try {
                    const parsed = JSON.parse(text);
                    if (!Array.isArray(parsed)) throw new Error(t("cors.mustBeArray"));
                    setParseError(null);
                    if (await onSave(parsed)) setEditing(false);
                  } catch (e) {
                    setParseError(errorText(e));
                  }
                }}
              >
                {t("cors.save")}
              </Button>
            </div>
          </div>
        ) : rules.length === 0 ? (
          <p className="type-body-medium text-muted">{t("cors.none")}</p>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-line">
            {rules.map((r) => (
              <li key={r.corsRuleName} className="flex items-start gap-3 border-b border-line py-3 ps-4 pe-1 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] text-fg" dir="ltr">
                    {r.corsRuleName}
                  </div>
                  <div className="mt-1 break-all font-mono text-[12px] text-muted" dir="ltr">
                    {r.allowedOrigins.join(", ")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.allowedOperations.map((o) => (
                      <Chip key={o} className="font-mono !text-[11px]">
                        {o}
                      </Chip>
                    ))}
                  </div>
                </div>
                <IconButton label={t("cors.remove")} disabled={saving} onClick={() => onSave(rules.filter((x) => x.corsRuleName !== r.corsRuleName))}>
                  <Icon name="delete" size={20} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ---------- lifecycle ----------

function LifecycleCard({ rules, saving, onSave }: { rules: LifecycleRule[]; saving: boolean; onSave: (r: LifecycleRule[]) => Promise<boolean> }) {
  const t = useT();
  const [draft, setDraft] = useState<LifecycleRule[]>(rules);
  useEffect(() => setDraft(rules), [rules]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules);
  const invalid = draft.some((r) => r.daysFromUploadingToHiding === null && r.daysFromHidingToDeleting === null);
  const keepLatest = draft.some((r) => r.fileNamePrefix === "" && r.daysFromHidingToDeleting === 1 && !r.daysFromUploadingToHiding);

  const set = (i: number, p: Partial<LifecycleRule>) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const num = (v: string) => (v.trim() === "" ? null : Math.max(1, Math.floor(Number(v.replace(/\D/g, ""))) || 1));

  return (
    <Card
      icon="auto_delete"
      title={t("lifecycle.title")}
      subtitle={t("lifecycle.text")}
      actions={
        !keepLatest && (
          <Button
            variant="tonal"
            icon="auto_fix_high"
            onClick={() =>
              setDraft((d) => [...d.filter((r) => r.fileNamePrefix !== ""), { fileNamePrefix: "", daysFromUploadingToHiding: null, daysFromHidingToDeleting: 1 }])
            }
          >
            {t("lifecycle.keepLatest")}
          </Button>
        )
      }
    >
      {draft.length === 0 ? (
        <p className="mb-4 type-body-medium text-muted">{t("lifecycle.none")}</p>
      ) : (
        <div className="mb-4 space-y-3">
          {draft.map((r, i) => (
            <div key={i} className="grid items-start gap-3 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_160px_160px_auto] sm:border-0 sm:p-0">
              <TextField
                label={t("lifecycle.prefix")}
                value={r.fileNamePrefix}
                onChange={(v) => set(i, { fileNamePrefix: v })}
                placeholder={t("lifecycle.allFiles")}
                dir="ltr"
                className="[&_input]:font-mono"
              />
              <TextField
                label={t("lifecycle.hideAfter")}
                value={r.daysFromUploadingToHiding?.toString() ?? ""}
                onChange={(v) => set(i, { daysFromUploadingToHiding: num(v) })}
                placeholder={t("lifecycle.never")}
                inputMode="numeric"
                suffix={t("lifecycle.days")}
              />
              <TextField
                label={t("lifecycle.deleteAfter")}
                value={r.daysFromHidingToDeleting?.toString() ?? ""}
                onChange={(v) => set(i, { daysFromHidingToDeleting: num(v) })}
                placeholder={t("lifecycle.never")}
                inputMode="numeric"
                suffix={t("lifecycle.days")}
              />
              <IconButton label={t("lifecycle.remove")} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} className="mt-2 justify-self-end">
                <Icon name="delete" size={20} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="text"
          icon="add"
          onClick={() => setDraft((d) => [...d, { fileNamePrefix: "", daysFromUploadingToHiding: null, daysFromHidingToDeleting: null }])}
        >
          {t("lifecycle.add")}
        </Button>
        <div className="flex-1" />
        {invalid && <span className="type-body-small text-danger">{t("lifecycle.needsNumber")}</span>}
        {dirty && (
          <Button variant="text" onClick={() => setDraft(rules)}>
            {t("common.discard")}
          </Button>
        )}
        <Button variant="filled" disabled={!dirty || invalid} loading={saving} onClick={() => onSave(draft)}>
          {t("lifecycle.save")}
        </Button>
      </div>
    </Card>
  );
}

// ---------- unfinished multipart uploads ----------

type MultipartUpload = { key: string; uploadId: string; initiated: string | null };

function MultipartCard({ bucket }: { bucket: string }) {
  const t = useT();
  const [uploads, setUploads] = useState<MultipartUpload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUploads((await api<{ uploads: MultipartUpload[] }>("/api/multipart", { query: { bucket } })).uploads);
    } catch (e) {
      setError(errorText(e));
    }
  }, [bucket]);

  useEffect(() => {
    load();
  }, [load]);

  const abort = async (list: { key: string; uploadId: string }[]) => {
    setBusy(true);
    let failed = 0;
    for (const u of list) await api("/api/multipart", { method: "DELETE", body: { bucket, ...u } }).catch(() => failed++);
    if (failed) toast.error(t("multipart.failed", { count: failed }));
    else toast.ok(t("multipart.canceled", { count: list.length }));
    setBusy(false);
    load();
  };

  return (
    <Card
      icon="hourglass_empty"
      title={t("multipart.title")}
      subtitle={t("multipart.text")}
      actions={
        !!uploads?.length && (
          <Button variant="outlined" loading={busy} onClick={() => abort(uploads)}>
            {t("multipart.cancelAll")}
          </Button>
        )
      }
    >
      {error ? (
        <Banner tone="error">{error}</Banner>
      ) : !uploads ? (
        <Spinner className="h-6 w-6 text-accent" />
      ) : !uploads.length ? (
        <p className="flex items-center gap-2 type-body-medium text-muted">
          <Icon name="check_circle" size={20} className="text-ok" />
          {t("multipart.none")}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-line">
          {uploads.map((u) => (
            <li key={u.uploadId} className="flex items-center gap-3 border-b border-line py-2 ps-4 pe-1 last:border-b-0">
              <span className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-fg" dir="ltr">
                {u.key}
              </span>
              <span className="shrink-0 type-body-small text-muted" title={formatDate(u.initiated)}>
                {timeAgo(u.initiated)}
              </span>
              <IconButton label={t("multipart.cancel")} disabled={busy} onClick={() => abort([u])}>
                <Icon name="close" size={20} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
