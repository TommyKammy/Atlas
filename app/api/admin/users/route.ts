import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { withAdminPermission } from "@/lib/api/route";
import { validatePassword } from "@/lib/password-policy";
import { getAdminRoles, getAdminUsers } from "@/lib/admin-data";
import { canGrantRole, getEffectiveRole, getRoleByKey } from "@/lib/permissions";

export const GET = withAdminPermission("members.manage", async (_req, { uid }) => {
  const users = await getAdminUsers(uid);
  const ws = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM projects) AS projects,
       (SELECT COUNT(*)::int FROM tasks WHERE deleted_at IS NULL) AS tasks,
       (SELECT COUNT(*)::int FROM comments) AS comments,
       (SELECT COUNT(*)::int FROM task_attachments) AS attachments,
       (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM task_attachments) AS bytes,
       (SELECT id FROM workspaces ORDER BY id LIMIT 1) AS workspace_id`,
  );
  const workspaceId = Number(ws.rows[0]?.workspace_id ?? 1);
  return NextResponse.json({
    users,
    stats: ws.rows[0],
    roles: await getAdminRoles(workspaceId, await getEffectiveRole(uid)),
  });
});

export const POST = withAdminPermission("members.manage", async (req, { uid: admin }) => {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 255) : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const roleKey = typeof body?.role === "string" && body.role !== "" ? body.role : "member";
  if (!name || !email || password === "") {
    return NextResponse.json({ error: "name, email and password required" }, { status: 400 });
  }
  const role = await getRoleByKey(roleKey);
  if (!role) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  const actor = await getEffectiveRole(admin);
  if (!canGrantRole(actor, role)) {
    return NextResponse.json({ error: "cannot grant a role with more permissions than your own" }, { status: 403 });
  }
  const passwordError = await validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
  const avatarUrl = typeof body?.avatar_url === "string" ? body.avatar_url.trim().slice(0, 500) || null : null;
  try {
    const r = await db.query(
      `INSERT INTO users (name, email, title, avatar_url, is_guest, is_admin, role_id, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, email, title, avatar_url, is_guest, is_admin, role_id, totp_enabled`,
      [name, email, title, avatarUrl, role.isGuest, role.isAdmin, role.id, hashPassword(password)],
    );
    return NextResponse.json(
      { ...r.rows[0], role_key: role.key, role_name: role.name },
      { status: 201 },
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "email already used" }, { status: 409 });
    }
    throw e;
  }
});
