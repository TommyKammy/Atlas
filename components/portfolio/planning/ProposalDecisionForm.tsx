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
  scenarioName,
  onDecide,
}: {
  scenarioName?: string;
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
      className="flex flex-col gap-3"
    >
      <div>
        <h3 className="text-[13px] font-semibold text-text">最終決裁</h3>
        <p className="mt-0.5 text-[12px] text-muted">
          理由は最終決裁の記録として保存されます。
        </p>
      </div>

      <label htmlFor={noteId} className="block text-[12px] font-medium text-text">
        決定理由
        <span className="ml-1 text-danger" aria-hidden>
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
          className="mt-1 min-h-20 w-full rounded-lg border border-line-strong bg-field px-3 py-2.5 text-[13px] leading-6 text-text outline-none focus:border-accent"
          maxLength={1000}
          placeholder="決定の理由を記録します"
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
          {busy === "approve"
            ? "承認中…"
            : scenarioName
              ? `承認して ${scenarioName}を採用`
              : "承認して採用"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`${buttonSecondary} min-h-11 justify-center`}
            disabled={busy !== null}
            onClick={() => void submit("return")}
          >
            {busy === "return" ? "差し戻し中…" : proposalDecisionActionLabel("return")}
          </button>
          <button
            type="button"
            className={`${buttonSecondary} min-h-11 justify-center`}
            disabled={busy !== null}
            onClick={() => void submit("defer")}
          >
            {busy === "defer" ? "記録中…" : proposalDecisionActionLabel("defer")}
          </button>
        </div>
      </div>
    </form>
  );
}
