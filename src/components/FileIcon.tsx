import { categoryOf, extOf, type FileCategory } from "@/lib/filetypes";
import { Icon } from "./ui";

const ICON: Record<FileCategory, string> = {
  image: "image",
  video: "movie",
  audio: "audio_file",
  document: "description",
  archive: "folder_zip",
  code: "code_blocks",
  font: "font_download",
  other: "draft",
};

export function fileIconName(name: string) {
  if (extOf(name) === "pdf") return "picture_as_pdf";
  return ICON[categoryOf(name)];
}

/** Type-tinted file icon (folders use the on-surface-variant color). */
export function FileIcon({ name, folder, size = 24, className }: { name: string; folder?: boolean; size?: number; className?: string }) {
  const cat = folder ? "folder" : categoryOf(name);
  return (
    <span className={className} style={{ color: `var(--ft-${cat})`, lineHeight: 0 }}>
      <Icon name={folder ? "folder" : fileIconName(name)} size={size} fill />
    </span>
  );
}
