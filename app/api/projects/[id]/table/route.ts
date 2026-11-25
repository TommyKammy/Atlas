import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { badRequest } from "@/lib/api/errors";
import { createProjectTable } from "@/lib/services/project-table";

export const POST = withProject("edit", async (_req, { uid, projectId, role, body }) => {
  const table = await createProjectTable({ uid, projectId, body, canArchiveSource: role === "admin" });
  if (!table) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(table, { status: 201 });
}, { body: true });

export const GET = withProject("view", async (_req, { projectId }) => {
  const result = await db.query(
    "SELECT id, name, created_at::text AS created_at FROM project_tables WHERE project_id = $1::bigint ORDER BY id DESC",
    [projectId],
  );
  return NextResponse.json(result.rows);
});

export const DELETE = withProject("admin", async (req, { projectId }) => {
  const tableId = Number(new URL(req.url).searchParams.get("table_id"));
  if (!Number.isInteger(tableId) || tableId <= 0) throw badRequest("table_id is required");
  const result = await db.query(
    "DELETE FROM project_tables WHERE id = $1::bigint AND project_id = $2::bigint RETURNING id",
    [tableId, projectId],
  );
  if (result.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deleted: tableId });
});
