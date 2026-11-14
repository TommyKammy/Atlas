"use client";

export type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type ToastOptions = {
  actionLabel?: string;
  action?: () => void;
  duration?: number;
};

/** Fire a global toast (rendered by FeedbackHost). */
export function toast(message: string, options: ToastOptions = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("atlas:toast", { detail: { message, ...options } }));
}

/** Show a global confirmation dialog and resolve to the user's choice. */
export function confirmAction(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(
      new CustomEvent("atlas:confirm", { detail: { message, ...options, resolve } }),
    );
  });
}
