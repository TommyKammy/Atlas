import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { getRuleDescriptors } from "@/lib/automation/descriptors";

export const GET = withProject("view", async (_req, { uid, projectId }) => {
  return NextResponse.json(await getRuleDescriptors(projectId, uid));
});
