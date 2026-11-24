import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";
import { getAdminRoles } from "@/lib/admin-data";
import { isPermission, normalizePermissions, type Permission } from "@/lib/permissions";
import { revokeAllUserTokens } from "@/lib/services/mcp-tokens";

const BASE_LEVELS = new Set(["admin", "member", "guest"]);
const MEMBER_ONLY_PERMISSIONS = new Set(["projects.create", "tasks.create"]);

function permissionsForBase(baseLevel: string, value: unknown): Permission[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every(isPermission)) return null;
  const permissions = normalizePermissions(value);
  if (baseLevel !== "admin") {
    return permissions.filter((p) => MEMBER_ONLY_PERMISSIONS.has(p));
  }
  return permissions;
}

async function loadRole(id: number) {
  const r = await db.query(
    `SELECT id, workspace_id, name, base_level, permissions, is_system, is_super
     FROM workspace_roles WHERE id = $1`,
    [id],
  );
  return r.rows[0] as
    | {
        id: number;
        workspace_id: number;
        name: string;
        base_level: "admin" | "member" | "guest";
        permissions: unknown;
        is_system: boolean;
        is_super: boolean;
      }
    | undefined;
}

export const PATCH = withAdminPermission("roles.manage", async (req, { uid, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid role id" }, { status: 400 });
  }
  const role = await loadRole(id);
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (role.is_system) {
    return NextResponse.json({ error: "system roles cannot be edited" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const sets: string[] = [];
  const values: unknown[] = [];
  let nextBase = role.base_level;
  if (typeof body?.name === "string") {
    const name = body.name.trim().slice(0, 80);
    if (!name) return NextResponse.json({ error: "role name is required" }, { status: 400 });
    values.push(name);
    sets.push(`name = $${values.length}`);
  }
  if (typeof body?.description === "string") {
    values.push(body.description.trim().slice(0, 500));
    sets.push(`description = $${values.length}`);
  }
  if (typeof body?.base_level === "string") {
    if (!BASE_LEVELS.has(body.base_level)) {
      return NextResponse.json({ error: "invalid base level" }, { status: 400 });
    }
    nextBase = body.base_level;
    values.push(nextBase);
    sets.push(`base_level = $${values.length}`);
  }
  if (body?.permissions !== undefined) {
    const permissions = permissionsForBase(nextBase, body.permissions);
    if (permissions === null) {
      return NextResponse.json({ error: "invalid permissions" }, { status: 400 });
    }
    if (Number(id) === Number((await db.query("SELECT role_id FROM users WHERE id = $1", [uid])).rows[0]?.role_id)) {
      if (nextBase !== "admin" || !permissions.includes("roles.manage")) {
        return NextResponse.json({ error: "cannot remove your own role management access" }, { status: 400 });
      }
    }
    values.push(JSON.stringify(permissions));
    sets.push(`permissions = $${values.length}::jsonb`);
  }
  if (sets.length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  values.push(id);
  // The role and its users' legacy flags must change together; otherwise a
  // failed second write would leave the two sources of truth disagreeing.
  const updated = await withTransaction(async (q) => {
    const roleUpdate = await q.query(
      `UPDATE workspace_roles SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id, name, base_level`,
      values,
    );
    await q.query(
      "UPDATE users SET is_admin = $2, is_guest = $3 WHERE role_id = $1",
      [id, nextBase === "admin", nextBase === "guest"],
    );
    // Guests cannot use MCP. Revoke tokens for every member of a role that is
    // being changed to the guest level, in the same transaction.
    if (nextBase === "guest" && role.base_level !== "guest") {
      const members = await q.query("SELECT id FROM users WHERE role_id = $1", [id]);
      for (const member of members.rows as Array<{ id: number }>) {
        await revokeAllUserTokens(Number(member.id), q);
      }
    }
    return roleUpdate;
  });
  await audit(uid, "role.update", {
    entity: "role",
    entityId: id,
    summary: `${updated.rows[0].name} (${nextBase})`,
  });
  return NextResponse.json({ roles: await getAdminRoles(role.workspace_id) });
});

export const DELETE = withAdminPermission("roles.manage", async (_req, { uid, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid role id" }, { status: 400 });
  }
  const role = await loadRole(id);
  if (!role) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (role.is_system) {
    return NextResponse.json({ error: "system roles cannot be deleted" }, { status: 400 });
  }
  const used = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1", [id]);
  if ((used.rows[0].n as number) > 0) {
    return NextResponse.json({ error: "role is assigned to users" }, { status: 400 });
  }
  await db.query("DELETE FROM workspace_roles WHERE id = $1", [id]);
  await audit(uid, "role.delete", { entity: "role", entityId: id, summary: role.name });
  return NextResponse.json({ roles: await getAdminRoles(role.workspace_id) });
});
