import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";

export const POST = withProject("configure", async (_req, { projectId, body }) => {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "project_id and ids are required" }, { status: 400 });
  }
  const numeric: number[] = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  const owned = await db.query(
    "SELECT id FROM project_tabs WHERE project_id = $1::bigint",
    [projectId],
  );
  const ownedIds = new Set<number>(owned.rows.map((row) => Number(row.id)));
  if (
    numeric.length !== ids.length ||
    new Set(numeric).size !== numeric.length ||
    numeric.some((id) => !ownedIds.has(id))
  ) {
    return NextResponse.json({ error: "ids must belong to the project" }, { status: 400 });
  }
  await db.query(
    `UPDATE project_tabs AS pt
     SET position = ordered.position
     FROM (
       SELECT id, (ordinality - 1) * 1000 AS position
       FROM unnest($2::bigint[]) WITH ORDINALITY AS t(id, ordinality)
     ) AS ordered
     WHERE pt.id = ordered.id AND pt.project_id = $1::bigint`,
    [projectId, numeric],
  );
  await notifyProject(projectId);
  return NextResponse.json({ ok: true });
}, { body: true });
