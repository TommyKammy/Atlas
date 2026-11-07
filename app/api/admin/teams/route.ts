import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { withAdminPermission } from "@/lib/api/route";
import { getAdminTeams } from "@/lib/admin-data";

const PRIVACY = new Set(["public", "private", "approval"]);
const STATUS = new Set(["active", "approved"]);
const MEMBER_ROLES = new Set(["manager", "member"]);

type MemberInput = { user_id: number; role: string };

function parseMembers(value: unknown): MemberInput[] | null {
  if (value === undefined) return [];
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

async function replaceMembers(client: { query: typeof db.query }, teamId: number, members: MemberInput[]) {
  await client.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
  for (const member of members) {
    await client.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [teamId, member.user_id, member.role],
    );
  }
}

export const GET = withAdminPermission("teams.manage", async () => {
  const ws = await db.query("SELECT id FROM workspaces ORDER BY id LIMIT 1");
  const workspaceId = Number(ws.rows[0]?.id ?? 1);
  return NextResponse.json({ teams: await getAdminTeams(workspaceId) });
});

export const POST = withAdminPermission("teams.manage", async (req, { uid }) => {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 1000) : "";
  const privacy = typeof body?.privacy === "string" ? body.privacy : "public";
  const status = typeof body?.status === "string" ? body.status : "active";
  const members = parseMembers(body?.members);
  if (!name) return NextResponse.json({ error: "team name is required" }, { status: 400 });
  if (!PRIVACY.has(privacy)) return NextResponse.json({ error: "invalid privacy" }, { status: 400 });
  if (!STATUS.has(status)) return NextResponse.json({ error: "invalid status" }, { status: 400 });
  if (members === null) return NextResponse.json({ error: "invalid members" }, { status: 400 });

  const ws = await db.query("SELECT id FROM workspaces ORDER BY id LIMIT 1");
  const workspaceId = Number(ws.rows[0]?.id ?? 1);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO teams (workspace_id, name, description, privacy, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [workspaceId, name, description, privacy, status, uid],
    );
    const teamId = Number(inserted.rows[0].id);
    const withCreator = members.some((m) => m.user_id === uid)
      ? members.map((m) => (m.user_id === uid ? { ...m, role: "manager" } : m))
      : [{ user_id: uid, role: "manager" as const }, ...members];
    await replaceMembers(client, teamId, withCreator);
    await client.query("COMMIT");
    await audit(uid, "team.create", { entity: "team", entityId: teamId, summary: name });
    const teams = await getAdminTeams(workspaceId);
    return NextResponse.json({ teams, team: teams.find((t) => t.id === teamId) ?? null }, { status: 201 });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "team name already used" }, { status: 409 });
    }
    throw e;
  } finally {
    client.release();
  }
});
