import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyField } from "@/lib/notify";
import { withResourceProject } from "@/lib/api/route";

export const PATCH = withResourceProject("edit", "custom_fields", async (_req, { params, body }) => {
  const id = params.id;
  const { name, options } = (body ?? {}) as { name?: unknown; options?: unknown };
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof name === "string" && name.trim() !== "") {
    values.push(name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (Array.isArray(options)) {
    values.push(JSON.stringify(options.map((o) => String(o).trim()).filter((o) => o !== "")));
    sets.push(`options = $${values.length}::jsonb`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "name or options required" }, { status: 400 });
  }
  values.push(id);
  const r = await db.query(
    `UPDATE custom_fields SET ${sets.join(", ")} WHERE id = $${values.length}::bigint RETURNING id`,
    values,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ id: Number(id) });
}, { body: true });

export const DELETE = withResourceProject("edit", "custom_fields", async (_req, { params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM custom_fields WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyField(id);
  return NextResponse.json({ deleted: Number(id) });
});
