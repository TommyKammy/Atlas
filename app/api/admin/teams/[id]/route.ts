import { NextResponse } from "next/server";
import { db, withTransaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";
import { getAdminTeams } from "@/lib/admin-data";

const PRIVACY = new Set(["public", "private", "approval"]);
const STATUS = new Set(["active", "approved"]);
const MEMBER_ROLES = new Set(["manager", "member"]);

type MemberInput = { user_id: number; role: string };

function parseMembers(value: unknown): MemberInput[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  const out: MemberInput[] = [];
  for (const item of value) {
    const userId = Number((item as { user_id?: unknown })?.user_id);
    const role = String((item as { role?: unknown })?.role ?? "member");
    if (!Number.isInteger(userId) || userId <= 0 || !MEMBER_ROLES.has(role) || seen.has(userId)) {
      return null;
    }
    seen.add(userId);
    out.push({ user_id: userId, role });
  }
  return out;
}

export const PATCH = withAdminPermission("teams.manage", async (req, { uid, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid team id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof body?.name === "string") {
    const name = body.name.trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "team name is required" }, { status: 400 });
    values.push(name);
    sets.push(`name = $${values.length}`);
  }
  if (typeof body?.description === "string") {
    values.push(body.description.trim().slice(0, 1000));
    sets.push(`description = $${values.length}`);
  }
  if (typeof body?.privacy === "string") {
    if (!PRIVACY.has(body.privacy)) return NextResponse.json({ error: "invalid privacy" }, { status: 400 });
    values.push(body.privacy);
    sets.push(`privacy = $${values.length}`);
  }
  if (typeof body?.status === "string") {
    if (!STATUS.has(body.status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
    values.push(body.status);
    sets.push(`status = $${values.length}`);
  }
  const members = body?.members === undefined ? undefined : parseMembers(body.members);
  if (body?.members !== undefined && members === null) {
    return NextResponse.json({ error: "invalid members" }, { status: 400 });
  }
  if (sets.length === 0 && members === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  let updated: { name: string; workspaceId: number } | null = null;
  try {
    updated = await withTransaction(async (q) => {
      const team = await q.query("SELECT id, workspace_id, name FROM teams WHERE id = $1 FOR UPDATE", [id]);
      if (team.rowCount === 0) return null;
      if (sets.length > 0) {
        values.push(id);
        await q.query(`UPDATE teams SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      }
      if (members !== undefined && members !== null) {
        await q.query("DELETE FROM team_members WHERE team_id = $1", [id]);
        for (const member of members) {
          await q.query(
            "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            [id, member.user_id, member.role],
          );
        }
      }
      return {
        name: String(team.rows[0].name),
        workspaceId: Number(team.rows[0].workspace_id),
      };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "team name already used" }, { status: 409 });
    }
    throw e;
  }
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "team.update", {
    entity: "team",
    entityId: id,
    workspaceId: updated.workspaceId,
    summary: updated.name,
  });
  const teams = await getAdminTeams(updated.workspaceId);
  return NextResponse.json({ teams, team: teams.find((t) => t.id === id) ?? null });
});

export const DELETE = withAdminPermission("teams.manage", async (_req, { uid, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid team id" }, { status: 400 });
  }
  const r = await db.query("DELETE FROM teams WHERE id = $1 RETURNING id, name, workspace_id", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "team.delete", {
    entity: "team",
    entityId: id,
    workspaceId: Number(r.rows[0].workspace_id),
    summary: r.rows[0].name,
  });
  return NextResponse.json({ teams: await getAdminTeams(Number(r.rows[0].workspace_id)) });
});
