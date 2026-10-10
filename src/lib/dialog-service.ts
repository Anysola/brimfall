"use client";

// M3 dialogs in place of the browser's confirm()/prompt() windows.
// M3Host listens and shows them; the caller awaits the answer via a Promise.

import type { ReactNode } from "react";

export type ConfirmOpts = {
  title: string;
  text?: ReactNode;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
  icon?: string;
  /** the confirm button stays disabled until this exact text is typed */
  typeToConfirm?: string;
  /** an extra checkbox; its state comes back in the result */
  checkbox?: { label: string; defaultChecked?: boolean };
};
export type ConfirmResult = { checked: boolean };
export type PromptOpts = { title: string; label: string; initial?: string; confirm?: string; validate?: (v: string) => string | null };

export type DialogRequest =
  | ({ kind: "confirm"; resolve: (r: ConfirmResult | null) => void } & ConfirmOpts)
  | ({ kind: "prompt"; resolve: (v: string | null) => void } & PromptOpts);

type Listener = (r: DialogRequest) => void;
let listener: Listener | null = null;

export function onDialogRequest(fn: Listener) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Resolves to { checked } when confirmed, null when canceled. */
export function confirmDialog(o: ConfirmOpts): Promise<ConfirmResult | null> {
  return new Promise((resolve) => {
    if (!listener) return resolve(window.confirm(o.title) ? { checked: !!o.checkbox?.defaultChecked } : null);
    listener({ kind: "confirm", resolve, ...o });
  });
}

export function promptDialog(o: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) return resolve(window.prompt(o.title, o.initial));
    listener({ kind: "prompt", resolve, ...o });
  });
}
