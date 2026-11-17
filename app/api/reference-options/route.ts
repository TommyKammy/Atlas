import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withUser } from "@/lib/api/route";

/** Tasks that can be linked by a reference field, filtered by accessible source projects. */
export const GET = withUser(async (req, { uid }) => {
  const url = new URL(req.url);
  const projectIds = (url.searchParams.get("project_ids") ?? "")
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (projectIds.length === 0) return NextResponse.json([]);

  const access = await db.query(
    `SELECT p.id FROM projects p
     WHERE p.id = ANY($1::bigint[])
       AND (
         EXISTS (SELECT 1 FROM users u WHERE u.id = $2 AND u.is_admin)
         OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = $2)
       )`,
    [projectIds, uid],
  );
  const accessible = access.rows.map((row) => Number(row.id));
  if (accessible.length === 0) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const r = await db.query(
    `SELECT t.id, t.name, p.name AS project_name, t.completed
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN task_project_memberships placement ON cardinality($1::bigint[]) = 1
       AND placement.task_id = t.id AND placement.project_id = ($1::bigint[])[1]
       AND t.project_id IS DISTINCT FROM placement.project_id
     WHERE t.deleted_at IS NULL AND t.parent_task_id IS NULL
       AND (t.project_id = ANY($1::bigint[]) OR EXISTS (
         SELECT 1 FROM task_project_memberships m
         WHERE m.task_id = t.id AND m.project_id = ANY($1::bigint[])
       ))
       AND ($2 = '' OR t.name ILIKE '%' || $2 || '%')
     ORDER BY CASE WHEN cardinality($1::bigint[]) > 1 THEN p.name END, COALESCE(placement.position, t.position), t.id
     LIMIT 300`,
    [accessible, query],
  );
  return NextResponse.json(
    r.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      project_name: row.project_name,
      completed: row.completed === true,
    })),
  );
});
