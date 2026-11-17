import { ApiError } from "@/lib/api-client";

export function isStaleRevisionError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    typeof error.body === "object" &&
    error.body !== null &&
    (error.body as { code?: unknown }).code === "stale_revision"
  );
}

export function planningErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { code?: unknown } | null;
    if (body?.code === "stale_revision") {
      return "他の担当者が内容を更新しました。最新の内容を表示しました。入力中の内容は保持されています。再比較して保存してください。";
    }
    if (body?.code === "project_link_exists") {
      return "この元プロジェクトは既に別の案件に紐付いています。";
    }
    if (body?.code === "proposal_status_changed") {
      return "提案の状態が変わりました。最新の内容を確認してください。";
    }
    if (body?.code === "proposal_stale") {
      return "提出時点から計画（予算・配賦枠・案件構成など）が変更されています。この提案は承認できません。提案を取り下げ、現在の計画で新しい版を提出してください。";
    }
    if (body?.code === "review_pending") {
      return "レビュー担当の確認が完了していないため、最終決裁はできません。先にレビューを完了してください。";
    }
    if (body?.code === "request_id_reused") {
      return "同じ操作が別の内容で送信されています。最新の内容を確認して、もう一度お試しください。";
    }
    return error.message;
  }
  if (error instanceof TypeError) {
    return "通信に失敗しました。接続を確認して、もう一度お試しください。";
  }
  return error instanceof Error ? error.message : "処理に失敗しました";
}
