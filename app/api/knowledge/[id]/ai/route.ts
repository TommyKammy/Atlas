import { withUser } from "@/lib/api/route";
import { generateNoteLlm, listNoteLlm, saveNoteLlm } from "@/lib/services/knowledge-ai";
import { badRequest } from "@/lib/api/errors";
import { readLlmBody } from "@/lib/llm-request";
const id = (raw: string) => { const n = Number(raw); if (!Number.isSafeInteger(n) || n <= 0) throw badRequest("ノートIDが無効です"); return n; };
export const GET = withUser(async (_req, { params, uid }) => Response.json(await listNoteLlm(id(params.id), uid), { headers: { "Cache-Control": "no-store" } }));
export const POST = withUser(async (req, { params, uid }) => Response.json(await generateNoteLlm(id(params.id), uid, await readLlmBody(req), req.signal), { headers: { "Cache-Control": "no-store" } }));
export const PUT = withUser(async (req, { params, uid }) => Response.json(await saveNoteLlm(id(params.id), uid, await readLlmBody(req)), { headers: { "Cache-Control": "no-store" } }));
