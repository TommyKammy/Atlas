"use client";

import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";

type ToastItem = { id: number; message: string };
type ConfirmRequest = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
};

/** Single host for global toasts and confirmation dialogs. */
export default function FeedbackHost() {
  const [toastItem, setToastItem] = useState<ToastItem | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      const message = typeof detail?.message === "string" ? detail.message : "";
      if (message === "") return;
      setToastItem({ id: Date.now(), message });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToastItem(null), 2800);
    };
    const onConfirm = (event: Event) => {
      const detail = (event as CustomEvent<ConfirmRequest>).detail;
      if (!detail || typeof detail.message !== "string") return;
      setConfirmRequest((previous) => {
        previous?.resolve(false);
        return detail;
      });
    };
    window.addEventListener("atlas:toast", onToast);
    window.addEventListener("atlas:confirm", onConfirm);
    return () => {
      window.removeEventListener("atlas:toast", onToast);
      window.removeEventListener("atlas:confirm", onConfirm);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const finish = (ok: boolean) => {
    const request = confirmRequest;
    setConfirmRequest(null);
    request?.resolve(ok);
  };

  return (
    <>
      {toastItem && (
        <div
          key={toastItem.id}
          role="status"
          data-toast
          className="fixed bottom-6 left-1/2 z-[140] -translate-x-1/2 rounded-md bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {toastItem.message}
        </div>
      )}
      <Dialog
        open={confirmRequest !== null}
        onClose={() => finish(false)}
        title={confirmRequest?.title ?? "確認"}
        backdropClassName="fixed inset-0 z-[130] flex items-center justify-center bg-black/30 p-4"
        panelClassName="w-[min(440px,94vw)] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl"
      >
        <div className="p-5">
          <div className="text-[14px] font-semibold text-neutral-900">{confirmRequest?.title ?? "確認"}</div>
          <p data-confirm-message className="mt-2 whitespace-pre-wrap text-[13px] text-neutral-700">
            {confirmRequest?.message}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              data-confirm-cancel
              onClick={() => finish(false)}
              className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              {confirmRequest?.cancelLabel ?? "キャンセル"}
            </button>
            <button
              type="button"
              data-confirm-ok
              onClick={() => finish(true)}
              className="rounded-md bg-[#2c60b8] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#24529c]"
            >
              {confirmRequest?.confirmLabel ?? "OK"}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
