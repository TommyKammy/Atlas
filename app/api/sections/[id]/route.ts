import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifySection } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withResourceProject } from "@/lib/api/route";

export const PATCH = withResourceProject("configure", "sections", async (_req, { uid, params, body }) => {
  const id = params.id;
  const { name } = (body ?? {}) as { name?: unknown };
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const r = await db.query(
    "UPDATE sections SET name = $2 WHERE id = $1::bigint RETURNING id, name",
    [id, trimmed],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifySection(id);
  await audit(uid, "section.update", { entity: "section", entityId: id, summary: trimmed });
  return NextResponse.json({ id: Number(r.rows[0].id), name: r.rows[0].name });
}, { body: true });

export const DELETE = withResourceProject("configure", "sections", async (_req, { uid, params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM sections WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifySection(id);
  await audit(uid, "section.delete", { entity: "section", entityId: id });
  return NextResponse.json({ deleted: Number(id) });
});
