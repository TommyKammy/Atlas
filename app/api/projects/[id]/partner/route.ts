import { withUser } from "@/lib/api/route";
import { badRequest } from "@/lib/api/errors";
import { readLlmBody } from "@/lib/llm-request";
import { generateProjectPartner } from "@/lib/services/project-partner";

export const POST = withUser(async (req, { params, uid }) => {
  const projectId = Number(params.id);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw badRequest("プロジェクトIDが無効です");
  const result = await generateProjectPartner(projectId, uid, await readLlmBody(req), req.signal);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
});
