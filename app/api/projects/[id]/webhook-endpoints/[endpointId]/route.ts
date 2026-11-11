import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withProject } from "@/lib/api/route";
import { audit } from "@/lib/audit";

export const DELETE = withProject("configure", async (_req, { uid, projectId, params }) => {
  const id = Number(params.endpointId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid endpoint id" }, { status: 400 });
  }
  const r = await db.query(
    "DELETE FROM automation_webhook_endpoints WHERE id = $1::bigint AND project_id = $2::bigint",
    [id, projectId],
  );
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await audit(uid, "automation.webhook.delete", {
    entity: "automation_webhook",
    entityId: id,
    projectId,
  });
  return NextResponse.json({ deleted: id });
});
