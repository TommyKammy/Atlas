import { withAdminPermission } from "@/lib/api/route";
import { listLlmAdmin, saveLlmConfig } from "@/lib/services/knowledge-ai";
import { readLlmBody } from "@/lib/llm-request";
export const GET = withAdminPermission("workspace.manage", async () => Response.json(await listLlmAdmin(), { headers: { "Cache-Control": "no-store" } }));
export const POST = withAdminPermission("workspace.manage", async req => Response.json(await saveLlmConfig(await readLlmBody(req)), { headers: { "Cache-Control": "no-store" } }));
