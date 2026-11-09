import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { saveProjectTemplate } from "@/lib/services/project-template";

/** Save the current project structure as a reusable template. */
export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, body }) => {
    const saved = await saveProjectTemplate({ uid, projectId, body });
    return NextResponse.json(saved, { status: 201 });
  },
  { body: true },
);
