import { getMfaRequestSession } from "@/lib/api/session";
import { handleAuthorizeDecision } from "@/lib/oauth/authorize";

/** Consent POST. Origin, parameters and the session are revalidated here. */
export async function POST(req: Request): Promise<Response> {
  return handleAuthorizeDecision(req, { loadSession: getMfaRequestSession });
}
