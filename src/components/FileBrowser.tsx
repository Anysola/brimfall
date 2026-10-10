"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";
import { onAction } from "@/lib/actions";
import { api, errorText, formatBytes, formatDate, readLocal, timeAgo, writeLocal } from "@/lib/client";
import { confirmDialog } from "@/lib/dialog-service";
import { previewKind } from "@/lib/filetypes";
import { toast } from "@/lib/toast";
import { MenuButton, NewMenu, useShell } from "./AppShell";
import { InfoSheet, MoveDialog, NewFolderDialog, RenameDialog, ShareDialog } from "./dialogs";
import { FileIcon } from "./FileIcon";
import { downloadFile, PreviewOverlay, type PreviewFile } from "./Preview";
import { useUploads } from "./uploads";
import {
  Banner,
  Button,
  Checkbox,
  ContextMenu,
  copyText,
  cx,
  EmptyState,
  Icon,
  IconButton,
  Kbd,
  MenuItem,
  MenuDivider,
  MoreMenu,
  Popover,
  Spinner,
  type MenuEntry,
} from "./ui";

interface FolderRow {
  kind: "folder";
  key: string;
  name: string;
}
interface FileRow {
  kind: "file";
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  url: string | null;
  thumb: string | null;
}
type Row = FolderRow | FileRow;

interface ListResponse {
  folders: { key: string; name: string }[];
  files: Omit<FileRow, "kind">[];
  nextToken: string | null;
  truncated: boolean;
}

type SortBy = "name" | "size" | "date";
type Sort = { by: SortBy; dir: 1 | -1 };

// Read dropped files, including whole folders.
async function readDrop(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = [];
  const entries = [...dt.items]
    .map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null))
    .filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files].map((f) => ({ file: f, path: f.name }));
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: path + file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

