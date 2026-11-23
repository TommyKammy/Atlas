import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";
import { createProject } from "@/lib/services/projects";

export const GET = withUser(async (_req, { uid }) => {
  const r = await db.query(
    `SELECT p.id, p.name
     FROM projects p
     WHERE p.archived_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM users u WHERE u.id = $1 AND u.is_admin)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $1)
       )
     ORDER BY p.name, p.id`,
    [uid],
  );
  return NextResponse.json(r.rows.map((row) => ({ id: Number(row.id), name: row.name })));
});

export const POST = withUser(async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const result = await createProject({ uid, source: "web" }, body);
  return NextResponse.json(result, { status: 201 });
});
