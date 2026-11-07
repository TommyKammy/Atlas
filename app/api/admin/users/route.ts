import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { withAdmin } from "@/lib/api/route";

const ROLE_FLAGS: Record<string, { is_admin: boolean; is_guest: boolean }> = {
  admin: { is_admin: true, is_guest: false },
  member: { is_admin: false, is_guest: false },
  guest: { is_admin: false, is_guest: true },
};

export const GET = withAdmin(async () => {
  const r = await db.query(
    `SELECT u.id, u.name, u.email, u.title, u.avatar_url, u.is_guest, u.is_admin,
       u.deactivated_at::text AS deactivated_at,
       (SELECT COUNT(*)::int FROM tasks t WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND NOT t.completed) AS open_tasks
     FROM users u ORDER BY u.id`,
  );
  const ws = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM projects) AS projects,
       (SELECT COUNT(*)::int FROM tasks WHERE deleted_at IS NULL) AS tasks,
       (SELECT COUNT(*)::int FROM comments) AS comments,
       (SELECT COUNT(*)::int FROM task_attachments) AS attachments,
       (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM task_attachments) AS bytes`,
  );
  return NextResponse.json({ users: r.rows, stats: ws.rows[0] });
});

export const POST = withAdmin(async (req) => {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 255) : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (typeof body?.role === "string" && !ROLE_FLAGS[body.role]) {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }
  const selectedRole = typeof body?.role === "string" ? body.role : body?.is_guest === true ? "guest" : "member";
  const flags = ROLE_FLAGS[selectedRole];
  if (!name || !email || password.length < 8 || !flags) {
    return NextResponse.json(
      { error: "name, email, 8+ char password and valid role required" },
      { status: 400 },
    );
  }
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
  const avatarUrl = typeof body?.avatar_url === "string" ? body.avatar_url.trim().slice(0, 500) || null : null;
  try {
    const r = await db.query(
      `INSERT INTO users (name, email, title, avatar_url, is_guest, is_admin, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, title, avatar_url, is_guest, is_admin`,
      [name, email, title, avatarUrl, flags.is_guest, flags.is_admin, hashPassword(password)],
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "email already used" }, { status: 409 });
    }
    throw e;
  }
});
