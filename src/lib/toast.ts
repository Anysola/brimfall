"use client";

// Snackbar queue. M3Host renders it; anything in the browser can push to it.

import { errorText } from "./client";

export type Snack = { id: number; tone: "info" | "ok" | "error"; text: string; leaving?: boolean };
type Listener = (list: Snack[]) => void;

let list: Snack[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn(list);
}

export function onSnacks(fn: Listener) {
  listeners.add(fn);
  fn(list);
  return () => {
    listeners.delete(fn);
  };
}

export function dismiss(id: number) {
  list = list.map((s) => (s.id === id ? { ...s, leaving: true } : s));
  emit();
  setTimeout(() => {
    list = list.filter((s) => s.id !== id);
    emit();
  }, 160);
}

function push(tone: Snack["tone"], text: string) {
  const id = ++seq;
  list = [...list.filter((s) => !s.leaving).slice(-2), { id, tone, text }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 8000 : 4000);
}

export const toast = {
  ok: (text: string) => push("ok", text),
  info: (text: string) => push("info", text),
  error: (e: unknown) => push("error", errorText(e)),
};
