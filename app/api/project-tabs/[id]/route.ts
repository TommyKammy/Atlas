import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withResourceProject } from "@/lib/api/route";
import { notifyProject } from "@/lib/notify";
import { audit } from "@/lib/audit";

export const PATCH = withResourceProject("edit", "project_tabs", async (_req, { uid, projectId, params, body }) => {
  const id = params.id;
  const owner = await db.query("SELECT id FROM project_tabs WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const payload = (body ?? {}) as { name?: unknown; icon?: unknown };
  const hasName = "name" in payload;
  const hasIcon = "icon" in payload;
  if (!hasName && !hasIcon) {
    return NextResponse.json({ error: "name or icon is required" }, { status: 400 });
  }
  let name: string | undefined;
  if (hasName) {
    if (typeof payload.name !== "string" || payload.name.trim() === "") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    name = payload.name.trim().slice(0, 120);
  }
  let icon: string | null | undefined;
  if (hasIcon) {
    if (payload.icon === null || payload.icon === "") {
      icon = null;
    } else if (typeof payload.icon === "string" && payload.icon.length <= 32) {
      icon = payload.icon;
    } else {
      return NextResponse.json({ error: "icon must be a short string or null" }, { status: 400 });
    }
  }
  if (name !== undefined && icon !== undefined) {
    await db.query("UPDATE project_tabs SET name = $1, icon = $2 WHERE id = $3::bigint", [name, icon, id]);
  } else if (name !== undefined) {
    await db.query("UPDATE project_tabs SET name = $1 WHERE id = $2::bigint", [name, id]);
  } else if (icon !== undefined) {
    await db.query("UPDATE project_tabs SET icon = $1 WHERE id = $2::bigint", [icon, id]);
  }
  await notifyProject(projectId);
  await audit(uid, "project_tab.update", {
    entity: "project_tab",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ id: Number(id), name: name ?? null, icon: icon ?? null });
}, { body: true });

export const DELETE = withResourceProject("edit", "project_tabs", async (_req, { uid, projectId, params }) => {
  const id = params.id;
  const owner = await db.query("SELECT id FROM project_tabs WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const count = await db.query(
    "SELECT COUNT(*)::int AS n FROM project_tabs WHERE project_id = $1::bigint",
    [projectId],
  );
  if (Number(count.rows[0].n) <= 1) {
    return NextResponse.json({ error: "cannot delete the last tab" }, { status: 400 });
  }
  await db.query("DELETE FROM project_tabs WHERE id = $1::bigint", [id]);
  await notifyProject(projectId);
  await audit(uid, "project_tab.delete", {
    entity: "project_tab",
    entityId: Number(id),
    projectId,
  });
  return NextResponse.json({ deleted: Number(id) });
});
