import { withUser } from "@/lib/api/route";
import { readLlmBody } from "@/lib/llm-request";
import { actionOptions, approvePartnerActions } from "@/lib/services/partner-actions";
import { partnerId } from "@/lib/services/partner-reports";

const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
export const GET = withUser(async (req, { params, uid }) => json(await actionOptions(partnerId(params.id), uid, req.nextUrl.searchParams.get("batch_id") ?? "")));
export const POST = withUser(async (req, { params, uid }) => json(await approvePartnerActions(partnerId(params.id), uid, await readLlmBody(req))));
