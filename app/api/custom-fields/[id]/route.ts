import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyField } from "@/lib/notify";
import { requireProjectPermission } from "@/lib/api-project-auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await db.query("SELECT project_id FROM custom_fields WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const auth = await requireProjectPermission(req, Number(owner.rows[0].project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await req.json();
  const { name, options } = body;
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
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owner = await db.query("SELECT project_id FROM custom_fields WHERE id = $1::bigint", [id]);
  if (owner.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const auth = await requireProjectPermission(req, Number(owner.rows[0].project_id), "edit");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const r = await db.query("DELETE FROM custom_fields WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifyField(id);
  return NextResponse.json({ deleted: Number(id) });
}
