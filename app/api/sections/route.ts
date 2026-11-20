import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withProject } from "@/lib/api/route";
import {
  sectionInsertionIndex,
  sectionPositionBetween,
  sectionRenumber,
  type SectionAnchor,
  type SectionRankRow,
} from "@/lib/section-order";

/** Optional positive id from a JSON field; null for "not supplied". */
function anchorId(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export const POST = withProject("configure", async (_req, { uid, projectId, body }) => {
  const { name, before_section_id, after_section_id } = (body ?? {}) as {
    name?: unknown;
    before_section_id?: unknown;
    after_section_id?: unknown;
  };
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "project_id and name are required" }, { status: 400 });
  }

  const before = anchorId(before_section_id);
  const after = anchorId(after_section_id);
  if (before === undefined || after === undefined) {
    return NextResponse.json({ error: "invalid section anchor" }, { status: 400 });
  }
  if (before !== null && after !== null) {
    return NextResponse.json(
      { error: "before_section_id and after_section_id are mutually exclusive" },
      { status: 400 },
    );
  }
  const anchor: SectionAnchor | null =
    before !== null ? { before } : after !== null ? { after } : null;

  const created = await withTransaction(async (q) => {
    // Serialize section placement with reorder so ranks cannot be rewritten
    // around a concurrent insert.
    await q.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('atlas:section-order:' || $1::text, 0))",
      [projectId],
    );
    const result = await q.query(
      "SELECT id, position FROM sections WHERE project_id = $1::bigint ORDER BY position, id FOR UPDATE",
      [projectId],
    );
    const rows = result.rows as SectionRankRow[];
    if (anchor && (anchor.before !== undefined || anchor.after !== undefined)) {
      const target = anchor.before ?? anchor.after;
      if (!rows.some((row) => row.id === target)) {
        return null;
      }
    }

    const index = sectionInsertionIndex(rows, anchor);
    const previous = index > 0 ? rows[index - 1].position : null;
    const next = index < rows.length ? rows[index].position : null;
    let position = sectionPositionBetween(previous, next);

    if (position === null) {
      // The integer gap is exhausted. Rewrite the whole project on the normal
      // grid and reserve the freed slot for the new section.
      const ranks = sectionRenumber(rows);
      await q.query(
        `UPDATE sections s SET position = r.position
         FROM unnest($2::bigint[], $3::double precision[]) AS r(id, position)
         WHERE s.id = r.id AND s.project_id = $1::bigint`,
        [projectId, ranks.map((row) => row.id), ranks.map((row) => row.position)],
      );
      position = (index + 1) * 1000;
    }

    const inserted = await q.query(
      "INSERT INTO sections (project_id, name, position) VALUES ($1, $2, $3) RETURNING id, name, position",
      [projectId, trimmed, position],
    );
    return inserted.rows[0] as { id: number; name: string; position: number };
  });

  if (created === null) {
    return NextResponse.json({ error: "section does not belong to project" }, { status: 400 });
  }

  await notifyProject(projectId);
  await audit(uid, "section.create", {
    entity: "section",
    entityId: created.id,
    projectId,
    summary: created.name,
  });
  return NextResponse.json(
    { id: created.id, name: created.name, position: created.position },
    { status: 201 },
  );
}, { body: true });
