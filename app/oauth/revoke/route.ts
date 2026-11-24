import { handleRevocationRequest } from "@/lib/oauth/http";

export async function POST(req: Request): Promise<Response> {
  return handleRevocationRequest(req);
}
