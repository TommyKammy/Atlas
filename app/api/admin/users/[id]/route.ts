import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { withAdminPermission } from "@/lib/api/route";
import { validatePassword } from "@/lib/password-policy";
import { canGrantRole, getEffectiveRole, getRoleByKey } from "@/lib/permissions";

export const PATCH = withAdminPermission("members.manage", async (req, { uid: admin, params }) => {
  const id = params.id;
  const body = await req.json().catch(() => null);
  const role =
    typeof body?.role === "string" && body.role !== "" ? await getRoleByKey(body.role) : null;
  if (typeof body?.role === "string" && body.role !== "" && !role) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  const actor = await getEffectiveRole(admin);
  if (role) {
    if (!canGrantRole(actor, role)) {
      return NextResponse.json(
        { error: "cannot grant a role with more permissions than your own" },
        { status: 403 },
      );
    }
    if (Number(id) === admin && role.id !== actor?.roleId) {
      return NextResponse.json({ error: "cannot change your own role" }, { status: 400 });
    }
    if (Number(id) === admin && role.isAdmin !== true) {
      return NextResponse.json({ error: "cannot demote self" }, { status: 400 });
    }
  }
  if (
    Number(id) === admin &&
    (typeof body?.is_admin === "boolean" || typeof body?.is_guest === "boolean")
  ) {
    return NextResponse.json({ error: "cannot change your own role" }, { status: 400 });
  }
  if (Number(id) === admin && body?.deactivated === true) {
    return NextResponse.json({ error: "cannot deactivate self" }, { status: 400 });
  }
  if (body?.deactivated === true) {
    const target = await db.query(
      "SELECT is_admin, deactivated_at FROM users WHERE id = $1::bigint",
      [id],
    );
    if (target.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (target.rows[0].is_admin && target.rows[0].deactivated_at === null) {
      const n = await db.query(
        "SELECT COUNT(*)::int AS n FROM users WHERE is_admin AND deactivated_at IS NULL",
      );
      if ((n.rows[0].n as number) <= 1) {
        return NextResponse.json({ error: "cannot deactivate the last admin" }, { status: 400 });
      }
    }
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body?.name === "string" && body.name.trim() !== "") {
    values.push(body.name.trim().slice(0, 120));
    sets.push(`name = $${values.length}`);
  }
  if (typeof body?.email === "string" && body.email.trim() !== "") {
    const email = body.email.trim().toLowerCase().slice(0, 255);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "invalid email" }, { status: 400 });
    }
    values.push(email);
    sets.push(`email = $${values.length}`);
  }
  if (typeof body?.title === "string") {
    values.push(body.title.trim().slice(0, 120));
    sets.push(`title = $${values.length}`);
  }
  if (typeof body?.avatar_url === "string") {
    values.push(body.avatar_url.trim().slice(0, 500) || null);
    sets.push(`avatar_url = $${values.length}`);
  }
  if (typeof body?.deactivated === "boolean") {
    sets.push(body.deactivated ? "deactivated_at = now()" : "deactivated_at = NULL");
  }
  if (role) {
    values.push(role.id);
    sets.push(`role_id = $${values.length}`);
    values.push(role.isGuest);
    sets.push(`is_guest = $${values.length}`);
    values.push(role.isAdmin);
    sets.push(`is_admin = $${values.length}`);
  } else {
    if (typeof body?.is_guest === "boolean") {
      values.push(body.is_guest);
      sets.push(`is_guest = $${values.length}`);
    }
    if (typeof body?.is_admin === "boolean") {
      values.push(body.is_admin);
      sets.push(`is_admin = $${values.length}`);
    }
  }
  if (typeof body?.password === "string" && body.password !== "") {
    const passwordError = await validatePassword(body.password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }
    values.push(hashPassword(body.password));
    sets.push(`password_hash = $${values.length}`);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  values.push(id);
  try {
    const r = await db.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}::bigint
       RETURNING id, name, email, title, avatar_url, is_guest, is_admin, role_id,
         totp_enabled, deactivated_at::text AS deactivated_at`,
      values,
    );
    if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    const updated = r.rows[0];
    const roleRow = await db.query(
      "SELECT key, name FROM workspace_roles WHERE id = $1",
      [updated.role_id],
    );
    return NextResponse.json({
      ...updated,
      role_key: roleRow.rows[0]?.key ?? null,
      role_name: roleRow.rows[0]?.name ?? null,
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "email already used" }, { status: 409 });
    }
    throw e;
  }
});

export const DELETE = withAdminPermission("members.manage", async (_req, { uid: admin, params }) => {
  const id = params.id;
  if (Number(id) === admin) {
    return NextResponse.json({ error: "cannot delete self" }, { status: 400 });
  }
  const r = await db.query("SELECT id FROM users WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  // All user references are ON DELETE CASCADE / SET NULL; one delete suffices.
  await db.query("DELETE FROM users WHERE id = $1::bigint", [id]);
  return NextResponse.json({ deleted: Number(id) });
});
