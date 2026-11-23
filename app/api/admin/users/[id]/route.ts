import { NextResponse } from "next/server";
import {
  requireAnotherAdmin,
  revokeSessionsAndMcpTokens,
  setUserDeactivated,
  withManagedUser,
} from "@/lib/services/admin-user-access";
import { revokeAllUserTokens } from "@/lib/services/mcp-tokens";
import { getMfaRequestSession } from "@/lib/api/session";
import { badRequest, forbidden } from "@/lib/api/errors";
import { hashPassword } from "@/lib/auth";
import { withAdminPermission } from "@/lib/api/route";
import { validatePassword } from "@/lib/password-policy";
import { canGrantRole, getRoleByKey } from "@/lib/permissions";
import { scimManagedChangeError } from "@/lib/scim/managed-user";

export const PATCH = withAdminPermission("members.manage", async (req, { uid: admin, params }) => {
  const id = Number(params.id);
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const currentSession = admin === id && password ? await getMfaRequestSession(req) : null;
  return withManagedUser(admin, id, "members.manage", async (q, { actor, target, active, profile }) => {
    const scimError = scimManagedChangeError(
      {
        scimEnabled: profile.scimEnabled,
        scimManaged: profile.scimManaged,
        scimDeleted: profile.scimDeleted,
        deactivated: !active,
        name: profile.name,
        email: profile.email,
        title: profile.title,
      },
      body && typeof body === "object" ? body : {},
    );
    if (scimError) {
      return NextResponse.json({ error: scimError, code: "scim_managed" }, { status: 409 });
    }
    let roleKey = typeof body?.role === "string" && body.role !== "" ? body.role : null;
    const legacyFlags = typeof body?.is_admin === "boolean" || typeof body?.is_guest === "boolean";
    if (roleKey === null && legacyFlags) {
      const adminFlag = body.is_admin ?? (target.baseLevel === "admin");
      const guestFlag = body.is_guest ?? (target.baseLevel === "guest");
      if (adminFlag && guestFlag) throw badRequest("incompatible role flags");
      const level = adminFlag ? "admin" : guestFlag ? "guest" : "member";
      if (level !== target.baseLevel) roleKey = level;
    }
    const role = roleKey === null ? null : await getRoleByKey(roleKey, q);
    if (roleKey !== null && !role) throw badRequest("invalid role");
    if (role && !canGrantRole(actor, role)) throw forbidden("cannot grant a more privileged role");
    if (id === admin && ((role && role.id !== actor.roleId) || legacyFlags || body?.deactivated === true)) {
      throw badRequest("cannot change your own role or deactivate yourself");
    }
    if (active && target.baseLevel === "admin" && role &&
        (!role.isAdmin || (target.isSuper && !role.isSuper))) {
      await requireAnotherAdmin(q, id, target.isSuper);
    }
    const deactivation = typeof body?.deactivated === "boolean" ? body.deactivated : null;
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
    if (role) {
      values.push(role.id);
      sets.push(`role_id = $${values.length}`);
      values.push(role.isGuest);
      sets.push(`is_guest = $${values.length}`);
      values.push(role.isAdmin);
      sets.push(`is_admin = $${values.length}`);
    } else if (legacyFlags) {
      // Keep redundant legacy flags aligned even when the effective role is unchanged.
      values.push(target.baseLevel === "guest", target.baseLevel === "admin");
      sets.push(`is_guest = $${values.length - 1}`, `is_admin = $${values.length}`);
    }
    if (password) {
      const error = await validatePassword(password, q);
      if (error) throw badRequest(error);
      values.push(hashPassword(password));
      sets.push(`password_hash = $${values.length}`);
    }
    if (sets.length === 0 && deactivation === null) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    if (sets.length > 0) {
      values.push(id);
      const r = await q.query(
        `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length}::bigint`,
        values,
      );
      if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (deactivation !== null) {
      await setUserDeactivated(q, id, deactivation, {
        preserveSessionTokenHash: currentSession?.tokenHash ?? null,
      });
    }
    // MCP is not available to guests. Revoke existing tokens in this same
    // transaction when a member is changed to a guest role.
    const becomesGuest = role ? role.isGuest : target.baseLevel === "guest";
    if (becomesGuest && target.baseLevel !== "guest") {
      await revokeAllUserTokens(id, q);
    }
    if (password) {
      // A password reset is a credential change; existing MCP tokens must stop
      // working in the same transaction.
      await revokeSessionsAndMcpTokens(q, id, {
        preserveSessionTokenHash: currentSession?.tokenHash ?? null,
      });
    }
    const selected = await q.query(
      `SELECT id, name, email, title, avatar_url, is_guest, is_admin, role_id,
         totp_enabled, deactivated_at::text AS deactivated_at FROM users WHERE id = $1`,
      [id],
    );
    if (selected.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    const updated = selected.rows[0];
    const roleRow = await q.query(
      "SELECT key, name FROM workspace_roles WHERE id = $1",
      [updated.role_id],
    );
    return NextResponse.json({
      ...updated,
      role_key: roleRow.rows[0]?.key ?? null,
      role_name: roleRow.rows[0]?.name ?? null,
    });
  }).catch((e) => {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "email already used" }, { status: 409 });
    }
    throw e;
  });
});

export const DELETE = withAdminPermission("members.manage", async (_req, { uid: admin, params }) => {
  const id = Number(params.id);
  return withManagedUser(admin, id, "members.manage", async (q, { target, active }) => {
    if (id === admin) throw badRequest("cannot delete self");
    if (active && target.baseLevel === "admin") await requireAnotherAdmin(q, id, target.isSuper);
    await q.query("DELETE FROM users WHERE id = $1", [id]);
    return NextResponse.json({ deleted: id });
  });
});
