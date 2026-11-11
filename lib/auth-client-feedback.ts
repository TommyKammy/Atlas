/** Preserve credentials on throttling/service errors and explain when to retry. */
export function authenticationFailureMessage(response: Pick<Response, "status" | "headers">): string | null {
  if (response.status === 429) {
    const value = Number(response.headers.get("Retry-After"));
    const seconds = Number.isFinite(value) && value > 0 ? Math.min(86_400, Math.ceil(value)) : 60;
    return `試行回数の上限に達しました。${seconds}秒後に再度お試しください。入力内容は保持しています。`;
  }
  if (response.status === 503) return "認証を一時的に利用できません。入力内容は保持しています。時間をおいて再試行し、解消しない場合は管理者に連絡してください。";
  return null;
}
