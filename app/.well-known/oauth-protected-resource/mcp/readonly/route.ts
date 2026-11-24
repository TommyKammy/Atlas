import { protectedResourceMetadataResponse } from "@/lib/oauth/metadata";

export function GET(req: Request): Response {
  return protectedResourceMetadataResponse(req, "readonly");
}
