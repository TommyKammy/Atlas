import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { createSection } from "@/lib/services/sections";

export const POST = withProject("configure", async (_req, { uid, projectId, body }) => {
  const result = await createSection({ uid, source: "web" }, projectId, body);
  return NextResponse.json(result, { status: 201 });
}, { body: true });
