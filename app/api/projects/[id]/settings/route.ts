import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { normalizeProjectSettings } from "@/lib/project-settings";
import { getNotificationDeliveryStatus } from "@/lib/notification-delivery-status";

/** Project settings payload for the header action dialog. */
export const GET = withProject("admin", async (_req, { projectId }) => {
  const project = await db.query(
    `SELECT id, workspace_id, name, description, status, status_color,
       owner_id, team_id, due_on::text AS due_on, settings
     FROM projects WHERE id = $1::bigint`,
    [projectId],
  );
  if (project.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = project.rows[0];
  const teams = await db.query(
    "SELECT id, name, description FROM teams WHERE workspace_id = $1::bigint ORDER BY name, id",
    [row.workspace_id],
  );
  return NextResponse.json({
    notification_delivery: await getNotificationDeliveryStatus(projectId),
    project: {
      id: Number(row.id),
      workspace_id: Number(row.workspace_id),
      name: row.name,
      description: row.description ?? "",
      status: row.status,
      status_color: row.status_color ?? "none",
      owner_id: row.owner_id === null ? null : Number(row.owner_id),
      team_id: row.team_id === null ? null : Number(row.team_id),
      due_on: row.due_on ?? null,
      settings: normalizeProjectSettings(row.settings),
    },
    teams: teams.rows.map((team) => ({
      id: Number(team.id),
      name: team.name,
      description: team.description ?? "",
    })),
  });
});