const coarse = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export function FileBrowser({ bucket }: { bucket: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const prefix = params.get("p") ?? "";
  const { enqueue, subscribe } = useUploads();
  const { pickFiles } = useShell();

  const [rows, setRows] = useState<Row[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const [query, setQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<Sort>({ by: "name", dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<string | null>(null);

  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: Row } | null>(null);
  const [menuOpenKey, setMenuOpenKey] = useState<string | null>(null);

  const [preview, setPreview] = useState<number | null>(null);
  const [infoKey, setInfoKey] = useState<string | null>(null);
  const [share, setShare] = useState<{ key: string; url: string | null } | null>(null);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [moveKeys, setMoveKeys] = useState<string[] | null>(null);
  const [newFolder, setNewFolder] = useState(false);

  const searchInput = useRef<HTMLInputElement>(null);
  const crumbsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setView(readLocal("bf-view", "list"));
    setSort(readLocal("bf-sort", { by: "name", dir: 1 }));
  }, []);

  useEffect(() => onAction((a) => a === "newFolder" && setNewFolder(true)), []);

  const go = useCallback(
    (p: string) => {
      setQuery("");
      setActiveSearch("");
      router.push(p ? `${pathname}?p=${encodeURIComponent(p)}` : pathname);
    },
    [router, pathname],
  );

  const toRows = (r: ListResponse): Row[] => [
    ...r.folders.map((f) => ({ kind: "folder" as const, ...f })),
    ...r.files.map((f) => ({ kind: "file" as const, ...f })),
  ];

  // Only the latest request may update the list; older ones finishing late are ignored.
  const loadSeq = useRef(0);

  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      const seq = ++loadSeq.current;
      if (!opts.quiet) setLoading(true);
      setError(null);
      try {
        const r = await api<ListResponse>("/api/objects", {
          query: { bucket, prefix, search: activeSearch || undefined, thumbs: view === "grid" ? 1 : undefined },
        });
        if (seq !== loadSeq.current) return;
        setRows(toRows(r));
        setNextToken(r.nextToken);
        setTruncated(r.truncated);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setError(errorText(e));
        setRows([]);
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [bucket, prefix, activeSearch, view],
  );

  useEffect(() => {
    setSelected(new Set());
    load();
  }, [load]);

  // keep the current folder visible in long paths
  useEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = document.documentElement.dir === "rtl" ? -el.scrollWidth : el.scrollWidth;
  }, [prefix]);

  const loadMore = async () => {
    if (!nextToken) return;
    const seq = loadSeq.current;
    setLoadingMore(true);
    try {
      const r = await api<ListResponse>("/api/objects", {
        query: { bucket, prefix, token: nextToken, thumbs: view === "grid" ? 1 : undefined },
      });
      if (seq !== loadSeq.current) return;
      setRows((cur) => [...cur, ...toRows(r)]);
      setNextToken(r.nextToken);
    } catch (e) {
      toast.error(e);
    }
    setLoadingMore(false);
  };

  // Refresh when uploads into this folder finish (debounced).
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe((b, key) => {
      if (b !== bucket || !key.startsWith(prefix)) return;
      clearTimeout(tm);
      tm = setTimeout(() => load({ quiet: true }), 600);
    });
    return () => {
      off();
      clearTimeout(tm);
    };
  }, [subscribe, bucket, prefix, load]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    const tm = setTimeout(() => setActiveSearch(q.length >= 2 ? q : ""), 350);
    return () => clearTimeout(tm);
  }, [query]);

  const sorted = useMemo(() => {
    const cmp = (a: Row, b: Row) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      let d = 0;
      if (sort.by === "size" && a.kind === "file" && b.kind === "file") d = a.size - b.size;
      else if (sort.by === "date" && a.kind === "file" && b.kind === "file") d = (a.lastModified ?? "").localeCompare(b.lastModified ?? "");
      if (d === 0) d = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      return d * sort.dir;
    };
    return [...rows].sort(cmp);
  }, [rows, sort]);

  const files = useMemo(() => sorted.filter((r): r is FileRow => r.kind === "file"), [sorted]);
  const folders = useMemo(() => sorted.filter((r): r is FolderRow => r.kind === "folder"), [sorted]);

  const setSortTo = (next: Sort) => {
    setSort(next);
    writeLocal("bf-sort", next);
  };
  const setSortBy = (by: SortBy) => setSortTo({ by, dir: (sort.by === by ? -sort.dir : 1) as 1 | -1 });

  const setViewMode = (v: "list" | "grid") => {
    setView(v);
    writeLocal("bf-view", v);
  };

  // ---------- selection ----------
  const selecting = selected.size > 0;

  const onRowClick = (e: React.MouseEvent, row: Row) => {
    // touch: a tap opens, unless we're already selecting
    if (coarse() && !selecting) return open(row);
    if (coarse()) return toggle(row.key);
    const next = new Set(e.metaKey || e.ctrlKey || e.shiftKey ? selected : []);
    if (e.shiftKey && lastClicked.current) {
      const a = sorted.findIndex((r) => r.key === lastClicked.current);
      const b = sorted.findIndex((r) => r.key === row.key);
      if (a !== -1 && b !== -1) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(sorted[i].key);
    } else if (next.has(row.key) && (e.metaKey || e.ctrlKey)) next.delete(row.key);
    else next.add(row.key);
    lastClicked.current = row.key;
    setSelected(next);
  };

  const toggle = (key: string, e?: React.MouseEvent) => {
    if (e?.shiftKey && lastClicked.current) {
      const next = new Set(selected);
      const a = sorted.findIndex((r) => r.key === lastClicked.current);
      const b = sorted.findIndex((r) => r.key === key);
      if (a !== -1 && b !== -1) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(sorted[i].key);
      lastClicked.current = key;
      return setSelected(next);
    }
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    lastClicked.current = key;
    setSelected(next);
  };

  const allSelected = sorted.length > 0 && selected.size === sorted.length;
  const selectAll = () => setSelected(allSelected ? new Set() : new Set(sorted.map((r) => r.key)));

  // ---------- actions ----------
  const open = (row: Row) => {
    if (row.kind === "folder") return go(row.key);
    const i = files.findIndex((f) => f.key === row.key);
    if (previewKind(row.name) && i !== -1) setPreview(i);
    else setInfoKey(row.key);
  };

  const remove = async (keys: string[]) => {
    const folderCount = keys.filter((k) => k.endsWith("/")).length;
    const res = await confirmDialog({
      title: keys.length === 1 ? t("files.deleteOne", { name: keys[0].slice(prefix.length) || keys[0] }) : t("files.deleteMany", { count: keys.length }),
      text: (
        <>
          {folderCount > 0 && <p className="mb-2">{t("files.deleteFoldersNote")}</p>}
          <p>{t("files.deleteNote")}</p>
        </>
      ),
      icon: "delete",
      confirm: t("common.delete"),
      danger: true,
      checkbox: { label: t("files.onlyHide") },
    });
    if (!res) return;
    try {
      const r = await api<{ deleted: number; errors: string[] }>("/api/objects", {
        method: "DELETE",
        body: { bucket, keys, permanent: !res.checked },
      });
      if (r.errors.length) toast.error(t("files.errorsOccurred", { count: r.errors.length, first: r.errors[0] }));
      else toast.ok(t("files.deleted", { count: r.deleted }));
      setSelected(new Set());
      load({ quiet: true });
    } catch (e) {
      toast.error(e);
    }
  };

  const downloadMany = async (keys: string[]) => {
    const list = keys.filter((k) => !k.endsWith("/"));
    if (list.length < keys.length) toast.info(t("files.foldersSkipped"));
    for (const k of list) {
      await downloadFile(bucket, k).catch((e) => toast.error(e));
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  const copyLinks = async (keys: string[]) => {
    const urls = files.filter((f) => keys.includes(f.key) && f.url).map((f) => f.url!) as string[];
    if (!urls.length) return toast.error(t("files.noPublicUrls"));
    await copyText(urls.join("\n"));
    toast.ok(t("files.urlsCopied", { count: urls.length }));
  };

  const copyUrl = async (url: string) => {
    await copyText(url);
    toast.ok(t("files.urlCopied"));
  };

  const menuFor = (row: Row): MenuEntry[] =>
    row.kind === "folder"
      ? [
          { label: t("files.open"), icon: "folder_open", onClick: () => go(row.key) },
          { label: t("nav.usage"), icon: "bar_chart", onClick: () => router.push(`/b/${encodeURIComponent(bucket)}/stats?p=${encodeURIComponent(row.key)}`) },
          { label: t("files.rename"), icon: "edit", onClick: () => setRenameKey(row.key), divider: true },
          { label: t("files.moveOrCopy"), icon: "drive_file_move", onClick: () => setMoveKeys([row.key]) },
          { label: t("files.copyPath"), icon: "content_copy", onClick: () => copyText(row.key).then(() => toast.ok(t("files.pathCopied"))) },
          { label: t("common.delete"), icon: "delete", onClick: () => remove([row.key]), danger: true, divider: true },
        ]
      : [
          { label: t("files.preview"), icon: "visibility", onClick: () => open(row), hidden: !previewKind(row.name) },
          { label: t("files.copyUrl"), icon: "link", onClick: () => copyUrl(row.url!), hidden: !row.url },
          { label: t("files.shareLink"), icon: "share", onClick: () => setShare({ key: row.key, url: row.url }) },
          { label: t("files.download"), icon: "download", onClick: () => downloadFile(bucket, row.key).catch((e) => toast.error(e)) },
          { label: t("files.rename"), icon: "edit", onClick: () => setRenameKey(row.key), divider: true },
          { label: t("files.moveOrCopy"), icon: "drive_file_move", onClick: () => setMoveKeys([row.key]) },
          { label: t("files.details"), icon: "info", onClick: () => setInfoKey(row.key) },
          { label: t("common.delete"), icon: "delete", onClick: () => remove([row.key]), danger: true, divider: true },
        ];

  const selKeys = [...selected];
  const multiMenu: MenuEntry[] = [
    { label: t("files.downloadN", { count: selected.size }), icon: "download", onClick: () => downloadMany(selKeys) },
    { label: t("files.copyUrls"), icon: "link", onClick: () => copyLinks(selKeys) },
    { label: t("files.moveOrCopy"), icon: "drive_file_move", onClick: () => setMoveKeys(selKeys) },
    { label: t("files.deleteN", { count: selected.size }), icon: "delete", onClick: () => remove(selKeys), danger: true, divider: true },
  ];

  const onContext = (e: React.MouseEvent, row: Row) => {
    e.preventDefault();
    if (!selected.has(row.key)) setSelected(new Set([row.key]));
    setCtx({ x: e.clientX, y: e.clientY, row });
  };

  // ---------- drag & drop ----------
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const list = await readDrop(e.dataTransfer);
    enqueue(bucket, prefix, list);
  };

  // ---------- keyboard ----------
  const modalOpen = preview !== null || !!share || !!renameKey || !!moveKeys || newFolder || !!ctx;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (modalOpen || el.closest("input, textarea, select, [role=dialog], [role=menu]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInput.current?.focus();
      } else if ((e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) && selected.size) {
        remove([...selected]);
      } else if (e.key === "Escape") {
        if (infoKey) setInfoKey(null);
        else setSelected(new Set());
      } else if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        setSelected(new Set(sorted.map((r) => r.key)));
      } else if (e.key === "Enter" && selected.size === 1) {
        const row = sorted.find((r) => selected.has(r.key));
        if (row) open(row);
      } else if (e.key === "Backspace" && prefix) {
        const parts = prefix.split("/").filter(Boolean);
        go(parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const crumbs = prefix.split("/").filter(Boolean);
  const loadedBytes = files.reduce((a, r) => a + r.size, 0);
  const summary = loading
    ? ""
    : activeSearch
      ? t("files.matches", { count: rows.length }) + (truncated ? ` · ${t("files.limited")}` : "")
      : [folders.length ? t("files.folderCount", { count: folders.length }) : null, t("files.fileCount", { count: files.length }), formatBytes(loadedBytes) + (nextToken ? "+" : "")]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* search */}
      <header className="flex shrink-0 items-center gap-1 px-2 pt-2 sm:px-4 md:gap-2 md:px-6 md:pt-4">
        <MenuButton />
        <SearchBar
          inputRef={searchInput}
          value={query}
          onChange={setQuery}
          placeholder={prefix ? t("files.searchFolder") : t("files.searchBucket", { bucket })}
          busy={loading && !!activeSearch}
        />
        <div className="ms-auto flex shrink-0 items-center">
          <IconButton label={t("common.refresh")} onClick={() => load()} className="hidden sm:inline-grid">
            <Icon name="refresh" className={loading ? "animate-spin [animation-duration:1.2s]" : ""} />
          </IconButton>
          <div role="radiogroup" aria-label={t("files.view")} className="ms-1 hidden h-10 overflow-hidden rounded-full border border-faint sm:flex">
            {(["list", "grid"] as const).map((v, i) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                aria-label={v === "list" ? t("files.listView") : t("files.gridView")}
                data-tip={v === "list" ? t("files.listView") : t("files.gridView")}
                onClick={() => setViewMode(v)}
                className={cx("sl grid w-12 place-items-center transition-colors", i > 0 && "border-s border-faint", view === v ? "bg-select text-on-select" : "text-muted")}
              >
                <Icon name={v === "list" ? "view_list" : "grid_view"} size={20} fill={view === v} />
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* path or selection */}
      <div className="flex h-16 shrink-0 items-center gap-2 px-2 sm:px-4 md:px-6">
        {selecting ? (
          <div className="m3-snack-in flex h-12 min-w-0 flex-1 items-center gap-0.5 rounded-full bg-select ps-1 pe-1 text-on-select">
            <IconButton label={t("files.clearSelection")} onClick={() => setSelected(new Set())} className="!text-current">
              <Icon name="close" />
            </IconButton>
            <span className="min-w-0 flex-1 truncate ps-1 type-title-medium">{t("files.selected", { count: selected.size })}</span>
            <IconButton label={allSelected ? t("files.selectNone") : t("files.selectAll")} onClick={selectAll} className="!text-current">
              <Icon name={allSelected ? "deselect" : "select_all"} />
            </IconButton>
            <IconButton label={t("files.download")} onClick={() => downloadMany(selKeys)} className="!text-current">
              <Icon name="download" />
            </IconButton>
            <IconButton label={t("files.copyUrls")} onClick={() => copyLinks(selKeys)} className="!text-current max-sm:hidden">
              <Icon name="link" />
            </IconButton>
            <IconButton label={t("files.moveOrCopy")} onClick={() => setMoveKeys(selKeys)} className="!text-current max-sm:hidden">
              <Icon name="drive_file_move" />
            </IconButton>
            <IconButton label={t("common.delete")} onClick={() => remove(selKeys)} className="!text-current">
              <Icon name="delete" />
            </IconButton>
            <span className="sm:hidden">
              <MoreMenu label={t("common.more")} items={multiMenu.slice(1, 3)} className="!text-current" />
            </span>
          </div>
        ) : (
          <>
            <nav ref={crumbsRef} aria-label={t("files.path")} className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">
              {activeSearch ? (
                <span className="truncate ps-2 type-title-large text-fg">{t("files.resultsFor", { query: activeSearch })}</span>
              ) : (
                <>
                  <Crumb onClick={() => go("")} current={!crumbs.length} icon="folder_open">
                    {bucket}
                  </Crumb>
                  {crumbs.map((c, i) => (
                    <span key={i} className="flex shrink-0 items-center">
                      <Icon name="chevron_right" size={20} className="text-muted" />
                      <Crumb onClick={() => go(crumbs.slice(0, i + 1).join("/") + "/")} current={i === crumbs.length - 1}>
                        {c}
                      </Crumb>
                    </span>
                  ))}
                </>
              )}
            </nav>
            <span className="hidden shrink-0 type-body-small text-muted lg:block">{summary}</span>
            <SortButton sort={sort} onSort={setSortTo} className={view === "list" ? "sm:hidden" : ""} />
          </>
        )}
      </div>

      {/* body */}
      <div
        className="relative min-h-0 flex-1"
        onDragEnter={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={onDrop}
      >
       <div className="h-full overflow-y-auto pb-24 md:pb-6" onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}>
        {error ? (
          <div className="px-4 pt-2 md:px-6">
            <Banner
              tone="error"
              action={
                <Button variant="text" onClick={() => load()} className="-my-2 !text-current">
                  {t("common.retry")}
                </Button>
              }
            >
              {error}
            </Banner>
          </div>
        ) : loading && !rows.length ? (
          <Skeleton grid={view === "grid"} />
        ) : !rows.length ? (
          activeSearch ? (
            <EmptyState icon="search_off" title={t("files.noMatches", { query: activeSearch })} text={t("files.noMatchesHint")} />
          ) : (
            <EmptyState icon="folder_open" title={t("files.emptyTitle")} text={t("files.emptyText")}>
              <Button variant="filled" icon="upload" onClick={() => pickFiles(false)}>
                {t("files.upload")}
              </Button>
              <Button variant="outlined" icon="create_new_folder" onClick={() => setNewFolder(true)}>
                {t("files.newFolder")}
              </Button>
            </EmptyState>
          )
        ) : view === "list" ? (
          <div role="grid" aria-label={t("files.title")} aria-multiselectable="true" className="px-1 sm:px-2 md:px-4">
            <div role="row" className="sticky top-0 z-10 mb-1 hidden h-12 items-center border-b border-line bg-panel px-2 type-title-small text-muted sm:grid [grid-template-columns:48px_minmax(0,1fr)_96px_120px] md:[grid-template-columns:48px_minmax(0,1fr)_110px_170px_120px]">
              <span role="columnheader" className="grid place-items-center">
                <Checkbox
                  label={t("files.selectAll")}
                  checked={allSelected}
                  indeterminate={selecting && !allSelected}
                  onChange={selectAll}
                />
              </span>
              <SortHeader label={t("files.name")} by="name" sort={sort} onSort={setSortBy} />
              <SortHeader label={t("files.size")} by="size" sort={sort} onSort={setSortBy} end />
              <SortHeader label={t("files.modified")} by="date" sort={sort} onSort={setSortBy} className="hidden md:flex" />
              <span />
            </div>
            {sorted.map((row) => (
              <ListRow
                key={row.key}
                row={row}
                selected={selected.has(row.key)}
                selecting={selecting}
                menuOpen={menuOpenKey === row.key}
                onClick={(e) => onRowClick(e, row)}
                onOpen={() => open(row)}
                onToggle={(e) => toggle(row.key, e)}
                onContext={(e) => onContext(e, row)}
                menu={menuFor(row)}
                onMenuOpen={(o) => setMenuOpenKey(o ? row.key : null)}
                onCopyUrl={row.kind === "file" && row.url ? () => copyUrl(row.url!) : undefined}
                onDownload={row.kind === "file" ? () => downloadFile(bucket, row.key).catch((e) => toast.error(e)) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-6 px-3 pt-1 sm:px-4 md:px-6">
            {folders.length > 0 && (
              <section>
                <h2 className="mb-3 px-1 type-title-small text-muted">{t("files.folders")}</h2>
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
                  {folders.map((row) => (
                    <FolderTile
                      key={row.key}
                      row={row}
                      selected={selected.has(row.key)}
                      selecting={selecting}
                      menuOpen={menuOpenKey === row.key}
                      onClick={(e) => onRowClick(e, row)}
                      onOpen={() => open(row)}
                      onToggle={(e) => toggle(row.key, e)}
                      onContext={(e) => onContext(e, row)}
                      menu={menuFor(row)}
                      onMenuOpen={(o) => setMenuOpenKey(o ? row.key : null)}
                    />
                  ))}
                </div>
              </section>
            )}
            {files.length > 0 && (
              <section>
                <h2 className="mb-3 px-1 type-title-small text-muted">{t("files.files")}</h2>
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
                  {files.map((row) => (
                    <FileTile
                      key={row.key}
                      row={row}
                      selected={selected.has(row.key)}
                      selecting={selecting}
                      menuOpen={menuOpenKey === row.key}
                      onClick={(e) => onRowClick(e, row)}
                      onOpen={() => open(row)}
                      onToggle={(e) => toggle(row.key, e)}
                      onContext={(e) => onContext(e, row)}
                      menu={menuFor(row)}
                      onMenuOpen={(o) => setMenuOpenKey(o ? row.key : null)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {nextToken && !activeSearch && !error && (
          <div className="flex justify-center pt-4">
            <Button variant="tonal" icon="expand_more" loading={loadingMore} onClick={loadMore}>
              {t("files.loadMore")}
            </Button>
          </div>
        )}
        {truncated && activeSearch && (
          <p className="px-6 pt-4 text-center type-body-small text-muted">{t("files.searchLimited")}</p>
        )}

       </div>
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 p-3">
            <div className="m3-dialog-in flex h-full w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft/85 text-on-accent-soft">
              <Icon name="cloud_upload" size={48} />
              <div className="mt-3 type-title-large">{t("files.dropToUpload")}</div>
              <div className="mt-1 max-w-[80%] truncate font-mono type-body-small opacity-80" dir="ltr">
                {bucket}/{prefix}
              </div>
            </div>
          </div>
        )}
      </div>

      <MobileFab />

      <ContextMenu at={ctx} onClose={() => setCtx(null)} items={ctx ? (selected.size > 1 ? multiMenu : menuFor(ctx.row)) : []} />

      {preview !== null && files[preview] && (
        <PreviewOverlay
          bucket={bucket}
          files={files as PreviewFile[]}
          index={preview}
          onIndex={setPreview}
          onClose={() => setPreview(null)}
          onInfo={(f) => {
            setPreview(null);
            setInfoKey(f.key);
          }}
          onShare={(f) => setShare({ key: f.key, url: f.url })}
        />
      )}
      <InfoSheet bucket={bucket} fileKey={infoKey} onClose={() => setInfoKey(null)} onChanged={() => load({ quiet: true })} />
      <ShareDialog bucket={bucket} file={share} onClose={() => setShare(null)} />
      <RenameDialog
        bucket={bucket}
        itemKey={renameKey}
        onClose={() => setRenameKey(null)}
        onDone={() => {
          setRenameKey(null);
          load({ quiet: true });
        }}
      />
      <MoveDialog
        bucket={bucket}
        keys={moveKeys}
        startPrefix={prefix}
        onClose={() => setMoveKeys(null)}
        onDone={() => {
          setMoveKeys(null);
          setSelected(new Set());
          load({ quiet: true });
        }}
      />
      <NewFolderDialog
        open={newFolder}
        bucket={bucket}
        prefix={prefix}
        onClose={() => setNewFolder(false)}
        onDone={(key) => {
          setNewFolder(false);
          go(key);
        }}
      />
    </div>
  );
}

// ---------- header pieces ----------

function SearchBar({
  value,
  onChange,
  placeholder,
  inputRef,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  busy?: boolean;
}) {
  const t = useT();
  return (
    <div className="group relative flex h-12 min-w-0 max-w-[720px] flex-1 items-center rounded-full bg-panel-2 transition-[background-color,box-shadow] duration-200 focus-within:bg-panel focus-within:shadow-e2 hover:bg-surface-high dark:bg-surface-high dark:focus-within:bg-surface-highest">
      {busy ? <Spinner className="ms-3.5 h-5 w-5 text-accent" /> : <Icon name="search" className="ms-3 text-muted" />}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent px-3 type-body-large text-fg outline-none placeholder:text-muted"
      />
      {value ? (
        <IconButton label={t("files.clearSearch")} onClick={() => onChange("")} className="me-1">
          <Icon name="close" />
        </IconButton>
      ) : (
        <span className="me-4 hidden md:inline-flex">
          <Kbd>/</Kbd>
        </span>
      )}
    </div>
  );
}

function Crumb({ children, onClick, current, icon }: { children: React.ReactNode; onClick: () => void; current?: boolean; icon?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "location" : undefined}
      className={cx(
        "sl flex h-10 max-w-[260px] shrink-0 items-center gap-2 rounded-full px-3 type-title-medium md:type-title-large",
        current ? "text-fg" : "text-muted",
      )}
    >
      {icon && <Icon name={icon} size={22} className="text-muted" />}
      <span className="truncate">{children}</span>
    </button>
  );
}

function SortHeader({ label, by, sort, onSort, end, className }: { label: string; by: SortBy; sort: Sort; onSort: (b: SortBy) => void; end?: boolean; className?: string }) {
  const on = sort.by === by;
  return (
    <button
      type="button"
      role="columnheader"
      aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => onSort(by)}
      className={cx("group flex h-full items-center gap-1 px-2 hover:text-fg", end && "justify-end", on && "text-fg", className)}
    >
      <span className="truncate">{label}</span>
      <Icon name={sort.dir === 1 || !on ? "arrow_upward" : "arrow_downward"} size={18} className={cx("transition-opacity", on ? "opacity-100" : "opacity-0 group-hover:opacity-40")} />
    </button>
  );
}

function SortButton({ sort, onSort, className }: { sort: Sort; onSort: (s: Sort) => void; className?: string }) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label: Record<SortBy, string> = { name: t("files.name"), size: t("files.size"), date: t("files.modified") };
  return (
    <span className={className}>
      <Button ref={anchor} variant="text" icon={sort.dir === 1 ? "arrow_upward" : "arrow_downward"} onClick={() => setOpen((v) => !v)}>
        {label[sort.by]}
      </Button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} align="end" className="w-[220px]">
        {(Object.keys(label) as SortBy[]).map((by) => (
          <MenuItem
            key={by}
            icon={sort.by === by ? <Icon name="check" /> : <span className="w-6" />}
            onClick={() => {
              setOpen(false);
              onSort({ by, dir: sort.dir });
            }}
          >
            {label[by]}
          </MenuItem>
        ))}
        <MenuDivider />
        {([1, -1] as const).map((dir) => (
          <MenuItem
            key={dir}
            icon={sort.dir === dir ? <Icon name="check" /> : <span className="w-6" />}
            onClick={() => {
              setOpen(false);
              onSort({ by: sort.by, dir });
            }}
          >
            {dir === 1 ? t("files.ascending") : t("files.descending")}
          </MenuItem>
        ))}
      </Popover>
    </span>
  );
}

function MobileFab() {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="sl fixed bottom-[calc(16px+env(safe-area-inset-bottom))] end-4 z-30 inline-flex h-14 items-center gap-3 rounded-2xl bg-accent-soft ps-4 pe-5 type-label-large text-on-accent-soft shadow-e3 md:hidden"
      >
        <Icon name="add" />
        {t("nav.new")}
      </button>
      <NewMenu anchor={anchor} open={open} onClose={() => setOpen(false)} align="end" />
    </>
  );
}

function Skeleton({ grid }: { grid: boolean }) {
  if (grid)
    return (
      <div className="grid gap-3 px-4 pt-10 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))] md:px-6">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton aspect-[5/4] rounded-xl" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    );
  return (
    <div className="space-y-1 px-4 pt-12 md:px-6" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-4 px-3">
          <div className="skeleton h-6 w-6 rounded-md" />
          <div className="skeleton h-3.5 rounded-full" style={{ width: `${30 + ((i * 37) % 40)}%` }} />
        </div>
      ))}
    </div>
  );
}

// ---------- rows and tiles ----------

type ItemProps<R extends Row> = {
  row: R;
  selected: boolean;
  selecting: boolean;
  menuOpen: boolean;
  onClick: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onToggle: (e: React.MouseEvent) => void;
  onContext: (e: React.MouseEvent) => void;
  menu: MenuEntry[];
  onMenuOpen: (o: boolean) => void;
};

function ListRow({
  row,
  selected,
  selecting,
  menuOpen,
  onClick,
  onOpen,
  onToggle,
  onContext,
  menu,
  onMenuOpen,
  onCopyUrl,
  onDownload,
}: ItemProps<Row> & { onCopyUrl?: () => void; onDownload?: () => void }) {
  const t = useT();
  const file = row.kind === "file" ? row : null;
  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={onContext}
      className={cx(
        "group grid h-14 cursor-default select-none items-center rounded-xl px-2 transition-colors duration-150 compact:h-11 sm:h-12 [grid-template-columns:48px_minmax(0,1fr)_auto] sm:[grid-template-columns:48px_minmax(0,1fr)_96px_120px] md:[grid-template-columns:48px_minmax(0,1fr)_110px_170px_120px]",
        selected ? "bg-select text-on-select" : "hover:bg-hover",
      )}
    >
      <span role="gridcell" className="relative grid h-10 w-10 place-items-center justify-self-center" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <span className={cx("pointer-events-none transition-opacity", (selecting || selected) ? "opacity-0" : "group-hover:opacity-0")}>
          <FileIcon name={row.name} folder={row.kind === "folder"} />
        </span>
        <Checkbox
          label={t("files.selectItem", { name: row.name })}
          checked={selected}
          onChange={(_, e) => onToggle(e)}
          className={cx("!absolute inset-0 transition-opacity", selecting || selected ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100")}
        />
      </span>
      <span role="gridcell" className="min-w-0 px-2">
        <button
          type="button"
          onClick={(e) => {
            if (selecting || e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.stopPropagation();
            onOpen();
          }}
          className="block max-w-full truncate text-start type-body-large text-current hover:underline focus-visible:underline sm:type-body-medium"
          title={row.key}
        >
          {row.name}
        </button>
        {file && (
          <span className={cx("block truncate type-body-small sm:hidden", selected ? "opacity-80" : "text-muted")}>
            {formatBytes(file.size)} · {timeAgo(file.lastModified)}
          </span>
        )}
      </span>
      <span role="gridcell" className={cx("hidden px-2 text-end type-body-medium tabular-nums sm:block", !selected && "text-muted")}>
        {file ? formatBytes(file.size) : ""}
      </span>
      <span role="gridcell" className={cx("hidden truncate px-2 type-body-medium md:block", !selected && "text-muted")} title={file ? formatDate(file.lastModified) : undefined}>
        {file ? timeAgo(file.lastModified) : ""}
      </span>
      <span
        role="gridcell"
        className="flex items-center justify-end"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <span className={cx("hidden items-center transition-opacity lg:flex", menuOpen ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100")}>
          {onCopyUrl && (
            <IconButton label={t("files.copyUrl")} onClick={onCopyUrl} className={selected ? "!text-current" : ""}>
              <Icon name="link" size={20} />
            </IconButton>
          )}
          {onDownload && (
            <IconButton label={t("files.download")} onClick={onDownload} className={selected ? "!text-current" : ""}>
              <Icon name="download" size={20} />
            </IconButton>
          )}
        </span>
        <MoreMenu label={t("common.more")} items={menu} onOpenChange={onMenuOpen} className={selected ? "!text-current" : ""} />
      </span>
    </div>
  );
}

function FolderTile({ row, selected, selecting, onClick, onOpen, onToggle, onContext, menu, onMenuOpen }: ItemProps<FolderRow>) {
  const t = useT();
  return (
    <div
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={onContext}
      title={row.key}
      className={cx(
        "group flex h-14 cursor-default select-none items-center gap-1 rounded-xl ps-1 pe-1 transition-colors duration-150",
        selected ? "bg-select text-on-select" : "bg-panel-2 hover:bg-surface-high dark:bg-surface-high dark:hover:bg-surface-highest",
      )}
    >
      <span className="relative grid h-10 w-10 shrink-0 place-items-center" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <span className={cx("pointer-events-none transition-opacity", selecting || selected ? "opacity-0" : "group-hover:opacity-0")}>
          <FileIcon name={row.name} folder />
        </span>
        <Checkbox
          label={t("files.selectItem", { name: row.name })}
          checked={selected}
          onChange={(_, e) => onToggle(e)}
          className={cx("!absolute inset-0", selecting || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
        />
      </span>
      <span className="min-w-0 flex-1 truncate type-title-small">{row.name}</span>
      <MoreMenu label={t("common.more")} items={menu} onOpenChange={onMenuOpen} className={selected ? "!text-current" : ""} />
    </div>
  );
}

function FileTile({ row, selected, selecting, onClick, onOpen, onToggle, onContext, menu, onMenuOpen }: ItemProps<FileRow>) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  return (
    <div
      onClick={onClick}
      onDoubleClick={onOpen}
      onContextMenu={onContext}
      title={row.key}
      className={cx(
        "group flex cursor-default select-none flex-col rounded-xl px-2 pb-2 transition-colors duration-150",
        selected ? "bg-select text-on-select" : "bg-panel-2 hover:bg-surface-high dark:bg-surface-high dark:hover:bg-surface-highest",
      )}
    >
      <div className="flex h-12 items-center gap-1">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <span className={cx("pointer-events-none transition-opacity", selecting || selected ? "opacity-0" : "group-hover:opacity-0")}>
            <FileIcon name={row.name} size={20} />
          </span>
          <Checkbox
            label={t("files.selectItem", { name: row.name })}
            checked={selected}
            onChange={(_, e) => onToggle(e)}
            className={cx("!absolute inset-0", selecting || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          />
        </span>
        <span className="min-w-0 flex-1 truncate type-title-small">{row.name}</span>
        <MoreMenu label={t("common.more")} items={menu} onOpenChange={onMenuOpen} size="sm" className={selected ? "!text-current" : ""} />
      </div>
      <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-panel dark:bg-panel-2">
        {row.thumb && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.thumb} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <FileIcon name={row.name} size={56} />
        )}
      </div>
      <div className={cx("mt-2 flex justify-between gap-2 px-1 type-body-small", selected ? "opacity-80" : "text-muted")}>
        <span className="tabular-nums">{formatBytes(row.size)}</span>
        <span className="truncate">{timeAgo(row.lastModified)}</span>
      </div>
    </div>
  );
}
