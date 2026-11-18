import type { ReactNode } from "react";
import type { PlanningScenarioResult } from "@/lib/planning/calculations";

export const buttonPrimary =
  "inline-flex min-h-9 items-center justify-center rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50";
export const buttonSecondary =
  "inline-flex min-h-9 items-center justify-center rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-secondary hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
export const buttonQuiet =
  "inline-flex items-center rounded px-1 py-0.5 text-[13px] font-medium text-accent-text hover:underline disabled:cursor-not-allowed disabled:opacity-50";
export const inputClass =
  "h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-text outline-none focus:border-accent";
export const labelClass = "block text-[12px] font-medium text-secondary";
export const sectionTitle = "text-[15px] font-semibold text-text";

export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "good" | "warn" | "bad";
}) {
  const tones = {
    neutral: "border-line-strong bg-surface-subtle text-secondary",
    blue: "border-accent-line bg-accent-soft text-accent-text",
    good: "border-success-line bg-success-soft text-success",
    warn: "border-warning-line bg-warning-soft text-warning",
    bad: "border-warning-line bg-warning-soft text-warning",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusTag({ result }: { result: PlanningScenarioResult }) {
  if (result.status === "needs_attention") return <Tag tone="bad">要調整</Tag>;
  if (result.status === "unknown") return <Tag tone="warn">未判定</Tag>;
  return <Tag tone="good">制約内</Tag>;
}

export function Stat({
  label,
  value,
  unit,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  unit?: string;
  detail?: ReactNode;
  tone?: "neutral" | "warn" | "bad";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-3">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={`mt-0.5 text-[22px] leading-tight font-semibold tabular-nums ${
          tone === "bad" ? "text-warning" : tone === "warn" ? "text-warning" : "text-text"
        }`}
      >
        {value}
        {unit && <> <span className="text-[12px] font-normal text-muted">{unit}</span></>}
      </div>
      {detail && <div className="mt-1 text-[11px] text-muted">{detail}</div>}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error" | "success";
  children: ReactNode;
}) {
  const tones = {
    info: "border-accent-line bg-accent-soft text-accent-text",
    warn: "border-warning-line bg-warning-soft text-warning",
    error: "border-danger-line bg-danger-soft text-red-900",
    success: "border-success-line bg-success-soft text-success",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-[12px] ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function EmptyPanel({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-5 py-10 text-center">
      <h2 className="text-[15px] font-semibold text-text">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-xl text-[12px] text-muted">{children}</div>}
      {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-1 text-[11px] text-danger">
      {children}
    </p>
  );
}
