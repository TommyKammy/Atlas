import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifySection } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { withResourceProject } from "@/lib/api/route";

export const DELETE = withResourceProject("edit", "sections", async (_req, { uid, params }) => {
  const id = params.id;
  const r = await db.query("DELETE FROM sections WHERE id = $1::bigint", [id]);
  if (r.rowCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  await notifySection(id);
  await audit(uid, "section.delete", { entity: "section", entityId: id });
  return NextResponse.json({ deleted: Number(id) });
});
