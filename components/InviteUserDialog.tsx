"use client";

import { isImeComposing } from "@/lib/ime-keyboard";

import { useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  dialogCloseClass,
  dialogSubtitleClass,
  dialogTitleClass,
  fieldControlClass,
  fieldLabelClass,
  primaryButtonClass,
  secondaryButtonClass,
  SelectControl,
  smallSecondaryButtonClass,
} from "./ui/form-controls";

export default function InviteUserDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<{ url: string; emailed: boolean; reason: string | null } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open, onClose);

  if (!open) return null;

  const invite = async () => {
    setBusy(true);
    setMsg("");
    setResult(null);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `招待に失敗しました (${res.status})`);
      setResult({
        url: data.invitation.url,
        emailed: data.emailed === true,
        reason: data.mail_reason ?? null,
      });
      setEmail("");
      setMsg(data.emailed ? "招待メールを送信しました" : "招待を作成しました");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-scrim p-4"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-dialog-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl bg-surface text-text shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 id="invite-dialog-title" className={dialogTitleClass}>
              メンバーを招待
            </h2>
            <p className={dialogSubtitleClass}>メールアドレスと権限を指定して招待します。</p>
          </div>
          <button type="button" onClick={onClose} className={dialogCloseClass} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="space-y-3 p-5">
          <label className="block">
            <span className={fieldLabelClass}>メールアドレス</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="メールアドレス"
              type="email"
              autoComplete="off"
              className={`mt-1.5 ${fieldControlClass}`}
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Enter") invite();
              }}
            />
          </label>
          <label className="block">
            <span className={fieldLabelClass}>権限</span>
            <SelectControl
              containerClassName="mt-1.5"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="member">メンバー</option>
              <option value="guest">ゲスト</option>
              <option value="admin">管理者</option>
            </SelectControl>
          </label>
          <button
            type="button"
            onClick={invite}
            disabled={busy || !email.trim()}
            className={`${primaryButtonClass} w-full`}
          >
            {busy ? "送信中…" : "招待を送る"}
          </button>
          {msg && <p className="text-[12px] text-secondary">{msg}</p>}
          {result && (
            <div className="rounded-md bg-surface-subtle p-3 text-[12px]">
              <div className="font-medium text-text">
                {result.emailed ? "招待メールを送信しました" : "SMTP未設定: 下のリンクを共有してください"}
              </div>
              <div className="mt-2">
                <span className={fieldLabelClass}>招待リンク</span>
                <div className="mt-1.5 flex gap-2">
                  <input
                    readOnly
                    value={result.url}
                    aria-label="招待リンク"
                    className={`${fieldControlClass} min-w-0 flex-1 font-mono read-only:bg-surface-subtle`}
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(result.url).catch(() => undefined)}
                    className={smallSecondaryButtonClass}
                  >
                    コピー
                  </button>
                </div>
              </div>
              {result.reason && <div className="mt-1 text-muted">{result.reason}</div>}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-line-subtle px-5 py-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
