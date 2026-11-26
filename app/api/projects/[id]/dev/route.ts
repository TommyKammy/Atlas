import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { enableDevProject, getDevProjectSettings, updateDevProject } from "@/lib/services/dev-projects";

/** Development settings of a project (docs/dev-projects-phase0.md §9). */
export const GET = withProject("configure", async (_req, { uid, projectId }) =>
  NextResponse.json(await getDevProjectSettings({ uid, source: "web" }, projectId)));

/** Enable the project as a development project. */
export const POST = withProject("configure", async (req, { uid, projectId }) => {
  const body = await req.json().catch(() => ({}));
  const actor = { uid, source: "web" } as const;
  const enabled = await enableDevProject(actor, projectId, body ?? {});
  return NextResponse.json({ keyed: enabled.keyed, ...(await getDevProjectSettings(actor, projectId)) });
});

/** Change the prefix or the start status. */
export const PATCH = withProject("configure", async (req, { uid, projectId }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await updateDevProject({ uid, source: "web" }, projectId, body ?? {}));
});
