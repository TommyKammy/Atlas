"use client";

import { useId, useRef, useState } from "react";
import type { PlanningProposalDecisionAction } from "@/lib/planning/types";
import { proposalDecisionActionLabel } from "@/lib/planning/approvals";
import { planningErrorMessage } from "./errors";
import { buttonPrimary, buttonSecondary, FieldError } from "./ui";

export type ProposalDecisionInput = {
  action: PlanningProposalDecisionAction;
  reason: string;
  requestId: string;
  expectedStatus: "pending_decision";
};

export default function ProposalDecisionForm({
  onDecide,
}: {
  onDecide: (input: ProposalDecisionInput) => Promise<void>;
}) {
  const noteId = useId();
  const errorId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef<{ action: PlanningProposalDecisionAction; reason: string; id: string } | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<PlanningProposalDecisionAction | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState("");

  const submit = async (action: PlanningProposalDecisionAction) => {
    if (busy !== null) return;
    const trimmed = reason.trim();
    if (trimmed === "") {
      setInvalid(true);
      setError("決定理由を入力してください");
      noteRef.current?.focus();
      return;
    }
    if (
      !attempt.current ||
      attempt.current.action !== action ||
      attempt.current.reason !== trimmed
    ) {
      attempt.current = { action, reason: trimmed, id: crypto.randomUUID() };
    }
    const current = attempt.current;
    setBusy(action);
    setInvalid(false);
    setError("");
    try {
      await onDecide({
        action,
        reason: trimmed,
        requestId: current.id,
        expectedStatus: "pending_decision",
      });
      attempt.current = null;
      setReason("");
    } catch (caught) {
      setError(planningErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      noValidate
      aria-label="投資提案の最終決裁"
      onSubmit={(event) => {
        event.preventDefault();
        void submit("approve");
      }}
      className="rounded-md border border-success-line bg-success-soft px-3 py-3"
    >
      <h3 className="text-[13px] font-semibold text-success">最終決裁</h3>
      <p className="mt-1 text-[11px] text-success">
        理由は最終決裁の記録として保存されます。
      </p>

      <label htmlFor={noteId} className="mt-2 block text-[12px] font-medium text-success">
        決定理由
        <span className="ml-1 text-red-700" aria-hidden>
          *
        </span>
        <textarea
          ref={noteRef}
          id={noteId}
          name="decisionReason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (event.target.value.trim() !== "") setInvalid(false);
          }}
          className="mt-1 min-h-20 w-full rounded-md border border-line-strong bg-field px-2.5 py-2 text-[13px] text-text outline-none focus:border-accent"
          maxLength={1000}
          placeholder="採用する理由、差し戻す理由、今期見送る理由"
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={buttonPrimary} disabled={busy !== null}>
          {busy === "approve" ? "承認中…" : proposalDecisionActionLabel("approve")}
        </button>
        <button
          type="button"
          className={buttonSecondary}
          disabled={busy !== null}
          onClick={() => void submit("return")}
        >
          {busy === "return" ? "差し戻し中…" : proposalDecisionActionLabel("return")}
        </button>
        <button
          type="button"
          className={buttonSecondary}
          disabled={busy !== null}
          onClick={() => void submit("defer")}
        >
          {busy === "defer" ? "記録中…" : proposalDecisionActionLabel("defer")}
        </button>
      </div>
    </form>
  );
}
