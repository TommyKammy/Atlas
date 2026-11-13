import { withUser } from "@/lib/api/route";
import { readLlmBody } from "@/lib/llm-request";
import { partnerId, readPartnerReport, reviewPartnerReport } from "@/lib/services/partner-reports";

const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
export const GET = withUser(async (_req, { params, uid }) => json(await readPartnerReport(partnerId(params.id), uid, partnerId(params.reportId))));
export const PATCH = withUser(async (req, { params, uid }) => json(await reviewPartnerReport(partnerId(params.id), uid, partnerId(params.reportId), await readLlmBody(req))));
