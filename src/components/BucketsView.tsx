"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { api } from "@/lib/client";
import { toast } from "@/lib/toast";
import { PageHeader, useShell, type BucketSummary } from "./AppShell";
import { Banner, Button, Chip, CopyButton, cx, EmptyState, Icon, Modal, Segmented, Spinner, TextField } from "./ui";

export function BucketsView() {
  const t = useT();
  const { buckets, native, reloadBuckets } = useShell();
  const [creating, setCreating] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => reloadBuckets(), []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("buckets.title")}
        subtitle={buckets ? t("buckets.count", { count: buckets.length }) : undefined}
        actions={
          native && (
            <Button variant="filled" icon="add" onClick={() => setCreating(true)}>
              <span className="max-sm:hidden">{t("buckets.new")}</span>
              <span className="sm:hidden">{t("nav.new")}</span>
            </Button>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2 md:px-6">
        {!buckets ? (
          <div className="grid place-items-center py-20">
            <Spinner className="h-8 w-8 text-accent" />
          </div>
        ) : !buckets.length ? (
          <EmptyState icon="database" title={t("buckets.emptyTitle")} text={t("buckets.emptyText")} />
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {buckets.map((b) => (
              <BucketCard key={b.name} bucket={b} native={native} />
            ))}
          </div>
        )}
        {!native && buckets && buckets.length > 0 && (
          <Banner className="mt-6">{t("buckets.s3Only")}</Banner>
        )}
      </div>
      <CreateBucket
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          reloadBuckets();
        }}
      />
    </div>
  );
}

function BucketCard({ bucket: b, native }: { bucket: BucketSummary; native: boolean }) {
  const t = useT();
  const base = `/b/${encodeURIComponent(b.name)}`;
  const isPublic = b.type === "allPublic";
  return (
    <article className="group relative flex flex-col rounded-xl border border-line bg-panel p-5 transition-shadow duration-200 hover:shadow-e1">
      <div className="flex items-start gap-4">
        <span className={cx("grid h-12 w-12 shrink-0 place-items-center rounded-2xl", isPublic ? "bg-accent-soft text-on-accent-soft" : "bg-panel-2 text-muted dark:bg-surface-high")}>
          <Icon name="database" fill />
        </span>
        <div className="min-w-0 flex-1">
          <Link href={base} className="block truncate type-title-large text-fg after:absolute after:inset-0 after:rounded-xl hover:underline">
            {b.name}
          </Link>
          {b.id && (
            <div className="mt-0.5 truncate font-mono text-[12px] text-muted" dir="ltr">
              {b.id}
            </div>
          )}
        </div>
        {b.type && (
          <Chip tone={isPublic ? "accent" : "neutral"} icon={isPublic ? "public" : "lock"}>
            {isPublic ? t("buckets.public") : b.type === "allPrivate" ? t("buckets.private") : b.type}
          </Chip>
        )}
      </div>
      <div className="mt-4 flex min-h-10 items-center gap-1 rounded-lg bg-panel-2 ps-3 dark:bg-surface-high">
        <Icon name="language" size={18} className="text-muted" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted" dir="ltr">
          {b.cdnUrl ?? t("buckets.noCdn")}
        </span>
        {b.cdnUrl && (
          <span className="relative z-[1]">
            <CopyButton text={b.cdnUrl} />
          </span>
        )}
      </div>
      <div className="relative z-[1] mt-4 flex flex-wrap gap-2">
        <Link href={base} className="sl inline-flex h-10 items-center gap-2 rounded-full bg-select ps-4 pe-5 type-label-large text-on-select">
          <Icon name="folder_open" size={18} />
          {t("nav.files")}
        </Link>
        <span className="flex-1" />
        <Link href={`${base}/stats`} aria-label={t("nav.usage")} data-tip={t("nav.usage")} className="sl grid h-10 w-10 place-items-center rounded-full text-muted">
          <Icon name="bar_chart" />
        </Link>
        {native && (
          <Link href={`${base}/settings`} aria-label={t("nav.settings")} data-tip={t("nav.settings")} className="sl grid h-10 w-10 place-items-center rounded-full text-muted">
            <Icon name="tune" />
          </Link>
        )}
      </div>
    </article>
  );
}

function CreateBucket({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [type, setType] = useState<"allPrivate" | "allPublic">("allPrivate");
  const [busy, setBusy] = useState(false);
  const valid = /^[a-zA-Z0-9-]{6,50}$/.test(name) && !name.toLowerCase().startsWith("b2-");
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api("/api/buckets", { body: { name, type } });
      toast.ok(t("buckets.created", { name }));
      setName("");
      onDone();
    } catch (e) {
      toast.error(e);
    }
    setBusy(false);
  };
  return (
    <Modal
      open={open}
      title={t("buckets.new")}
      description={t("buckets.globalNames")}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="filled" disabled={!valid} loading={busy} onClick={submit}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <form
        className="space-y-6 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t("buckets.name")}
          value={name}
          onChange={(v) => setName(v.trim())}
          autoFocus
          surface="dialog"
          dir="ltr"
          className="[&_input]:font-mono"
          supporting={t("buckets.nameRules")}
          error={name && !valid ? t("errors.bucketNameRules") : undefined}
        />
        <div>
          <div className="mb-2 type-title-small text-muted">{t("buckets.visibility")}</div>
          <Segmented<"allPrivate" | "allPublic">
            label={t("buckets.visibility")}
            value={type}
            onChange={setType}
            options={[
              { value: "allPrivate", label: t("buckets.private"), icon: "lock" },
              { value: "allPublic", label: t("buckets.public"), icon: "public" },
            ]}
          />
        </div>
      </form>
    </Modal>
  );
}
