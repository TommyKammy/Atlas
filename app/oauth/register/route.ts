import { handleClientRegistration } from "@/lib/oauth/http";

export async function POST(req: Request): Promise<Response> {
  return handleClientRegistration(req);
}
