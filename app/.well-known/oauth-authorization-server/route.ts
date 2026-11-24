import { authorizationServerMetadataResponse } from "@/lib/oauth/metadata";

export function GET(req: Request): Response {
  return authorizationServerMetadataResponse(req);
}
