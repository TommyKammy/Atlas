import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdmin, withUser } from "@/lib/api/route";
import { createProjectFromTemplate } from "@/lib/services/projects";

export const DELETE = withAdmin(async (_req, { params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid template id" }, { status: 400 });
  }
  const existing = await db.query(
    "SELECT is_builtin FROM project_templates WHERE id = $1::bigint",
    [id],
  );
  if (existing.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.rows[0].is_builtin === true) {
    return NextResponse.json(
      { error: "built-in templates cannot be deleted" },
      { status: 403 },
    );
  }
  await db.query("DELETE FROM project_templates WHERE id = $1::bigint", [id]);
  return NextResponse.json({ deleted: id });
});

// Instantiate a template into a new project. Body: { name: string }.
export const POST = withUser(async (req, { uid, params }) => {
  const body = await req.json().catch(() => null);
  const result = await createProjectFromTemplate({ uid, source: "web" }, Number(params.id), body);
  return NextResponse.json(result, { status: 201 });
});
