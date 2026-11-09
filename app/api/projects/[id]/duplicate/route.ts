import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { duplicateProject } from "@/lib/services/project-duplicate";

/** Duplicate a project's structure; the copy gets fresh ids. */
export const POST = withProject(
  "edit",
  async (_req, { uid, projectId, body }) => {
    const id = await duplicateProject({ uid, projectId, body });
    return NextResponse.json({ id, source_project_id: projectId }, { status: 201 });
  },
  { body: true },
);
