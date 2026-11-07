import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { PROJECT_ICONS } from "@/lib/project-appearance";
import { withProject } from "@/lib/api/route";

export const DELETE = withProject("admin", async (_req, { uid, projectId }) => {
  const r = await db.query("DELETE FROM projects WHERE id = $1::bigint", [projectId]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "project.delete", { entity: "project", entityId: projectId });
  return NextResponse.json({ deleted: projectId });
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
  if (sets.length === 0) {
    return NextResponse.json(
      { error: "name, description, status, status_color, status_options, status_field_name, status_field_enabled, color, icon or archived required" },
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
