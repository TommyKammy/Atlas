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
    return error.message;
  }
  if (error instanceof TypeError) {
    return "通信に失敗しました。接続を確認して、もう一度お試しください。";
  }
  return error instanceof Error ? error.message : "処理に失敗しました";
}
