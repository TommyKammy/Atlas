"use client";

import { useId, useRef, useState } from "react";
import type { ProposalReviewAction } from "@/lib/planning/approvals";
import { planningErrorMessage } from "./errors";
import { buttonPrimary, buttonSecondary, FieldError } from "./ui";

export type ProposalReviewInput = {
  action: ProposalReviewAction;
  note: string;
  requestId: string;
  expectedStatus: "under_review";
};

export default function ProposalReviewForm({
  reviewerName,
  onReview,
}: {
  reviewerName: string;
  onReview: (input: ProposalReviewInput) => Promise<void>;
}) {
  const noteId = useId();
  const helpId = useId();
  const errorId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef<{ action: ProposalReviewAction; note: string; id: string } | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<ProposalReviewAction | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState("");

  const submit = async (action: ProposalReviewAction) => {
    if (busy !== null) return;
    const trimmed = note.trim();
    if (trimmed === "") {
      setInvalid(true);
      setError("レビューのコメント・差し戻し理由を入力してください");
      noteRef.current?.focus();
      return;
    }
    if (
      !attempt.current ||
      attempt.current.action !== action ||
      attempt.current.note !== trimmed
    ) {
      attempt.current = { action, note: trimmed, id: crypto.randomUUID() };
    }
    const current = attempt.current;
    setBusy(action);
    setInvalid(false);
    setError("");
    try {
      await onReview({
        action,
        note: trimmed,
        requestId: current.id,
        expectedStatus: "under_review",
      });
      attempt.current = null;
      setNote("");
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      noValidate
      aria-label="投資提案のレビュー"
      onSubmit={(event) => {
        event.preventDefault();
        void submit("pass");
      }}
      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3"
    >
      <h3 className="text-[13px] font-semibold text-blue-950">レビュー</h3>
      <p className="mt-1 text-[11px] leading-5 text-blue-800">
        提出時点のA案・B案、予算、職種別・月別の不足を確認してください。コメントは判断の記録として保存され、差し戻しの場合は新しい提案の理由になります。担当: {reviewerName}
      </p>

      <label htmlFor={noteId} className="mt-2 block text-[12px] font-medium text-blue-950">
        レビューのコメント・差し戻し理由
        <span className="ml-1 text-red-700" aria-hidden>
          *
        </span>
        <textarea
          ref={noteRef}
          id={noteId}
          name="reviewNote"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            if (event.target.value.trim() !== "") setInvalid(false);
          }}
          className="mt-1 min-h-24 w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-[13px] text-neutral-900 outline-none focus:border-[#2c60b8]"
          maxLength={2000}
          placeholder="確認した内容、懸念点、差し戻す場合は修正してほしい点"
          aria-describedby={invalid ? `${helpId} ${errorId}` : helpId}
          aria-invalid={invalid}
          required
          disabled={busy !== null}
        />
      </label>
      <p id={helpId} className="mt-1 text-[11px] text-blue-800">
        「確認して決裁へ」でも「差し戻す」でもコメントは必須です。
      </p>

      {error && (
        <div id={errorId} role="alert">
          <FieldError>{error}</FieldError>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={buttonPrimary} disabled={busy !== null}>
          {busy === "pass" ? "確認中…" : "確認して決裁へ"}
        </button>
        <button
          type="button"
          className={buttonSecondary}
          disabled={busy !== null}
          onClick={() => void submit("return")}
        >
          {busy === "return" ? "差し戻し中…" : "差し戻す"}
        </button>
      </div>
    </form>
  );
}
