import { badRequest } from "../api/errors";
import { audit } from "../audit";
import { withTransaction } from "../db";
import { notifyProject } from "../notify";
import {
  sectionInsertionIndex,
  sectionPositionBetween,
  sectionRenumber,
  type SectionAnchor,
  type SectionRankRow,
} from "../section-order";
import { requireProjectAccess, type Actor } from "./actor";

/** Optional positive id from a JSON field; null for "not supplied". */
function anchorId(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/**
 * Create a section for an actor that need not come from an HTTP session.
 * Authorization uses the project's configure policy, and anchor validation,
 * locking, ordering and side effects mirror POST /api/sections.
 */
export async function createSection(
  actor: Actor,
  projectId: number,
  input: unknown,
): Promise<{ id: number; name: string; position: number }> {
  await requireProjectAccess(actor, projectId, "configure");
  const { name, before_section_id, after_section_id } = (input ?? {}) as {
    name?: unknown;
    before_section_id?: unknown;
    after_section_id?: unknown;
  };
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    throw badRequest("project_id and name are required");
  }

  const before = anchorId(before_section_id);
  const after = anchorId(after_section_id);
  if (before === undefined || after === undefined) {
    throw badRequest("invalid section anchor");
  }
  if (before !== null && after !== null) {
    throw badRequest("before_section_id and after_section_id are mutually exclusive");
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
    throw badRequest("section does not belong to project");
  }

  await notifyProject(projectId);
  await audit(actor.uid, "section.create", {
    entity: "section",
    entityId: created.id,
    projectId,
    summary: created.name,
  });
  return created;
}
