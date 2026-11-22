import { handleMcpPost, methodNotAllowedResponse } from "@/lib/mcp/http";

export async function POST(req: Request): Promise<Response> {
  return handleMcpPost(req, "readonly");
}

export function GET(): Response {
  return methodNotAllowedResponse();
}
