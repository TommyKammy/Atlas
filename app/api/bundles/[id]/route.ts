import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";
import { normalizeBundleFields } from "@/lib/bundles";
import { audit } from "@/lib/audit";

async function requireAdmin(req: Request): Promise<number | null> {
  const uid = getCurrentUserIdFromRequest(req);
  const r = await db.query("SELECT is_admin FROM users WHERE id = $1 AND deactivated_at IS NULL", [uid]);
  return (r.rowCount ?? 0) > 0 && r.rows[0].is_admin === true ? uid : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const uid = await requireAdmin(req);
  if (uid === null) return NextResponse.json({ error: "admin only" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim() !== "") {
    values.push(body.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (typeof body.description === "string") {
    values.push(body.description.trim());
    sets.push(`description = $${values.length}`);
  }
  if (body.fields !== undefined) {
    const fields = normalizeBundleFields(body.fields);
    if (!fields) return NextResponse.json({ error: "invalid fields" }, { status: 400 });
    values.push(JSON.stringify(fields));
    sets.push(`fields = $${values.length}::jsonb`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  values.push(id);
  const r = await db.query(
    `UPDATE bundles SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}::bigint`,
    values,
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "bundle.update", { entity: "bundle", entityId: Number(id) });
  return NextResponse.json({ id: Number(id) });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const uid = await requireAdmin(req);
  if (uid === null) return NextResponse.json({ error: "admin only" }, { status: 403 });
  const { id } = await params;
  const r = await db.query("DELETE FROM bundles WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "bundle.delete", { entity: "bundle", entityId: Number(id) });
  return NextResponse.json({ deleted: Number(id) });
}
