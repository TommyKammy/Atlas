import { NextResponse } from "next/server";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { getProjectViewStates, saveProjectViewState, type ViewState } from "@/lib/data";

const VIEWS = new Set(["list", "board", "timeline", "calendar"]);

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = Number(searchParams.get("project_id"));
  const view = searchParams.get("view") ?? "";
  if (!Number.isInteger(projectId) || projectId <= 0 || !VIEWS.has(view)) {
    return NextResponse.json({ error: "project_id and a valid view are required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, projectId, "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const uid = getCurrentUserIdFromRequest(req);
  const states = await getProjectViewStates(uid, projectId);
  return NextResponse.json({ view, state: states[view] ?? {} });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const projectId = Number(body?.project_id);
  const view = typeof body?.view === "string" ? body.view : "";
  if (!Number.isInteger(projectId) || projectId <= 0 || !VIEWS.has(view) || !validState(body?.state)) {
    return NextResponse.json({ error: "project_id, view and state are required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, projectId, "view");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const uid = getCurrentUserIdFromRequest(req);
  await saveProjectViewState(uid, projectId, view, body.state);
  return NextResponse.json({ ok: true, view });
}
