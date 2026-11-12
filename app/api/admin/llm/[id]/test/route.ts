import { withAdminPermission } from "@/lib/api/route";
import { testLlmConfig } from "@/lib/services/knowledge-ai";
export const POST = withAdminPermission("workspace.manage", async (req, { params }) => Response.json(await testLlmConfig(params.id, req.signal), { headers: { "Cache-Control": "no-store" } }));
