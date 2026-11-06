import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectPermission } from "@/lib/api-project-auth";
import { notifyProject } from "@/lib/notify";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { project_id, ids } = body ?? {};
  if (!project_id || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "project_id and ids are required" }, { status: 400 });
  }
  const auth = await requireProjectPermission(req, Number(project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const numeric = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  const owned = await db.query(
    "SELECT id FROM project_tabs WHERE project_id = $1::bigint",
    [project_id],
  );
  const ownedIds = new Set<number>(owned.rows.map((row) => Number(row.id)));
  if (numeric.length !== ids.length || numeric.some((id) => !ownedIds.has(id))) {
    return NextResponse.json({ error: "ids must belong to the project" }, { status: 400 });
  }
  for (const [index, id] of numeric.entries()) {
    await db.query("UPDATE project_tabs SET position = $1 WHERE id = $2::bigint", [index * 1000, id]);
  }
  await notifyProject(Number(project_id));
  return NextResponse.json({ ok: true });
}
