"use client";

/** Project email intake settings. */
export default function CustomizeEmailPanel({
  address,
  copied,
  enabled,
  canEdit,
  busy,
  onCopy,
  onToggle,
  onRegenerate,
  secondaryButton,
}: {
  address: string;
  copied: boolean;
  enabled: boolean;
  canEdit: boolean;
  busy: boolean;
  onCopy: () => void;
  onToggle: (enabled: boolean) => void;
  onRegenerate: () => void;
  secondaryButton: string;
}) {
  return (
    <div className="p-5">
      <p className="text-[13px] text-secondary">
        プロジェクト専用のメールアドレスです。受信ゲートウェイに届いたメールは、件名をタスク名、本文を説明として取り込みます。
      </p>
      <div className="mt-4 rounded-lg border border-line bg-surface-subtle p-3">
        <div className="text-[11px] font-medium text-muted">プロジェクトのメールアドレス</div>
        <div className="mt-1 flex items-center gap-2">
          <code data-customize-email-address className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1.5 text-[12px] text-text">
            {address || "生成中…"}
          </code>
          <button
            type="button"
            data-customize-email-copy
            onClick={onCopy}
            disabled={!address}
            className={secondaryButton}
          >
            {copied ? "コピー済み" : "コピー"}
          </button>
        </div>
      </div>
      <label className="mt-4 flex items-center gap-2 text-[13px] text-secondary">
        <input
          type="checkbox"
          data-customize-email-enabled
          checked={enabled}
          disabled={!canEdit || busy}
          onChange={(event) => onToggle(event.target.checked)}
          className="h-4 w-4 accent-[#2c60b8]"
        />
        メールからのタスク作成を有効にする
      </label>
      {canEdit && (
        <button
          type="button"
          data-customize-email-regenerate
          disabled={busy}
          onClick={onRegenerate}
          className="mt-4 text-[12px] text-accent-text hover:underline"
        >
          アドレスを再生成
        </button>
      )}
      <p className="mt-5 rounded-md bg-surface-subtle px-3 py-2 text-[11px] leading-4 text-muted">
        実際のSMTP受信には外部ゲートウェイが必要です。Atlasでは認証済みの取り込みAPIで同じ処理を検証できます。
      </p>
    </div>
  );
}
