import { NextResponse } from "next/server";
import { withProject } from "@/lib/api/route";
import { badRequest } from "@/lib/api/errors";
import { getProjectViewStates, saveProjectViewState, type ViewState } from "@/lib/data";

const VIEWS = new Set(["list", "board", "timeline", "calendar", "tabs"]);

function validState(value: unknown): value is ViewState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 30) return false;
  return entries.every(
    ([key, v]) =>
      key.length <= 40 &&
      (v === null ||
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean") &&
      (typeof v !== "string" || v.length <= 200),
  );
}

export const GET = withProject("view", async (req, { uid, projectId }) => {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") ?? "";
  if (!VIEWS.has(view)) throw badRequest("project_id and a valid view are required");
  const states = await getProjectViewStates(uid, projectId);
  return NextResponse.json({ view, state: states[view] ?? {} });
});

export const PUT = withProject("view", async (_req, { uid, projectId, body }) => {
  const { view, state } = (body ?? {}) as { view?: string; state?: unknown };
  if (typeof view !== "string" || !VIEWS.has(view) || !validState(state)) {
    throw badRequest("project_id, view and state are required");
  }
  await saveProjectViewState(uid, projectId, view, state);
  return NextResponse.json({ ok: true, view });
}, { body: true });
