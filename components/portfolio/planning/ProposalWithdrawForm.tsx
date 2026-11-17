"use client";

import { useId, useRef, useState } from "react";
import type { PlanningProposalStatus } from "@/lib/planning/types";
import { planningErrorMessage } from "./errors";
import { buttonSecondary, FieldError } from "./ui";

export type ProposalWithdrawInput = {
  reason: string;
  requestId: string;
  expectedStatus: PlanningProposalStatus;
};

export default function ProposalWithdrawForm({
  currentStatus,
  onWithdraw,
}: {
  currentStatus: PlanningProposalStatus;
  onWithdraw: (input: ProposalWithdrawInput) => Promise<void>;
}) {
  const reasonId = useId();
  const errorId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef<{ reason: string; id: string } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = reason.trim();
    if (trimmed === "") {
      setInvalid(true);
      setError("取り下げ理由を入力してください");
      reasonRef.current?.focus();
      return;
    }
    if (!attempt.current || attempt.current.reason !== trimmed) {
      attempt.current = { reason: trimmed, id: crypto.randomUUID() };
    }
    setBusy(true);
    setInvalid(false);
    setError("");
    try {
      await onWithdraw({
        reason: trimmed,
        requestId: attempt.current.id,
        expectedStatus: currentStatus,
      });
      attempt.current = null;
      setReason("");
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      aria-label="投資提案の取り下げ"
      onSubmit={(event) => void submit(event)}
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3"
    >
      <h3 className="text-[13px] font-semibold text-amber-950">提案を取り下げる</h3>
      <p className="mt-1 text-[11px] text-amber-900">
        取り下げた版は履歴に残ります。現在の計画で新しい版を提出できます。
      </p>

      <label htmlFor={reasonId} className="mt-2 block text-[12px] font-medium text-amber-950">
        取り下げ理由
        <span className="ml-1 text-red-700" aria-hidden>
          *
        </span>
        <textarea
          ref={reasonRef}
          id={reasonId}
          name="withdrawReason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (event.target.value.trim() !== "") setInvalid(false);
          }}
          className="mt-1 min-h-16 w-full rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-[13px] text-neutral-900 outline-none focus:border-[#2c60b8]"
          maxLength={1000}
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid}
          required
          disabled={busy}
        />
      </label>

      {error && (
        <div id={errorId}>
          <FieldError>{error}</FieldError>
        </div>
      )}

      <div className="mt-2">
        <button type="submit" className={buttonSecondary} disabled={busy}>
          {busy ? "取り下げ中…" : "理由を記録して取り下げる"}
        </button>
      </div>
    </form>
  );
}
