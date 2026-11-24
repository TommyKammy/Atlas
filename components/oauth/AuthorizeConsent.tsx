import type { AuthorizeRequest } from "@/lib/oauth/authorize";
import {
  checkboxClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../ui/form-controls";
import { pageFrameClass, pageScrollClass } from "../ui/page-layout";

const definitionRowClass = "grid gap-1 px-4 py-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3";
const definitionTermClass = "text-[12px] font-medium text-muted";
const definitionValueClass = "min-w-0 break-words text-[13px] leading-5 text-text";

export function AuthorizeConsent({
  request,
  userName,
}: {
  request: AuthorizeRequest;
  userName: string;
}) {
  const canChooseReadOnly = request.endpoint === "default" && request.scopes.includes("write");

  return (
    <div className={pageFrameClass}>
      <div data-page-scroll className={pageScrollClass}>
        <div className="flex min-h-full items-center justify-center px-4 py-8">
          <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-6 shadow-card">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-[15px] font-semibold text-on-accent">
                A
              </div>
              <div className="min-w-0">
                <h1 className="text-[18px] font-semibold leading-7 text-text">
                  Atlas への接続を許可
                </h1>
                <p className="mt-1 text-[13px] leading-5 text-muted">
                  <span className="font-medium text-secondary">{request.clientName}</span>
                  {" "}が Atlas のデータへのアクセスを求めています。
                </p>
              </div>
            </div>

            <dl className="mt-5 divide-y divide-line-subtle rounded-md border border-line">
              <div className={definitionRowClass}>
                <dt className={definitionTermClass}>クライアント</dt>
                <dd className={definitionValueClass}>{request.appKindLabel}</dd>
              </div>
              <div className={definitionRowClass}>
                <dt className={definitionTermClass}>戻り先</dt>
                <dd className={definitionValueClass}>{request.redirectLabel}</dd>
              </div>
              <div className={definitionRowClass}>
                <dt className={definitionTermClass}>接続先</dt>
                <dd className={definitionValueClass}>
                  <code className="font-mono">
                    {request.endpoint === "readonly" ? "/mcp/readonly" : "/mcp"}
                  </code>
                  {request.endpoint === "readonly" && (
                    <span className="ml-2 text-[12px] text-muted">（読み取り専用）</span>
                  )}
                </dd>
              </div>
              <div className={definitionRowClass}>
                <dt className={definitionTermClass}>要求された権限</dt>
                <dd className={definitionValueClass}>{request.permissionLabel}</dd>
              </div>
              <div className={definitionRowClass}>
                <dt className={definitionTermClass}>ログイン中のユーザー</dt>
                <dd className={definitionValueClass}>{userName}</dd>
              </div>
            </dl>

            <form method="post" action="/oauth/authorize/decision" className="mt-5">
              <input type="hidden" name="response_type" value="code" />
              <input type="hidden" name="client_id" value={request.clientId} />
              <input type="hidden" name="redirect_uri" value={request.redirectUri} />
              <input type="hidden" name="code_challenge" value={request.codeChallenge} />
              <input type="hidden" name="code_challenge_method" value="S256" />
              {request.state !== null && (
                <input type="hidden" name="state" value={request.state} />
              )}
              <input type="hidden" name="scope" value={request.scopes.join(" ")} />
              <input type="hidden" name="resource" value={request.resource} />

              {canChooseReadOnly && (
                <label className="flex items-start gap-2 rounded-md bg-surface-subtle px-3 py-3">
                  <input
                    type="checkbox"
                    name="read_only"
                    value="1"
                    className={`mt-0.5 ${checkboxClass}`}
                    data-oauth-read-only
                  />
                  <span>
                    <span className="block text-[13px] font-medium text-text">読み取りのみ許可する</span>
                    <span className="mt-0.5 block text-[12px] leading-5 text-muted">
                      書き込みや変更を許可せず、参照だけを許可します。
                    </span>
                  </span>
                </label>
              )}

              <p className="mt-4 text-[12px] leading-5 text-muted">
                許可すると、あなたの現在の権限の範囲内で、このアプリが Atlas
                のデータを読み取り・更新できるようになります。権限はプロフィールの「接続済みアプリ」からいつでも解除できます。
              </p>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button
                  type="submit"
                  name="action"
                  value="deny"
                  data-oauth-deny
                  className={secondaryButtonClass}
                >
                  拒否する
                </button>
                <button
                  type="submit"
                  name="action"
                  value="allow"
                  data-oauth-allow
                  className={primaryButtonClass}
                >
                  許可する
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
