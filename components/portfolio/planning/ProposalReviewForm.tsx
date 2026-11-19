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
      className="flex flex-col gap-3"
    >
      <div>
        <h3 className="text-[13px] font-semibold text-text">レビュー</h3>
        <p className="mt-0.5 text-[12px] text-muted">
          コメントは判断の記録として保存されます。担当: {reviewerName}
        </p>
      </div>

      <label htmlFor={noteId} className="block text-[12px] font-medium text-text">
        レビューのコメント・差し戻し理由
        <span className="ml-1 text-danger" aria-hidden>
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
          className="mt-1 min-h-24 w-full rounded-lg border border-line-strong bg-field px-3 py-2.5 text-[13px] leading-6 text-text outline-none focus:border-accent"
          maxLength={2000}
          placeholder="確認した内容、懸念点、差し戻す場合は修正してほしい点"
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid}
          required
          disabled={busy !== null}
        />
      </label>

      {error && (
        <div id={errorId}>
          <FieldError>{error}</FieldError>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          className={`${buttonPrimary} min-h-11 w-full justify-center font-bold`}
          disabled={busy !== null}
        >
          {busy === "pass" ? "確認中…" : "確認して決裁へ"}
        </button>
        <button
          type="button"
          className={`${buttonSecondary} min-h-11 w-full justify-center`}
          disabled={busy !== null}
          onClick={() => void submit("return")}
        >
          {busy === "return" ? "差し戻し中…" : "差し戻す"}
        </button>
      </div>
    </form>
  );
}
