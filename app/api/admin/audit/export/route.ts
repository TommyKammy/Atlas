import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdmin } from "@/lib/api/route";
import { csvResponse, toCsv } from "@/lib/csv";

export const GET = withAdmin(async (req) => {
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") {
    return NextResponse.json({ error: "format must be json or csv" }, { status: 400 });
  }
  const r = await db.query(
    `SELECT a.id, a.created_at::text AS created_at, u.name AS actor_name, a.action,
       a.entity, a.entity_id, p.name AS project_name, a.summary
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.actor_id
     LEFT JOIN projects p ON p.id = a.project_id
     ORDER BY a.id DESC LIMIT 5000`,
  );
  if (format === "json") {
    return new NextResponse(JSON.stringify({ exported_at: new Date().toISOString(), rows: r.rows }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="atlas-audit.json"`,
      },
    });
  }
  const rows: unknown[][] = [["id", "日時", "操作者", "操作", "対象", "対象ID", "プロジェクト", "概要"]];
  for (const row of r.rows as {
    id: number;
    created_at: string;
    actor_name: string | null;
    action: string;
    entity: string;
    entity_id: number | null;
    project_name: string | null;
    summary: string;
  }[]) {
    rows.push([
      row.id,
      row.created_at,
      row.actor_name ?? "",
      row.action,
      row.entity,
      row.entity_id ?? "",
      row.project_name ?? "",
      row.summary,
    ]);
  }
  return csvResponse("atlas-audit.csv", toCsv(rows));
});
