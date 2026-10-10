export type FileCategory = "image" | "video" | "audio" | "document" | "archive" | "code" | "font" | "other";

const MAP: Record<Exclude<FileCategory, "other">, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico", "heic", "tiff", "tif"],
  video: ["mp4", "webm", "mov", "mkv", "avi", "m4v", "m3u8", "ts"],
  audio: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "rtf", "odt"],
  archive: ["zip", "tar", "gz", "tgz", "rar", "7z", "bz2", "xz", "zst", "jar"],
  code: ["js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "html", "css", "xml", "yml", "yaml", "toml", "sh", "py", "go", "rs", "php", "sql", "map"],
  font: ["woff", "woff2", "ttf", "otf", "eot"],
};

const LOOKUP = new Map<string, FileCategory>();
for (const [cat, exts] of Object.entries(MAP)) for (const e of exts) LOOKUP.set(e, cat as FileCategory);

export function extOf(name: string): string {
  const base = name.split("/").pop() ?? name;
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

export function categoryOf(name: string): FileCategory {
  return LOOKUP.get(extOf(name)) ?? "other";
}

export const TEXT_EXT = new Set([
  "txt", "md", "csv", "log", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx", "html", "htm", "css", "xml", "yml", "yaml",
  "toml", "ini", "env", "sh", "py", "go", "rs", "php", "sql", "map", "svg", "conf", "srt", "vtt",
]);

export function previewKind(name: string): "image" | "video" | "audio" | "pdf" | "text" | null {
  const ext = extOf(name);
  if (ext === "pdf") return "pdf";
  if (ext === "svg") return "image";
  if (TEXT_EXT.has(ext)) return "text";
  const cat = categoryOf(name);
  if (cat === "image" && !["heic", "tiff", "tif"].includes(ext)) return "image";
  if (cat === "video" && ["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (cat === "audio") return "audio";
  return null;
}
