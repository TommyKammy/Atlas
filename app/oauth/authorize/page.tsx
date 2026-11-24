import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthorizeConsent } from "@/components/oauth/AuthorizeConsent";
import { AuthorizeError } from "@/components/oauth/AuthorizeError";
import { getMfaServerSession } from "@/lib/api/session";
import {
  authorizeErrorRedirect,
  authorizeParamsFromRecord,
  authorizePathFromParams,
  loadAuthorizeWorkspace,
  validateAuthorizeRequest,
} from "@/lib/oauth/authorize";
import { OAuthError } from "@/lib/oauth/errors";
import { MissingPublicBaseUrlError, requestBaseUrl } from "@/lib/oauth/resources";

export const instant = false;

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The development fallback in requestBaseUrl needs an origin. Production
 * ignores these headers and requires APP_URL / APP_ORIGIN.
 */
async function publicBaseUrl(): Promise<string> {
  const incoming = await headers();
  const host = (incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "")
    .split(",")[0]
    .trim();
  if (host === "") throw new Error("missing request host");
  const protocol = (incoming.get("x-forwarded-proto") ?? "http")
    .split(",")[0]
    .trim();
  return requestBaseUrl(new Request(`${protocol}://${host}/oauth/authorize`));
}

function fatalMessage(error: OAuthError): string {
  if (error.code === "invalid_client") {
    return "このクライアントは登録されていないか、無効になっています。接続元のアプリからやり直してください。";
  }
  return "認可リクエストが正しくありません。クライアントの登録内容と戻り先の URL を確認してください。";
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // resolveClient reads Date.now() for its CIMD cache. Cache Components would
  // otherwise execute it while prerendering this route. Wait for a real
  // request before any authorization work runs.
  await connection();
  const incoming = await searchParams;
  const params = authorizeParamsFromRecord(incoming);

  let baseUrl: string;
  try {
    baseUrl = await publicBaseUrl();
  } catch (error) {
    // A production deployment without APP_URL/APP_ORIGIN has already logged
    // the configuration error; let it become a 500 rather than showing a
    // consent screen for a Host-derived issuer.
    if (error instanceof MissingPublicBaseUrlError) throw error;
    return (
      <AuthorizeError message="サーバーの公開 URL が設定されていません。管理者に連絡してください。" />
    );
  }

  const validation = await validateAuthorizeRequest(params, { baseUrl });
  if (!validation.ok) {
    if (validation.fatal) return <AuthorizeError message={fatalMessage(validation.error)} />;
    redirect(validation.redirectTo);
  }
  const request = validation.request;

  const access = await getMfaServerSession();
  if (!access) {
    const next = encodeURIComponent(authorizePathFromParams(params));
    redirect(`/oauth/authorize/resume?to=login&next=${next}`);
  }
  if (access.mfaPending) {
    const next = encodeURIComponent(authorizePathFromParams(params));
    redirect(`/oauth/authorize/resume?to=mfa&next=${next}`);
  }

  if (access.user.isGuest) {
    redirect(authorizeErrorRedirect(
      request.redirectUri,
      new OAuthError("access_denied", "guest users cannot use MCP"),
      request.state,
      request.issuer,
    ));
  }

  const workspace = await loadAuthorizeWorkspace();
  if (!workspace || !workspace.mcpEnabled) {
    return <AuthorizeError message="管理者が MCP 接続を有効にすると利用できます。" />;
  }

  return <AuthorizeConsent request={request} userName={access.user.name} />;
}
