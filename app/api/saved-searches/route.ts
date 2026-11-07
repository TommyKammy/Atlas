import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { getSavedSearches } from "@/lib/data";

export const GET = withUser(async (req, { uid }) => {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspace_id");
  if (!workspaceId) return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
  return NextResponse.json(await getSavedSearches(Number(workspaceId), uid));
});

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const workspaceId = Number(body?.workspace_id);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  const params = typeof body?.params === "object" && body.params !== null && !Array.isArray(body.params)
    ? body.params
    : null;
  if (!Number.isInteger(workspaceId) || workspaceId <= 0 || name === "" || params === null) {
    return NextResponse.json({ error: "workspace_id, name and params are required" }, { status: 400 });
  }
  const r = await db.query(
    "INSERT INTO saved_searches (workspace_id, user_id, name, params) VALUES ($1::bigint, $2, $3, $4::jsonb) RETURNING id",
    [workspaceId, uid, name, JSON.stringify(params)],
  );
  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
});
