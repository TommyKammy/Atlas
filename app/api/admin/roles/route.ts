import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";
import { getAdminRoles } from "@/lib/admin-data";
import { isPermission, normalizePermissions } from "@/lib/permissions";

const BASE_LEVELS = new Set(["admin", "member", "guest"]);
const MEMBER_ONLY_PERMISSIONS = new Set(["projects.create", "tasks.create"]);

function permissionsForBase(baseLevel: string, value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every(isPermission)) return null;
  const permissions = normalizePermissions(value);
  if (baseLevel !== "admin") {
    return permissions.filter((p) => MEMBER_ONLY_PERMISSIONS.has(p));
  }
  return permissions;
}

async function workspaceId(): Promise<number> {
  const ws = await db.query("SELECT id FROM workspaces ORDER BY id LIMIT 1");
  return Number(ws.rows[0]?.id ?? 1);
}

export const GET = withAdminPermission("roles.manage", async () => {
  return NextResponse.json({ roles: await getAdminRoles(await workspaceId()) });
});

export const POST = withAdminPermission("roles.manage", async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : "";
  const baseLevel = typeof body?.base_level === "string" ? body.base_level : "member";
  const permissions = permissionsForBase(baseLevel, body?.permissions ?? []);
  if (!name) return NextResponse.json({ error: "role name is required" }, { status: 400 });
  if (!BASE_LEVELS.has(baseLevel)) {
    return NextResponse.json({ error: "invalid base level" }, { status: 400 });
  }
  if (permissions === null) {
    return NextResponse.json({ error: "invalid permissions" }, { status: 400 });
  }
  const wsId = await workspaceId();
  const key = `custom_${randomBytes(4).toString("hex")}`;
  try {
    const r = await db.query(
      `INSERT INTO workspace_roles (workspace_id, key, name, description, base_level, permissions, is_system)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, FALSE)
       RETURNING id`,
      [wsId, key, name, description, baseLevel, JSON.stringify(permissions)],
    );
    await audit(uid, "role.create", {
      entity: "role",
      entityId: r.rows[0].id,
      summary: `${name} (${baseLevel})`,
    });
    return NextResponse.json({ roles: await getAdminRoles(wsId) }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "role already exists" }, { status: 409 });
    }
    throw e;
  }
});
