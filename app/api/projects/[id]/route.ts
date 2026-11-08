import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { PROJECT_ICONS } from "@/lib/project-appearance";
import { withProject } from "@/lib/api/route";
import { mergeProjectSettings } from "@/lib/project-settings";
import { detachMultiHomedTasks } from "@/lib/project-delete";

export const DELETE = withProject("admin", async (_req, { uid, projectId }) => {
  const movedTasks = await withTransaction(async (q) => {
    const moved = await detachMultiHomedTasks(q, projectId);
    await audit(uid, "project.delete", {
      entity: "project",
      entityId: projectId,
      projectId,
      summary: `hard delete; multi-homed tasks moved: ${moved}`,
    });
    await q.query("DELETE FROM projects WHERE id = $1::bigint", [projectId]);
    return moved;
  });
  return NextResponse.json({ deleted: projectId, moved_tasks: movedTasks });
});

export const PATCH = withProject("admin", async (req, { uid, projectId }) => {
  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim() !== "") {
    values.push(body.name.trim().slice(0, 100));
    sets.push(`name = $${values.length}`);
  }
  if (typeof body.description === "string") {
    values.push(body.description.trim().slice(0, 5000));
    sets.push(`description = $${values.length}`);
  }
  if (typeof body.status === "string" && body.status.trim() !== "") {
    values.push(body.status.trim().slice(0, 100));
    sets.push(`status = $${values.length}`);
  }
  if (typeof body.status_color === "string") {
    const allowedColors = new Set(["none", "green", "yellow", "red", "blue", "muted"]);
    if (!allowedColors.has(body.status_color)) {
      return NextResponse.json({ error: "invalid status_color" }, { status: 400 });
    }
    values.push(body.status_color);
    sets.push(`status_color = $${values.length}`);
  }
  if (Array.isArray(body.status_options)) {
    const opts = body.status_options
      .map((o: unknown) => String(o).trim())
      .filter((o: string) => o !== "")
      .slice(0, 20)
      .map((o: string) => o.slice(0, 40));
    if (opts.length === 0) {
      return NextResponse.json({ error: "status_options must be a non-empty array" }, { status: 400 });
    }
    values.push(JSON.stringify(opts));
    sets.push(`status_options = $${values.length}::jsonb`);
  }
  if (typeof body.status_field_name === "string" && body.status_field_name.trim() !== "") {
    values.push(body.status_field_name.trim().slice(0, 40));
    sets.push(`status_field_name = $${values.length}`);
  }
  if (typeof body.status_field_enabled === "boolean") {
    values.push(body.status_field_enabled);
    sets.push(`status_field_enabled = $${values.length}`);
  }
  const statusRenames: { from: string; to: string }[] = Array.isArray(body.status_renames)
    ? body.status_renames
        .filter(
          (entry: unknown): entry is { from: string; to: string } =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { from?: unknown }).from === "string" &&
            typeof (entry as { to?: unknown }).to === "string",
        )
        .map((entry: { from: string; to: string }) => ({
          from: entry.from.trim().slice(0, 40),
          to: entry.to.trim().slice(0, 40),
        }))
        .filter((entry: { from: string; to: string }) => entry.from !== "" && entry.to !== "" && entry.from !== entry.to)
        .slice(0, 20)
    : [];
  if ("color" in body) {
    const color = body.color;
    if (color !== null && (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
      return NextResponse.json({ error: "color must be a hex color or null" }, { status: 400 });
    }
    values.push(color);
    sets.push(`color = $${values.length}`);
  }
  if ("icon" in body) {
    const icon = body.icon;
    const allowed = PROJECT_ICONS.map((i) => i.key).filter(Boolean) as string[];
    if (icon !== null && (typeof icon !== "string" || !allowed.includes(icon))) {
      return NextResponse.json({ error: "invalid icon" }, { status: 400 });
    }
    values.push(icon);
    sets.push(`icon = $${values.length}`);
  }
  if (typeof body.archived === "boolean") {
    values.push(body.archived);
    sets.push(`archived_at = CASE WHEN $${values.length}::boolean THEN NOW() ELSE NULL END`);
  }
  if ("owner_id" in body) {
    const ownerId = body.owner_id === null || body.owner_id === "" ? null : Number(body.owner_id);
    if (ownerId !== null && (!Number.isInteger(ownerId) || ownerId <= 0)) {
      return NextResponse.json({ error: "invalid owner_id" }, { status: 400 });
    }
    if (ownerId !== null) {
      const owner = await db.query("SELECT id FROM users WHERE id = $1::bigint AND deactivated_at IS NULL", [ownerId]);
      if (owner.rowCount === 0) return NextResponse.json({ error: "owner not found" }, { status: 404 });
    }
    values.push(ownerId);
    sets.push(`owner_id = $${values.length}`);
  }
  if ("team_id" in body) {
    const teamId = body.team_id === null || body.team_id === "" ? null : Number(body.team_id);
    if (teamId !== null && (!Number.isInteger(teamId) || teamId <= 0)) {
      return NextResponse.json({ error: "invalid team_id" }, { status: 400 });
    }
    if (teamId !== null) {
      const team = await db.query(
        `SELECT t.id FROM teams t
         WHERE t.id = $1::bigint
           AND t.workspace_id = (SELECT workspace_id FROM projects WHERE id = $2::bigint)`,
        [teamId, projectId],
      );
      if (team.rowCount === 0) return NextResponse.json({ error: "team not found" }, { status: 404 });
    }
    values.push(teamId);
    sets.push(`team_id = $${values.length}`);
  }
  if ("due_on" in body) {
    const due = body.due_on === null || body.due_on === "" ? null : String(body.due_on);
    if (due !== null) {
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(due) ? Date.parse(`${due}T00:00:00Z`) : Number.NaN;
      if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== due) {
        return NextResponse.json({ error: "due_on must be a valid YYYY-MM-DD date or null" }, { status: 400 });
      }
    }
    values.push(due);
    sets.push(`due_on = $${values.length}::date`);
  }
  if ("settings" in body) {
    if (body.settings !== null && (typeof body.settings !== "object" || Array.isArray(body.settings))) {
      return NextResponse.json({ error: "settings must be an object" }, { status: 400 });
    }
    const current = await db.query("SELECT settings FROM projects WHERE id = $1::bigint", [projectId]);
    const merged = mergeProjectSettings(current.rows[0]?.settings, body.settings);
    if (merged.work_hours.start >= merged.work_hours.end) {
      return NextResponse.json({ error: "work_hours.start must be before work_hours.end" }, { status: 400 });
    }
    values.push(JSON.stringify(merged));
    sets.push(`settings = $${values.length}::jsonb`);
  }
  if (sets.length === 0) {
    return NextResponse.json(
      {
        error:
          "name, description, status, status_color, status_options, status_field_name, status_field_enabled, color, icon, archived, owner_id, team_id, due_on or settings required",
      },
      { status: 400 },
    );
  }
  values.push(projectId);
  const r = await db.query(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = $${values.length}::bigint RETURNING id`,
    values,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  for (const rename of statusRenames) {
    await db.query(
      `UPDATE tasks SET status = $1, updated_at = now()
       WHERE project_id = $2::bigint AND status = $3 AND deleted_at IS NULL`,
      [rename.to, projectId, rename.from],
    );
  }
  await audit(uid, "project.update", {
    entity: "project",
    entityId: projectId,
  });
  await import("@/lib/notify").then((m) => m.notifyProject(projectId));
  return NextResponse.json({ id: projectId });
});
