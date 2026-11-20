import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";

/** Persist the complete section order for one project. */
export const POST = withProject("configure", async (_req, { uid, projectId, body }) => {
  const rawIds = (body ?? {}) as { ids?: unknown };
  const ids = Array.isArray(rawIds.ids)
    ? rawIds.ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
    : [];
  const valid = await withTransaction(async (q) => {
    await q.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('atlas:section-order:' || $1::text, 0))",
      [projectId],
    );
    const existing = await q.query(
      "SELECT id FROM sections WHERE project_id = $1::bigint ORDER BY position, id FOR UPDATE",
      [projectId],
    );
    const existingIds = new Set(existing.rows.map((row) => Number(row.id)));
    if (
      ids.length !== existingIds.size ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !existingIds.has(id))
    ) {
      return false;
    }
    await q.query(
      `UPDATE sections s SET position = v.ord * 1000
       FROM unnest($2::bigint[]) WITH ORDINALITY AS v(id, ord)
       WHERE s.id = v.id AND s.project_id = $1::bigint`,
      [projectId, ids],
    );
    return true;
  });
  if (!valid) {
    return NextResponse.json({ error: "ids must contain every section exactly once" }, { status: 400 });
  }
  await notifyProject(projectId);
  await audit(uid, "section.reorder", {
    entity: "project",
    entityId: projectId,
    projectId,
    summary: ids.join(","),
  });
  return NextResponse.json({ ok: true, ids });
}, { body: true });
