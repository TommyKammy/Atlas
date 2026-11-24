import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";
import { sendInvitationEmail } from "@/lib/mailer";
import { canGrantRole, getEffectiveRole, getRoleByKey } from "@/lib/permissions";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理者",
  member: "メンバー",
  guest: "ゲスト",
};

export const GET = withAdminPermission("members.manage", async (req) => {
  const r = await db.query(
    `SELECT i.id, i.email, i.role, i.token, i.created_at::text AS created_at,
       i.expires_at::text AS expires_at, i.accepted_at::text AS accepted_at,
       u.name AS invited_by_name
     FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.accepted_at IS NULL AND i.expires_at > now()
     ORDER BY i.id DESC`,
  );
  const origin = process.env.APP_ORIGIN ?? new URL(req.url).origin;
  return NextResponse.json({
    invitations: r.rows.map((row) => ({
      ...row,
      url: `${origin}/invite/${row.token ?? ""}`,
    })),
  });
});

export const POST = withAdminPermission("members.manage", async (req, { uid: admin }) => {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 255) : "";
  const role = typeof body?.role === "string" ? body.role : "member";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  const roleRecord = ROLE_LABEL[role] ? await getRoleByKey(role) : null;
  if (!roleRecord) return NextResponse.json({ error: "invalid role" }, { status: 400 });
  const actor = await getEffectiveRole(admin);
  if (!canGrantRole(actor, roleRecord)) {
    return NextResponse.json(
      { error: "cannot grant a role with more permissions than your own" },
      { status: 403 },
    );
  }
  const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  if ((existing.rowCount ?? 0) > 0) {
    return NextResponse.json({ error: "user already exists" }, { status: 409 });
  }
  await db.query(
    "UPDATE invitations SET accepted_at = now() WHERE email = $1 AND accepted_at IS NULL",
    [email],
  );
  const token = randomBytes(24).toString("base64url");
  const r = await db.query(
    `INSERT INTO invitations (email, role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '7 days')
     RETURNING id, email, role, token, expires_at::text AS expires_at`,
    [email, role, token, admin],
  );
  const origin = process.env.APP_ORIGIN ?? new URL(req.url).origin;
  const url = `${origin}/invite/${token}`;
  const ws = await db.query("SELECT id, name FROM workspaces ORDER BY id LIMIT 1");
  const mail = await sendInvitationEmail({
    to: email,
    url,
    workspaceName: ws.rows[0]?.name ?? "Atlas",
    roleLabel: ROLE_LABEL[role],
  });
  await audit(admin, "invitation.create", {
    entity: "invitation",
    entityId: r.rows[0].id,
    workspaceId: ws.rows[0] ? Number(ws.rows[0].id) : undefined,
    summary: `${email} (${role})`,
  });
  return NextResponse.json(
    {
      invitation: { ...r.rows[0], url },
      emailed: mail.sent,
      mail_reason: mail.reason ?? null,
    },
    { status: 201 },
  );
});
