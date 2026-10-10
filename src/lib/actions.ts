"use client";

// "New" menu actions (upload files/folder, new folder) are triggered from the navigation
// but handled by the file browser. If no browser is mounted yet, the action waits for one.

export type FileAction = "upload" | "uploadFolder" | "newFolder";
type Listener = (a: FileAction) => void;

let listener: Listener | null = null;
let pending: FileAction | null = null;

export function requestAction(a: FileAction) {
  if (listener) listener(a);
  else pending = a;
}

export function onAction(fn: Listener) {
  listener = fn;
  if (pending) {
    const a = pending;
    pending = null;
    // let the browser finish mounting first
    setTimeout(() => fn(a), 0);
  }
  return () => {
    if (listener === fn) listener = null;
  };
}
