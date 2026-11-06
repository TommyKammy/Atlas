import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserIdFromRequest } from "@/lib/current-user";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const uid = getCurrentUserIdFromRequest(req);
  const me = await db.query("SELECT is_admin FROM users WHERE id = $1 AND deactivated_at IS NULL", [uid]);
  if (me.rowCount === 0 || me.rows[0].is_admin !== true) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
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
  const lines = ["id,日時,操作者,操作,対象,対象ID,プロジェクト,概要"];
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
    lines.push(
      [row.id, row.created_at, row.actor_name ?? "", row.action, row.entity, row.entity_id ?? "", row.project_name ?? "", row.summary]
        .map(csvCell)
        .join(","),
    );
  }
  return new NextResponse("\uFEFF" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="atlas-audit.csv"`,
    },
  });
}
