"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n/client";
import { api, errorText, formatDay } from "@/lib/client";
import { confirmDialog } from "@/lib/dialog-service";
import { toast } from "@/lib/toast";
import { PageHeader } from "./AppShell";
import { Banner, Button, Checkbox, Chip, CopyField, cx, EmptyState, FilterChip, Icon, IconButton, Modal, Select, Spinner, TextField } from "./ui";

interface Key {
  keyName: string;
  applicationKeyId: string;
  capabilities: string[];
  expirationTimestamp: number | null;
  bucketId: string | null;
  namePrefix: string | null;
}

interface Bucket {
  name: string;
  id: string | null;
}

type Created = { keyName: string; applicationKeyId: string; applicationKey: string };

const PRESETS = {
  readOnly: ["listBuckets", "listAllBucketNames", "listFiles", "readFiles"],
  readWrite: ["listBuckets", "listAllBucketNames", "listFiles", "readFiles", "shareFiles", "writeFiles", "deleteFiles"],
  writeOnly: ["listBuckets", "writeFiles"],
} as const;

export function KeysView() {
  const t = useT();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [all, setAll] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [lastCreated, setLastCreated] = useState<Created | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [k, b] = await Promise.all([
        api<{ keys: Key[]; currentKeyId: string; allCapabilities: string[] }>("/api/keys"),
        api<{ buckets: Bucket[] }>("/api/buckets"),
      ]);
      setKeys(k.keys);
      setAll(k.allCapabilities);
      setCurrent(k.currentKeyId);
      setBuckets(b.buckets);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const bucketName = useMemo(() => new Map(buckets.map((b) => [b.id, b.name])), [buckets]);

  const remove = async (k: Key) => {
    const ok = await confirmDialog({
      title: t("keys.deleteTitle", { name: k.keyName }),
      text: t("keys.deleteText"),
      icon: "key_off",
      danger: true,
      confirm: t("keys.delete"),
    });
    if (!ok) return;
    try {
      await api("/api/keys", { method: "DELETE", query: { id: k.applicationKeyId } });
      toast.ok(t("keys.deleted"));
      load();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("keys.title")}
        subtitle={t("keys.subtitle")}
        actions={
          <Button variant="filled" icon="add" onClick={() => setCreating(true)} disabled={!keys}>
            <span className="max-sm:hidden">{t("keys.new")}</span>
            <span className="sm:hidden">{t("nav.new")}</span>
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2 md:px-6">
        {error && <Banner tone="error">{error}</Banner>}
        {!keys && !error && (
          <div className="grid place-items-center py-20">
            <Spinner className="h-8 w-8 text-accent" />
          </div>
        )}
        {keys && !keys.length && <EmptyState icon="key" title={t("keys.emptyTitle")} />}
        {keys && keys.length > 0 && (
          <ul className="overflow-hidden rounded-xl border border-line">
            {keys.map((k) => {
              const everything = k.capabilities.length >= all.length - 2;
              const mine = k.applicationKeyId === current;
              return (
                <li key={k.applicationKeyId} className="flex gap-4 border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
                  <span className={cx("mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full", mine ? "bg-accent-soft text-on-accent-soft" : "bg-panel-2 text-muted dark:bg-surface-high")}>
                    <Icon name="key" size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate type-title-medium text-fg">{k.keyName}</span>
                      {mine && <Chip tone="accent" icon="bolt">{t("keys.thisApp")}</Chip>}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[12.5px] text-muted" dir="ltr">
                      {k.applicationKeyId}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {everything ? (
                        <Chip tone="accent">{t("keys.allCapabilities")}</Chip>
                      ) : (
                        k.capabilities.map((c) => (
                          <Chip key={c} className="font-mono !text-[11px]">
                            {c}
                          </Chip>
                        ))
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 type-body-small text-muted">
                      <span className="flex items-center gap-1.5">
                        <Icon name="database" size={16} />
                        <span dir="ltr" className="font-mono">
                          {k.bucketId ? (bucketName.get(k.bucketId) ?? k.bucketId) : t("keys.allBuckets")}
                          {k.namePrefix && `/${k.namePrefix}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Icon name="event" size={16} />
                        {k.expirationTimestamp ? t("keys.expires", { date: formatDay(k.expirationTimestamp) }) : t("keys.never")}
                      </span>
                    </div>
                  </div>
                  {!mine && (
                    <IconButton label={t("keys.delete")} onClick={() => remove(k)} className="-me-2 self-start">
                      <Icon name="delete" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CreateKeyDialog
        open={creating}
        all={all}
        buckets={buckets}
        onClose={() => setCreating(false)}
        onCreated={(k) => {
          setCreating(false);
          setCreated(k);
          setLastCreated(k);
          load();
        }}
      />
      <Modal
        open={!!created}
        title={t("keys.createdTitle")}
        icon={<Icon name="key" size={24} className="text-secondary" />}
        onClose={() => setCreated(null)}
        width={560}
        footer={
          <Button variant="filled" onClick={() => setCreated(null)}>
            {t("common.done")}
          </Button>
        }
      >
        {lastCreated && (
          <div className="space-y-5 pt-1">
            <Banner tone="warn">{t("keys.createdNote")}</Banner>
            <CopyField label="keyID" value={lastCreated.applicationKeyId} surface="dialog" />
            <CopyField label="applicationKey" value={lastCreated.applicationKey} surface="dialog" />
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateKeyDialog({
  open,
  all,
  buckets,
  onClose,
  onCreated,
}: {
  open: boolean;
  all: string[];
  buckets: Bucket[];
  onClose: () => void;
  onCreated: (k: Created) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [caps, setCaps] = useState<Set<string>>(new Set(PRESETS.readWrite));
  const [bucketId, setBucketId] = useState("");
  const [prefix, setPrefix] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setCaps(new Set(PRESETS.readWrite));
    setBucketId("");
    setPrefix("");
    setDays("");
    setBusy(false);
  }, [open]);

  const toggle = (c: string) =>
    setCaps((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  const same = (list: readonly string[]) => list.length === caps.size && list.every((c) => caps.has(c));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const r = await api<{ key: Created }>("/api/keys", {
        body: {
          keyName: name.trim(),
          capabilities: [...caps],
          bucketId: bucketId || undefined,
          namePrefix: prefix.trim() || undefined,
          validDays: days ? Number(days) : undefined,
        },
      });
      onCreated(r.key);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const nameOk = /^[A-Za-z0-9-]{1,100}$/.test(name.trim());
  const valid = nameOk && caps.size > 0;

  return (
    <Modal
      open={open}
      title={t("keys.new")}
      onClose={onClose}
      width={680}
      fullScreenOnMobile
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="filled" disabled={!valid} loading={busy} onClick={submit}>
            {t("keys.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-6 pt-2">
        <TextField
          label={t("keys.name")}
          value={name}
          onChange={setName}
          autoFocus
          surface="dialog"
          placeholder="my-app-uploader"
          supporting={t("keys.nameRules")}
          error={name && !nameOk ? t("errors.keyNameRules") : undefined}
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_140px]">
          <Select
            label={t("keys.bucket")}
            value={bucketId}
            onChange={(v) => {
              setBucketId(v);
              if (!v) setPrefix("");
            }}
            surface="dialog"
            options={[{ value: "", label: t("keys.allBuckets") }, ...buckets.filter((b) => b.id).map((b) => ({ value: b.id!, label: b.name }))]}
          />
          <TextField
            label={t("keys.prefix")}
            value={prefix}
            onChange={setPrefix}
            disabled={!bucketId}
            surface="dialog"
            placeholder={bucketId ? "uploads/" : ""}
            supporting={!bucketId ? t("keys.prefixNeedsBucket") : undefined}
            dir="ltr"
            className="[&_input]:font-mono"
          />
          <TextField label={t("keys.days")} value={days} onChange={(v) => setDays(v.replace(/\D/g, "").slice(0, 4))} surface="dialog" inputMode="numeric" placeholder="∞" />
        </div>
        <section>
          <h3 className="mb-3 type-title-small text-muted">{t("keys.capabilities")}</h3>
          <div className="mb-4 flex flex-wrap gap-2">
            <FilterChip selected={same(PRESETS.readOnly)} onClick={() => setCaps(new Set(PRESETS.readOnly))}>
              {t("keys.presetRead")}
            </FilterChip>
            <FilterChip selected={same(PRESETS.readWrite)} onClick={() => setCaps(new Set(PRESETS.readWrite))}>
              {t("keys.presetReadWrite")}
            </FilterChip>
            <FilterChip selected={same(PRESETS.writeOnly)} onClick={() => setCaps(new Set(PRESETS.writeOnly))}>
              {t("keys.presetWrite")}
            </FilterChip>
            <FilterChip selected={same(all)} onClick={() => setCaps(new Set(all))}>
              {t("keys.presetAll")}
            </FilterChip>
          </div>
          <div className="grid grid-cols-1 gap-x-2 sm:grid-cols-2">
            {all.map((c) => (
              <label key={c} className="-ms-2 flex cursor-pointer select-none items-center gap-1 font-mono text-[12.5px] text-fg">
                <Checkbox label={c} checked={caps.has(c)} onChange={() => toggle(c)} />
                <span dir="ltr">{c}</span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
