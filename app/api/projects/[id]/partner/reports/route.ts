import { withUser } from "@/lib/api/route";
import { listPartnerReports, partnerId } from "@/lib/services/partner-reports";

export const GET = withUser(async (req, { params, uid }) => {
  const before = req.nextUrl.searchParams.get("before");
  return Response.json(await listPartnerReports(partnerId(params.id), uid, before === null ? undefined : partnerId(before)), { headers: { "Cache-Control": "no-store" } });
});
